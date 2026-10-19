import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createProgram, LoweringError, type CallResult, type ProgramBuilder, TryCallResult } from '../src/builder.ts';
import { encodeCall, rawCalldata, selectorOf } from '../src/abi.ts';
import { CALLER, context, SELF, TIMESTAMP, Value } from '../src/expr.ts';
import { decode } from '../src/decode.ts';
import { bytesToHex, hexToBytes } from '../src/bytes.ts';
import { pop as popNode, push, stop } from '../src/api.ts';
import type { CompiledProgram } from '../src/compile.ts';

const CALL_CD = () => encodeCall('execute(uint256)', [42n]);

/** Byte address of a generated label, by its unique prefix. */
function labelOf(c: CompiledProgram, prefix: string): number | undefined {
  const names = [...c.labels.keys()].filter((n) => n.startsWith(prefix));
  assert.equal(names.length, 1, `exactly one label starting with ${prefix}, got ${[...c.labels.keys()]}`);
  return c.labels.get(names[0]!);
}

/** DUP depths in emission order — a read-out of the shadow stack at each use. */
function dupDepths(p: ProgramBuilder): number[] {
  return decode(p.compile().bytes)
    .filter((i) => i.name === 'DUP')
    .map((i) => i.index!);
}

/**
 * POPs beyond the one every call emits to drop its return size, i.e. the pops
 * that close branch bodies. Counting nodes (not bytes) keeps call guards out.
 */
function branchCleanupPops(p: ProgramBuilder): number {
  const ast = p.toAST();
  const count = (op: 'POP' | 'CALL' | 'STATICCALL') =>
    ast.filter((n) => n.kind === 'op' && n.op === op).length;
  return count('POP') - count('CALL') - count('STATICCALL');
}

test('hand-lowered gt vector', () => {
  // a > b lowers to LT(b, a): SELF, CALLER, LT, JZ +2 to the auto-appended STOP.
  const p = createProgram();
  p.if(CALLER.gt(SELF), () => {});
  assert.equal(p.compile().hex, '0x3334292c000200');
});

test('acceptance program lowers to the golden bytes', () => {
  // Guidance example. Trace: CALLER target; BLOB balanceOf template; patch
  // arg with SELF; STATICCALL; revert-on-fail; PUSH0/RDLOAD decode word0;
  // gt lowers to PUSH limit + DUP balance + LT; branch CALLs execute(balance)
  // reusing the slot as DUP6 under the call operands.
  const p = createProgram();
  const balance = p.staticCall(CALLER, encodeCall('balanceOf(address)', [SELF])).uint256();
  p.if(balance.gt(1000), () => {
    p.call(CALLER, encodeCall('execute(uint256)', [balance]));
  });
  const c = p.compile();
  // Includes the runtime range guard on the SELF address patch:
  // DUP1, PUSH21 2^160, LT, JZ fail / fail: REVERT — stack-neutral.
  assert.equal(
    c.hex,
    '0x342d002470a082310000000000000000000000000000000000000000000000000000000000000000220201042433220115010000000000000000000000000000000000000000292c00052b0003392e312c0006212b0003390100320203e82202292c003d3401002d0024fe0d94c10000000000000000000000000000000000000000000000000000000000000000220201042422062e302c0006212b00033900',
  );
  // Golden is only meaningful if it also decodes cleanly through the low layer.
  for (const instr of decode(c.bytes)) void instr;
});

test('reused values duplicate at correct depth; branch joins are balanced', () => {
  const p = createProgram();
  const t = p.staticCall(CALLER, encodeCall('emptyReturn()')).uint256();
  p.if(t.eq(TIMESTAMP), () => {
    const inner = p.staticCall(CALLER, CALL_CD()).uint256();
    p.if(inner.eq(t), () => {});
  });
  const c = p.compile(); // must not throw: nested joins pop their own slots
  assert.ok(c.labels.has('__if_end_3'));
  const lines = decode(c.bytes);
  // Reuse is depth-correct: [t, inner] + DUP(inner)=1, then t is 3 from the
  // top because the first operand's copy is already stacked: DUP 3.
  assert.ok(lines.some((i) => i.name === 'DUP' && i.index === 3));
});

