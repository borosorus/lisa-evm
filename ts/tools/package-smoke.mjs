#!/usr/bin/env node
/**
 * Node-version-agnostic consumer smoke for the PACKED package.
 *
 * Deliberately plain JavaScript (no TypeScript, no build tooling): it runs on
 * any Node that satisfies the published package's engines floor and proves
 * the compiled dist/ works as a consumer sees it. This is NOT the repository
 * development suite (that runs TypeScript directly and needs Node >= 23.6).
 *
 * Usage:
 *   node package-smoke.mjs                     from a directory whose
 *                                              node_modules contains
 *                                              @bosorus/lisa-evm
 *   node package-smoke.mjs --dist <dir>        import <dir>/*.js directly
 *                                              (e.g. a built ts/dist)
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const distIdx = process.argv.indexOf('--dist');
const base =
  distIdx >= 0 ? pathToFileURL(resolve(process.argv[distIdx + 1]) + '/').href : null;
const imp = (sub) => import(base ? base + (sub === '.' ? 'index.js' : `${sub}.js`) : `@bosorus/lisa-evm${sub === '.' ? '' : `/${sub}`}`);

const lib = await imp('.');

// Curated root surface: common application/tooling API present...
for (const name of [
  'createProgram', 'encodeCall', 'rawCalldata', 'selectorOf', 'compile',
  'decode', 'disassemble', 'SELF', 'Value', 'LoweringError',
]) {
  assert.ok(name in lib, `root exports ${name}`);
}
// ...plumbing is not.
for (const name of ['program', 'push', 'mstore', 'keccakBytes', 'keccakAscii']) {
  assert.ok(!(name in lib), `root does not leak ${name}`);
}

// Documented subpath entries all import and expose their pipeline role.
const entries = {
  api: ['program', 'push', 'add', 'stop'],
  ast: ['NO_OPERAND_OPS', 'nodeKind'],
  builder: ['createProgram', 'ProgramBuilder'],
  expr: ['SELF', 'CALLER', 'literal'],
  abi: ['encodeCall', 'rawCalldata', 'selectorOf'],
  compile: ['compile', 'CompileError'],
  decode: ['decode', 'disassemble'],
  encode: ['encode', 'instructionSize'],
  isa: ['INSTRUCTIONS', 'lookup'],
  bytes: ['bytesToHex', 'hexToBytes'],
};
const mods = {};
for (const [sub, names] of Object.entries(entries)) {
  mods[sub] = await imp(sub);
  for (const name of names) assert.ok(name in mods[sub], `/${sub} exports ${name}`);
}

// A representative high-level program through the packed root entry.
const p = lib.createProgram();
const v = p.staticCall(lib.SELF, lib.encodeCall('read(address)', [lib.SELF])).uint256();
p.if(v.gt(1), () => {
  p.call(lib.SELF, lib.encodeCall('write(uint256)', [v]));
});
const c = p.compile();
assert.match(c.hex, /^0x[0-9a-f]+$/);

// Raw calldata and generic return-word access remain available.
const raw = lib.rawCalldata('0xdeadbeef');
assert.equal(raw.patches.length, 0);
const q = lib.createProgram();
q.staticCall(lib.SELF, raw).word(32);
const attempt = q.tryStaticCall(lib.SELF, raw);
if (!(attempt.success instanceof lib.Value)) throw new Error('success is not a LISA Value');
q.if(attempt.success, () => {});
q.if(q.tryCall(lib.SELF, raw).success, () => {});
assert.ok(q.compile().hex.includes('012032'));

// Round trip through the documented low-level pipeline.
const low = mods.api.program(mods.api.push(2), mods.api.push(3), mods.api.add, mods.api.stop);
const lowCompiled = mods.compile.compile(low);
assert.equal(lowCompiled.hex, '0x010201032400');
assert.deepEqual(mods.decode.disassemble(lowCompiled.bytes), ['PUSH1 0x2', 'PUSH1 0x3', 'ADD', 'STOP']);
assert.deepEqual(mods.decode.decode(lowCompiled.bytes).map((i) => i.name), ['PUSH', 'PUSH', 'ADD', 'STOP']);

console.log('package-smoke: ok');
