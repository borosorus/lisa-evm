# LISA

LISA is an experimental stack-based virtual machine implemented in standalone Yul. The instruction set and runtime live in [`yul/LISA.yul`](yul/LISA.yul), while Foundry provides the Solidity test and deployment harnesses.

The runtime is intentionally kept independent of a particular wallet architecture. It can be deployed standalone, integrated directly into a smart-wallet contract, or used as an implementation that an authenticated host invokes with EVM `DELEGATECALL`. The current standalone runtime reads the program directly from calldata; an embedding wallet may adapt how program bytes reach the interpreter while preserving the ISA.

The project pins Solidity 0.8.29 and the Cancun EVM target. It requires Foundry, Make, Bash, and awk.

## Execution model

LISA uses a 16-word stack and a small virtual-memory abstraction. Guest memory offsets are translated above LISA's internal bookkeeping region, so programs cannot address the interpreter's stack metadata directly.

Programs execute with a byte program counter. `STOP` terminates successfully, and reaching the end of the program also succeeds. Invalid opcodes, stack errors, malformed or truncated instructions, invalid jumps, and invalid virtual-memory translations halt exceptionally.

Relative jumps use a 16-bit sign-magnitude encoding: bit 15 means "backwards" and bits 0..14 contain the magnitude.

A minimal program:

```text
PUSH1 2
PUSH1 3
ADD
STOP

01 02 01 03 24 00
```

### Execution context

Context opcodes reflect the EVM context in which the interpreter is running. In a standalone deployment, `SELF` is the LISA contract address. When the interpreter is reached through host-level `DELEGATECALL`, `SELF` is the host wallet address and `CALLER` remains the original caller.

Likewise, LISA's `CALL` instruction always performs an ordinary EVM call from the current execution context. In a wallet integration, that generally means external calls are made as the wallet.

## Trust and integration model

LISA intentionally does not define wallet authentication or authorization policy. A host wallet should perform any required authentication, authorization, nonce/replay checks, spending policy, or other account-level validation before handing execution to the interpreter.

If LISA is deployed standalone without such a gate, arbitrary callers can submit programs and use authority held by that deployment through `CALL`, including ETH, token approvals, protocol permissions, or roles.

If LISA is embedded in or delegated to by a smart wallet, the same principle applies to the host execution context: programs may be able to exercise assets and permissions belonging to the wallet. The surrounding wallet therefore determines who may execute programs and what additional restrictions apply.

`STATICCALL` is available for read-only external execution. A **guest** `DELEGATECALL` instruction is intentionally not part of the current LISA ISA. This is separate from a host wallet using EVM `DELEGATECALL` to invoke the LISA interpreter itself. Guest delegate execution can be added later if a concrete module/storage use case justifies the additional semantics.

## Build and test

```bash
make build       # Compile Solidity harnesses and LISA creation bytecode
make test        # Recompile, then run offline tests
make test-opt    # Run the suite against optimized Yul bytecode
make trace       # Trace the full integration test
make debug       # Open Forge's debugger on the full integration test
make snapshot    # Record gas snapshots
make fmt         # Format Solidity files
make clean       # Remove Forge and Yul build output
```

Use another test with:

```bash
make trace TEST=test_Program_Loop
make debug TEST=test_Program_ConditionalCall
```

The build script compiles `yul/LISA.yul` with solc and writes hex-encoded creation bytecode to `build/yul/LISA.bin`. Build output and Forge caches are ignored by Git. Pass a custom compiler with `make test SOLC=/path/to/solc-0.8.29`.

The default build is intentionally unoptimized for easier stepping and debugging. Use `make test-opt` to exercise optimized bytecode.

## Standalone deployment

The included deployment script is useful for local testing and for deployments that intentionally use LISA as its own contract. It is not a requirement of the architecture.

Simulate deployment locally without an RPC:

```bash
make build
forge script script/LISA.s.sol:LISAScript --offline
```

To deploy to Anvil, add `--rpc-url http://127.0.0.1:8545 --broadcast` and your preferred Foundry signer options.
