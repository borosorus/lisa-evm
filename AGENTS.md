# AGENTS.md

## Scope

Implement a small, focused improvement to the TypeScript builder in `ts/`.

The goal is to:
- add an optional `else` branch to `ProgramBuilder.if()`;
- make the raw AST escape hatch more explicit;
- keep the existing AST/compiler/encoder architecture intact.

Do not broaden this into a general control-flow or compiler rewrite.

## Required API change

Extend:

```ts
p.if(condition, thenBody)
```

to also support:

```ts
p.if(condition, thenBody, elseBody)
```

The existing two-argument form must continue to work unchanged.

Prefer this API over chained forms such as `p.if(...).else(...)`. The builder is eager today; do not introduce delayed branch objects or AST splicing just to support chaining.

## Lowering semantics

An if/else should lower conceptually to:

```text
condition
JZ else

  thenBody

JMP end

else:
  elseBody

end:
```

An if without else should remain equivalent to the current lowering.

Use symbolic labels and let the existing compiler resolve byte offsets. Do not add manual jump-offset calculations to the builder.

## Stack and scope invariants

The builder's shadow stack remains the source of truth for stack accounting.

Each structured branch body must join with the same persistent stack shape it had on entry. Values created only inside a branch must not leak past that branch.

For both `then` and `else`:
- open a branch scope;
- allow branch-local persistent values while the scope is active;
- clean branch-local slots before the join;
- close the scope;
- reject use of branch-local `Value` or `CallResult` after the branch closes.

If useful, extract only the smallest internal helper needed to share scope/cleanup logic between branch bodies. Keep it obvious and local; avoid introducing a general control-flow framework.

Do not add branch result values or phi-like merging in this change.

## Raw escape hatch

The current `ProgramBuilder.emit(...nodes)` bypasses shadow-stack accounting and is only safe for stack-neutral raw AST emission.

Make this danger explicit. Prefer renaming it to:

```ts
emitUnsafe(...nodes)
```

Update call sites, tests, and documentation accordingly.

If backwards compatibility is considered important, a tiny deprecated forwarding alias is acceptable, but do not add complexity around it. The important part is that the public API clearly communicates that the method bypasses stack tracking.

Document that instructions emitted through this escape hatch must leave the runtime stack in the same shape expected by the builder.

## Non-goals

Do not:
- redesign the AST;
- rename or restructure the compiler/encoder pipeline;
- add loops, switch/match, branch-return values, or a control-flow IR;
- add `if(...).else(...)` chaining;
- change LISA runtime semantics or `yul/LISA.yul`;
- expand the ABI feature set;
- refactor unrelated TypeScript tooling.

Keep the patch readable and small.

## Tests

Add focused tests for:
- existing `if(condition, thenBody)` behavior remaining unchanged;
- `if(condition, thenBody, elseBody)` lowering and execution shape;
- both branches joining at the original stack depth;
- branch-local `Value` objects being out of scope after either branch closes;
- branch-local `CallResult` objects being out of scope after either branch closes;
- nested if/else cases using correct stack depths;
- the renamed raw escape hatch and any compatibility alias, if retained.

Prefer semantic assertions and a few targeted decode/label checks over large new golden byte strings unless a golden vector materially improves coverage.

Run the existing TypeScript suite and package validation after the change. Preserve current public package behavior outside the intended API update.

## Design principle

Integrate less if there is doubt.

The builder should stay a small safe assembler generator: it removes manual stack bookkeeping, call-failure handling, scopes, and label math without turning LISA into a high-level language.
