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

The standalone runtime is deployed on Ethereum mainnet at
[`0x7F6b058AAF78BC690f781F0914499C460Ff342D9`](https://etherscan.io/address/0x7F6b058AAF78BC690f781F0914499C460Ff342D9);
send compiled program bytes as calldata to execute them there.

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

`if` takes an optional third argument for the other path. Each branch body is
its own scope: values it creates are popped before the two paths join, and
touching one after the branch closed raises `LoweringError`:

```ts
p.if(
  balance.gt(1000),
  () => p.call(SELF, encodeCall('execute(uint256)', [balance])),
  () => p.call(SELF, encodeCall('queue(uint256)', [balance])),
);
```

Return data is tracked per path: a result decoded before the `if` stays readable
in a branch that makes no later call, and after the join only if neither branch
called again.

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

An account's ETH balance needs no call and no contract in between:

```ts
import { createProgram, encodeCall, CALLER, SELF } from '@bosorus/lisa-evm';

const p = createProgram();
p.if(p.balance(CALLER).gt(10n ** 18n), () => {
  p.call(SELF, encodeCall('settle()'));
});
```

The address accepts anything word-shaped — a `Value`, a hex address, bytes. Like
`GAS` and `SELFBALANCE`, `p.balance(...)` is an expression rather than a stack
slot: it lowers where the value is used, so a balance checked in a condition
costs no slot and each use re-reads the account.

An invariant worth aborting on gets a guard, and hashing bytes that travel with
the program has a direct form:

```ts
import { createProgram, encodeCall, CALLER, SELF } from '@bosorus/lisa-evm';

const p = createProgram();
p.revertUnless(p.balance(CALLER).gt(10n ** 18n)); // revert instead of continuing
const digest = p.keccak('0xdeadbeef');
p.call(SELF, encodeCall('claim(uint256)', [digest]));
```

`revertUnless` emits the same `JZ -> REVERT` guard the builder emits for a failed
call, and costs no slot; LISA's `REVERT` carries no revert data. `keccak` is a
slot rather than an expression — the data is copied (`BLOB`) and hashed once per
call, so reusing the `Value` duplicates the digest instead of re-copying and
re-hashing, and the slot lives until its scope closes. Hashing data that only
exists at runtime needs LISA's memory API, which the builder does not expose yet.

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

- Raw AST nodes go through `emitUnsafe(...nodes)`, the escape hatch around the
  shadow stack. What it appends must leave every value the builder tracks at the
  same stack position with the same contents — keeping only the stack depth is
  not enough — and nothing checks it. The old `emit` name remains as a
  deprecated alias.
- Programs are address-free by design: nothing here bakes in chain or runtime
  addresses. How program bytes reach a deployed runtime (calldata, an
  embedding wallet, `DELEGATECALL`) is an execution concern outside this
  package.
- Repository development requirements (Node >= 23.6, Foundry) do **not**
  apply to consumers of this package.
