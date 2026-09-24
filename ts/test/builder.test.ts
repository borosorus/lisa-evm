import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createProgram, LoweringError, type ProgramBuilder } from '../src/builder.ts';
import { encodeCall } from '../src/abi.ts';
import { CALLER, SELF, TIMESTAMP, Value } from '../src/expr.ts';
import { decode } from '../src/decode.ts';

const CALL_CD = () => encodeCall('execute(uint256)', [42n]);

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
  assert.equal(
    c.hex,
    '0x342d002470a0823100000000000000000000000000000000000000000000000000000000000000002202010424332e312c0006212b0003390100320203e82202292c003d3401002d0024fe0d94c10000000000000000000000000000000000000000000000000000000000000000220201042422062e302c0006212b00033900',
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
