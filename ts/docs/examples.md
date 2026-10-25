# SDK examples

[SDK home](../README.md) · [Concepts](concepts.md) · [API reference](api.md) · [Troubleshooting](troubleshooting.md)

Each example is independent and only builds bytecode. Replace the illustrative
`0x1111…` target with a contract that implements the shown function signatures
before executing a program. The SDK itself does not send transactions.

## Read, compare, then write

```ts
import { createProgram, encodeCall } from '@bosorus/lisa-evm';

const target = '0x1111111111111111111111111111111111111111';
const p = createProgram();
const count = p.staticCall(target, encodeCall('count()')).uint256();

p.if(count.gt(10n), () => {
  p.call(target, encodeCall('setCount(uint256)', [count]));
});

const { bytes, hex } = p.compile();
```

`count` is a captured runtime word, so it can be reused in the branch. Both
calls are checked: the LISA program reverts if either external call fails.

## Send a value with `CALL`

```ts
import { createProgram, encodeCall } from '@bosorus/lisa-evm';

const target = '0x1111111111111111111111111111111111111111';
const p = createProgram();
p.call(target, encodeCall('deposit()'), 1_000_000_000_000_000n);
const program = p.compile();
```

The third argument is the EVM value-transfer word in wei. Omit it to send
zero. `staticCall()` and `tryStaticCall()` do not accept value.

## Continue after a failed call

```ts
import { createProgram, encodeCall } from '@bosorus/lisa-evm';

const primary = '0x1111111111111111111111111111111111111111';
const fallback = '0x2222222222222222222222222222222222222222';
const p = createProgram();
const attempt = p.tryCall(primary, encodeCall('perform()'));

p.if(
  attempt.success,
  () => { p.call(primary, encodeCall('markSuccess()')); },
  () => { p.call(fallback, encodeCall('perform()')); },
);

const program = p.compile();
```

`attempt.success` is a runtime `Value`. It remains usable after a later call,
but calling `attempt.word()` after that call raises `LoweringError` because its
return data is stale. A failed call can have revert data; do not decode it as
a successful ABI result.

## Read two return words

```ts
import { createProgram, encodeCall } from '@bosorus/lisa-evm';

const target = '0x1111111111111111111111111111111111111111';
const p = createProgram();
const result = p.staticCall(target, encodeCall('pair()'));
const first = result.word(0);
const second = result.word(32);
p.revertUnless(second.gt(first));
const program = p.compile();
```

Both words are captured before another call can replace the return-data
buffer. `word(32)` requests bytes 32–63; if the call returned fewer than 64
bytes, `RDLOAD` reverts at runtime.

## Pass runtime values as ABI arguments

```ts
import { createProgram, encodeCall, CALLER, SELF } from '@bosorus/lisa-evm';

const target = '0x1111111111111111111111111111111111111111';
const p = createProgram();
p.call(target, encodeCall('record(address,uint256)', [SELF, p.balance(CALLER)]));
const program = p.compile();
```

`encodeCall()` embeds constant arguments in its template. Runtime `Value`
arguments are written into the calldata when the program executes. Only the
[supported static ABI types](api.md#abi-calldata) are accepted.

## Use calldata encoded elsewhere

```ts
import { createProgram, rawCalldata } from '@bosorus/lisa-evm';

const target = '0x1111111111111111111111111111111111111111';
const preEncoded = '0x12345678'; // replace with complete calldata
const p = createProgram();
p.call(target, rawCalldata(preEncoded));
const program = p.compile();
```

`rawCalldata()` copies the bytes verbatim and performs no ABI parsing.

## Guard a balance and hash embedded bytes

```ts
import { createProgram, encodeCall, CALLER } from '@bosorus/lisa-evm';

const target = '0x1111111111111111111111111111111111111111';
const p = createProgram();
p.revertUnless(p.balance(CALLER).gt(1n));
const digest = p.keccak('0xdeadbeef');
p.call(target, encodeCall('commit(uint256)', [digest]));
const program = p.compile();
```

The digest is a captured runtime word. It is encoded here as `uint256`;
runtime `bytesN` ABI arguments are not supported by `encodeCall()`.

## Build a loop with symbolic labels

```ts
import { compile, disassemble } from '@bosorus/lisa-evm';
import { program, push, label, dup, jz, sub, jmp, pop, stop } from '@bosorus/lisa-evm/api';

const ast = program(
  push(2),
  label('again'),
  dup(1),
  jz('done'),
  push(1), sub,
  jmp('again'),
  label('done'),
  pop, stop,
);

const { bytes, hex, labels } = compile(ast);
const lines = disassemble(bytes);
```

`compile()` resolves the label offsets. Low-level programs need their own
stack discipline and explicit stopping instruction; see the
[low-level reference](low-level.md).
