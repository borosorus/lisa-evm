# AGENTS.md

## Goal

Prepare the TypeScript toolchain in ts/ to be a clean, public npm package that can serve as the shared SDK/compiler layer for applications built on LISA.

Target package name:

~~~
@borosorus/lisa-evm
~~~

The repository remains a combined runtime/tooling repository:

~~~
lisa-evm
├── yul/           authoritative LISA runtime
├── test/          runtime / integration tests
└── ts/            public TypeScript package
~~~

Do not restructure the repository into a monorepo or split the TypeScript code into multiple packages unless a concrete technical requirement makes that necessary.

The package should be usable by a separate browser-based application without importing repository source files directly.

## 1. Preserve the existing toolchain architecture

The TypeScript implementation already has a useful separation:

~~~
high-level builder / expressions / ABI helpers
                    ↓
                   AST
                    ↓
                 compiler
                    ↓
                 encoder
                    ↓
               LISA bytecode
~~~

The reverse tooling also exists:

~~~
LISA bytecode
     ↓
decoder / disassembler
~~~

Preserve this architecture.

Do not use package preparation as an excuse to redesign the AST, lowering semantics, stack accounting, ABI semantics, label resolution, byte encoding, return-data handling, or LISA instruction semantics.

This branch is primarily about making the existing toolchain a robust external dependency.

Small fixes are allowed when packaging or external-consumer testing exposes a genuine API or portability problem.

## 2. Package identity

Change the package from its current private development identity, lisa-tooling, to:

~~~
@borosorus/lisa-evm
~~~

Remove private: true.

Keep the initial package version at 0.1.0 unless there is a concrete reason in repository history to choose another version.

Add useful npm metadata such as repository information, homepage / bugs links where appropriate, keywords, and public publish configuration.

Do not invent a license value.

There is currently no repository LICENSE file. If no license has been explicitly selected by the repository owner, omit package license metadata rather than choosing one on their behalf.

## 3. Public API boundary

The root package entry should remain curated.

Ordinary consumers should be able to write code conceptually like:

~~~ts
import {
  createProgram,
  encodeCall,
  rawCalldata,
  compile,
  decode,
  disassemble,
  SELF,
} from '@borosorus/lisa-evm';
~~~

Do not expose every internal module from the root merely because it is convenient.

The package root should focus on common application/tooling use:

- program builder;
- runtime values and expressions;
- ABI helpers;
- raw calldata helper;
- compiler;
- decoder / disassembler;
- intentionally public types.

Specialized functionality may remain available through explicit subpath exports such as:

~~~
@borosorus/lisa-evm/api
@borosorus/lisa-evm/ast
@borosorus/lisa-evm/compile
@borosorus/lisa-evm/encode
@borosorus/lisa-evm/decode
@borosorus/lisa-evm/isa
@borosorus/lisa-evm/bytes
@borosorus/lisa-evm/builder
@borosorus/lisa-evm/expr
@borosorus/lisa-evm/abi
~~~

Review the existing exports rather than blindly preserving or expanding them.

Implementation-specific helpers such as internal hashing glue should remain internal unless there is a real consumer use case.

Avoid breaking the existing semantic split between the curated root and lower-level subpaths.

## 4. ESM and TypeScript consumer experience

The package is ESM. Keep it ESM unless a real consumer requirement proves another format is necessary.

The published artifact should contain compiled JavaScript and TypeScript declarations so consumers do not need to execute TypeScript source directly.

Expected consumer behavior:

~~~
npm install @borosorus/lisa-evm
        ↓
import package normally
        ↓
no repository-relative imports
no TypeScript runtime loader
no access to lisa-evm source tree
~~~

Keep declaration generation working for every documented public entry point.

Check that package exports and generated declaration paths agree.

Avoid requiring consumers to know that package source lives under ts/.

## 5. Browser compatibility

A major intended consumer is a browser application.

Production package code must not depend on Node filesystem APIs, process globals, child processes, repository paths, Foundry, local generated files outside the package, or test-only Node helpers.

Node-only behavior is fine in tests, fixture generators, packaging scripts, and development tooling.

The current @noble/hashes dependency is acceptable if it remains browser-compatible.

Add or improve a lightweight consumer/package test that would catch accidental Node-only runtime imports.

Do not add a large browser framework to this repository merely to test packaging.

If a tiny bundler-based smoke test is useful, keep it isolated as development tooling.

## 6. Package contents

Publishing happens from ts/.

The npm artifact should be deliberate and small.

At minimum it should contain:

~~~
package.json
README.md
dist/
~~~

If a license is later explicitly chosen, include it as well.

Do not publish source tests unless intentionally useful, fixture-generation tools, Foundry artifacts, Yul build outputs, repository scripts, local caches, node_modules, or unrelated repository files.

Use npm's files field or equivalent simple package controls rather than complicated ignore rules where possible.

Inspect the actual package tarball. Do not assume metadata produces the intended artifact.

## 7. Package documentation

Add a package-local README suitable for npm.

It should be concise and consumer-oriented and explain:

- what the package is;
- that it compiles/builds LISA programs;
- the relationship between the package and the LISA runtime;
- installation;
- a minimal high-level builder example;
- use of pre-encoded calldata;
- compilation to program bytes/hex;
- decoder/disassembler usage;
- documented low-level subpath imports;
- supported environment expectations;
- that the Yul runtime remains the authoritative execution semantics.

Avoid turning the npm README into the complete VM specification. The repository root README already serves that role.

Update repository-level documentation where package names or old file-dependency instructions have become stale.

All public consumer examples should import from @borosorus/lisa-evm, not directly from ts/src/, unless the example is explicitly about contributing inside this repository.