test('stack limit fails with a clear lowering error', () => {
  const p = createProgram();
  const keep: Value[] = [];
  assert.throws(() => {
    for (let i = 0; i < 17; i++) {
      keep.push(p.staticCall(CALLER, CALL_CD()).uint256());
    }
  }, (err: unknown) => err instanceof LoweringError && /would need 17 slots, maximum is 16/.test(`${err}`));
});

test('values from a closed branch are rejected', () => {
  const p = createProgram();
  let leaked: Value | undefined;
  p.if(1, () => {
    leaked = p.staticCall(CALLER, CALL_CD()).uint256();
  });
  const v = leaked!;
  assert.throws(
    () => p.if(v.eq(0), () => {}),
    (err: unknown) => err instanceof LoweringError && /out of scope/.test(`${err}`),
  );
});

test('values from another program are rejected', () => {
  const a: ProgramBuilder = createProgram();
  const b: ProgramBuilder = createProgram();
  const v = a.staticCall(CALLER, CALL_CD()).uint256();
  assert.throws(
    () => b.if(v.eq(1), () => {}),
    (err: unknown) => err instanceof LoweringError && /different program/.test(`${err}`),
  );
});

test('decoding after a later call is rejected as stale', () => {
  const p = createProgram();
  const first = p.staticCall(CALLER, CALL_CD());
  p.staticCall(CALLER, CALL_CD());
  assert.throws(
    () => first.uint256(),
    (err: unknown) => err instanceof LoweringError && /stale/.test(`${err}`),
  );
});

test('CALL default value is PUSH1 0 and explicit values materialize', () => {
  const p = createProgram();
  p.call(CALLER, CALL_CD()); // value defaults to 0
  const withValue = p.call(CALLER, CALL_CD(), TIMESTAMP); // runtime value
  assert.ok(withValue !== undefined);
  const hex = p.compile().hex;
  // first CALL: CALLER PUSH0 BLOB...; second: CALLER TIMESTAMP BLOB...
  assert.ok(hex.includes('3401002d0024'));
  assert.ok(hex.includes('34382d0024')); // second: CALLER TIMESTAMP(0x38) BLOB...
});

test('try calls preserve success as a reusable runtime slot without a failure guard', () => {
  const p = createProgram();
  const first = p.tryStaticCall(CALLER, rawCalldata('0xdeadbeef'));
  const second = p.tryCall(CALLER, rawCalldata('0xdeadbeef'), TIMESTAMP);

  assert.ok(first instanceof TryCallResult);
  assert.ok(first.success instanceof Value);
  assert.ok(second.success instanceof Value);
  p.if(first.success, () => {});
  p.revertUnless(second.success.eq(1));
  p.if(first.success, () => {}); // the earlier flag survives the newer call

  const instructions = decode(p.compile().bytes);
  const names = instructions.map((instruction) => instruction.name);
  assert.equal(names.filter((name) => name === 'STATICCALL').length, 1);
  assert.equal(names.filter((name) => name === 'CALL').length, 1);
  assert.equal(names.filter((name) => name === 'REVERT').length, 1); // only revertUnless
  assert.equal(names.filter((name) => name === 'JZ').length, 3); // if, revertUnless, if
  const swaps = instructions.filter((instruction) => instruction.name === 'SWAP');
  assert.deepEqual(swaps.map((instruction) => instruction.index), [2, 2]);
  assert.ok(instructions.some((instruction) => instruction.name === 'DUP' && instruction.index === 2));
  assert.ok(instructions.some((instruction) => instruction.name === 'DUP' && instruction.index === 1));

  // Every call's size is removed before the next instruction, leaving only
  // its success slot for later DUPs.
  const ast = p.toAST();
  for (let i = 0; i < ast.length; i++) {
    const node = ast[i];
    if (node?.kind === 'op' && (node.op === 'CALL' || node.op === 'STATICCALL')) {
      assert.equal(ast[i + 1]?.kind, 'swap');
      assert.equal(ast[i + 2]?.kind, 'op');
      assert.equal((ast[i + 2] as { op?: string }).op, 'POP');
    }
  }
});

