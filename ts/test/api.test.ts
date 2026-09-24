import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  add,
  blob,
  bytesToHex,
  compile,
  decode,
  dup,
  hexToBytes,
  jz,
  jmp,
  label,
  pop,
  program,
  push,
  raw,
  stop,
  sub,
  swap,
} from '../src/index.ts';

test('API builds the README example end to end', () => {
  const p = program(push(2), push(3), add, stop);
  assert.equal(compile(p).hex, '0x010201032400');
});

test('push accepts numbers, bigints, hex strings, and byte arrays', () => {
  assert.equal(compile(program(push(300))).hex, '0x02012c');
  assert.equal(compile(program(push(300n))).hex, '0x02012c');
  assert.equal(compile(program(push('0x012c'))).hex, '0x02012c');
  assert.equal(compile(program(push(hexToBytes('012c')))).hex, '0x02012c');
  // Hex/bytes keep their exact width (leading zeros preserved).
  assert.equal(compile(program(push('0x00001234'))).hex, '0x0400001234');
  assert.throws(() => push('0x' + 'ff'.repeat(33)), RangeError);
  // Numbers that cannot survive JS number precision are rejected, not guessed.
  assert.throws(() => push(2 ** 53 + 2), RangeError);
  assert.throws(() => push(1.5), RangeError);
  assert.throws(() => push(-1), RangeError);
  // For everything larger, bigint and hex stay exact.
  assert.equal(compile(program(push(2n ** 53n + 2n))).hex, '0x0720000000000002');
});

test('blob accepts hex and bytes; program flattens nested arrays', () => {
  assert.equal(compile(program(blob('0xabcd'))).hex, '0x2d0002abcd');
  const nested = program([push(1), [pop, program(stop)]]);
  assert.equal(compile(nested).hex, '0x01012100');
});

test('API-built label programs compile through the AST, not a side channel', () => {
  // push1 1 / jz skip / push1 42 / jmp end / skip: push1 66 / end: stop
  // jz opcode at 2, operand at 3, skip at 10 => +7; jmp operand at 8, end at 12 => +4.
  const src = program(push(1), jz('skip'), push(42), jmp('end'), label('skip'), push(66), label('end'), stop);
  const c = compile(src);
  assert.equal(c.hex, '0x01012c0007012a2b0004014200');
  // Sanity: decoded form agrees structurally with the AST.
  const decoded = decode(c.bytes);
  assert.deepEqual(decoded.map((i) => i.name), ['PUSH', 'JZ', 'PUSH', 'JMP', 'PUSH', 'STOP']);
  assert.equal(decoded[1].target, 10);
  assert.equal(decoded[3].target, 12);
});

test('raw nodes round-trip through the API unchanged', () => {
  const c = compile(program(raw('0x2b8055'), raw(hexToBytes('0x21'))));
  assert.equal(c.hex, '0x2b805521');
});

test('nodes are frozen; the API does not let programs be mutated after the fact', () => {
  assert.throws(() => {
    (add as { op: string }).op = 'STOP';
  });
});

test('compile output can be re-decoded and re-encoded to the same bytes', () => {
  const src = program(
    blob('0x2000'),
    dup(2),
    push(4),
    add,
    swap(3),
    jmp('x'),
    label('x'),
    stop,
  );
  const bytes = compile(src).bytes;
  assert.deepEqual(compile(program(raw(bytes))).bytes, bytes);
});
