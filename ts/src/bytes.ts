/** Small byte/hex helpers shared by the encoder, decoder, and compiler. */

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new RangeError(`hex string has odd length: ${hex}`);
  if (!/^([0-9a-fA-F]{2})*$/.test(clean)) throw new RangeError(`invalid hex string: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array, withPrefix = true): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return withPrefix ? `0x${s}` : s;
}

/** Minimum big-endian byte length for a non-negative integer (>= 1). */
export function byteLength(value: bigint): number {
  if (value < 0n) throw new RangeError('value must be non-negative');
  let n = 1;
  let v = value >> 8n;
  while (v > 0n) {
    n++;
    v >>= 8n;
  }
  return n;
}

/** Big-endian bytes of `value`, zero-padded to `length`. */
export function toBE(value: bigint, length: number): Uint8Array {
  if (value < 0n) throw new RangeError('value must be non-negative');
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v > 0n) throw new RangeError(`value ${value} does not fit in ${length} bytes`);
  return out;
}

/** Big-endian unsigned integer from bytes. */
export function fromBE(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Coerce number | bigint | hex string | bytes into a canonical Uint8Array. */
export function toBytes(input: number | bigint | string | Uint8Array): Uint8Array {
  if (typeof input === 'string') return hexToBytes(input);
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input) || input < 0) {
      throw new RangeError(
        `expected a non-negative safe integer (use bigint or hex for larger values): ${input}`,
      );
    }
    return toBE(BigInt(input), byteLength(BigInt(input)));
  }
  if (typeof input === 'bigint') return toBE(input, byteLength(input));
  return input;
}
