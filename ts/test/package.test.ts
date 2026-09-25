import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Guards the PACKAGE boundary, not the logic (unit tests cover that): if the
 * package has been built (`npm run build`), the declared entry points must
 * load as plain JavaScript with the documented surface. Skipped otherwise,
 * so `make test-ts` never depends on build artifacts.
 */

const distIndex = new URL('../dist/index.js', import.meta.url);
const built = existsSync(fileURLToPath(distIndex));

test('built entry point loads and compiles', { skip: !built && 'run `npm run build` first' }, async () => {
  const lib = await import(distIndex.href);

  // High-level acceptance program through the package entry.
  const p = lib.createProgram();
  const v = p.staticCall(lib.SELF, lib.encodeCall('read(address)', [lib.SELF])).uint256();
  p.if(v.gt(1), () => {
    p.call(lib.SELF, lib.encodeCall('write(uint256)', [v]));
  });
  const c = p.compile();
  assert.ok(c.hex.startsWith('0x') && c.hex.length > 10);

  // New APIs reachable from the entry: raw calldata + generic word access.
  const raw = lib.rawCalldata('0xdeadbeef');
  assert.equal(raw.patches.length, 0);
  const q = lib.createProgram();
  q.staticCall(lib.SELF, raw).word(32);
  assert.ok(q.compile().hex.includes('012032'));

  // Curated surface: builder/abi/expr/compile/decode present, plumbing absent.
  for (const name of ['createProgram', 'encodeCall', 'rawCalldata', 'selectorOf', 'compile', 'decode', 'disassemble', 'SELF', 'Value', 'LoweringError']) {
    assert.ok(name in lib, `index exports ${name}`);
  }
  for (const name of ['program', 'push', 'mstore', 'keccakBytes']) {
    assert.ok(!(name in lib), `index does not leak ${name}`);
  }
});

test('deep imports expose the low-level pipeline', { skip: !built && 'run `npm run build` first' }, async () => {
  const api = await import(new URL('../dist/api.js', import.meta.url).href);
  const compile = await import(new URL('../dist/compile.js', import.meta.url).href);
  const p = api.program(api.push(2), api.push(3), api.add, api.stop);
  assert.equal(compile.compile(p).hex, '0x010201032400');
});
