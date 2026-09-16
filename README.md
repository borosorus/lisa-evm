# LISA

LISA is an experimental stack based virtual machine implemented in standalone Yul. The instruction set and runtime are defined in [`yul/LISA.yul`](yul/LISA.yul); Foundry provides the Solidity deployment harness and tests.

The project pins Solidity 0.8.29 and the Cancun EVM target. It requires Foundry, Make, Bash, and awk.

## Build and test

```bash
make build       # Compile Solidity harnesses and LISA creation bytecode
make test        # Recompile, then run offline tests
make trace       # Show an execution trace
make debug       # Open Forge's debugger
make snapshot    # Record gas snapshots
forge fmt        # Format Solidity files
```

The build script compiles `yul/LISA.yul` with solc and writes hex encoded creation bytecode to `build/yul/LISA.bin`. Build output and Forge caches are ignored by Git. Pass a custom compiler with `make test SOLC=/path/to/solc-0.8.29`.

Start without optimization for easier stepping. To test optimized bytecode, use `make test YUL_FLAGS='--optimize --optimize-runs 200'`.

## Deploy

Simulate deployment locally without an RPC:

```bash
make build
forge script script/LISA.s.sol:LISAScript --offline
```

To deploy to Anvil, add `--rpc-url http://127.0.0.1:8545 --broadcast` and your preferred Foundry signer options.

See [`YUL_GUIDE.md`](YUL_GUIDE.md) for the standalone Yul and Forge workflow.
