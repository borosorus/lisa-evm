# LISA

LISA is an experimental stack-based virtual machine implemented in standalone Yul. Programs are supplied directly as calldata; the instruction set and runtime live in [`yul/LISA.yul`](yul/LISA.yul), while Foundry provides the Solidity deployment harness and tests.

The project pins Solidity 0.8.29 and the Cancun EVM target. It requires Foundry, Make, Bash, and awk.

## Execution model

LISA uses a 16-word stack and a small virtual-memory abstraction. Guest memory offsets are translated above LISA's internal bookkeeping region, so programs cannot address the interpreter's stack metadata directly.

Programs execute from calldata with a byte program counter. `STOP` terminates successfully, and reaching the end of calldata also succeeds. Invalid opcodes, stack errors, malformed or truncated instructions, invalid jumps, and invalid virtual-memory translations halt exceptionally.

Relative jumps use a 16-bit sign-magnitude encoding: bit 15 means "backwards" and bits 0..14 contain the magnitude.

A minimal program:

```text
PUSH1 2
PUSH1 3
ADD
STOP

01 02 01 03 24 00
```

## Trust model

LISA is intentionally programmable by its callers. In particular, `CALL` executes from the LISA address.

Do not treat the LISA address as an authenticated or privileged account. ETH held by LISA can be spent by programs, and token approvals, protocol permissions, roles, or other authority granted to LISA can likewise be exercised through programs.

`STATICCALL` is available for read-only external execution. `DELEGATECALL` is intentionally not part of the current ISA: the VM does not expose a persistent storage model, and delegate execution would introduce one implicitly through arbitrary external bytecode.

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

## Deploy

Simulate deployment locally without an RPC:

```bash
make build
forge script script/LISA.s.sol:LISAScript --offline
```

To deploy to Anvil, add `--rpc-url http://127.0.0.1:8545 --broadcast` and your preferred Foundry signer options.
