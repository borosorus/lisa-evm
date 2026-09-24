import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INSTRUCTIONS,
  MAX_OPCODE,
  PUSH_MAX_BYTES,
  STACK_SIZE,
  decodeRel16,
  encodeRel16,
  instructionFor,
  lookup,
} from '../src/isa.ts';

test('opcode table is canonical and matches the documented layout', () => {
  // README table: opcodes 0x00..0x39 contiguous, nothing above 0x39.
  assert.equal(MAX_OPCODE, 0x39);
  for (let opcode = 0; opcode <= MAX_OPCODE; opcode++) {
    assert.ok(instructionFor(opcode), `opcode 0x${opcode.toString(16)} must be defined`);
  }
  assert.equal(instructionFor(0x3a), undefined);
  assert.equal(instructionFor(0xff), undefined);

  // PUSHn: opcode value == immediate length.
  for (let n = 1n; n <= BigInt(PUSH_MAX_BYTES); n++) {
    const spec = instructionFor(Number(n));
    assert.equal(spec?.name, 'PUSH');
    assert.equal(spec?.operandBytes, Number(n));
  }

  // Spot checks against yul/LISA.yul.
  assert.equal(instructionFor(0x21)?.name, 'POP');
  assert.equal(instructionFor(0x22)?.name, 'DUP');
  assert.equal(instructionFor(0x2b)?.name, 'JMP');
  assert.equal(instructionFor(0x2c)?.name, 'JZ');
  assert.equal(instructionFor(0x2d)?.operandKind, 'blob');
  assert.equal(instructionFor(0x39)?.name, 'REVERT');

  // No duplicate opcodes or names in the fixed table.
  const names = new Set<string>();
  for (const spec of INSTRUCTIONS.values()) {
    assert.ok(!names.has(spec.name), `duplicate name ${spec.name}`);
    names.add(spec.name);
  }
  assert.equal(INSTRUCTIONS.size, 26); // 0x00 + 0x21..0x39 minus PUSH family range
});

test('stack depth matches the runtime', () => {
  assert.equal(STACK_SIZE, 16); // yul/LISA.yul: STACK_SIZE()
});

test('name lookup covers PUSHn and fixed mnemonics', () => {
  assert.equal(lookup('PUSH1')?.opcode, 0x01);
  assert.equal(lookup('push32')?.opcode, 0x20);
  assert.equal(lookup('add')?.name, 'ADD');
  assert.equal(lookup('KECCAK256')?.opcode, 0x28);
  assert.equal(lookup('PUSH0'), undefined);
  assert.equal(lookup('PUSH33'), undefined);
  assert.equal(lookup('NOPE'), undefined);
});

test('rel16 sign-magnitude round trips', () => {
  for (const delta of [0, 1, -1, 2, -2, 0x7fff, -0x7fff, 12345, -12345]) {
    assert.equal(decodeRel16(encodeRel16(delta)), delta, `delta ${delta}`);
  }

  // Word-level encoding, straight from the Yul comments and LISA.t.sol.
  assert.equal(encodeRel16(84), 0x0054); // JZ +84 in test_Program_Loop
  assert.equal(encodeRel16(-85), 0x8055); // JMP -85 in test_Program_Loop
  assert.equal(decodeRel16(0x7fff), 32767);
  assert.equal(decodeRel16(0x8000), 0); // negative zero == 0
  assert.equal(decodeRel16(0x8001), -1);
});

test('rel16 rejects out-of-range values', () => {
  assert.throws(() => encodeRel16(32768), RangeError);
  assert.throws(() => encodeRel16(-32768), RangeError);
  assert.throws(() => encodeRel16(1.5), RangeError);
  assert.throws(() => decodeRel16(0x10000), RangeError);
});
