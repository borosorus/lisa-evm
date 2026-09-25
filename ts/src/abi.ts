/**
 * Minimal ABI calldata construction for external calls.
 *
 * Turns `encodeCall("balanceOf(address)", [SELF])` into a static BLOB
 * template (selector + 32-byte argument words) plus a list of runtime
 * patches: argument words that hold high-level Values and must be written
 * into VM memory with MSTORE after the BLOB is materialized at runtime.
 *
 * Supports static ABI types only: address, bool, uint8..uint256 (multiples
 * of 8), bytes1..bytes32. Full Solidity ABI is out of scope by design.
 */

import { bytesToHex, concat, fromBE, toBE, toBytes } from './bytes.ts';
import { keccakAscii } from './keccak.ts';
import { toValue, type Value } from './expr.ts';

/** A Value written into an argument word at `offset` (4 + 32 * argIndex). */
export interface AbiPatch {
  readonly offset: number;
  readonly arg: Value;
  /**
   * For runtime (non-literal) Values of narrow types: the emitted program
   * reverts unless the word is `< bounds`, mirroring the constant path's
   * range checks (LISA has no masking opcode, so this validates rather than
   * truncates). Undefined for uint256, whose full word is canonical.
   */
  readonly bounds?: bigint;
}

/** Immutable description of one call's calldata. */
export interface CallData {
  /** ABI signature; absent for pre-encoded raw calldata (see rawCalldata). */
  readonly signature?: string;
  /** 4-byte selector; absent for raw calldata, which may carry none. */
  readonly selector?: Uint8Array; // 4 bytes
  /** Input type names; absent for raw calldata. */
  readonly inputs?: readonly string[];
  /** selector || word0 || word1 ... (constant words inline, holes zeroed) */
  readonly template: Uint8Array;
  readonly patches: readonly AbiPatch[];
}

export type AbiArg = Value | number | bigint | boolean | string | Uint8Array;

const SIG_RE = /^([A-Za-z_$][A-Za-z0-9_$]*)\(([A-Za-z_$][A-Za-z0-9_$]*(,[A-Za-z_$][A-Za-z0-9_$]*)*)?\)$/;

interface TypeSpec {
  readonly kind: 'address' | 'bool' | 'uint' | 'bytes';
  /** bits for uint, byte count for bytes, otherwise 0 */
  readonly size: number;
}

function parseType(text: string): TypeSpec {
  if (text === 'address') return { kind: 'address', size: 0 };
  if (text === 'bool') return { kind: 'bool', size: 0 };
  const uint = /^uint([0-9]+)$/.exec(text);
  if (uint) {
    const bits = Number(uint[1]);
    if (bits < 8 || bits > 256 || bits % 8 !== 0) {
      throw new TypeError(`unsupported ABI type "${text}" (uint must be 8..256, multiple of 8)`);
    }
    return { kind: 'uint', size: bits };
  }
  const bytes = /^bytes([0-9]+)$/.exec(text);
  if (bytes) {
    const n = Number(bytes[1]);
    if (n < 1 || n > 32) {
      throw new TypeError(`unsupported ABI type "${text}" (bytes must be 1..32)`);
    }
    return { kind: 'bytes', size: n };
  }
  if (/^(u?int|bytes|string|function)$/.test(text) || text.endsWith('[]')) {
    throw new TypeError(`unsupported ABI type "${text}" (static types only: address, bool, uintN, bytesN)`);
  }
  throw new TypeError(`invalid ABI type "${text}"`);
}

/** Parse a canonical `name(type,type)` signature into name + input types. */
export function parseSignature(signature: string): { name: string; types: readonly string[] } {
  const m = SIG_RE.exec(signature);
  if (!m) throw new TypeError(`invalid function signature: "${signature}"`);
  const types = m[2] === undefined || m[2] === '' ? [] : m[2]!.split(',');
  types.forEach(parseType); // validate all before use
  return { name: m[1]!, types };
}

function constantWord(type: TypeSpec, value: Exclude<AbiArg, Value>, where: string): Uint8Array {
  if (typeof value === 'boolean') {
    if (type.kind !== 'bool') throw new TypeError(`${where}: boolean given for type "${typeName(type)}"`);
    return toBE(value ? 1n : 0n, 32);
  }
  if (type.kind === 'bool') {
    if ((typeof value === 'number' && (value === 0 || value === 1)) ||
        (typeof value === 'bigint' && (value === 0n || value === 1n))) {
      return toBE(BigInt(value), 32);
    }
    throw new TypeError(`${where}: bool argument must be true/false (or 1/0)`);
  }

  if (type.kind === 'bytes') {
    const raw = toBytes(toBytesInput(value, where));
    if (raw.length > type.size) {
      throw new RangeError(`${where}: ${raw.length} byte(s) exceed bytes${type.size}`);
    }
    const word = new Uint8Array(32);
    word.set(raw); // fixed bytes are LEFT-aligned
    return word;
  }

  const n = normalizeNumber(value, where);
  if (type.kind === 'address' && n >= 1n << 160n) {
    throw new RangeError(`${where}: ${n} is not an address (< 2^160)`);
  }
  if (type.kind === 'uint' && n >= 1n << BigInt(type.size)) {
    throw new RangeError(`${where}: ${n} does not fit in uint${type.size}`);
  }
  return toBE(n, 32);
}

