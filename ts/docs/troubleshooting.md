# Troubleshooting

[SDK home](../README.md) · [Concepts](concepts.md) · [API reference](api.md) · [Examples](examples.md)

| Symptom | Cause and fix |
| --- | --- |
| `CallResult is stale` | A newer external call replaced the return-data buffer. Call `word()`, `uint256()`, `bytes32()`, or `bool()` before emitting the newer call and retain the captured `Value`. |
| `Value is out of scope` or `CallResult is out of scope` | It was created inside an `if` arm that has closed. Use it inside that arm, or capture a value before the branch if both paths need it. |
| `Value belongs to a different program` | A captured value was passed to another `ProgramBuilder`. Build it again in that program; context values such as `SELF` can be reused. |
| `LISA stack limit exceeded` | Persistent decoded words, hashes, success flags, and temporary operands exceed 16 words. Reduce simultaneously live slots or split the program into smaller scopes. |
| An `if` always takes the same path in JavaScript | `Value` is an object, not a JavaScript boolean. Use `p.if(value, thenBody, elseBody)` to emit LISA control flow. |
| A call fails despite valid calldata | Checked calls revert the LISA program when the EVM target fails. Confirm the target implements the function, or use `tryCall()` / `tryStaticCall()` and branch on `.success`. |
| A decoded result reverts at runtime | `RDLOAD` needs a complete 32-byte word starting at the requested byte offset. Check return-data length and ABI expectations; `.bool()` does not make short returndata safe. |
| `unsupported ABI type` or `invalid function signature` | Use a canonical signature with supported static types, such as `f(address,uint256)`. Dynamic types, arrays, tuples, signed integers, and `uint` aliases are not supported by `encodeCall()`. Use `rawCalldata()` for calldata encoded elsewhere. |
| `runtime arguments of bytesN are not supported` | `encodeCall()` cannot infer how to align a runtime word as fixed bytes. Supply a constant `bytesN` argument or pass fully encoded calldata through `rawCalldata()`. |
| `RangeError` for a number or word | JavaScript `number` inputs must be non-negative safe integers. Use `bigint` or hex for larger values; respect ABI type ranges and aligned return-word offsets. |
| Package import fails | Use ESM and Node.js >= 22, or a modern browser bundler. Import the builder from `@bosorus/lisa-evm` and low-level constructors from documented subpaths such as `@bosorus/lisa-evm/api`. |
| `DecodeError` on bytecode | The byte stream has an invalid opcode or truncated operand. Inspect the reported byte offset and use `decode()` or `disassemble()` on valid compiled bytes. |
| A decoded low-level program fails at runtime | Decoding checks byte structure, not every VM rule. For example, `DUP 0` decodes but is invalid at runtime. Check the [ISA reference](low-level.md) and the Yul runtime. |

`LoweringError` comes from the high-level builder, `CompileError` from AST
label resolution, and `DecodeError` from byte parsing. ABI and byte helpers
also raise `TypeError` or `RangeError` for invalid inputs.
