/**
 * Canonical LISA instruction set definition.
 *
 * This is the single source of truth for opcodes, operand widths, and
 * instruction metadata in the TypeScript toolchain. The authoritative
 * execution semantics live in `yul/LISA.yul`; everything here mirrors it.
 *
 * Operand conventions (from the runtime):
 * - PUSHn: opcode value == immediate length (0x01..0x20), n big-endian bytes.
 * - DUP/SWAP: one unsigned byte operand `n` (1..16; 0 is invalid at runtime).
 * - JMP/JZ: 16-bit sign-magnitude relative offset, relative to the address of
 *   the offset field itself (opcode address + 1). Bit 15 = backwards,
 *   bits 0..14 = magnitude.
 * - BLOB: u16 big-endian length followed by that many data bytes.
 */

export type OperandKind = 'none' | 'push' | 'index' | 'rel16' | 'blob';

export interface InstructionSpec {
  /** Canonical uppercase mnemonic, e.g. "ADD", "PUSH", "DUP". */
  readonly name: string;
  readonly opcode: number;
  /** Inline bytes consumed after the opcode byte. */
  readonly operandBytes: number;
  readonly operandKind: OperandKind;
  /** Stack effect, bottom-to-top, matching the README/Yul documentation. */
  readonly stack: string;
  readonly docs: string;
}

const spec = (
  name: string,
  opcode: number,
  operandKind: OperandKind,
  operandBytes: number,
  stack: string,
  docs: string,
): InstructionSpec => ({ name, opcode, operandKind, operandBytes, stack, docs });

/** Fixed-opcode instructions, keyed by opcode. */
export const INSTRUCTIONS: ReadonlyMap<number, InstructionSpec> = new Map(
  [
    spec('STOP', 0x00, 'none', 0, 'halt', 'Successful termination'),
    spec('POP', 0x21, 'none', 0, '[x] -> []', 'Remove top stack item'),
    spec('DUP', 0x22, 'index', 1, '[s(n)] -> [s(n), s(n)]', 'Duplicate the nth stack item (1-based from top)'),
    spec('SWAP', 0x23, 'index', 1, '[t, ..., s(n)] -> [s(n), ..., t]', 'Swap top with the nth stack item'),
    spec('ADD', 0x24, 'none', 0, '[a, b] -> [a + b]', 'Wrapping addition'),
    spec('SUB', 0x25, 'none', 0, '[a, b] -> [a - b]', 'Wrapping subtraction'),
    spec('MUL', 0x26, 'none', 0, '[a, b] -> [a * b]', 'Wrapping multiplication'),
    spec('DIV', 0x27, 'none', 0, '[a, b] -> [a / b]', 'Integer division; division by zero yields zero'),
    spec('KECCAK256', 0x28, 'none', 0, '[offset, size] -> [hash]', 'Hash virtual memory range'),
    spec('LT', 0x29, 'none', 0, '[a, b] -> [a < b]', 'Unsigned less-than'),
    spec('EQ', 0x2a, 'none', 0, '[a, b] -> [a == b]', 'Equality'),
    spec('JMP', 0x2b, 'rel16', 2, '[] -> []', 'Unconditional relative jump'),
    spec('JZ', 0x2c, 'rel16', 2, '[cond] -> []', 'Pop condition; jump when zero'),
    spec('BLOB', 0x2d, 'blob', -1, '[] -> [offset, len]', 'Copy inline data to virtual memory (len-prefixed)'),
    spec('MSTORE', 0x2e, 'none', 0, '[offset, value] -> []', 'Store word in virtual memory'),
    spec('MLOAD', 0x2f, 'none', 0, '[offset] -> [value]', 'Load word from virtual memory'),
    spec('CALL', 0x30, 'none', 0, '[target, value, offset, len] -> [rdsize, success]', 'EVM call'),
    spec('STATICCALL', 0x31, 'none', 0, '[target, offset, len] -> [rdsize, success]', 'Static EVM call'),
    spec('RDLOAD', 0x32, 'none', 0, '[offset] -> [word]', 'Load 32 bytes from latest returndata'),
    spec('SELF', 0x33, 'none', 0, '[] -> [address]', 'Current execution address'),
    spec('CALLER', 0x34, 'none', 0, '[] -> [msg.sender]', 'Original caller'),
    spec('GAS', 0x35, 'none', 0, '[] -> [gas left]', 'Gas remaining'),
    spec('SELFBALANCE', 0x36, 'none', 0, '[] -> [balance]', 'Current address balance'),
    spec('BALANCE', 0x37, 'none', 0, '[address] -> [balance]', 'Account balance'),
    spec('TIMESTAMP', 0x38, 'none', 0, '[] -> [timestamp]', 'Block timestamp'),
    spec('REVERT', 0x39, 'none', 0, 'halt', 'Revert execution'),
  ].map((s) => [s.opcode, s] as const),
);