test('try-call returndata has normal staleness and branch scope rules', () => {
  const p = createProgram();
  const result = p.tryStaticCall(CALLER, rawCalldata('0xdeadbeef'));
  const success = result.success;
  p.tryCall(CALLER, rawCalldata('0xdeadbeef'));
  assert.throws(() => result.word(0), (err: unknown) => err instanceof LoweringError && /stale/.test(`${err}`));
  p.if(success, () => {}); // call sequence does not invalidate the captured flag

  let branchSuccess: Value | undefined;
  p.if(1, () => {
    p.if(1, () => {
      branchSuccess = p.tryStaticCall(CALLER, rawCalldata('0xdeadbeef')).success;
    });
  });
  assert.throws(
    () => p.if(branchSuccess!, () => {}),
    (err: unknown) => err instanceof LoweringError && /out of scope/.test(`${err}`),
  );

  const nested = createProgram();
  const persistent = nested.tryStaticCall(CALLER, rawCalldata('0xdeadbeef')).success;
  nested.if(persistent, () => {
    nested.if(persistent, () => {
      nested.tryStaticCall(CALLER, rawCalldata('0xdeadbeef')).success;
    });
  });
  nested.if(persistent, () => {});
  assert.doesNotThrow(() => nested.compile()); // nested local slots clean up at both joins
});

test('call results from a closed branch are rejected', () => {
  // A CallResult captured inside a branch would decode returndata that the
  // skipped/taken runtime path may never have produced: reject after close.
  const p = createProgram();
  let leaked: CallResult | undefined;
  p.if(1, () => {
    leaked = p.staticCall(CALLER, CALL_CD());
  });
  assert.throws(
    () => leaked!.uint256(),
    (err: unknown) => err instanceof LoweringError && /out of scope/.test(`${err}`),
  );
});

test('if without else keeps its current lowering: JZ to the join, no JMP', () => {
  const p = createProgram();
  p.if(1, () => {});
  const c = p.compile();
  const ins = decode(c.bytes);
  assert.deepEqual(ins.map((i) => i.name), ['PUSH', 'JZ', 'STOP']);
  assert.equal(ins[1].target, c.bytes.length - 1); // falls through to the STOP at the join
  const end = labelOf(c, '__if_end_');
  assert.equal(end, c.bytes.length - 1);
  assert.equal(p.toAST().some((n) => n.kind === 'jmp'), false);
});

test('if/else lowers to JZ else, then, JMP end, else, end', () => {
  const p = createProgram();
  p.if(
    1,
    () => p.staticCall(CALLER, rawCalldata('0x11111111')),
    () => p.staticCall(SELF, rawCalldata('0x22222222')),
  );
  const c = p.compile();
  const ins = decode(c.bytes);
  const other = labelOf(c, '__if_else_');
  const end = labelOf(c, '__if_end_');

  // Condition, then a JZ whose target is the else label.
  assert.equal(ins[0].name, 'PUSH');
  assert.equal(ins[1].name, 'JZ');
  assert.equal(ins[1].target, other);
  assert.ok(other! < end! && end === c.bytes.length - 1, 'end is the join, at the auto-appended STOP');

  // The then path exits with a JMP to `end`: the instruction that ends right
  // at the else label is that JMP (labels are zero-width, so match on
  // position, not on the resolved target, which later guards can share).
  const thenExit = ins.filter((i) => i.offset + i.size === other);
  assert.equal(thenExit.length, 1);
  assert.equal(thenExit[0].name, 'JMP');
  assert.equal(thenExit[0].target, end);

  // Bodies sit on the expected side of the else label.
  const at = (data: string) =>
    ins.find((i) => i.name === 'BLOB' && bytesToHex(i.data!, false) === data)!.offset;
  assert.ok(at('11111111') < other!, 'then body before the else label');
  assert.ok(at('22222222') >= other! && at('22222222') < end!, 'else body between else and end');
});

