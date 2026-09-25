/**
 * TypeScript-first program builder.
 *
 * Emits the EXISTING flat AST (ast.ts) while tracking a shadow copy of the
 * runtime stack, so high-level Values never require manual DUP/SWAP/label
 * bookkeeping. Every emitted node goes through helpers that keep the shadow
 * in sync; anything that would exceed LISA's 16-word stack fails with a
 * LoweringError instead of emitting invalid bytecode. compile() hands the
 * node list to the same two-pass compiler the low-level API uses.
 *
 * Call convention on the real stack (see yul/LISA.yul):
 *   CALL       pops [target, value, offset, len], pushes [rdsize, success]
 *   STATICCALL pops [target, offset, len],       pushes [rdsize, success]
 * Failed calls revert via a generated JZ -> REVERT guard; scalar decoding
 * uses PUSH offset; RDLOAD (which replaces the stack top in place).
 */

import type { Node, NoOperandOp } from './ast.ts';
import {
  add,
  blob,
  call as callNode,
  dup,
  jmp,
  jz,
  label,
  mstore as mstoreNode,
  pop,
  push,
  rdload as rdloadNode,
  revert as revertNode,
  staticcall as staticcallNode,
  stop as stopNode,
} from './api.ts';
import { compile, type CompiledProgram } from './compile.ts';
import { STACK_SIZE } from './isa.ts';
import { toValue, Value, type ValueLike } from './expr.ts';
import type { CallData } from './abi.ts';

/** Zero-operand node from its mnemonic. */
function opNode(name: NoOperandOp): Node {
  return { kind: 'op', op: name };
}

export class LoweringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoweringError';
  }
}

/** A persistent stack slot holding a decoded value. */
interface SlotRef {
  readonly id: number;
  readonly scope: number;
}

/** Opaque handle to a completed call's (checked) return data. */
export class CallResult {
  readonly builder: ProgramBuilder;
  readonly seq: number;
  /** Branch scope the call was emitted in; decoding after it closes is a bug. */
  readonly scope: number;

  constructor(builder: ProgramBuilder, seq: number, scope: number) {
    this.builder = builder;
    this.seq = seq;
    this.scope = scope;
  }

  /**
   * Decode the 32-byte returndata word starting at byte `offset` (must be a
   * multiple of 32). Out-of-bounds reads fail at runtime per LISA's RDLOAD
   * semantics, exactly as the scalar aliases below do for word 0.
   */
  word(offset: number): Value {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % 32 !== 0) {
      throw new RangeError(`returndata word offset must be a non-negative multiple of 32, got ${offset}`);
    }
    return this.builder.decodeWord(this, BigInt(offset));
  }

  /** Decode return word at byte offset 0. Word0 aliases: all read one RDLOAD. */
  uint256(): Value {
    return this.word(0);
  }
  bytes32(): Value {
    return this.word(0);
  }
  bool(): Value {
    return this.word(0);
  }
}

export type AddressLike = ValueLike;

const BIN_OPS = {
  add: 'ADD',
  sub: 'SUB',
  mul: 'MUL',
  div: 'DIV',
  lt: 'LT',
  eq: 'EQ',
} as const;

export class ProgramBuilder {
  private readonly nodes: Node[] = [];
  /** Runtime stack mirror: slot refs are persistent, null = transient. */
  private readonly shadow: (SlotRef | null)[] = [];
  /** Scope ids of currently open branch bodies; [0] = top level, never closed. */
  private readonly scopeStack: number[] = [0];
  private nextSlot = 1;
  private nextScope = 1;
  private labelSeq = 1;
  private callSeq = 0;

  // --- public surface ------------------------------------------------------

  /**
   * Low-level escape hatch: append raw AST nodes. They are NOT reflected in
   * the shadow stack, so they must be stack-neutral (push+consume balanced).
   */
  emit(...nodes: readonly Node[]): void {
    for (const node of nodes) this.nodes.push(node);
  }

  /** STATICCALL with no value transfer. Return data stays live. */
  staticCall(target: AddressLike, data: CallData): CallResult {
    return this.emitCall(target, data, undefined);
  }

  /** CALL; `value` (default 0) is the LISA value-transfer word. */
  call(target: AddressLike, data: CallData, value: ValueLike = 0n): CallResult {
    return this.emitCall(target, data, value);
  }

  /** Structured conditional: `body` runs when `condition` is non-zero. */
  if(condition: ValueLike, body: () => void): void {
    this.materialize(condition); // consumes below via JZ
    const end = this.freshLabel('if_end');
    this.consume(1, jz(end));
    const mark = this.shadow.length;
    const scope = this.nextScope++;
    this.scopeStack.push(scope);
    try {
      body();
    } finally {
      this.scopeStack.pop();
    }
    // Both join paths must reach `end` at the entry depth: discard slots the
    // body kept alive (the taken path pops them; the fall-through path needs
    // the POPs too, which is exactly what we emit here).
    while (this.shadow.length > mark) {
      this.shadow.pop();
      this.nodes.push(pop);
    }
    this.nodes.push(label(end));
  }

  /** The AST so far, without the auto-appended STOP (fixture plumbing). */
  toAST(): readonly Node[] {
    return [...this.nodes];
  }

