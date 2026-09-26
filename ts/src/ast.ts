/**
 * Minimal AST for LISA programs.
 *
 * A program is a flat node list — the same shape the VM executes, with two
 * additions that do not exist in bytecode: symbolic `LABEL` markers and
 * label names as jump targets. The compiler (compile.ts) lowers nodes to
 * concrete instructions and resolves labels.
 */

import type { OperandKind } from './isa.ts';

/** Zero-operand opcodes, keyed by canonical name. */
export const NO_OPERAND_OPS = [
  'STOP',
  'POP',
  'ADD',
  'SUB',
  'MUL',
  'DIV',
  'KECCAK256',
  'LT',
  'EQ',
  'MSTORE',
  'MLOAD',
  'CALL',
  'STATICCALL',
  'RDLOAD',
  'SELF',
  'CALLER',
  'GAS',
  'SELFBALANCE',
  'BALANCE',
  'TIMESTAMP',
  'REVERT',
] as const;

export type NoOperandOp = (typeof NO_OPERAND_OPS)[number];

export type Node =
  /** Push an unsigned value; `bytes` forces the immediate width (1..32). */
  | { kind: 'push'; value: bigint; bytes?: number }
  | { kind: 'op'; op: NoOperandOp }
  | { kind: 'dup'; n: number }
  | { kind: 'swap'; n: number }
  | { kind: 'jmp'; target: string }
  | { kind: 'jz'; target: string }
  | { kind: 'blob'; data: Uint8Array }
  /** Symbolic marker, zero width in bytecode. */
  | { kind: 'label'; name: string }
  /** Escape hatch: literal bytes, for tooling and negative tests. */
  | { kind: 'raw'; bytes: Uint8Array };

export type Program = readonly Node[];

/** Operand kind for a node, mirroring the ISA table. */
export function nodeKind(node: Node): OperandKind | 'label' | 'raw' {
  switch (node.kind) {
    case 'push':
      return 'push';
    case 'dup':
    case 'swap':
      return 'index';
    case 'jmp':
    case 'jz':
      return 'rel16';
    case 'blob':
      return 'blob';
    case 'op':
      return 'none';
    case 'label':
      return 'label';
    case 'raw':
      return 'raw';
  }
}
