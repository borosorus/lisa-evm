/**
 * Keccak-256 for compile-time ABI function selectors.
 *
 * Delegates to @noble/hashes (audited). Needed because a selector like
 * balanceOf(address) -> 0x70a08231 depends only on the signature string but
 * must be baked into the program's BLOB calldata template at build time.
 * Node's crypto offers only FIPS SHA3 (different padding). Nothing in a
 * compiled LISA program depends on this module; it is tooling-time only.
 *
 * Internal module: not re-exported from index.ts, to avoid a name clash
 * with the KECCAK256 instruction constant in api.ts.
 */

import { keccak_256 } from '@noble/hashes/sha3.js';

/** Keccak-256 digest of arbitrary bytes (32 bytes). */
export function keccakBytes(input: Uint8Array): Uint8Array {
  return keccak_256(input);
}

/** Keccak-256 of an ASCII string (selectors are the first 4 digest bytes). */
export function keccakAscii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === undefined || c > 0x7f) throw new RangeError(`signature must be ASCII: ${text}`);
    bytes[i] = c;
  }
  return keccak_256(bytes);
}
