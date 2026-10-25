# @bosorus/lisa-evm

TypeScript SDK for building **LISA** programs. It provides a program builder,
ABI calldata helpers, a low-level AST and compiler, and bytecode inspection.
The output is plain `Uint8Array` or hex program bytes. This package does not
execute programs or connect to a chain.

The package is ESM, supports Node.js >= 22 and modern browsers, and has one
runtime dependency: `@noble/hashes` for ABI selectors. LISA execution
semantics are defined by the [Yul runtime](https://github.com/borosorus/lisa-evm/blob/main/yul/LISA.yul).

## Install and build a program

```bash
npm install @bosorus/lisa-evm
```

```ts
import { createProgram, encodeCall } from '@bosorus/lisa-evm';

// Replace this illustrative address with a contract that has count() and
// setCount(uint256). Building the program needs no RPC connection.
const target = '0x1111111111111111111111111111111111111111';
const p = createProgram();

const read = p.tryStaticCall(target, encodeCall('count()'));
p.if(read.success, () => {
  const count = read.uint256();
  p.if(count.gt(10n), () => {
    p.call(target, encodeCall('setCount(uint256)', [count]));
  });
});

const program = p.compile();
program.bytes; // Uint8Array
program.hex;   // 0x-prefixed hex
```

`tryStaticCall()` lets the LISA program continue after an external call fails.
Its `success` is a **runtime `Value`**, so branch with `p.if()` rather than a
JavaScript `if`. `call()` and `staticCall()` are checked calls that revert the
LISA program on failure. [How values and calls work](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/concepts.md)

## Find a feature

| I want to... | Use | Read |
| --- | --- | --- |
| Build a program | `createProgram()`, `p.compile()` | [API: build](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/api.md#build-a-program) |
| Encode a function call | `encodeCall()`, `selectorOf()` | [API: ABI calldata](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/api.md#abi-calldata) |
| Use calldata encoded elsewhere | `rawCalldata()` | [Example](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/examples.md#use-calldata-encoded-elsewhere) |
| Make a checked or recoverable call | `call()`, `staticCall()`, `tryCall()`, `tryStaticCall()` | [API: calls](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/api.md#programbuilder-calls) |
| Read return data | `CallResult.word()`, `uint256()`, `bytes32()`, `bool()` | [Concepts: return data](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/concepts.md#calls-and-return-data) |
| Branch or guard an invariant | `p.if()`, `p.revertUnless()`, `Value.gt()` and other comparisons | [API: control flow](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/api.md#control-flow-and-values) |
| Read runtime context or balance | `SELF`, `CALLER`, `GAS`, `TIMESTAMP`, `SELFBALANCE`, `p.balance()` | [API: context words](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/api.md#value-and-context-words) |
| Hash embedded bytes | `p.keccak()` | [Example](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/examples.md#guard-a-balance-and-hash-embedded-bytes) |
| Inspect program bytes | `decode()`, `disassemble()` | [API: byte inspection](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/api.md#compile-and-inspect-bytes) |
| Write instructions and labels directly | `@bosorus/lisa-evm/api`, `compile()` | [Low-level reference](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/low-level.md) |
| Diagnose an error | `LoweringError`, `CompileError`, `DecodeError` | [Troubleshooting](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/troubleshooting.md) |

## API index and imports

The package root is the application-facing import. These groups are available
from `@bosorus/lisa-evm`; the linked reference lists their signatures and
behavior.

| Symbols | Reference |
| --- | --- |
| `createProgram`, `ProgramBuilder`, `AddressLike`, `LoweringError` | [Builder](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/api.md#build-a-program) |
| `CallResult`, `TryCallResult` | [Call results](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/api.md#callresult-and-trycallresult) |
| `Value`, `ValueLike`, `ValueTerm`, `BinKind`, `literal`, `toValue`, `context`, `binop`, `SELF`, `CALLER`, `GAS`, `TIMESTAMP`, `SELFBALANCE` | [Values](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/api.md#value-and-context-words) |
| `encodeCall`, `rawCalldata`, `selectorOf`, `parseSignature`, `CallData`, `AbiCallData`, `AbiArg`, `AbiPatch` | [ABI calldata](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/api.md#abi-calldata) |
| `compile`, `CompiledProgram`, `CompileError`, `decode`, `disassemble`, `DecodedInstruction`, `DecodeError` | [Compile and inspect](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/api.md#compile-and-inspect-bytes) |
| `Node`, `NoOperandOp`, `Program` | [AST and subpaths](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/low-level.md) |

For AST constructors and encoding internals, import documented subpaths such
as `@bosorus/lisa-evm/api`, `/compile`, `/encode`, `/decode`, `/isa`, and
`/bytes`. All ten subpaths and their exports are listed in the
[low-level reference](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/low-level.md).

```ts
import { compile, decode, disassemble } from '@bosorus/lisa-evm';
import { program, push, add, stop } from '@bosorus/lisa-evm/api';

const bytes = compile(program(push(2), push(3), add, stop)).bytes;
disassemble(bytes); // ['PUSH1 0x2', 'PUSH1 0x3', 'ADD', 'STOP']
decode(bytes);      // instruction objects with byte offsets and operands
```

## Read next

- [Concepts and runtime values](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/concepts.md): JavaScript versus LISA, stack slots, scopes, calls, and return data.
- [Public API reference](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/api.md): root exports, signatures, inputs, and errors.
- [Low-level API and import paths](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/low-level.md): AST, compiler, encoder, decoder, ISA, and bytes.
- [Copyable examples](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/examples.md): common program-building tasks.
- [Troubleshooting](https://github.com/borosorus/lisa-evm/blob/main/ts/docs/troubleshooting.md): common build and runtime problems.

Programs are address-free: no runtime address, RPC endpoint, or wallet is
embedded by this SDK. The repository's standalone Yul runtime is deployed on
[Ethereum mainnet](https://etherscan.io/address/0x7F6b058AAF78BC690f781F0914499C460Ff342D9),
but execution and authorization belong to the host application. Repository
development requires Node.js >= 23.6 and Foundry; package consumers only need
the published Node/browser support above.
