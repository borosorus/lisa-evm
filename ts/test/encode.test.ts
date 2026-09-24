import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bytesToHex, concat, hexToBytes } from '../src/bytes.ts';
import { encode, instructionSize, type Instruction } from '../src/encode.ts';
import { decode, DecodeError, disassemble } from '../src/decode.ts';

const hex = (b: Uint8Array) => bytesToHex(b);

test('encodes every instruction family byte-exactly', () => {
  const cases: Array<[Instruction[], string]> = [
    [[{ opcode: 0x00 }], '0x00'],
    [[{ opcode: 0x01, value: 2n }], '0x0102'],
    [[{ opcode: 0x04, value: 0xdeadbeefn }], '0x04deadbeef'],
    [[{ opcode: 0x14, value: 1n }], `0x14${'00'.repeat(19)}01`],
    [[{ opcode: 0x20, value: 2n ** 256n - 1n }], `0x20${'ff'.repeat(32)}`],
    [[{ opcode: 0x21 }], '0x21'],
    [[{ opcode: 0x22, index: 1 }], '0x2201'],
    [[{ opcode: 0x23, index: 16 }], '0x2310'],
    [[{ opcode: 0x24 }], '0x24'],
    [[{ opcode: 0x2b, rel: 84 }], '0x2b0054'],
    [[{ opcode: 0x2c, rel: -85 }], '0x2c8055'],
    [[{ opcode: 0x2d, data: hexToBytes('0x1234') }], '0x2d0002' + '1234'],
    [[{ opcode: 0x2d, data: new Uint8Array() }], '0x2d0000'],
    [[{ opcode: 0x39 }], '0x39'],
  ];
  for (const [program, expected] of cases) {
    assert.equal(hex(encode(program)), expected, JSON.stringify(program, bigintReplacer));
  }
});

test('README example encodes to the documented bytes', () => {
  // PUSH1 2 / PUSH1 3 / ADD / STOP  =>  01 02 01 03 24 00
  const program: Instruction[] = [
    { opcode: 0x01, value: 2n },
    { opcode: 0x01, value: 3n },
    { opcode: 0x24 },
    { opcode: 0x00 },
  ];
  assert.equal(hex(encode(program)), '0x010201032400');
});

test('encoder rejects invalid operands', () => {
  assert.throws(() => encode([{ opcode: 0x3a }]), RangeError); // invalid opcode
  assert.throws(() => encode([{ opcode: 0x01, value: 256n }]), RangeError); // too wide for PUSH1
  assert.throws(() => encode([{ opcode: 0x01, value: -1n }]), RangeError);
  assert.throws(() => encode([{ opcode: 0x22, index: 0 }]), RangeError); // DUP 0 invalid
  assert.throws(() => encode([{ opcode: 0x23, index: 17 }]), RangeError); // beyond stack depth
  assert.throws(() => encode([{ opcode: 0x2b, rel: 32768 }]), RangeError);
  assert.throws(() => encode([{ opcode: 0x24, value: 1n }]), TypeError); // operand on none-op
  assert.throws(() => encode([{ opcode: 0x22 }]), TypeError); // missing operand
  assert.throws(
    () => encode([{ opcode: 0x2d, data: new Uint8Array(0x10000) }]),
    RangeError,
  ); // oversized BLOB
});

test('instructionSize agrees with encode', () => {
  const program: Instruction[] = [
    { opcode: 0x20, value: 7n },
    { opcode: 0x22, index: 3 },
    { opcode: 0x2c, rel: -4 },
    { opcode: 0x2d, data: hexToBytes('0xabcdef') },
    { opcode: 0x00 },
  ];
  assert.equal(
    program.reduce((n, i) => n + instructionSize(i), 0),
    encode(program).length,
  );
});

