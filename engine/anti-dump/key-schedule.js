/**
 * Key schedule — derives encryption keys from a seed.
 *
 * The seed is generated randomly at obfuscation time and embedded in
 * the output. At runtime, the VM mixes the seed with a runtime salt
 * (derived from Roblox's tick(), the script's own bytecode hash, and
 * a few environment variables) to produce a session key.
 *
 * The session key is used to derive a sequence of per-fragment keys
 * via a key schedule. The schedule advances every KEY_ROTATION_PERIOD
 * instructions, so an attacker who dumps one fragment still cannot
 * decrypt the next.
 */

/**
 * A simple 32-bit xorshift PRNG. Fast, deterministic, seedable.
 * Not cryptographically secure, but adequate for key scheduling
 * because the seed itself is unpredictable.
 */
export class XorShift32 {
  constructor(seed) {
    if (seed === 0) seed = 0x9e3779b9;
    this.state = seed >>> 0;
  }

  next() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  nextByte() {
    return this.next() & 0xff;
  }
}

/**
 * Derive a session key from a seed and a runtime salt.
 * Returns a 32-byte Uint8Array.
 */
export function deriveSessionKey(seedBytes, saltBytes) {
  const out = new Uint8Array(32);
  const prng = new XorShift32(simpleHash(seedBytes) ^ simpleHash(saltBytes));

  // Fill with PRNG output, mixed with seed bytes
  for (let i = 0; i < 32; i++) {
    out[i] = prng.nextByte() ^ seedBytes[i % seedBytes.length] ^ saltBytes[i % saltBytes.length];
  }
  return out;
}

/**
 * Derive a per-fragment key from the session key and a fragment index.
 * Each fragment gets a unique key that depends on all previous fragments
 * (chain mode), so an attacker cannot skip ahead.
 */
export function deriveFragmentKey(sessionKey, fragmentIndex, previousFragmentKey) {
  const out = new Uint8Array(32);
  const input = new Uint8Array(sessionKey.length + previousFragmentKey.length + 4);
  input.set(sessionKey, 0);
  input.set(previousFragmentKey, sessionKey.length);
  // Encode index as 4 bytes little-endian
  input[sessionKey.length + previousFragmentKey.length + 0] = fragmentIndex & 0xff;
  input[sessionKey.length + previousFragmentKey.length + 1] = (fragmentIndex >> 8) & 0xff;
  input[sessionKey.length + previousFragmentKey.length + 2] = (fragmentIndex >> 16) & 0xff;
  input[sessionKey.length + previousFragmentKey.length + 3] = (fragmentIndex >> 24) & 0xff;

  // Mix
  let h = simpleHash(input);
  for (let i = 0; i < 32; i++) {
    h = (h * 1664525 + 1013904223) >>> 0;
    out[i] = (h >>> ((i % 4) * 8)) & 0xff;
  }
  return out;
}

/**
 * Simple non-cryptographic hash (FNV-1a 32-bit).
 * Used for key derivation, not for integrity (see integrity.js).
 */
export function simpleHash(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export default {
  XorShift32,
  deriveSessionKey,
  deriveFragmentKey,
  simpleHash,
};