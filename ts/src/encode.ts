/**
 * Encoder: concrete instructions (no labels) to LISA bytecode.
 *
 * All widths and operand layouts come from the canonical ISA table in isa.ts.
 */

import {
  BLOB_MAX_LEN,
  PUSH_MAX_BYTES,
  STACK_SIZE,
  decodeRel16,
  encodeRel16,
  instructionFor,
} from './isa.ts';
import { concat, toBE } from './bytes.ts';

/**
 * One fully-resolved instruction. Exactly one operand field may be present:
 * - `value`: PUSH immediate (opcode == byte width).
 * - `index`: DUP/SWAP operand (1..16).
 * - `rel`:   signed jump delta for JMP/JZ, relative to this instruction's
 *            operand field (opcode address + 1).
 * - `data`:  BLOB payload.
 */
export interface Instruction {
  readonly opcode: number;
  readonly value?: bigint;
  readonly index?: number;
  readonly rel?: number;
  readonly data?: Uint8Array;
  /**
   * Raw 16-bit jump word, retained by the decoder. Byte-exact re-encoding
   * of sign-magnitude negative zero (`0x8000`) is otherwise lossy; normal
   * encoding never needs it, so `encode` prefers it only when present.
   */
  readonly relWord?: number;
}

/**
 * Pre-encoded, decoder-validated bytecode emitted verbatim (backs AST `raw`
 * nodes). Lets programs embed bytes that decode but would not encode, such
 * as the runtime-invalid `DUP 0` used in negative tests.
 */
export interface RawInstruction {
  readonly rawBytes: Uint8Array;
}

export type AnyInstruction = Instruction | RawInstruction;

export function isRaw(instr: AnyInstruction): instr is RawInstruction {
  return 'rawBytes' in instr;
}

/** Total encoded size of an instruction. Throws on structurally invalid input. */
export function instructionSize(instr: AnyInstruction): number {
  if (isRaw(instr)) return instr.rawBytes.length;
  checkOperands(instr);
  const spec = instructionFor(instr.opcode)!;
  switch (spec.operandKind) {
    case 'push':
      return 1 + spec.operandBytes;
    case 'index':
      return 2;
    case 'rel16':
      return 3;
    case 'blob':
      return 3 + instr.data!.length;
    case 'none':
      return 1;
  }
}

function checkOperands(instr: Instruction): void {
  const spec = instructionFor(instr.opcode);
  if (!spec) throw new RangeError(`invalid opcode 0x${instr.opcode.toString(16)}`);

  const given = (['value', 'index', 'rel', 'data'] as const).filter((k) => instr[k] !== undefined);
  const expected = spec.operandKind === 'none' ? 0 : 1;
  if (given.length !== expected) {
    throw new TypeError(`${spec.name}: expected ${expected} operand field(s), got ${given.length}`);
  }

  switch (spec.operandKind) {
    case 'push': {
      const v = instr.value!;
      if (v < 0n || v >= 1n << (BigInt(instr.opcode) * 8n)) {
        throw new RangeError(`PUSH${instr.opcode} value out of range: ${v}`);
      }
      break;
    }
    case 'index': {
      const n = instr.index!;
      if (!Number.isInteger(n) || n < 1 || n > STACK_SIZE) {
        throw new RangeError(`${spec.name} operand must be an integer in [1, ${STACK_SIZE}]: ${n}`);
      }
      break;
    }
    case 'rel16': {
      encodeRel16(instr.rel!); // validates range
      if (instr.relWord !== undefined) {
        // The retained raw word must be a valid u16 encoding of `rel`;
        // otherwise two fields would disagree and the emitted bytes would
        // silently contradict the instruction's `rel`.
        if (
          !Number.isInteger(instr.relWord) ||
          instr.relWord < 0 ||
          instr.relWord > 0xffff ||
          decodeRel16(instr.relWord) !== instr.rel!
        ) {
          throw new RangeError(
            `relWord 0x${(instr.relWord ?? 0).toString(16)} disagrees with rel ${instr.rel!}`,
          );
        }
      }
      break;
    }
    case 'blob': {
      if (instr.data!.length > BLOB_MAX_LEN) {
        throw new RangeError(`BLOB data exceeds ${BLOB_MAX_LEN} bytes: ${instr.data!.length}`);
      }
      break;
    }
    case 'none':
      break;
  }
}

/** Encode a program (instruction sequence) to bytecode. */
export function encode(program: readonly AnyInstruction[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const instr of program) {
    if (isRaw(instr)) {
      parts.push(instr.rawBytes);
      continue;
    }
    checkOperands(instr);
    const spec = instructionFor(instr.opcode)!;
    const head = new Uint8Array([instr.opcode]);
    switch (spec.operandKind) {
      case 'push':
        parts.push(head, toBE(instr.value!, spec.operandBytes));
        break;
      case 'index':
        parts.push(head, new Uint8Array([instr.index!]));
        break;
      case 'rel16': {
        // Prefer the decoder-retained raw word for byte-exact re-encoding
        // (sign-magnitude -0 would otherwise normalize to 0x0000).
        parts.push(head, toBE(BigInt(instr.relWord ?? encodeRel16(instr.rel!)), 2));
        break;
      }
      case 'blob': {
        const len = instr.data!.length;
        parts.push(head, toBE(BigInt(len), 2), instr.data!);
        break;
      }
      case 'none':
        parts.push(head);
        break;
    }
  }
  return concat(...parts);
}

/** Re-exported for convenience when building instructions by hand. */
export { decodeRel16, encodeRel16 };
