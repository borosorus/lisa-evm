/**
 * Compiler: AST to concrete instructions to bytecode.
 *
 * Two passes:
 * 1. Size every node and assign byte addresses to labels.
 * 2. Lower nodes to instructions, resolving label jumps to the VM's 16-bit
 *    sign-magnitude deltas (relative to the operand field: opcode address + 1).
 */

import type { Node, Program } from './ast.ts';
import { encode, type AnyInstruction } from './encode.ts';
import { PUSH_MAX_BYTES, STACK_SIZE, encodeRel16, lookup } from './isa.ts';
import { byteLength } from './bytes.ts';

export interface CompiledProgram {
  readonly instructions: readonly AnyInstruction[];
  readonly bytes: Uint8Array;
  readonly hex: string;
  /** Byte address of each label. */
  readonly labels: ReadonlyMap<string, number>;
}

export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompileError';
  }
}

export function compile(program: Program): CompiledProgram {
  const instructions: AnyInstruction[] = [];
  const labels = new Map<string, number>();

  // Pass 1: sizes of every node, addresses of every label.
  const sizes = program.map(nodeSize);
  let addr = 0;
  for (let i = 0; i < program.length; i++) {
    const node = program[i];
    if (node.kind === 'label') {
      if (labels.has(node.name)) {
        throw new CompileError(`duplicate label "${node.name}" at byte ${addr}`);
      }
      labels.set(node.name, addr);
    }
    addr += sizes[i];
  }

  // Pass 2: lower nodes to instructions, resolving label jumps.
  addr = 0;
  for (let i = 0; i < program.length; i++) {
    const node = program[i];
    switch (node.kind) {
      case 'push':
        instructions.push({ opcode: pushWidth(node), value: node.value });
        break;
      case 'op':
        instructions.push({ opcode: opcodeOf(node.op) });
        break;
      case 'dup':
        checkIndex('DUP', node.n);
        instructions.push({ opcode: opcodeOf('DUP'), index: node.n });
        break;
      case 'swap':
        checkIndex('SWAP', node.n);
        instructions.push({ opcode: opcodeOf('SWAP'), index: node.n });
        break;
      case 'jmp':
      case 'jz': {
        // Labels always sit on node boundaries (assigned in pass 1). A label
        // at the very end of the program jumps one byte past the last
        // instruction, where the VM's loop bound ends execution successfully.
        const target = resolveLabel(node.target, addr);
        const rel = target - (addr + 1);
        encodeRel16(rel); // range check with a precise error
        instructions.push({ opcode: opcodeOf(node.kind), rel });
        break;
      }
      case 'blob':
        instructions.push({ opcode: opcodeOf('BLOB'), data: node.data });
        break;
      case 'raw':
        instructions.push(...lowerRaw(node.bytes));
        break;
      case 'label':
        break;
    }
    addr += sizes[i];
  }

  const bytes = encode(instructions);
  return { instructions, bytes, hex: toHex(bytes), labels };

  function resolveLabel(name: string, at: number): number {
    const target = labels.get(name);
    if (target === undefined) throw new CompileError(`unknown label "${name}" at byte ${at}`);
    return target;
  }
}

function toHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function nodeSize(node: Node): number {
  switch (node.kind) {
    case 'push':
      return 1 + pushWidth(node);
    case 'op':
      return 1;
    case 'dup':
    case 'swap':
      return 2;
    case 'jmp':
    case 'jz':
      return 3;
    case 'blob':
      return 3 + node.data.length;
    case 'label':
      return 0;
    case 'raw':
      return node.bytes.length;
  }
}

/** Resolve (and validate) the PUSH immediate width in bytes. */
function pushWidth(node: { value: bigint; bytes?: number }): number {
  if (node.value < 0n || node.value >= 1n << 256n) {
    throw new CompileError(`PUSH value out of range (must fit in 256 bits): ${node.value}`);
  }
  const width = node.bytes ?? Math.max(byteLength(node.value), 1);
  if (!Number.isInteger(width) || width < 1 || width > PUSH_MAX_BYTES) {
    throw new CompileError(`PUSH width must be an integer in [1, ${PUSH_MAX_BYTES}]: ${node.bytes}`);
  }
  if (node.value >= 1n << (BigInt(width) * 8n)) {
    throw new CompileError(`PUSH value ${node.value} does not fit in ${width} byte(s)`);
  }
  return width;
}

function checkIndex(name: string, n: number): void {
  if (!Number.isInteger(n) || n < 1 || n > STACK_SIZE) {
    throw new CompileError(`${name} operand must be an integer in [1, ${STACK_SIZE}]: ${n}`);
  }
}

/** Opcode for a mnemonic, always resolved through the canonical ISA table. */
function opcodeOf(name: string): number {
  const spec = lookup(name);
  if (!spec) throw new CompileError(`unknown instruction "${name}"`);
  return spec.opcode;
}

/** Raw nodes are literal, byte-exact passthrough (an unvalidated escape hatch). */
function lowerRaw(bytes: Uint8Array): AnyInstruction[] {
  return [{ rawBytes: bytes }];
}
