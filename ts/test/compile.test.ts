import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Program } from '../src/ast.ts';
import { compile, CompileError } from '../src/compile.ts';
import {
  add,
  blob,
  dup,
  jmp,
  jz,
  label,
  pop,
  program,
  push,
  raw,
  stop,
  sub,
  swap,
} from '../src/api.ts';

const p = (nodes: Program) => compile(nodes).hex;

test('push widths are minimal by default and forced when asked', () => {
  assert.equal(p([push(0)]), '0x0100');
  assert.equal(p([push(2)]), '0x0102');
  assert.equal(p([push(0x1234)]), '0x021234');
  assert.equal(p([push(2n ** 256n - 1n)]), `0x20${'ff'.repeat(32)}`);
  assert.equal(p([push(2, 4)]), '0x0400000002');
  assert.equal(p([push(0, 32)]), `0x20${'00'.repeat(32)}`);
});

test('push rejects impossible values', () => {
  assert.throws(() => p([push(2n ** 256n)]), (e: unknown) => e instanceof CompileError || e instanceof RangeError);
  assert.throws(() => p([push(256, 1)]), CompileError);
  assert.throws(() => p([push(1, 0)]), CompileError);
  assert.throws(() => p([push(1, 33)]), CompileError);
});

test('forward labels: delta is relative to the operand field, not the next instruction', () => {
  // push1 1 / push1 2 / jmp end / push1 9 / end: add
  // jmp opcode at 4, operand field at 5, target (add) at 9 => rel +4.
  // EVM convention would have encoded +2 here.
  const src = program(push(1), push(2), jmp('end'), push(9), label('end'), add);
  assert.equal(p(src), '0x010101022b0004010924');
});

test('backward labels encode negative sign-magnitude deltas', () => {
  // label t, pop, jmp t: t is byte 0 (label is zero-width), jmp opcode at 1,
  // operand at 2, target 0 => delta -2 => 0x8002.
  assert.equal(p(program(label('t'), pop, jmp('t'))), '0x212b8002');
  // Adjacent label => smallest backward delta, -1.
  assert.equal(p(program(label('t'), jmp('t'))), '0x2b8001');
});

test('jump deltas land on labels exactly (delta boundaries)', () => {
  // +2 is the smallest forward delta possible via labels (a label immediately
  // after a jmp sits at opcode+3, operand at opcode+1).
  assert.equal(p(program(jmp('t'), label('t'), stop)), '0x2b000200');

  // Max forward: operand at 1; jmp is 3 bytes, then N POPs, label at 3+N;
  // delta = (3+N) - 1 => N = 32765 gives +32767.
  const far = program(jmp('far'), raw(new Uint8Array(32765).fill(0x21)), label('far'), stop);
  assert.ok(compile(far).hex.startsWith('0x2b7fff'));

  // Max backward: label at 0, N POPs, jmp at N with operand at N+1;
  // delta = -(N+1) => N = 32766 gives -32767 (0xffff).
  const back = program(label('far'), raw(new Uint8Array(32766).fill(0x21)), jmp('far'));
  assert.ok(compile(back).hex.endsWith('ffff'));
});

test('deltas beyond +-32767 are rejected', () => {
  const tooFar = program(jmp('far'), raw(new Uint8Array(32766).fill(0x21)), label('far'), stop);
  assert.throws(() => compile(tooFar), RangeError);
});

test('label resolution errors are precise', () => {
  assert.throws(() => p([jmp('nope')]), (e: unknown) => /unknown label "nope"/.test(`${e}`));
  assert.throws(
    () => p([label('x'), pop, label('x')]),
    (e: unknown) => /duplicate label "x"/.test(`${e}`),
  );
  // Duplicate is caught even when the jump precedes the second definition.
  assert.throws(
    () => p([jmp('x'), pop, label('x'), label('x')]),
    (e: unknown) => /duplicate label "x"/.test(`${e}`),
  );
});

test('label at end of program targets successful termination', () => {
  // jmp opcode at 0, operand at 1, end-of-program at 3 => rel +2. The VM
  // reads past the program as STOP, which terminates successfully.
  assert.equal(p(program(jmp('end'), label('end'))), '0x2b0002');
});

test('blob and raw nodes interleave with labels and jumps', () => {
  // blob@0 (5 bytes), jmp@5 (operand 6), raw POP@8, skip@9, stop@9: rel +3.
  const src = program(blob('0xcafe'), jmp('skip'), raw('0x21'), label('skip'), stop);
  const c = compile(src);
  assert.equal(c.hex, '0x2d0002cafe2b00032100');
  assert.equal(c.labels.get('skip'), 9);
});

test('raw nodes pass bytes through verbatim, whatever they contain', () => {
  // Byte-exactness, including sequences the encoder itself would never emit:
  assert.equal(p([raw('0x3a')]), '0x3a'); // invalid opcode (for negative tests)
  assert.equal(p([raw('0x2200')]), '0x2200'); // DUP 0: decodable, runtime-invalid
  assert.equal(p([raw('0x2b8000')]), '0x2b8000'); // rel16 negative zero stays verbatim
  // Raw node boundaries are independent: a split instruction stays intact.
  assert.equal(p([raw('0x01'), raw('0x02')]), '0x0102');
  // Labels count raw bytes as opaque length, like real instructions.
  // jmp operand at 1, t after one raw byte => +3.
  assert.equal(p([jmp('t'), raw('0x21'), label('t'), stop]), '0x2b00032100');
});

test('dup/swap operands validated', () => {
  assert.throws(() => p([dup(0)]), CompileError);
  assert.throws(() => p([swap(17)]), CompileError);
  assert.equal(p([dup(1), swap(2)]), '0x22012302');
});

test('compiled countdown loop matches hand-computed bytes', () => {
  // acc=0; i=3; head: dup1; jz done; swap2; push1 1; add; swap2; push1 1; sub;
  // jmp head; done: pop; stop
  const src = program(
    push(0),
    push(3),
    label('head'), // byte 4
    dup(1),
    jz('done'), // operand at 7
    swap(2),
    push(1),
    add,
    swap(2),
    push(1),
    sub,
    jmp('head'), // operand at 20
    label('done'), // byte 22
    pop,
    stop,
  );
  const c = compile(src);
  assert.equal(c.labels.get('head'), 4);
  assert.equal(c.labels.get('done'), 22);
  // JZ: 22 - 7 = +15; JMP: 4 - 20 = -16.
  assert.equal(c.hex, '0x0100010322012c000f230201012423020101252b80102100');
});

test('loop shape reproduces the Solidity ground-truth delta (+84 => 0x0054)', () => {
  // Mirrors test_Program_Loop byte layout: head at 2, JZ operand at 5, exit
  // label at 89 (blob body of 77 bytes, two POPs, then exit).
  const nodes: Program = [
    push(3),
    label('head'),
    dup(1),
    jz('exit'),
    blob(new Uint8Array(77)),
    pop,
    pop,
    label('exit'),
    pop,
    stop,
  ];
  const c = compile(nodes);
  assert.equal(c.labels.get('head'), 2);
  assert.equal(c.labels.get('exit'), 89);
  assert.equal(Buffer.from(c.bytes.slice(5, 7)).toString('hex'), '0054');
});
