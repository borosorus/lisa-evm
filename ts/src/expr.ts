/**
 * High-level runtime values for the TypeScript-first API.
 *
 * A Value is a lazily-emitted description of a word that exists when LISA
 * executes — never a JavaScript number. Two natures:
 *
 * - expression terms (literal, context opcode, binary op) are PURE: they
 *   emit their instructions whenever they are consumed, and cost a stack
 *   slot only transiently;
 * - slot terms are decoded return data: they occupy a real stack slot for
 *   their scope's lifetime, and reuse emits DUP at the correct position
 *   (computed by the builder against its shadow stack).
 *
 * Emitting lives in builder.ts; this module is data + fluent sugar.
 */

import type { NoOperandOp } from './ast.ts';
import { fromBE, toBytes } from './bytes.ts';

export type BinKind = 'add' | 'sub' | 'mul' | 'div' | 'lt' | 'gt' | 'eq';

export type ValueTerm =
  | { readonly t: 'lit'; readonly value: bigint }
  | { readonly t: 'ctx'; readonly op: NoOperandOp }
  | { readonly t: 'bin'; readonly kind: BinKind; readonly lhs: Value; readonly rhs: Value }
  | { readonly t: 'slot'; readonly id: number; readonly scope: number; readonly owner: object };

export type ValueLike = Value | number | bigint | string | Uint8Array;

export class Value {
  readonly term: ValueTerm;

  constructor(term: ValueTerm) {
    this.term = term;
  }

  add(rhs: ValueLike): Value {
    return binop('add', this, toValue(rhs));
  }
  sub(rhs: ValueLike): Value {
    return binop('sub', this, toValue(rhs));
  }
  mul(rhs: ValueLike): Value {
    return binop('mul', this, toValue(rhs));
  }
  div(rhs: ValueLike): Value {
    return binop('div', this, toValue(rhs));
  }
  lt(rhs: ValueLike): Value {
    return binop('lt', this, toValue(rhs));
  }
  /** a > b lowers to LT(b, a): LISA has only a less-than opcode. */
  gt(rhs: ValueLike): Value {
    return binop('gt', this, toValue(rhs));
  }
  eq(rhs: ValueLike): Value {
    return binop('eq', this, toValue(rhs));
  }
}

export function binop(kind: BinKind, lhs: Value, rhs: Value): Value {
  return new Value({ t: 'bin', kind, lhs, rhs });
}

export function literal(value: bigint): Value {
  if (value < 0n || value >= 1n << 256n) {
    throw new RangeError(`literal value out of range (0..2^256-1): ${value}`);
  }
  return new Value({ t: 'lit', value });
}

/** Context opcodes that push exactly one word — the only safe `ctx` terms. */
const PUSH_CONTEXT_OPS: readonly NoOperandOp[] = ['SELF', 'CALLER', 'GAS', 'TIMESTAMP', 'SELFBALANCE'];

export function context(op: NoOperandOp): Value {
  if (!PUSH_CONTEXT_OPS.includes(op)) {
    throw new TypeError(
      `context("${op}"): not a push-one context opcode (allowed: ${PUSH_CONTEXT_OPS.join(', ')})`,
    );
  }
  return new Value({ t: 'ctx', op });
}

/** Coerce a JS-ish constant into a Value; Values pass through untouched. */
export function toValue(v: ValueLike): Value {
  if (v instanceof Value) return v;
  if (typeof v === 'bigint') return literal(v);
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v) || v < 0) {
      throw new RangeError(`expected a non-negative safe integer (use bigint or hex): ${v}`);
    }
    return literal(BigInt(v));
  }
  // hex strings / byte arrays encode a word value (width-insensitive)
  return literal(fromBE(toBytes(v)));
}

// --- VM context values (the same values the README ISA table lists) ---------

/** The wallet contract executing this program (`address()`). */
export const SELF: Value = context('SELF');
/** The caller of the wallet. */
export const CALLER: Value = context('CALLER');
/** Gas remaining. */
export const GAS: Value = context('GAS');
/** Current block timestamp. */
export const TIMESTAMP: Value = context('TIMESTAMP');
/** Wallet balance. */
export const SELFBALANCE: Value = context('SELFBALANCE');