test('if/else with empty branches is JZ else, JMP end, end', () => {
  const p = createProgram();
  p.if(1, () => {}, () => {});
  // PUSH1 1, JZ -> 8, JMP -> 8, STOP: with an empty then body both labels
  // collapse onto the join address, and the JMP still steps over the else.
  assert.equal(p.compile().hex, '0x01012c00052b000200');
});

test('both branch bodies join at the stack depth the if entered with', () => {
  // Only slot references emit DUP here, so the DUP sequence IS the stack
  // shape at each use: t is deep inside a branch (DUP 2) and one deep again
  // after the join (DUP 1).
  const p = createProgram();
  const t = p.staticCall(CALLER, rawCalldata('0xdeadbeef')).uint256();
  p.if(
    t.eq(0),
    () => {
      const a = p.staticCall(CALLER, rawCalldata('0xdeadbeef')).uint256();
      p.if(t.eq(a), () => {});
    },
    () => {
      const b = p.staticCall(CALLER, rawCalldata('0xdeadbeef')).uint256();
      p.if(t.eq(b), () => {});
    },
  );
  p.if(t.eq(1), () => {});
  assert.deepEqual(dupDepths(p), [1, 2, 2, 2, 2, 1]);
  // One cleanup POP per arm, so neither path carries its slot into the join.
  assert.equal(branchCleanupPops(p), 2);
});

test('nested if/else keeps stack depths correct at every level', () => {
  const p = createProgram();
  const t = p.staticCall(CALLER, rawCalldata('0xdeadbeef')).uint256();
  p.if(
    t.eq(0),
    () => {
      const a = p.staticCall(CALLER, rawCalldata('0xdeadbeef')).uint256();
      p.if(
        a.eq(0),
        () => {
          const c = p.staticCall(CALLER, rawCalldata('0xdeadbeef')).uint256();
          p.if(t.eq(c), () => {});
        },
        () => {
          p.if(t.eq(0), () => {});
        },
      );
    },
    () => {
      const d = p.staticCall(CALLER, rawCalldata('0xdeadbeef')).uint256();
      p.if(t.eq(d), () => {});
    },
  );
  p.if(t.eq(0), () => {});
  // Depths: outer cond (t) | then: a's cond | inner then: t and c, 3 deep |
  // inner else: t with a still live | outer else: t and d | join: t alone.
  assert.deepEqual(dupDepths(p), [1, 1, 3, 2, 2, 2, 2, 1]);
  // One POP for each of the three branch-local slots (a, c, d); the inner
  // else-body created none and therefore emits none.
  assert.equal(branchCleanupPops(p), 3);
});

test('branch-local values are out of scope after either branch closes', () => {
  const p = createProgram();
  let fromThen: Value | undefined;
  let fromElse: Value | undefined;
  p.if(
    1,
    () => {
      fromThen = p.staticCall(CALLER, rawCalldata('0xdeadbeef')).uint256();
    },
    () => {
      fromElse = p.staticCall(CALLER, rawCalldata('0xdeadbeef')).uint256();
    },
  );
  for (const leaked of [fromThen!, fromElse!]) {
    assert.ok(leaked);
    assert.throws(
      () => p.if(leaked.eq(0), () => {}),
      (err: unknown) => err instanceof LoweringError && /out of scope/.test(`${err}`),
    );
  }
  // While a branch is open, its own values are usable.
  assert.doesNotThrow(() =>
    p.if(1, () => {
      const local = p.staticCall(CALLER, rawCalldata('0xdeadbeef')).uint256();
      p.if(local.eq(0), () => {});
    }),
  );
});