## 8. Prepack and release safety

A package should not be publishable with stale or missing dist/.

Add an appropriate prepack or release-validation path that ensures the package is built before npm creates the artifact.

Prefer simple scripts composed from existing commands rather than introducing a release framework.

The important checks are:

~~~
typecheck
tests
build
package artifact validation
~~~

Avoid running unnecessarily expensive Foundry suites from every npm packaging command unless required to establish package correctness.

Runtime/toolchain compatibility should still be covered somewhere in repository CI.

## 9. Package-boundary tests

Tests that import relative source files do not fully prove the published API.

Maintain or extend package-boundary tests so they validate the built package surface.

Verify at least:

- the package root imports successfully;
- documented root API is present;
- documented subpath exports import successfully;
- TypeScript declarations are emitted;
- a representative high-level program can be constructed and compiled through the public package API;
- raw calldata remains available;
- generic return-word access remains available;
- intentionally internal low-level helpers are not accidentally exposed from the root.

Prefer testing the artifact consumers actually receive.

A good validation flow is conceptually:

~~~
build
  ↓
npm pack
  ↓
install or import packed artifact in an isolated consumer
  ↓
exercise public API
~~~

The exact implementation is left to the implementing agent.

## 10. CI

The repository currently has no GitHub Actions workflow.

Add a focused CI workflow.

At minimum validate the TypeScript package with a clean dependency install and:

~~~bash
npm run typecheck
npm test
npm run build
npm pack
~~~

Run commands from ts/ where appropriate.

Also preserve confidence that compiler output matches the real LISA runtime. Existing repository integration tests / fixture tests already address this relationship; incorporate the relevant existing command rather than duplicating runtime semantics in JavaScript-only tests.

Do not create a sprawling matrix unless it provides useful coverage.

A single supported Node version is acceptable initially if it matches the documented development requirements. A small matrix is fine if it is cheap and materially useful.

## 11. Node version expectations

Review the current Node requirement.

The repository README currently mentions Node >= 23.6 because development tests run TypeScript directly.

That development requirement does not automatically need to become the minimum runtime requirement of the compiled npm package.

Distinguish repository development requirements from published package runtime requirements.

If the compiled package works on an older maintained Node release and modern browsers, do not unnecessarily require Node 23.6 for consumers.

Set an engines field only when there is a justified compatibility floor.

Do not guess compatibility. Test the range you claim.

## 12. Versioning

Keep one package and one release stream for now.

Do not create packages such as:

~~~
@borosorus/lisa-ast
@borosorus/lisa-compiler
@borosorus/lisa-builder
~~~

The subpath-export model is sufficient.

The TypeScript package must stay semantically aligned with the LISA ISA/runtime in this repository.

Do not invent an ISA-version constant unless there is a real versioning scheme to represent. If version metadata becomes useful, define its semantics first.

## 13. Publishing

Make the repository publish-ready, but do not publish to npm unless explicitly instructed and the required npm account/organization state is available.

Before any first publication, verify:

- the scoped package name is available or owned;
- package metadata is correct;
- tarball contents are correct;
- the packed package installs in an isolated consumer;
- build, tests, and typecheck pass;
- documentation refers to the final package name.

For future automated releases, prefer npm/GitHub trusted publishing or another short-lived credential mechanism over storing a long-lived npm token.

Do not block package-preparation work on registry automation.

A simple first release is preferable to a complex release-management system.

## 14. Do not couple the package to a specific application

The package is shared LISA tooling.

Do not add application-specific UI state, React components, editor models, wallet connection code, RPC clients, chain configuration, deployment addresses, browser storage, or account-specific execution policy.

Those belong in consuming applications.

It is fine to improve generic compiler/tooling APIs when an external consumer reveals an actual missing abstraction, but keep the boundary language/runtime-oriented.

## 15. Preserve runtime independence

The TypeScript package should compile LISA programs without requiring a deployed runtime address.

A runtime deployment is an execution concern, not a compiler concern.

Keep the relationship:

~~~
@borosorus/lisa-evm
    ↓
produces LISA program bytes

deployed LISA runtime
    ↓
executes those bytes
~~~

Do not bake chain-specific runtime addresses into this package.

## 16. Recommended work sequence

Inspect existing TypeScript tests and the public API before editing.

A sensible sequence is:

~~~
package metadata / rename
        ↓
package-local README + repository docs
        ↓
review exports and declarations
        ↓
browser/runtime portability checks
        ↓
prepack / artifact validation
        ↓
isolated packed-package consumer test
        ↓
GitHub CI
        ↓
final npm pack inspection
~~~

The exact commit structure is up to the implementing agent.

Prefer coherent incremental changes over one large opaque commit.

## 17. Acceptance criteria

This branch is ready when:

- ts/ identifies as public @borosorus/lisa-evm;
- private: true is gone;
- normal consumers import only from the package and documented subpaths;
- built JavaScript and declarations are complete;
- package runtime code is browser-safe;
- package-local npm documentation exists;
- repository docs use the new package identity;
- npm pack produces a clean, intentional artifact;
- the packed artifact works from an isolated consumer;
- CI validates typecheck, tests, build, and packaging;
- runtime/toolchain compatibility tests remain intact;
- no application-specific code has been introduced;
- no npm publication has happened without explicit instruction.

## Non-goals

Do not use this work to redesign LISA, add new VM opcodes, rewrite the compiler, add a UI, add wallet/account behavior, create a monorepo, split the toolchain into multiple npm packages, add a heavy release framework, broadly upgrade unrelated dependencies, invent a license, or publish automatically before deliberate review.

The desired result is boring in the best way: a small, predictable, browser-safe package that external LISA applications can depend on through normal npm semver.
