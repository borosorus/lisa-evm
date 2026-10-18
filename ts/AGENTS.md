# TypeScript Tooling: Recoverable Calls

## Goal

Implement **Option A**: explicit `ProgramBuilder.tryCall()` and `ProgramBuilder.tryStaticCall()` that let a LISA program inspect the EVM call success flag without automatically reverting. Make the change safe, test it end-to-end, and leave `@bosorus/lisa-evm` ready for its next npm release.

Keep the change focused on `ts/`. The existing LISA VM and ISA already return `[returndataSize, success]` for `CALL` and `STATICCALL`; do not change `yul/LISA.yul`, opcode semantics, AST shapes, or the compiler/encoder unless a demonstrated bug requires it.

## Public API

Preserve the existing checked methods **without behavior changes**:

```ts
p.call(target, calldata, value?);    // reverts the LISA program on failed call
p.staticCall(target, calldata);       // reverts the LISA program on failed call
```

Add:

```ts
const result = p.tryCall(target, calldata, value?);
const read = p.tryStaticCall(target, calldata);

p.if(
  result.success,
  () => { /* call succeeded */ },
  () => { /* call failed, execution continues */ },
);
```

- The `success` member is a **LISA runtime `Value`**, not a JavaScript boolean. It should be usable with the existing `p.if`, `revertUnless`, and value operations.
- Keep the current `CallResult` returndata methods (`word(offset)`, `uint256()`, `bytes32()`, `bool()`) available on try-call results. A small `TryCallResult` extending `CallResult` is a reasonable choice; prefer the smallest clear type design.
- `tryCall` follows the same argument/value conventions as `call` (default value 0); `tryStaticCall` follows `staticCall`.
- No `allowFailure` option, no change to the meaning of `call()`, and no new guest opcodes.

## Lowering / correctness invariants

Reuse the existing calldata template + runtime ABI patching and actual call emission in `builder.ts`. Share that code with checked calls; split only the post-call handling as necessary.

After `CALL` or `STATICCALL` the runtime stack is:

```text
[..., returndataSize, success]   // success at the top
```

Checked calls must keep the existing failure guard and discard both returned stack words as they do today. Try-calls must:

1. **Not emit an automatic `JZ -> REVERT` failure guard.**
2. Discard `returndataSize` while preserving `success` (e.g. `SWAP 2; POP`).
3. Capture `success` as a persistent builder-managed slot via the existing shadow-stack discipline, so later uses emit correct `DUP` depths.
4. Preserve the 16-word stack checks and correct scope cleanup. Try-call success values created inside an if/else arm must not escape that arm.
5. Advance call/returndata sequence tracking just like a checked call. A later external call can replace returndata, but it **must not invalidate a previously captured success slot**.
6. Preserve the current branch-specific returndata staleness rules for `if/else`: decoding old results is valid only on paths where no newer call overwrote them.

Returndata may exist even if the external EVM call failed (for example, revert data). Do **not** treat `success === 0` as implying empty returndata; keep `RDLOAD` out-of-bounds and stale-data behavior unchanged. Document that callers must not assume failed-call returndata is a successful ABI return value.

Do not introduce an unnecessary generalized call-policy framework or a new IR.

## Tests (required)

Extend `ts/test/builder.test.ts` and the existing runtime compatibility fixtures where useful, covering:

- Checked `call` and `staticCall` still fail fast with their current behavior.
- `tryCall` and `tryStaticCall` return an accessible success `Value` and do not auto-revert.
- Correct stack shape: discard `returndataSize`, keep `success`, and reuse it at different `DUP` depths.
- A failed external call can select the failure arm of `p.if(result.success, then, else)`; a successful call selects the success arm. Prefer at least one actual Foundry/Yul runtime test in addition to checking emitted instructions.
- Returndata decoding works when valid, including failure/revert data when present; invalid/short returndata keeps existing bounds behavior.
- A later call makes earlier `CallResult.word()` stale but does not invalidate an already captured `success` Value.
- Nested branches, scope leakage, and balanced joins work with try-call results.
- Both APIs are available from the curated package root and packed-consumer imports/types; no unrelated public exports.

Prefer focused semantic/runtime assertions over new giant golden-byte strings.

## Documentation and npm release preparation

- Update `ts/README.md` and any relevant root README API examples with both checked and recoverable call semantics and a short `p.if(result.success, ..., ...)` example.
- Preserve ESM, Node >=22 consumer support, browser-safe imports, existing subpath exports, and `@bosorus/lisa-evm` naming. Keep GitHub repository URLs under `borosorus/lisa-evm`.
- Current repository manifest is `0.3.0`. **Check the version actually published to npm** before choosing a new one (`npm view @bosorus/lisa-evm version`). For an additive feature, prefer the next minor version (normally `0.4.0` if `0.3.0` is published), never reuse an already-published version.
- When ready, update `ts/package.json` and `ts/package-lock.json` together (e.g. `npm version minor --no-git-tag-version` from `ts/`, after checking the version). Don't modify the package name.
- Validate: `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, `npm pack --dry-run` in `ts/`; run `make test` at the repo root for the real Yul runtime fixtures. Confirm all three existing GitHub Actions CI jobs pass.
- Inspect the packed artifact/consumer smoke tests for the new public API, including types and Node 22 compatibility.
- **Do not run `npm publish`, create a release/tag, or merge to `main` without explicit approval.** Leave a clear summary of the version prepared, tests run, and exact publishing command for the maintainer.

## Constraints

Keep changes small, readable, and auditable. Reuse the current `Value`, `CallResult`, `captureTop`, branch scopes, and stack accounting where possible. Avoid broad refactors, new dependencies, wallet-specific assumptions, or unrelated features.

**Integrate less if there is doubt.**