test('branch-local call results are out of scope after either branch closes', () => {
  // Two programs so each leaked result is also the freshest returndata: with a
  // later call in the other branch, staleness would mask the scope rejection.
  const CD = rawCalldata('0xdeadbeef');

  const onThen = createProgram();
  let fromThen: CallResult | undefined;
  onThen.if(
    1,
    () => {
      fromThen = onThen.staticCall(CALLER, CD);
    },
    () => {},
  );
  assert.throws(
    () => fromThen!.uint256(),
    (err: unknown) => err instanceof LoweringError && /out of scope/.test(`${err}`),
  );

  const onElse = createProgram();
  let fromElse: CallResult | undefined;
  onElse.if(
    0,
    () => {},
    () => {
      fromElse = onElse.staticCall(CALLER, CD);
    },
  );
  assert.throws(
    () => fromElse!.uint256(),
    (err: unknown) => err instanceof LoweringError && /out of scope/.test(`${err}`),
  );

  // While a branch is open, its own result decodes normally.
  assert.doesNotThrow(() =>
    onElse.if(1, () => {
      onElse.staticCall(CALLER, CD).uint256();
    }),
  );
});

test('return data is tracked per branch path, not per emission order', () => {
  // The then arm's call never runs on the else path, so a result decoded
  // before the `if` is still current there; after the join either path may
  // have replaced it, which is exactly when staleness must bite again.
  const p = createProgram();
  const before = p.staticCall(CALLER, CALL_CD());
  let decodedInElse: Value | undefined;
  p.if(
    0,
    () => {
      p.staticCall(CALLER, CALL_CD());
    },
    () => {
      decodedInElse = before.uint256();
    },
  );
  assert.ok(decodedInElse, 'the else path decodes the pre-`if` return data');
  assert.throws(
    () => before.uint256(),
    (err: unknown) => err instanceof LoweringError && /stale/.test(`${err}`),
  );

  // Same result, decoded in the arm that goes on to call: stale from there on.
  const q = createProgram();
  const earlier = q.staticCall(CALLER, CALL_CD());
  q.if(
    1,
    () => {
      earlier.uint256(); // still current
      q.staticCall(CALLER, CALL_CD());
      assert.throws(
        () => earlier.uint256(),
        (err: unknown) => err instanceof LoweringError && /stale/.test(`${err}`),
      );
    },
    () => {},
  );
});

test('emitUnsafe appends raw nodes and the deprecated emit alias forwards', () => {
  const p = createProgram();
  p.emitUnsafe(push(7));
  p.emitUnsafe(stop);
  assert.equal(p.compile().hex, '0x010700'); // no extra STOP: the last node halted

  const viaAlias = createProgram();
  viaAlias.emit(push(7));
  viaAlias.emit(stop);
  assert.equal(viaAlias.compile().hex, p.compile().hex);

  // Escaped nodes are visible in the AST and untouched by stack accounting:
  // the POP below never shrinks the shadow, so `t` still duplicates at 1.
  const q = createProgram();
  const t = q.staticCall(CALLER, rawCalldata('0xdeadbeef')).uint256();
  q.emitUnsafe(popNode);
  q.if(t.eq(0), () => {});
  assert.equal(dupDepths(q).at(-1), 1);
});

test('runtime narrow-type arguments get a range guard; full words do not', () => {
  const reverts = (hex: string) =>
    decode(hexToBytes(hex)).filter((i) => i.name === 'REVERT').length;

  const addr = createProgram();
  addr.staticCall(CALLER, encodeCall('f(address)', [SELF]));
  // DUP1, PUSH21 2**160, LT + revert-if-out-of-range before the MSTORE.
  const addrGuard = '2201' + '15' + '01' + '00'.repeat(20) + '29';
  assert.ok(addr.compile().hex.includes(addrGuard));
  assert.equal(reverts(addr.compile().hex), 2); // call guard + argument guard

  const flag = createProgram();
  flag.staticCall(CALLER, encodeCall('f(bool)', [CALLER]));
  assert.ok(flag.compile().hex.includes('2201010229')); // DUP1, PUSH1 2, LT

  const wide = createProgram();
  wide.staticCall(CALLER, encodeCall('f(uint256)', [CALLER]));
  assert.equal(reverts(wide.compile().hex), 1); // call guard only
});