/** PUSHn family: opcode value is the immediate byte length, 0x01..0x20. */
export const PUSH_MIN_BYTES = 1;
export const PUSH_MAX_BYTES = 32;
export const PUSH_FIRST_OPCODE = 0x01;
export const PUSH_LAST_OPCODE = 0x20;

/** Highest valid opcode; anything above is invalid at runtime. */
export const MAX_OPCODE = 0x39;

/** LISA stack depth (runtime STACK_SIZE). */
export const STACK_SIZE = 16;

/** 16-bit sign-magnitude jump limits. */
export const REL16_MAX_FORWARD = 0x7fff;
export const REL16_MAX_BACKWARD = 0x7fff;

/** Largest BLOB data length encodable in the u16 length prefix. */
export const BLOB_MAX_LEN = 0xffff;

/** Resolve any opcode (including PUSHn) to its spec, or undefined if invalid. */
export function instructionFor(opcode: number): InstructionSpec | undefined {
  if (opcode >= PUSH_FIRST_OPCODE && opcode <= PUSH_LAST_OPCODE) {
    return PUSH_SPECS.get(opcode);
  }
  return INSTRUCTIONS.get(opcode);
}

const PUSH_SPECS: ReadonlyMap<number, InstructionSpec> = new Map(
  Array.from({ length: PUSH_MAX_BYTES }, (_, i) => {
    const n = i + 1;
    const s = spec('PUSH', n, 'push', n, '[] -> [x]', `Push ${n}-byte big-endian immediate`);
    return [n, s] as const;
  }),
);

const NAME_INDEX: ReadonlyMap<string, InstructionSpec> = new Map([
  ...[...INSTRUCTIONS.values()].map((s) => [s.name, s] as const),
  ...[...PUSH_SPECS.values()].map((s) => [`PUSH${s.opcode}`, s] as const),
]);

/** Name lookup for encoder input; e.g. lookup('PUSH1') / lookup('DUP'). */
export function lookup(name: string): InstructionSpec | undefined {
  return NAME_INDEX.get(name.toUpperCase());
}

/** Decode a 16-bit sign-magnitude word into a signed delta. */
export function decodeRel16(word: number): number {
  if ((word & 0xffff) !== word) throw new RangeError(`rel16 word out of range: ${word}`);
  // `| 0` normalizes -0 (from 0x8000) to 0.
  return word & 0x8000 ? -(word & 0x7fff) || 0 : word & 0x7fff;
}

/** Encode a signed delta into a 16-bit sign-magnitude word. */
export function encodeRel16(delta: number): number {
  if (!Number.isInteger(delta)) throw new RangeError(`rel16 delta must be an integer: ${delta}`);
  if (delta > REL16_MAX_FORWARD || delta < -REL16_MAX_BACKWARD) {
    throw new RangeError(
      `rel16 delta out of range [-${REL16_MAX_BACKWARD}, ${REL16_MAX_FORWARD}]: ${delta}`,
    );
  }
  return delta < 0 ? 0x8000 | -delta : delta | 0;
}
