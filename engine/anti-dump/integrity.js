/**
 * Integrity — SHA-256 checksum computation for encrypted fragments.
 *
 * Every encrypted fragment carries a truncated SHA-256 checksum. The
 * VM recomputes the checksum after decrypting and compares. If they
 * differ, the fragment was tampered with and execution aborts.
 *
 * We use Node's built-in crypto module at obfuscation time. The VM
 * Lua side has a small SHA-256 implementation embedded in builder.js.
 */

import { createHash } from 'node:crypto';
import { CHECKSUM_LENGTH } from './constants.js';

/**
 * Compute a truncated SHA-256 checksum of the given bytes.
 * Returns a Uint8Array of CHECKSUM_LENGTH bytes.
 */
export function computeChecksum(bytes) {
  const hash = createHash('sha256');
  hash.update(Buffer.from(bytes));
  const digest = hash.digest();
  return new Uint8Array(digest.slice(0, CHECKSUM_LENGTH));
}

/**
 * Compute the SHA-256 of the entire program's serialized fragments.
 * Used for a top-level integrity check.
 */
export function computeProgramHash(encryptedMain, encryptedProtos) {
  const hash = createHash('sha256');
  for (const frag of encryptedMain) {
    hash.update(Buffer.from(frag.bytes));
  }
  for (const pf of encryptedProtos) {
    for (const frag of pf.fragments) {
      hash.update(Buffer.from(frag.bytes));
    }
  }
  return new Uint8Array(hash.digest());
}

export default { computeChecksum, computeProgramHash };