test('balance(address) lowers to the address then BALANCE at each use', () => {
  const p = createProgram();
  const bal = p.balance('0x1111111111111111111111111111111111111111');
  p.if(bal.eq(0), () => {});
  p.if(bal.eq(1), () => {});
  const ins = decode(p.compile().bytes);
  assert.deepEqual(ins.slice(0, 2).map((i) => i.name), ['PUSH', 'BALANCE']);
  assert.equal(ins[0].size, 21, 'a 20-byte address lowers to PUSH20');
  // Like GAS or SELFBALANCE: an expression emitted where it is consumed, so two
  // uses mean two reads and a stack that never held the balance.
  assert.equal(ins.filter((i) => i.name === 'BALANCE').length, 2);
  assert.equal(ins.some((i) => i.name === 'DUP'), false);
});

test('balance accepts a literal, a context Value, or a decoded address', () => {
  const p = createProgram();
  const own = p.balance(SELF);
  const other = p.balance('0x2222222222222222222222222222222222222222');
  p.if(own.lt(other), () => {});
  const ins = decode(p.compile().bytes);
  assert.deepEqual(ins.slice(0, 5).map((i) => i.name), ['SELF', 'BALANCE', 'PUSH', 'BALANCE', 'LT']);
  assert.deepEqual(dupDepths(p), [], 'two balances in one comparison, zero slots');

  const q = createProgram();
  const who = q.staticCall(CALLER, CALL_CD()).uint256();
  q.if(q.balance(who).gt(0), () => {}); // an address that only exists at runtime
  const qNames = decode(q.compile().bytes).map((i) => i.name);
  const read = qNames.indexOf('BALANCE');
  assert.ok(read > 0 && qNames[read - 1] === 'DUP', 'the address slot is duplicated into BALANCE');
});

test('balance costs no stack slot, so repeated checks cannot exhaust the stack', () => {
  const p = createProgram();
  for (let i = 0; i < 17; i++) p.if(p.balance(SELF).gt(0), () => {});
  assert.doesNotThrow(() => p.compile());
  // The same reads held as decoded values do fail, which is what makes the
  // expression form load-bearing rather than cosmetic.
  const q = createProgram();
  const keep: Value[] = [];
  assert.throws(() => {
    for (let i = 0; i < 17; i++) keep.push(q.staticCall(CALLER, CALL_CD()).uint256());
  }, (err: unknown) => err instanceof LoweringError && /would need 17 slots, maximum is 16/.test(`${err}`));
});

test('a balance Value outlives the branch it was written in and reads where used', () => {
  const p = createProgram();
  let later: Value | undefined;
  p.if(1, () => {
    later = p.balance(SELF); // describing the read emits nothing
  });
  assert.doesNotThrow(() => p.if(later!.gt(0), () => {}));
  assert.equal(decode(p.compile().bytes).filter((i) => i.name === 'BALANCE').length, 1);
});

test('revertUnless(cond) emits a stack-neutral revert guard', () => {
  const p = createProgram();
  const t = p.staticCall(CALLER, CALL_CD()).uint256();
  p.revertUnless(t.eq(1));
  p.revertUnless(1);
  const c = p.compile();
  const ins = decode(c.bytes);
  assert.equal(ins.filter((i) => i.name === 'REVERT').length, 3); // call guard + 2 requires
  const failLabels = [...c.labels].filter(([name]) => name.startsWith('__revert_fail_'));
  assert.equal(failLabels.length, 2, 'each revertUnless emitted its guard label');
  for (const [name, addr] of failLabels) {
    assert.equal(ins.find((i) => i.offset === addr)!.name, 'REVERT', `${name} lands on a REVERT`);
  }
  // Stack-neutral: `t` is still one deep afterwards, and nothing was popped.
  p.if(t.eq(2), () => {});
  assert.equal(dupDepths(p).at(-1), 1);
  assert.equal(branchCleanupPops(p), 0);
});

test('revertUnless works inside a branch and never leaves a slot behind', () => {
  const p = createProgram();
  p.if(1, () => {
    const local = p.staticCall(CALLER, CALL_CD()).uint256();
    p.revertUnless(local.gt(0));
  });
  assert.equal(branchCleanupPops(p), 1); // only the branch's own slot
  assert.equal(decode(p.compile().bytes).filter((i) => i.name === 'REVERT').length, 2);
});

