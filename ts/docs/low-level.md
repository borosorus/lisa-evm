# Low-level API and import paths

[SDK home](../README.md) · [Public API](api.md) · [Concepts](concepts.md) · [Examples](examples.md)

The builder emits the same flat AST exposed by the low-level API. Use these
subpaths for tooling that needs symbolic labels, instruction encoding, byte
inspection, or ISA metadata. Application code usually starts at the package
root.

## Import map

| Import | Exports and purpose |
| --- | --- |
| `@bosorus/lisa-evm/api` | `ProgramPart`, AST constructors: `program`, `push`, `dup`, `swap`, `label`, `jmp`, `jz`, `blob`, `raw`, and zero-operand opcode constants. |
| `@bosorus/lisa-evm/ast` | `Node`, `Program`, `NoOperandOp`, `NO_OPERAND_OPS`, `nodeKind`. |
| `@bosorus/lisa-evm/compile` | `compile`, `CompiledProgram`, `CompileError`. |
| `@bosorus/lisa-evm/encode` | `encode`, `instructionSize`, `isRaw`, `Instruction`, `RawInstruction`, `AnyInstruction`, `encodeRel16`, `decodeRel16`. |
| `@bosorus/lisa-evm/decode` | `decode`, `disassemble`, `DecodedInstruction`, `DecodeError`. |
| `@bosorus/lisa-evm/isa` | `INSTRUCTIONS`, `instructionFor`, `lookup`, `encodeRel16`, `decodeRel16`, `InstructionSpec`, `OperandKind`, and ISA limits. |
| `@bosorus/lisa-evm/bytes` | `hexToBytes`, `bytesToHex`, `toBytes`, `toBE`, `fromBE`, `byteLength`, `concat`. |
| `@bosorus/lisa-evm/expr` | `Value`, `ValueLike`, context words, expression helpers and types. |
| `@bosorus/lisa-evm/abi` | `encodeCall`, `rawCalldata`, selectors, signature parsing, calldata types. |
| `@bosorus/lisa-evm/builder` | `createProgram`, `ProgramBuilder`, call results, and `LoweringError`. |

The root entry curates the builder, values, ABI calldata, compiler, decoder,
and AST **types**. It does not re-export low-level opcode constructors or
encoder helpers. `keccak.ts` is internal and has no package subpath.

## AST constructors

```ts
import { program, push, add, stop } from '@bosorus/lisa-evm/api';
import { compile, disassemble } from '@bosorus/lisa-evm';

const compiled = compile(program(push(2), push(3), add, stop));
compiled.hex;                 // 0x010201032400
disassemble(compiled.bytes);  // ['PUSH1 0x2', 'PUSH1 0x3', 'ADD', 'STOP']
```

| Constructor | AST effect |
| --- | --- |
| `program(...parts)` | Flatten nested `Node` arrays into a `Program`. |
| `push(value, bytes?)` | Push an unsigned word. Numeric values use minimal width; hex and bytes keep their input width unless `bytes` is supplied. Width must be 1–32. |
| `dup(n)`, `swap(n)` | Operate on the nth stack item, counting the top as 1. Runtime and compiler accept indices 1–16. |
| `label(name)`, `jmp(name)`, `jz(name)` | Mark a byte location and jump to it. `jz` pops a condition and jumps when it is zero. |
| `blob(data)` | Copy inline bytes into virtual memory and push their offset and length. |
| `raw(bytes)` | Insert literal bytecode. Intended for tooling and negative cases; bypasses normal encoder checks. |

Zero-operand constants from `/api`: `stop`, `pop`, `add`, `sub`, `mul`, `div`,
`keccak256`, `lt`, `eq`, `mstore`, `mload`, `call`, `staticcall`, `rdload`,
`self`, `caller`, `gas`, `selfbalance`, `balance`, `timestamp`, and `revert`.
Their uppercase names and stack effects are in `INSTRUCTIONS` from `/isa`.

`ProgramPart` is a `Node` or nested array of parts. The `Node` union covers
these constructors, opcode nodes, labels, and raw bytes. `Program` is
`readonly Node[]`; `nodeKind(node)` reports its operand
kind. Low-level `compile(program)` does **not** add a terminal `STOP`. Add
`stop` explicitly when the program should halt there.

## Compiler, encoder, and decoder

`compile(program)` resolves symbolic labels in two passes and returns
`CompiledProgram` with resolved `instructions`, `bytes`, `hex`, and `labels`.
Unknown or duplicate labels, invalid operands, and jump offsets outside the
16-bit sign-magnitude range fail with `CompileError` or a range/type error.
Jump deltas are relative to the jump's operand field (opcode address + 1).

`encode(instructions)` accepts resolved `Instruction` objects with an `opcode`
and the appropriate `value`, `index`, `rel`, or `data` field. It also accepts
`RawInstruction` objects with `rawBytes`. `instructionSize()` reports encoded
length, and `isRaw()` distinguishes these two types. The encoder re-exports
`encodeRel16()` and `decodeRel16()` for manual relative jumps.

`decode(bytes)` returns `DecodedInstruction[]` with `name`, byte `offset`,
`size`, and the applicable operand. For jumps it also reports the absolute
`target`. `disassemble(bytes)` formats those records as strings. `DecodeError`
includes the bad byte `offset`. Decoding rejects invalid opcodes and truncated
operands, but may still return instructions that the VM rejects at runtime
(for example, `DUP 0`).

The `/isa` module exposes the opcode table and numeric limits:
`PUSH_MIN_BYTES`, `PUSH_MAX_BYTES`, `PUSH_FIRST_OPCODE`, `PUSH_LAST_OPCODE`,
`MAX_OPCODE`, `STACK_SIZE`, `REL16_MAX_FORWARD`, `REL16_MAX_BACKWARD`, and
`BLOB_MAX_LEN`. `lookup(name)` and `instructionFor(opcode)` return
`InstructionSpec` metadata or `undefined`.

### Byte helpers

| Function | Result |
| --- | --- |
| `hexToBytes(hex: string)` | Validate even-length hex (with or without `0x`) and return `Uint8Array`. |
| `bytesToHex(bytes: Uint8Array, withPrefix?: boolean)` | Lowercase hex, with `0x` by default. |
| `toBytes(input: number \| bigint \| string \| Uint8Array)` | Convert unsigned values or hex to bytes; copy a byte-array input. |
| `byteLength(value: bigint)` | Minimum big-endian byte width, at least one. |
| `toBE(value: bigint, length: number)` / `fromBE(bytes: Uint8Array)` | Convert between unsigned integers and big-endian bytes. |
| `concat(...parts: Uint8Array[])` | Concatenate byte arrays. |

`toBE()` throws if the value does not fit its width. These helpers do not
perform ABI encoding; use `encodeCall()` for that.

## Safety boundary

The builder tracks stack slots; raw AST or `emitUnsafe()` does not update that
tracking. If you mix them, every tracked slot must retain both its contents
and stack position. The compiler checks byte layout and label resolution, not
all VM execution conditions. The authoritative opcode semantics are in
[`yul/LISA.yul`](https://github.com/borosorus/lisa-evm/blob/main/yul/LISA.yul).