test('decoder round-trips every family', () => {
  const original: Instruction[] = [
    { opcode: 0x01, value: 2n },
    { opcode: 0x0b, value: 0x1234567890abcdefn },
    { opcode: 0x20, value: 2n ** 256n - 1n },
    { opcode: 0x21 },
    { opcode: 0x22, index: 16 },
    { opcode: 0x23, index: 1 },
    { opcode: 0x2d, data: hexToBytes('0xdeadbeef') },
    { opcode: 0x2b, rel: 84 },
    { opcode: 0x2c, rel: -85 },
    { opcode: 0x39 },
  ];
  const decoded = decode(encode(original));
  assert.equal(hex(encode(decoded)), hex(encode(original)));
  assert.equal(
    decoded.reduce((n, i) => n + i.size, 0),
    encode(original).length,
  );
});

test('decoder tracks offsets and jump targets correctly', () => {
  // Ground truth from LISA.t.sol test_Program_Loop:
  //   PUSH1 3 / DUP1 / JZ +84  with the JZ rel field at byte 5 => target 89.
  const head = hexToBytes('0x010322012c0054');
  const decoded = decode(head);
  assert.deepEqual(
    decoded.map((i) => [i.name, i.offset, i.size]),
    [
      ['PUSH', 0, 2],
      ['DUP', 2, 2],
      ['JZ', 4, 3],
    ],
  );
  assert.equal(decoded[2].rel, 84);
  assert.equal(decoded[2].target, 5 + 84);
});

test('decoder rejects invalid opcodes and truncation on every path', () => {
  const bad = [
    '0x3a', // invalid opcode
    '0xff', // invalid opcode
    '0x20', // PUSH32 with no immediate
    '0x141234', // PUSH20 with truncated immediate
    '0x22', // DUP with no operand byte
    '0x2b00', // JMP truncated rel16
    '0x2c55', // JZ truncated rel16
    '0x2d00', // BLOB truncated length
    '0x2d0004', // BLOB length 4, no payload
    '0x2d0004aabb', // BLOB payload truncated
    '0x243a', // valid op then invalid opcode
  ];
  for (const h of bad) {
    assert.throws(() => decode(hexToBytes(h)), DecodeError, h);
  }
});

test('empty program decodes to empty instruction list', () => {
  assert.deepEqual(decode(new Uint8Array()), []);
  assert.deepEqual(disassemble(new Uint8Array()), []);
});

test('disassembly is human-readable and matches semantics', () => {
  // The conditional from LISA.t.sol: JZ 0x004c at operand address 50 -> target 126.
  const lines = disassemble(hexToBytes('0x2c004c'));
  assert.deepEqual(lines, ['JZ +76 -> 77']);

  const blobLines = disassemble(hexToBytes('0x2d00041234abcd'));
  assert.deepEqual(blobLines, ['BLOB 4 byte(s)']);

  const pushLines = disassemble(hexToBytes('0x021234'));
  assert.deepEqual(pushLines, ['PUSH2 0x1234']);
});

// --- helpers -------------------------------------------------------------

function nameOf(i: Instruction): string {
  // Minimal mirror of isa lookup to catch decode mislabeling without reusing decode.
  if (i.opcode >= 0x01 && i.opcode <= 0x20) return 'PUSH';
  return {
    0x00: 'STOP', 0x21: 'POP', 0x22: 'DUP', 0x23: 'SWAP', 0x24: 'ADD', 0x25: 'SUB',
    0x26: 'MUL', 0x27: 'DIV', 0x28: 'KECCAK256', 0x29: 'LT', 0x2a: 'EQ',
    0x2b: 'JMP', 0x2c: 'JZ', 0x2d: 'BLOB', 0x2e: 'MSTORE', 0x2f: 'MLOAD',
    0x30: 'CALL', 0x31: 'STATICCALL', 0x32: 'RDLOAD', 0x33: 'SELF', 0x34: 'CALLER',
    0x35: 'GAS', 0x36: 'SELFBALANCE', 0x37: 'BALANCE', 0x38: 'TIMESTAMP', 0x39: 'REVERT',
  }[i.opcode]!;
}

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value;
}
