/**
 * Public entry point for the LISA TypeScript toolchain.
 *
 * This surface is intentionally curated: the TypeScript-first builder
 * (builder.ts, expr.ts), ABI calldata (abi.ts), the shared pipeline entry
 * (compile), and bytecode introspection (decode). keccak.ts is internal.
 *
 * The lower-level plumbing stays available as documented deep imports:
 *   @bosorus/lisa-evm/api    - AST node constructors (program, push, add, ...)
 *   @bosorus/lisa-evm/ast    - AST types (Node, Program, NoOperandOp)
 *   @bosorus/lisa-evm/encode - the instruction encoder
 *   @bosorus/lisa-evm/isa    - canonical ISA metadata
 *   @bosorus/lisa-evm/bytes  - byte/hex helpers
 * (When working inside the lisa-evm repository, import
 *  ts/src/<module>.ts instead of the subpath.)
 */

export * from './builder.ts';
export * from './expr.ts';
export * from './abi.ts';
export { compile, CompileError, type CompiledProgram } from './compile.ts';
export { decode, disassemble, DecodeError, type DecodedInstruction } from './decode.ts';
export type { Node, NoOperandOp, Program } from './ast.ts';
