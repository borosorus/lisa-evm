/**
 * Decoder / disassembler: LISA bytecode to concrete instructions.
 *
 * Rejects invalid opcodes and truncated programs consistently. Structural
 * decoding is permissive about values the runtime only rejects at execution
 * time (e.g. DUP 0), which are reported verbatim.
 */

import { decodeRel16, instructionFor } from './isa.ts';
import type { Instruction } from './encode.ts';

export interface DecodedInstruction extends Instruction {
  /** Name from the canonical ISA table, e.g. "ADD" or "PUSH". */
  readonly name: string;
  /** Byte address of the opcode within the program. */
  readonly offset: number;
  /** Total encoded size in bytes. */
  readonly size: number;
  /** For JMP/JZ: absolute target address (operand address + delta). */
  readonly target?: number;
}

export class DecodeError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`${message} (at byte ${offset})`);
    this.name = 'DecodeError';
    this.offset = offset;
  }
}

/** Decode bytecode into instructions. Throws DecodeError on malformed input. */
export function decode(program: Uint8Array): DecodedInstruction[] {
  const out: DecodedInstruction[] = [];
  let offset = 0;
  while (offset < program.length) {
    const opcode = program[offset];
    const spec = instructionFor(opcode);
    if (!spec) throw new DecodeError(`invalid opcode 0x${opcode.toString(16).padStart(2, '0')}`, offset);

    let size = 1;
    let value: bigint | undefined;
    let index: number | undefined;
    let rel: number | undefined;
    let relWord: number | undefined;
    let target: number | undefined;
    let data: Uint8Array | undefined;

    switch (spec.operandKind) {
      case 'none':
        break;
      case 'push': {
        const bytes = readSlice(program, offset + 1, spec.operandBytes, offset, `PUSH${opcode} immediate`);
        value = bytes.reduce((v, b) => (v << 8n) | BigInt(b), 0n);
        size = 1 + spec.operandBytes;
        break;
      }
      case 'index': {
        readSlice(program, offset + 1, 1, offset, `${spec.name} operand`);
        index = program[offset + 1];
        size = 2;
        break;
      }
      case 'rel16': {
        const bytes = readSlice(program, offset + 1, 2, offset, `${spec.name} offset`);
        relWord = (bytes[0] << 8) | bytes[1];
        rel = decodeRel16(relWord);
        target = offset + 1 + rel;
        size = 3;
        break;
      }
      case 'blob': {
        const lenBytes = readSlice(program, offset + 1, 2, offset, 'BLOB length');
        const len = (lenBytes[0] << 8) | lenBytes[1];
        data = readSlice(program, offset + 3, len, offset, 'BLOB data');
        size = 3 + len;
        break;
      }
    }

    out.push({
      opcode,
      name: spec.name,
      offset,
      size,
      ...(value !== undefined ? { value } : {}),
      ...(index !== undefined ? { index } : {}),
      ...(rel !== undefined ? { rel, relWord: relWord!, target: target! } : {}),
      ...(data !== undefined ? { data } : {}),
    });
    offset += size;
  }
  return out;
}

function readSlice(
  program: Uint8Array,
  start: number,
  length: number,
  errorOffset: number,
  what: string,
): Uint8Array {
  if (start + length > program.length) {
    throw new DecodeError(`truncated program: ${what} needs ${length} byte(s)`, errorOffset);
  }
  return program.slice(start, start + length);
}

/** Human-readable single-line disassembly, e.g. `PUSH2 0x1234` or `JMP -> 89`. */
export function disassemble(program: Uint8Array): string[] {
  return decode(program).map((i) => {
    const base = `${i.name}${i.opcode >= 0x01 && i.opcode <= 0x20 ? i.opcode : ''}`;
    switch (i.name) {
      case 'PUSH':
        return `${base} 0x${(i.value ?? 0n).toString(16)}`;
      case 'DUP':
      case 'SWAP':
        return `${base} ${i.index}`;
      case 'JMP':
      case 'JZ':
        return `${base} ${i.rel! >= 0 ? '+' : ''}${i.rel} -> ${i.target}`;
      case 'BLOB':
        return `${base} ${i.data!.length} byte(s)`;
      default:
        return base;
    }
  });
}
