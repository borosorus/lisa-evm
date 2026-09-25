import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bytesToHex, hexToBytes } from '../src/bytes.ts';
import { encodeCall, parseSignature, rawCalldata, selectorOf } from '../src/abi.ts';
import { SELF, Value } from '../src/expr.ts';

test('parseSignature accepts canonical forms', () => {
  assert.deepEqual(parseSignature('balanceOf(address)'), { name: 'balanceOf', types: ['address'] });
  assert.deepEqual(parseSignature('transfer(address,uint256)'), {
    name: 'transfer',
    types: ['address', 'uint256'],
  });
  assert.deepEqual(parseSignature('noArgs()'), { name: 'noArgs', types: [] });
});

test('parseSignature rejects malformed signatures and unsupported types', () => {
  assert.throws(() => parseSignature('balanceOf address'), TypeError);
  assert.throws(() => parseSignature('balanceOf(address'), TypeError);
  assert.throws(() => parseSignature('7bad(address)'), TypeError);
  assert.throws(() => parseSignature('f(string)'), TypeError);
  assert.throws(() => parseSignature('f(uint97)'), TypeError); // not 8-quantized
  assert.throws(() => parseSignature('f(bytes33)'), TypeError);
  assert.throws(() => parseSignature('f(uint257)'), TypeError);
  assert.throws(() => parseSignature('f(bytes)'), TypeError);
  assert.throws(() => parseSignature('f(uint256[])'), TypeError);
  assert.deepEqual(parseSignature('f(uint96)').types, ['uint96']); // 96 = 12 * 8
});

test('selectors match published Ethereum vectors', () => {
  assert.equal(selectorOf('balanceOf(address)'), '0x70a08231');
  assert.equal(selectorOf('transfer(address,uint256)'), '0xa9059cbb');
  assert.equal(selectorOf('approve(address,uint256)'), '0x095ea7b3');
});

test('constant-only calldata is baked into the template', () => {
  const data = encodeCall('transfer(address,uint256)', [
    '0x1111111111111111111111111111111111111111',
    42n,
  ]);
  assert.deepEqual(data.patches, []);
  assert.equal(
    bytesToHex(data.template),
    '0xa9059cbb' +
      '000000000000000000000000' + '1111111111111111111111111111111111111111' + // right-aligned address
      '000000000000000000000000000000000000000000000000000000000000002a', // 42
    'selector || addr word || uint word',
  );
  assert.equal(data.template.length, 4 + 64);
});

test('runtime arguments leave holes and produce ordered patches', () => {
  const data = encodeCall('transfer(address,uint256)', [SELF, 7n]);
  assert.equal(data.patches.length, 1);
  assert.equal(data.patches[0]!.offset, 4);
  assert.ok(data.patches[0]!.arg instanceof Value);
  // constant word still inline at offset 4 + 32
  assert.equal(bytesToHex(data.template.slice(36, 68)), `0x${'00'.repeat(31)}07`);

  const both = encodeCall('transfer(address,uint256)', [SELF, SELF]);
  assert.deepEqual(both.patches.map((p) => p.offset), [4, 36]);
  assert.deepEqual([...both.template.slice(4)], Array(64).fill(0));
});

test('bool and bytes constants are ABI-canonical', () => {
  const yes = encodeCall('f(bool)', [true]);
  assert.equal(bytesToHex(yes.template.slice(4, 36)), `0x${'00'.repeat(31)}01`);

  const left = encodeCall('f(bytes4)', ['0xaabb']);
  assert.equal(bytesToHex(left.template.slice(4, 36)), '0xaabb' + '00'.repeat(30));
  assert.throws(() => encodeCall('f(bytes4)', ['0x1122334455']), RangeError); // > 4 bytes
});

test('encodeCall validates arguments', () => {
  assert.throws(() => encodeCall('f(uint8)', [256]), RangeError);
  assert.throws(() => encodeCall('f(address)', [2n ** 160n]), RangeError);
  assert.throws(() => encodeCall('f(uint256)', [-1n]), RangeError);
  assert.throws(() => encodeCall('f(bool)', [5n]), TypeError);
  assert.throws(() => encodeCall('f(uint256)', [true]), TypeError);
  assert.throws(() => encodeCall('balanceOf(address)'), TypeError); // count
  assert.throws(() => encodeCall('noArgs()', [1n]), TypeError); // count
});

test('static Values bake; runtime Values pass through untouched as patches', () => {
  // A literal Value is statically known, so it is baked exactly like a
  // constant (with the same checks) instead of costing a runtime MSTORE.
  const baked = encodeCall('f(uint8)', [new Value({ t: 'lit', value: 9n })]);
  assert.equal(baked.patches.length, 0);
  assert.equal(bytesToHex(baked.template.slice(4, 36)), `0x${'00'.repeat(31)}09`);
  assert.throws(() => encodeCall('f(uint8)', [new Value({ t: 'lit', value: 256n })]), RangeError);

  // A runtime Value becomes a patch, carrying its type's bound.
  const data = encodeCall('f(uint256)', [SELF]);
  assert.equal(data.patches.length, 1);
  assert.equal(data.patches[0]!.arg, SELF);
  assert.equal(data.patches[0]!.bounds, undefined); // uint256: full word is canonical
  assert.equal(encodeCall('f(address)', [SELF]).patches[0]!.bounds, 2n ** 160n);
  assert.equal(encodeCall('f(bool)', [SELF]).patches[0]!.bounds, 2n);
});

test('runtime bytesN arguments are refused, not silently misaligned', () => {
  // Constants left-align; a runtime word's alignment is unknowable here.
  assert.throws(() => encodeCall('f(bytes4)', [SELF]), TypeError);
  assert.throws(() => encodeCall('f(bytes32)', [SELF]), TypeError);
});

test('rawCalldata accepts pre-encoded calldata verbatim', () => {
  const encoded = '0xa9059cbb' + '11'.repeat(32) + '22'.repeat(32);
  const fromHex = rawCalldata(encoded);
  assert.equal(bytesToHex(fromHex.template), encoded);
  assert.deepEqual(fromHex.patches, []);
  assert.deepEqual([...rawCalldata(hexToBytes(encoded)).template], [...fromHex.template]);
  assert.equal(fromHex.signature, undefined); // raw calldata carries no ABI metadata

  // Empty calldata is representable.
  assert.equal(rawCalldata('0x').template.length, 0);
});

test('rawCalldata validates like the byte helpers and stays immutable', () => {
  assert.throws(() => rawCalldata('0x0z'), RangeError); // hexToBytes validation
  assert.throws(() => rawCalldata('abc'), RangeError); // odd length
  assert.throws(
    () => rawCalldata(`0x${'00'.repeat(0x10000)}`), // beyond BLOB's u16 length
    RangeError,
  );
  const data = rawCalldata('0xa9059cbb');
  assert.throws(() => {
    'use strict';
    (data as { patches: unknown }).patches = [];
  }, TypeError);
  assert.throws(() => {
    'use strict';
    (data as { template: unknown }).template = new Uint8Array();
  }, TypeError);
});