test('keccak(data) hashes inline bytes and reuses the digest as a slot', () => {
  const p = createProgram();
  const a = p.keccak('0xdeadbeef');
  p.if(a.eq(0), () => {});
  const b = p.keccak(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  p.if(b.eq(0), () => {});
  p.if(a.eq(b), () => {});
  const ins = decode(p.compile().bytes);
  assert.equal(ins.filter((i) => i.name === 'KECCAK256').length, 2, 'exactly one hash per keccak() call');
  const blobs = ins.filter((i) => i.name === 'BLOB').map((i) => bytesToHex(i.data!, false));
  assert.deepEqual(blobs, ['deadbeef', 'deadbeef'], 'hex and bytes carry the same data');
  assert.deepEqual(dupDepths(p), [1, 1, 2, 2], 'three comparisons over two digests: reuse, never re-hash');

  // Each hash holds a slot, so 17 of them is a stack overflow, not a program.
  const q = createProgram();
  const keep: Value[] = [];
  assert.throws(() => {
    for (let i = 0; i < 17; i++) keep.push(q.keccak('0x00'));
  }, (err: unknown) => err instanceof LoweringError && /would need 17 slots, maximum is 16/.test(`${err}`));
});

test('a digest from a closed branch is out of scope and popped at the join', () => {
  const p = createProgram();
  let leaked: Value | undefined;
  p.if(1, () => {
    leaked = p.keccak('0xc0ffee');
  });
  assert.equal(branchCleanupPops(p), 1);
  assert.throws(
    () => p.if(leaked!.eq(0), () => {}),
    (err: unknown) => err instanceof LoweringError && /out of scope/.test(`${err}`),
  );
});

test('context() only accepts push-one context opcodes', () => {
  assert.equal(context('SELF').term.t, 'ctx');
  // BALANCE pops its address and KECCAK256 pops a range: both are builder
  // methods (p.balance, p.keccak), not context Values.
  for (const op of ['POP', 'ADD', 'STOP', 'REVERT', 'BALANCE', 'KECCAK256'] as const) {
    assert.throws(() => context(op), TypeError, op);
  }
});

test('generic return-word reads emit PUSH offset; RDLOAD at the given byte offset', () => {
  const p = createProgram();
  const r = p.staticCall(CALLER, encodeCall('pair()'));
  r.word(0);
  r.word(32); // second word is 32 bytes in
  const hex = p.compile().hex;
  assert.ok(hex.includes('010032'), 'PUSH1 0 then RDLOAD (word 0)');
  assert.ok(hex.includes('012032'), 'PUSH1 32 then RDLOAD (word 1)');
});

test('word() rejects non-word-aligned or negative offsets', () => {
  const p = createProgram();
  const r = p.staticCall(CALLER, encodeCall('emptyReturn()'));
  for (const off of [-32, 4, 31, 33, 1.5, Number.NaN]) {
    assert.throws(() => r.word(off), RangeError, `offset ${off}`);
  }
});

test('rawCalldata flows through the same BLOB call path', () => {
  const cd = rawCalldata('0xa9059cbb' + '11'.repeat(32));
  const p = createProgram();
  p.staticCall(CALLER, cd);
  const hex = p.compile().hex;
  // BLOB with the exact template bytes, then STATICCALL (0x31).
  assert.ok(hex.includes('2d0024a9059cbb' + '11'.repeat(32)));
  assert.ok(hex.includes('31')); // STATICCALL reached, no MSTORE patches emitted
});

test('mutating exposed calldata bytes cannot alter a later lowering', () => {
  const raw = rawCalldata('0xcafec0de');
  raw.template[0] = 0x00; // mutate an obtained copy
  const abi = encodeCall('noArgs()');
  abi.template[0] = 0x00;

  const p = createProgram();
  p.staticCall(CALLER, raw);
  p.staticCall(CALLER, abi);
  const hex = p.compile().hex;
  assert.ok(hex.includes('2d0004cafec0de'), 'raw bytes intact');
  assert.ok(hex.includes('2d0004' + selectorOf('noArgs()').slice(2)), 'ABI bytes intact');
});
