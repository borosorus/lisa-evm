import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bytesToHex, hexToBytes } from '../src/bytes.ts';
import { encodeCall, parseSignature, selectorOf } from '../src/abi.ts';
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

test('Value arguments pass through untouched', () => {
  const v = new Value({ t: 'lit', value: 9n });
  const data = encodeCall('f(uint256)', [v]);
  assert.equal(data.patches.length, 1);
  assert.equal(data.patches[0]!.arg, v);
});