function toBytesInput(value: number | bigint | string | Uint8Array, where: string): string | Uint8Array {
  if (typeof value === 'string' || value instanceof Uint8Array) return value;
  throw new TypeError(`${where}: expected bytes for this type, got ${typeof value}`);
}

function normalizeNumber(value: number | bigint | string | Uint8Array, where: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new RangeError(`${where}: negative value ${value}`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${where}: expected a non-negative safe integer, got ${value}`);
    }
    return BigInt(value);
  }
  const n = fromBE(toBytes(value)); // hex strings / raw bytes encode big-endian words
  return n;
}

function typeName(type: TypeSpec): string {
  switch (type.kind) {
    case 'address':
      return 'address';
    case 'bool':
      return 'bool';
    case 'uint':
      return `uint${type.size}`;
    case 'bytes':
      return `bytes${type.size}`;
  }
}

/** Value a runtime word must stay below for the type to remain canonical. */
function runtimeBounds(type: TypeSpec): bigint | undefined {
  switch (type.kind) {
    case 'bool':
      return 2n; // canonical bool words are 0/1
    case 'address':
      return 1n << 160n;
    case 'uint':
      return type.size < 256 ? 1n << BigInt(type.size) : undefined;
    case 'bytes':
      return undefined; // runtime bytesN arguments are rejected in encodeCall
  }
}

/**
 * Build calldata for `signature(args...)`. Constants are baked into the
 * template; high-level Values become runtime MSTORE patches.
 */
export function encodeCall(signature: string, args: readonly AbiArg[] = []): CallData {
  const { types } = parseSignature(signature);
  if (args.length !== types.length) {
    throw new TypeError(
      `encodeCall("${signature}"): expected ${types.length} argument(s), got ${args.length}`,
    );
  }
  const selector = keccakAscii(signature).slice(0, 4);
  const words: Uint8Array[] = [];
  const patches: AbiPatch[] = [];
  types.forEach((typeText, i) => {
    const type = parseType(typeText);
    const arg = args[i]!;
    const where = `encodeCall("${signature}") arg ${i} (${typeText})`;
    if (isValueLikeHandle(arg)) {
      if (arg.term.t === 'lit') {
        // A statically-known Value is no different from a constant: bake the
        // canonical word (with the constant path's checks) into the template.
        words.push(constantWord(type, arg.term.value, where));
      } else if (type.kind === 'bytes') {
        // bytesN constants are LEFT-aligned; a runtime word's alignment is
        // the value's own story and LISA cannot re-align it, so refuse to
        // guess instead of silently encoding the wrong bytes.
        throw new TypeError(`${where}: runtime arguments of bytesN are not supported (use a constant)`);
      } else {
        words.push(new Uint8Array(32)); // patched at runtime; placeholder zeros
        patches.push({ offset: 4 + 32 * i, arg, bounds: runtimeBounds(type) });
      }
    } else {
      words.push(constantWord(type, arg, where));
    }
  });
  return {
    signature,
    selector,
    inputs: types,
    template: concat(selector, ...words),
    patches,
  };
}

function isValueLikeHandle(arg: AbiArg): arg is Value {
  return typeof arg === 'object' && arg !== null && !(arg instanceof Uint8Array) && 'term' in arg;
}

/** Selector for a signature (exported for tests and address bookkeeping). */
export function selectorOf(signature: string): string {
  return bytesToHex(keccakAscii(signature).slice(0, 4));
}

/**
 * Calldata encoded elsewhere, used verbatim: no ABI parsing, no runtime
 * patches; it lowers through the same BLOB/call path as encodeCall output.
 * Accepts the project's hex/byte representations (validated like them) and
 * returns a frozen CallData whose ABI metadata is absent by design.
 */
export function rawCalldata(bytes: string | Uint8Array): CallData {
  const template = toBytes(bytes); // same validation as the other byte helpers
  if (template.length > 0xffff) {
    throw new RangeError(`calldata of ${template.length} bytes exceeds the BLOB u16 length limit`);
  }
  // The descriptor is frozen; JS offers no immutable typed arrays, so the
  // template follows the same read-only convention as encodeCall output.
  return Object.freeze({ template, patches: Object.freeze([]) as readonly AbiPatch[] });
}
