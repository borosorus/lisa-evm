# Public API reference

[SDK home](../README.md) · [Concepts](concepts.md) · [Examples](examples.md) · [Low-level API](low-level.md)

Everything on this page is available from `@bosorus/lisa-evm`. For the ten
documented subpath imports, see the [low-level reference](low-level.md). Types
are shown in TypeScript notation; imports are ESM.

## Build a program

| API | Purpose |
| --- | --- |
| `createProgram(): ProgramBuilder` | Start a program with an empty builder. |
| `ProgramBuilder.compile(): CompiledProgram` | Compile its AST, appending `STOP` unless it already ends in `STOP` or `REVERT`. |
| `ProgramBuilder.toAST(): readonly Node[]` | Copy the current AST without an appended `STOP`. Intended for tooling and fixtures. |

### `ProgramBuilder` calls

| Method | Result | Behavior |
| --- | --- | --- |
| `call(target: AddressLike, data: CallData, value?: ValueLike)` | `CallResult` | EVM `CALL`; value defaults to `0n`; LISA reverts if the call fails. |
| `staticCall(target: AddressLike, data: CallData)` | `CallResult` | EVM `STATICCALL`; LISA reverts if the call fails. |
| `tryCall(target: AddressLike, data: CallData, value?: ValueLike)` | `TryCallResult` | EVM `CALL`; value defaults to `0n`; exposes failure without automatically reverting. |
| `tryStaticCall(target: AddressLike, data: CallData)` | `TryCallResult` | EVM `STATICCALL`; exposes failure without automatically reverting. |

`AddressLike` is an alias of `ValueLike`. A target may therefore be a runtime
`Value`, an address-shaped hex string or bytes, or a non-negative integer word.
The builder does not validate that the target implements the encoded function.

### `CallResult` and `TryCallResult`

| Member | Result | Meaning |
| --- | --- | --- |
| `word(offset: number)` | `Value` | Emit `RDLOAD` now and capture one 32-byte word at an aligned, non-negative byte offset. |
| `uint256()` | `Value` | Alias of `word(0)`. |
| `bytes32()` | `Value` | Alias of `word(0)`. |
| `bool()` | `Value` | Alias of `word(0)`; it does not return a JavaScript `boolean`. |
| `TryCallResult.success` | `Value` | Captured runtime flag: nonzero on success, zero on failure. |

`word()` raises `RangeError` for an invalid offset and `LoweringError` when the
result belongs to another builder, is out of scope, or is stale after another
call. A valid offset can still be out of bounds **at runtime** and cause a
revert. Capture needed words before emitting a later call. A captured word or
`success` flag remains usable after that call.

### Control flow and values

| Method | Result | Behavior |
| --- | --- | --- |
| `if(condition: ValueLike, thenBody: () => void, elseBody?: () => void)` | `void` | Emit runtime branching. Each callback builds a scoped arm; values created there cannot escape it. |
| `revertUnless(condition: ValueLike)` | `void` | Emit a guard that reverts the LISA program when the runtime word is zero. |
| `balance(address: AddressLike)` | `Value` | Read an account's ETH balance when the expression is used. |
| `keccak(data: Uint8Array \| string)` | `Value` | Copy embedded bytes and hash them once, capturing the digest as a slot. |
| `emitUnsafe(...nodes: readonly Node[])` | `void` | Append raw AST without shadow-stack tracking. Preserve every tracked slot's position **and contents**. |
| `emit(...nodes: readonly Node[])` | `void` | Deprecated alias of `emitUnsafe`. |

`keccak()` accepts hex strings or bytes, not an arbitrary runtime memory range.
`emitUnsafe()` can invalidate the builder's stack model; use the structured
methods whenever possible.

## `Value` and context words

`ValueLike = Value | number | bigint | string | Uint8Array`. Numbers must be
non-negative safe integers; strings are hex bytes, interpreted as big-endian
unsigned words. `Value` methods return another runtime `Value`:

| Methods | Result |
| --- | --- |
| `add(rhs)`, `sub(rhs)`, `mul(rhs)`, `div(rhs)` | Unsigned 256-bit arithmetic; addition, subtraction, and multiplication wrap. Division by zero yields zero. |
| `lt(rhs)`, `gt(rhs)`, `eq(rhs)` | A runtime word containing zero or one; consume with `p.if()` or `p.revertUnless()`. |

Each method accepts `ValueLike` as `rhs`. The exported context values are
`SELF` (current execution address), `CALLER`, `GAS`, `TIMESTAMP`, and
`SELFBALANCE`. Each use reads the runtime context again.

The root also exports these advanced construction helpers and types:

| Export | Meaning |
| --- | --- |
| `literal(value: bigint): Value` | Build a constant word in `0..2^256-1`. |
| `toValue(value: ValueLike): Value` | Convert a supported constant or pass a `Value` through. |
| `context(op: NoOperandOp): Value` | Build a context read; accepts only `SELF`, `CALLER`, `GAS`, `TIMESTAMP`, or `SELFBALANCE`. |
| `binop(kind: BinKind, lhs: Value, rhs: Value): Value` | Build a binary expression; `BinKind` is `add`, `sub`, `mul`, `div`, `lt`, `gt`, or `eq`. |
| `ValueTerm` | Tagged expression/slot representation. Directly constructing slot terms is unsafe; let the builder capture them. |

## ABI calldata

| Export | Result | Meaning |
| --- | --- | --- |
| `encodeCall(signature: string, args?: readonly AbiArg[])` | `AbiCallData` | Function selector plus static ABI argument words. |
| `rawCalldata(bytes: string \| Uint8Array)` | `CallData` | Copy pre-encoded calldata verbatim; no ABI parsing or patches. |
| `selectorOf(signature: string)` | `string` | Four-byte selector as `0x` hex. |
| `parseSignature(signature: string)` | `{ name: string; types: readonly string[] }` | Validate and split a canonical function signature. |

Use signatures such as `transfer(address,uint256)` with no spaces or argument
names. Supported argument types: `address`, `bool`, explicit `uint8` through
`uint256` in steps of 8, and `bytes1` through `bytes32`. Unsupported types
include `uint` aliases, dynamic bytes/string, arrays, tuples, and signed
integers. The argument count and constant ranges are checked at build time.
Runtime values for narrow types get an emitted range guard; runtime `bytesN`
arguments are rejected because their alignment cannot be inferred.

`AbiArg` includes `Value`, non-negative number or bigint, boolean, hex string,
and `Uint8Array`. `CallData` has a copied `template: Uint8Array` and readonly
`patches: readonly AbiPatch[]`. `AbiCallData` adds `signature`, four-byte
`selector`, and `inputs`. Runtime `Value` arguments create patches, each with
its byte `offset`, `arg`, and optional upper `bounds` check. Consumers usually
pass these objects directly to a builder call.

## Compile and inspect bytes

| Export | Result | Meaning |
| --- | --- | --- |
| `compile(program: Program)` | `CompiledProgram` | Lower a flat AST, resolve labels, and encode bytes. Unlike `p.compile()`, it does not append `STOP`. |
| `decode(program: Uint8Array)` | `DecodedInstruction[]` | Parse bytecode, rejecting invalid opcodes and truncation. |
| `disassemble(program: Uint8Array)` | `string[]` | Human-readable instruction lines. |

`CompiledProgram` contains `instructions`, `bytes`, `hex`, and a `labels` map
from names to byte addresses. `DecodedInstruction` contains `opcode`, `name`,
`offset`, `size`, and the operand fields appropriate to its instruction;
relative jumps also have an absolute `target`.

The root exports `CompileError`, `DecodeError` (with `offset`), and
`LoweringError`, plus the AST types `Node`, `NoOperandOp`, and `Program`.
Decoding checks byte structure, while VM stack and execution rules still
apply. See [low-level API](low-level.md) for constructors and ISA details.
