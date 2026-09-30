# @bosorus/lisa-evm

TypeScript SDK for **LISA**, an experimental stack-based virtual machine. This
package builds LISA programs — a high-level program builder, ABI calldata, an
AST, a compiler with symbolic labels, an encoder, and a decoder/disassembler —
and emits plain program bytes.

It is a **compiler, not an executor**: it produces `Uint8Array`/hex program
bytes and needs no deployed runtime, RPC, or chain configuration. Execution
semantics are defined by the authoritative runtime,
[`yul/LISA.yul`](https://github.com/borosorus/lisa-evm/blob/main/yul/LISA.yul),
in the [lisa-evm](https://github.com/borosorus/lisa-evm) repository. This
package mirrors that ISA; when the two disagree, the Yul runtime is right.

## Install

```bash
npm install @bosorus/lisa-evm
```

ESM only. Works in modern browsers (bundlers included) and Node.js >= 22. The
only runtime dependency is [`@noble/hashes`](https://www.npmjs.com/package/@noble/hashes)
(Keccak-256 for ABI selectors, needed at program-build time).

## Build a program

`createProgram()` writes programs in terms of values and calls instead of a
manual stack; the builder resolves `DUP`/`SWAP` depths and stack cleanup for
you and raises `LoweringError` rather than emitting broken bytecode:

```ts
import { createProgram, encodeCall, SELF } from '@bosorus/lisa-evm';

const p = createProgram();

const balance = p.staticCall(SELF, encodeCall('balanceOf(address)', [SELF])).uint256();
p.if(balance.gt(1000), () => {
  p.call(SELF, encodeCall('execute(uint256)', [balance]));
});

const program = p.compile(); // { bytes: Uint8Array; hex: string; ... }
```

Pre-encoded calldata drops straight into the same call path, and any aligned
32-byte return-data word is readable:

```ts
import { createProgram, rawCalldata, SELF } from '@bosorus/lisa-evm';

const p = createProgram();
// transfer(address,uint256) encoded elsewhere — no ABI parsing here.
p.call(SELF, rawCalldata('0xa9059cbb0000000000000000000000001111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000000000002a'));

const result = p.staticCall(SELF, rawCalldata('0xc45a815d'));
const secondWord = result.word(32);             // word at byte offset 32
```

## Inspect bytecode

```ts
import { compile, decode, disassemble } from '@bosorus/lisa-evm';
import { program, push, add, stop } from '@bosorus/lisa-evm/api';

const programBytes = compile(program(push(2), push(3), add, stop)).bytes;
disassemble(programBytes);   // ["PUSH1 0x2", "PUSH1 0x3", "ADD", "STOP"]
decode(programBytes);        // structured instructions (name, operand, offset, size)
```

## Low-level subpaths

The AST layer the builder lowers into is available through documented
subpath imports:

```ts
import { program, push, add, stop } from '@bosorus/lisa-evm/api';
import { compile } from '@bosorus/lisa-evm/compile';

compile(program(push(2), push(3), add, stop)).hex; // 0x010201032400
```

Available subpaths: `api` (AST constructors), `ast` (AST types), `compile`,
`encode`, `decode`, `isa` (canonical opcode table), `bytes` (hex/byte
helpers), `expr`, `abi`, `builder`. The root entry is the curated
application-facing surface; internal plumbing (e.g. Keccak glue) stays out of
the root.

## Notes

- Programs are address-free by design: nothing here bakes in chain or runtime
  addresses. How program bytes reach a deployed runtime (calldata, an
  embedding wallet, `DELEGATECALL`) is an execution concern outside this
  package.
- Repository development requirements (Node >= 23.6, Foundry) do **not**
  apply to consumers of this package.
