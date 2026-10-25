# How LISA programs are built

[SDK home](../README.md) · [API reference](api.md) · [Examples](examples.md) · [Troubleshooting](troubleshooting.md)

`@bosorus/lisa-evm` builds bytecode. It does not execute programs, connect to a
chain, or choose a wallet. `createProgram()` records instructions in a
`ProgramBuilder`; `p.compile()` returns the finished program as bytes and hex.
The Yul runtime defines what those instructions do when a program is executed.

## JavaScript values and LISA values

A `Value` describes a 256-bit word that will exist when the LISA program runs.
It is **not** a JavaScript number or boolean. Use its methods to build
arithmetic and comparisons, and use `p.if()` to branch on one:

```ts
import { createProgram, CALLER } from '@bosorus/lisa-evm';

const p = createProgram();
const hasFunds = p.balance(CALLER).gt(1_000_000_000_000_000_000n);
p.if(hasFunds, () => {
  p.revertUnless(p.balance(CALLER).gt(0n));
});
const { bytes, hex } = p.compile();
```

The callbacks passed to `p.if()` run **while building** the program. They add
instructions for the two runtime paths; JavaScript does not choose a path then.
`if (hasFunds) { ... }` would instead test whether the `Value` object exists in
JavaScript, which is not the LISA condition.

`ValueLike` accepts a `Value`, a non-negative safe JavaScript integer, a
`bigint`, a hex string, or big-endian bytes. Use `bigint` or hex for values too
large for a safe JavaScript integer. Arithmetic on LISA words is unsigned and
256-bit; `add`, `sub`, and `mul` wrap at that width. Division by zero yields
zero. A condition is true when its runtime word is nonzero.

## Expressions and captured slots

`SELF`, `CALLER`, `GAS`, `TIMESTAMP`, `SELFBALANCE`, and `p.balance(address)`
are expressions. Each use emits a read at that point in the program. For
example, using `p.balance(CALLER)` twice reads the balance twice.

Decoded return words, `p.keccak(data)` results, and try-call `success` values
are captured stack slots. They are computed once and reused with `DUP`. A slot
remains on the LISA stack until its scope closes. Temporary operands also use
stack space; the builder raises `LoweringError` if lowering would exceed the
VM's 16-word limit.

`p.keccak(data)` hashes bytes embedded in the program, such as a hex string or
`Uint8Array`. The builder does not expose a way to hash arbitrary bytes that
only become available in VM memory at runtime.

## Calls and return data

`p.call(target, data, value?)` sends a `CALL`, with value defaulting to zero.
`p.staticCall(target, data)` sends a `STATICCALL`. Both are **checked**: a
failed external call reverts the LISA program. `p.tryCall()` and
`p.tryStaticCall()` instead return a `TryCallResult` whose `success` is a
runtime `Value`:

```ts
import { createProgram, encodeCall } from '@bosorus/lisa-evm';

const target = '0x1111111111111111111111111111111111111111';
const p = createProgram();
const calldata = encodeCall('run()');
const attempt = p.tryCall(target, calldata);
p.if(attempt.success, () => {
  // Instructions for success.
}, () => {
  // Instructions for failure; the LISA program continues.
});
const program = p.compile();
```

All four methods return a `CallResult` or subclass for the *latest* EVM return
data. Calling `result.word(offset)` immediately emits an `RDLOAD` and captures
that 32-byte word as a slot. `offset` is a byte offset and must be a
non-negative multiple of 32. `uint256()`, `bytes32()`, and `bool()` are all
aliases for `word(0)`; they do not decode different JavaScript types, and
`bool()` does not validate an ABI boolean.

The return-data buffer is replaced by the next external call. Decode any words
you need **before** emitting that call. Already captured words and success
flags remain usable afterward. Decoding from the older `CallResult` raises
`LoweringError` while building. At runtime, `RDLOAD` reverts if fewer than 32
bytes remain at the requested offset. Failed calls may provide revert data;
its presence does not make it a successful ABI return value.

## Branch scopes

Each `p.if()` arm has its own scope. Values captured inside an arm are popped
before its paths join and cannot be used after the arm closes. Values captured
before the branch can be reused in either arm and after the join.

Return-data freshness is tracked by path. A result from before an `if/else`
remains decodable inside a branch that has made no newer call. After the join,
it remains decodable only when neither branch made a newer call.

## Calldata and output

`encodeCall('name(type,...)', args)` builds a function selector and static ABI
argument words. Constant arguments are embedded; runtime `Value` arguments are
patched into calldata when the LISA program runs. Supported types are
`address`, `bool`, explicit `uint8` through `uint256` in steps of 8, and
`bytes1` through `bytes32`. Dynamic types, arrays, tuples, signed integers,
and runtime `bytesN` arguments are unsupported. Use `rawCalldata(bytes)` for
calldata encoded elsewhere.

`p.compile()` returns `{ instructions, bytes, hex, labels }` and appends `STOP`
unless the program already ends in `STOP` or `REVERT`. The output is plain
program bytecode. `decode(bytes)` and `disassemble(bytes)` inspect it;
structural decoding does not prove that an arbitrary low-level program will
execute safely.
