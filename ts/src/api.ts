/**
 * Ergonomic TypeScript API for constructing LISA programs.
 *
 * Thin by design: every helper returns an AST node; byte encoding, label
 * resolution, and validation all live in the compiler. Example:
 *
 * ```ts
 * import { program, push, add, label, jmp, stop } from 'lisa';
 *
 * const p = program(push(2), push(3), add, stop);
 * compile(p).hex; // 0x0102010324 00
 * ```
 */

import type { Node, NoOperandOp, Program } from './ast.ts';
import { fromBE, toBytes } from './bytes.ts';

/** Concatenate node lists into one program. */
export type ProgramPart = Node | readonly ProgramPart[];

export function program(...parts: ProgramPart[]): Program {
  const flat: Node[] = [];
  const add = (part: ProgramPart): void => {
    if (isNode(part)) flat.push(part);
    else for (const p of part) add(p);
  };
  parts.forEach(add);
  return flat;
}

function isNode(x: unknown): x is Node {
  return typeof x === 'object' && x !== null && 'kind' in x;
}

/**
 * Push an unsigned value from a number, bigint, hex string, or big-endian bytes.
 * Numbers encode at minimal width; hex/bytes keep their exact width (e.g. a
 * 20-byte address always compiles to PUSH20, like hand-written programs do).
 */
export function push(value: number | bigint | string | Uint8Array, bytes?: number): Node {
  if (typeof value === 'string' || value instanceof Uint8Array) {
    const raw = toBytes(value);
    if (raw.length < 1 || raw.length > 32) {
      throw new RangeError(`push byte input must be 1..32 bytes, got ${raw.length}`);
    }
    return push(fromBE(raw), bytes ?? raw.length);
  }
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new RangeError(`push number must be a safe integer: ${value}`);
  }
  const normalized = typeof value === 'bigint' ? value : BigInt(value);
  if (normalized < 0n || normalized >= 1n << 256n) {
    throw new RangeError(`push value out of range: ${normalized}`);
  }
  return bytes === undefined ? { kind: 'push', value: normalized } : { kind: 'push', value: normalized, bytes };
}

/** Duplicate the nth stack item (1 = top). */
export function dup(n: number): Node {
  return { kind: 'dup', n };
}

/** Swap the top with the nth stack item (1 = top, i.e. a no-op). */
export function swap(n: number): Node {
  return { kind: 'swap', n };
}

/** Unconditional relative jump to a symbolic label. */
export function jmp(target: string): Node {
  return { kind: 'jmp', target };
}

/** Pop the condition; jump to a symbolic label when it is zero. */
export function jz(target: string): Node {
  return { kind: 'jz', target };
}

/** Inline data copied into virtual memory; pushes [offset, len]. */
export function blob(data: Uint8Array | string): Node {
  return { kind: 'blob', data: toBytes(data) };
}

/** Symbolic, zero-width label marker. */
export function label(name: string): Node {
  return { kind: 'label', name };
}

/** Literal bytes, bypassing the encoder (for tooling and negative tests). */
export function raw(bytes: Uint8Array | string): Node {
  return { kind: 'raw', bytes: toBytes(bytes) };
}

// Zero-operand instructions as frozen AST node constants.
const op = (opcode: NoOperandOp): Node => Object.freeze({ kind: 'op', op: opcode });

export const stop = op('STOP');
export const pop = op('POP');
export const add = op('ADD');
export const sub = op('SUB');
export const mul = op('MUL');
export const div = op('DIV');
export const keccak256 = op('KECCAK256');
export const lt = op('LT');
export const eq = op('EQ');
export const mstore = op('MSTORE');
export const mload = op('MLOAD');
export const call = op('CALL');
export const staticcall = op('STATICCALL');
export const rdload = op('RDLOAD');
export const self = op('SELF');
export const caller = op('CALLER');
export const gas = op('GAS');
export const selfbalance = op('SELFBALANCE');
export const balance = op('BALANCE');
export const timestamp = op('TIMESTAMP');
export const revert = op('REVERT');
