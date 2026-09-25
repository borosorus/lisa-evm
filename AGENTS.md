# AGENTS.md

## Purpose

This branch already contains the core TypeScript tooling for LISA:

- canonical ISA metadata;
- encoder / decoder / disassembler;
- low-level AST and compiler;
- TypeScript-first `ProgramBuilder`;
- runtime `Value` expressions;
- structured `if`;
- ABI call templates with runtime patches;
- checked `CALL` / `STATICCALL`;
- runtime compatibility fixtures executed against `LISA.yul`.

The next step is **not** to expand the language or redesign the compiler.

The goal of this pass is to make the TypeScript tooling a small, clean, integration-ready package that can be consumed by other TypeScript projects without depending on this repository's development setup.

Keep the implementation compact and preserve the existing architecture.

---

## Architecture to Preserve

Keep the current layering:

```text
TypeScript-first API
        ↓
builder / Values / ABI templates
        ↓
existing flat LISA AST
        ↓
existing compiler
        ↓
encoder
        ↓
LISA bytecode
```

The existing low-level API must remain available.

Do not merge the high-level builder into the low-level compiler and do not create a second bytecode-generation path.

`yul/LISA.yul` remains authoritative for execution semantics.

---

## Integration-Readiness Roadmap

### 1. Make the TypeScript tooling consumable as a normal package

The current `ts/` directory is optimized for repository-local development. Adapt it so another TypeScript project can consume it through a normal package dependency.

The package should expose built JavaScript and TypeScript declarations rather than requiring consumers to execute the repository's raw `.ts` sources.

Add the minimum package/build configuration needed for this.

Expected properties:

- standard package entry point;
- exported public API;
- generated `.js` output;
- generated `.d.ts` declarations;
- ESM-friendly output;
- no dependency on Node-only APIs in the public runtime library;
- package consumers should not need Node's native TypeScript execution support;
- tests and fixture-generation tools may remain Node-specific.

Keep the package structure simple. Do not introduce a monorepo or multiple packages unless clearly required.

The existing `src/index.ts` public surface should remain the main conceptual entry point.

---

### 2. Add raw / already-encoded calldata support

The high-level builder currently expects `CallData` produced by the local ABI helper.

Add an explicit way to pass calldata that has already been encoded elsewhere.

The public API should make both of these use cases natural:

```ts
p.call(target, encodeCall("transfer(address,uint256)", [to, amount]));
```

and conceptually:

```ts
p.call(target, rawCalldata("0x..."));
```

The exact name and representation are up to the implementing agent.

Raw calldata should:

- become a normal immutable `CallData`-compatible value;
- contain no runtime patches;
- lower through the same `BLOB` / call path as other calldata;
- accept the project's normal byte/hex representations;
- validate malformed input consistently with the existing byte helpers.

Do not expand the local ABI implementation merely to support calldata shapes that can already be supplied pre-encoded.

---

### 3. Expose generic return-word access

`CallResult` currently exposes scalar aliases that all decode returndata word 0.

Expose a small generic API for reading an arbitrary 32-byte returndata word.

Conceptually:

```ts
const result = p.staticCall(target, data);

const word0 = result.word(0);
const word1 = result.word(32);
```

Exact naming and whether the offset is expressed as bytes or word index are implementation choices, but semantics must be explicit.

Requirements:

- reuse the existing `RDLOAD` lowering;
- preserve stale-`CallResult` checks;
- preserve scope checks;
- preserve stack accounting;
- out-of-bounds reads should continue to fail according to the real runtime semantics;
- existing helpers such as `.uint256()`, `.bool()`, and `.bytes32()` may remain as conveniences over word 0.

Do not build a general ABI return decoder in this pass.

---

### 4. Harden the public package boundary

Review exports and make sure consumers see intentional APIs rather than repository plumbing.

Keep low-level tooling available, but distinguish public library functionality from:

- test helpers;
- fixture generators;
- repository build scripts;
- internal Keccak helpers where they do not need to be exported.

Avoid adding wrappers purely for aesthetics.

Make sure the package can be imported without executing test or filesystem-related code.

---

### 5. Verify portability and dependency assumptions

The runtime library should stay environment-neutral TypeScript/JavaScript where practical.

In particular:

- avoid `node:*` imports from public source modules;
- keep the Keccak dependency narrow;
- do not depend on filesystem, process, Foundry, or repository paths from the package API;
- keep emitted code compatible with ordinary modern TypeScript/JavaScript tooling.

The development and fixture scripts can continue to use Node APIs.

---

### 6. Finish with a focused verification pass

Before considering this roadmap complete, verify:

- the package builds from a clean install;
- declarations are emitted successfully;
- the built package can be imported through its declared package entry point;
- existing TypeScript unit tests still pass;
- existing runtime fixtures still execute against the real Yul runtime;
- optimized and unoptimized runtime tests still pass;
- raw calldata calls work;
- generic return-word reads work;
- current high-level acceptance programs still compile and execute unchanged.

Prefer extending the existing tests rather than creating a parallel test framework.

---

## Non-Goals

Do not use this pass to add:

- loops or additional structured control flow;
- a Solidity-like DSL;
- dynamic ABI types;
- a full ABI encoder / decoder;
- a richer type system;
- memory spilling;
- sophisticated stack allocation;
- optimizer passes;
- new VM opcodes for frontend convenience;
- UI-specific APIs;
- multiple npm packages;
- broad dependency upgrades unrelated to package readiness.

If one of these becomes necessary to satisfy a concrete bug or packaging blocker, document why before implementing it.

---

## Compatibility Expectations

Preserve both usage levels.

Low-level construction should continue to work:

```ts
program(
  push(2),
  push(3),
  add,
  stop,
);
```

The TypeScript-first API should continue to work:

```ts
const p = createProgram();

const value = p
  .staticCall(target, encodeCall("read(address)", [SELF]))
  .uint256();

p.if(value.gt(limit), () => {
  p.call(target, encodeCall("write(uint256)", [value]));
});

const compiled = p.compile();
```

New raw-calldata and generic-return-word functionality should fit naturally into this model rather than bypassing it.

---

## Agent Guidance

Before modifying code:

1. inspect the current branch in full;
2. run or understand the existing TypeScript and runtime compatibility tests;
3. produce a concrete implementation plan;
4. prefer the smallest changes that satisfy the roadmap;
5. preserve readable lowering and explicit stack semantics;
6. update documentation where package usage or public APIs change.

The agent should determine exact filenames, build tooling, package metadata, public names, and test organization from the current repository state.

The desired outcome is a **small standalone LISA TypeScript package**, not a larger compiler platform.