  /** Compile through the existing pipeline, halting unless already halted. */
  compile(): CompiledProgram {
    const nodes = [...this.nodes];
    const last = nodes[nodes.length - 1];
    if (!last || last.kind !== 'op' || (last.op !== 'STOP' && last.op !== 'REVERT')) {
      nodes.push(stopNode);
    }
    return compile(nodes);
  }

  // --- internals -----------------------------------------------------------

  /** @internal used by CallResult */
  decodeWord(result: CallResult, offset: bigint): Value {
    if (result.builder !== this) {
      throw new LoweringError('CallResult belongs to a different program');
    }
    if (result.seq !== this.callSeq) {
      throw new LoweringError('CallResult is stale: return data was replaced by a later call');
    }
    if (!this.scopeStack.includes(result.scope)) {
      throw new LoweringError('CallResult is out of scope: its branch has closed');
    }
    this.produce(1, push(offset)); // placeholder offset word
    this.nodes.push(rdloadNode); // replaces the top word in place
    const ref: SlotRef = { id: this.nextSlot++, scope: this.scopeStack[this.scopeStack.length - 1]! };
    this.shadow[this.shadow.length - 1] = ref; // transient became persistent
    return new Value({ t: 'slot', id: ref.id, scope: ref.scope, owner: this });
  }

  private emitCall(target: AddressLike, data: CallData, value: ValueLike | undefined): CallResult {
    this.materialize(target);
    if (value !== undefined) this.materialize(value);
    this.produce(2, blob(data.template)); // pushes [offset, len], len on top

    for (const patch of data.patches) {
      // stack: [... , offset, len] (len on top): point at the arg word and
      // write the runtime value into the template in VM memory.
      this.produce(1, dup(2)); // copy the blob offset (2nd from top)
      this.produce(1, push(BigInt(patch.offset)));
      this.consume(2, add, 1); // -> memory offset of the argument word
      this.materialize(patch.arg);
      if (patch.bounds !== undefined) {
        // The argument is a runtime word that must stay canonical for its
        // ABI type (< bounds). LISA has no masking opcode, so the check runs
        // at program runtime: LT + revert-if-out-of-range (stack-neutral).
        const fail = this.freshLabel('arg_fail');
        const done = this.freshLabel('arg_ok');
        this.produce(1, dup(1));
        this.produce(1, push(patch.bounds));
        this.consume(2, opNode('LT'), 1);
        this.consume(1, jz(fail));
        this.nodes.push(jmp(done), label(fail), revertNode, label(done));
      }
      this.consume(2, mstoreNode); // pops value, then offset
    }

    const isStatic = value === undefined;
    this.consume(isStatic ? 3 : 4, isStatic ? staticcallNode : callNode, 2);
    this.callSeq += 1;

    // [rdsize, success] -> fail fast on failure, keep no slots.
    const fail = this.freshLabel('call_fail');
    const done = this.freshLabel('call_done');
    this.consume(1, jz(fail)); // pops success
    this.consume(1, pop); // discards rdsize
    this.nodes.push(jmp(done));
    this.nodes.push(label(fail), revertNode, label(done));
    return new CallResult(this, this.callSeq, this.scopeStack[this.scopeStack.length - 1]!);
  }

  private materialize(v: ValueLike): void {
    const term = toValue(v).term;
    switch (term.t) {
      case 'lit':
        this.produce(1, push(term.value));
        break;
      case 'ctx':
        this.produce(1, opNode(term.op));
        break;
      case 'bin': {
        if (term.kind === 'gt') {
          // a > b == LT(b, a): pop order is (b, a) so push b first.
          this.materialize(term.rhs);
          this.materialize(term.lhs);
        } else {
          this.materialize(term.lhs);
          this.materialize(term.rhs);
        }
        this.consume(2, opNode(term.kind === 'gt' ? 'LT' : BIN_OPS[term.kind]), 1);
        break;
      }
      case 'slot': {
        if (term.owner !== this) {
          throw new LoweringError('Value belongs to a different program');
        }
        const index = this.shadow.findIndex((s) => s !== null && s.id === term.id);
        if (index === -1 || !this.scopeStack.includes(term.scope)) {
          throw new LoweringError('Value is out of scope: its branch has closed');
        }
        this.produce(1, dup(this.shadow.length - index)); // DUP n is 1-based from the top
        break;
      }
    }
  }

  /** Emit a node that grows the runtime stack by `n` words. */
  private produce(n: number, node: Node): void {
    this.checkRoom(n);
    this.nodes.push(node);
    for (let i = 0; i < n; i++) this.shadow.push(null);
  }

  /** Emit a node that pops `n` words (optionally pushing `pushes` back). */
  private consume(n: number, node: Node, pushes = 0): void {
    if (this.shadow.length < n) {
      throw new LoweringError(`internal stack accounting error: cannot pop ${n} from ${this.shadow.length}`);
    }
    this.shadow.length -= n;
    this.checkRoom(pushes);
    this.nodes.push(node);
    for (let i = 0; i < pushes; i++) this.shadow.push(null);
  }

  private checkRoom(delta: number): void {
    if (this.shadow.length + delta > STACK_SIZE) {
      throw new LoweringError(
        `LISA stack limit exceeded: program would need ${this.shadow.length + delta} slots, maximum is ${STACK_SIZE}`,
      );
    }
  }

  private freshLabel(prefix: string): string {
    return `__${prefix}_${this.labelSeq++}`;
  }
}

export function createProgram(): ProgramBuilder {
  return new ProgramBuilder();
}
