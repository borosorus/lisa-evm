import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Validates the packed artifact — what npm actually publishes — end to end:
 *
 *   npm pack -> tarball contents -> npm install into an isolated consumer ->
 *   public API exercised through normal Node resolution -> declarations
 *
 * Runs `npm pack --ignore-scripts` against the built dist/ (skipped when dist
 * is absent, like the other built-package checks); publication freshness is
 * enforced separately by the `prepack` script, which rebuilds before npm
 * creates the artifact. `tools/package-smoke.mjs` is the consumer program;
 * keeping it plain JS lets CI re-run it on any Node in the engines range.
 */

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distEntry = join(pkgDir, 'dist', 'index.js');
const built = existsSync(distEntry);

type Stage = { tmp: string; tgzPath: string; pkgPath: string; entries: string[] };
let stage: Stage | undefined;

function packAndUnpack(): Stage {
  if (stage) return stage;
  const tmp = mkdtempSync(join(tmpdir(), 'lisa-pkg-test-'));
  try {
    const tgzName = execFileSync(
      'npm', ['pack', '--ignore-scripts', '--pack-destination', tmp],
      { cwd: pkgDir, encoding: 'utf8' },
    ).trim().split('\n').pop()!;
    const tgzPath = join(tmp, tgzName);
    const entries = execFileSync('tar', ['-tzf', tgzPath], { encoding: 'utf8' })
      .trim().split('\n');
    execFileSync('tar', ['-xzf', tgzPath, '-C', tmp]);
    // npm's single top-level directory; assert on it so the allowlist below
    // cannot silently match a differently-rooted tarball.
    assert.ok(entries.every((e) => e === 'package' || e.startsWith('package/')), 'single package/ root');
    const result = { tmp, tgzPath, pkgPath: join(tmp, 'package'), entries };
    stage = result;
    return result;
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

/**
 * A real `npm install <tarball>` consumer — the dependency graph, manifest,
 * and bin/link handling npm performs are part of what we publish. Prefers
 * --offline (everything needed is cached by the dev install) and falls back
 * to the default registry path only if the cache cannot serve it.
 */
function installConsumer(tmp: string, name: string): string {
  const { tgzPath } = packAndUnpack();
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"name":"lisa-consumer","private":true}\n');
  try {
    execFileSync('npm', ['install', tgzPath, '--no-audit', '--no-fund', '--offline', '--loglevel=error'], { cwd: dir, encoding: 'utf8' });
  } catch {
    execFileSync('npm', ['install', tgzPath, '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, encoding: 'utf8' });
  }
  return dir;
}

test('npm pack produces a clean, intentional artifact', { skip: !built && 'run `npm run build` first' }, () => {
  const { pkgPath, entries } = packAndUnpack();

  // Contents allowlist: nothing but the manifest, README, and dist/.
  for (const entry of entries) {
    assert.match(
      entry,
      /^package\/(package\.json|README\.md|dist\/[\w./-]+\.(js|d\.ts))$/,
      `unexpected tarball entry: ${entry}`,
    );
  }
  assert.ok(entries.some((e) => e === 'package/README.md'), 'packaged README');
  assert.ok(entries.some((e) => e === 'package/dist/index.js'), 'packaged entry point');

  // Identity and metadata a consumer / registry would check.
  const meta = JSON.parse(readFileSync(join(pkgPath, 'package.json'), 'utf8'));
  assert.equal(meta.name, '@bosorus/lisa-evm');
  assert.equal(meta.private, undefined, 'not private');
  assert.equal(meta.version, '0.4.0');
  assert.equal(meta.publishConfig?.access, 'public');
  assert.equal(typeof meta.repository?.url, 'string');
  assert.equal(meta.scripts?.prepack, 'npm run build', 'prepack rebuilds before pack');

  // Every documented export condition resolves inside the tarball.
  const targets = Object.values(meta.exports as Record<string, { types: string; default: string }>)
    .flatMap((c) => [c.types, c.default]);
  assert.ok(targets.length >= 22, 'root plus ten subpath entries');
  for (const target of targets) {
    assert.ok(existsSync(join(pkgPath, target)), `exports target ${target} exists`);
  }
});

test('packed runtime code is browser-safe (no Node builtins)', { skip: !built && 'run `npm run build` first' }, () => {
  const { pkgPath } = packAndUnpack();
  const jsFiles = execFileSync('find', [join(pkgPath, 'dist'), '-name', '*.js'], { encoding: 'utf8' })
    .trim().split('\n');
  assert.ok(jsFiles.length >= 11, 'dist JS files present');
  for (const file of jsFiles) {
    // Strip comments so prose like "import ... from 'lisa'" in docblocks
    // cannot masquerade as an import specifier.
    const text = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const specifiers = [
      ...[...text.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
      ...[...text.matchAll(/(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
    ];
    assert.ok(!text.includes('node:'), `${file} mentions a node: specifier anywhere`);
    for (const s of specifiers) {
      const bare = s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0];
      assert.ok(!s.startsWith('node:'), `${file} imports ${s}`);
      assert.ok(!['fs', 'path', 'os', 'url', 'child_process', 'crypto', 'process', 'module'].includes(bare),
        `${file} imports Node builtin ${s}`);
      // External deps: only the browser-safe hashing library. Relative and
      // extension-ful specifiers are dist-internal; nothing may escape dist.
      if (!s.startsWith('.')) assert.equal(bare, '@noble/hashes', `${file} external import ${s}`);
    }
    assert.ok(!/\brequire\s*\(/.test(text), `${file} calls require()`);
    assert.ok(!/\bprocess\.[A-Za-z]/.test(text), `${file} touches process globals`);
    assert.ok(!text.includes('__dirname') && !text.includes('import.meta.url'), `${file} uses path globals`);
  }
});

test('packed artifact installs and runs in an isolated consumer', { skip: !built && 'run `npm run build` first' }, () => {
  const { tmp } = packAndUnpack();

  // A real `npm install <tarball>` in a directory that shares nothing with
  // the repository: resolution, dependency graph, and manifest are exactly
  // what a registry consumer gets.
  const consumer = installConsumer(tmp, 'consumer');
  copyFileSync(resolve(pkgDir, 'tools', 'package-smoke.mjs'), join(consumer, 'smoke.mjs'));

  const out = execFileSync(process.execPath, ['smoke.mjs'], { cwd: consumer, encoding: 'utf8' });
  assert.match(out, /package-smoke: ok/);

  // The executing copy must live under the consumer's node_modules.
  const where = execFileSync(
    process.execPath, ['--input-type=module', '-e',
      "console.log(await import.meta.resolve('@bosorus/lisa-evm'))"],
    { cwd: consumer, encoding: 'utf8' },
  ).trim();
  // Canonicalize both sides (macOS tmpdirs resolve through /private).
  const resolved = dirname(fileURLToPath(where));
  const expected = realpathSync(join(consumer, 'node_modules', '@bosorus', 'lisa-evm', 'dist'));
  assert.ok(realpathSync(resolved) === expected, `resolved ${where} outside consumer`);
});

test('packed declarations typecheck in a consumer', { skip: !built && 'run `npm run build` first' }, () => {
  const { tmp } = packAndUnpack();
  const consumer = installConsumer(tmp, 'consumer-types');
  writeFileSync(join(consumer, 'consumer.ts'), `
import { createProgram, encodeCall, rawCalldata, compile, SELF, type CompiledProgram, type TryCallResult, type Value } from '@bosorus/lisa-evm';
import { program, push, add, stop } from '@bosorus/lisa-evm/api';
import type { Program } from '@bosorus/lisa-evm/ast';

const p = createProgram();
const v = p.staticCall(SELF, encodeCall('transfer(address,uint256)', [SELF, 7n])).uint256();
p.if(v.gt(1), () => { p.call(SELF, encodeCall('done(uint256)', [v])); });
const raw = rawCalldata('0xdeadbeef');
p.staticCall(SELF, raw).word(32);
const attempted: TryCallResult = p.tryStaticCall(SELF, raw);
const success: Value = attempted.success;
p.if(success, () => {});
// @ts-expect-error success is a runtime Value, not a JavaScript boolean
const invalid: boolean = attempted.success;
void invalid;
const sent = p.tryCall(SELF, raw);
p.if(sent.success, () => {});
const high: CompiledProgram = p.compile();
const q: Program = program(push(2), push(3), add, stop);
const low: CompiledProgram = compile(q);
if (!high.hex.startsWith('0x') || !low.hex.startsWith('0x')) throw new Error('unreachable');
`);
  // Real tsc against the packed .d.ts files — the consumer's editor check.
  execFileSync(
    process.execPath,
    [resolve(pkgDir, 'node_modules', 'typescript', 'bin', 'tsc'),
     '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext',
     join(consumer, 'consumer.ts')],
    { cwd: consumer, encoding: 'utf8' },
  );
});

after(() => { if (stage) rmSync(stage.tmp, { recursive: true, force: true }); });
