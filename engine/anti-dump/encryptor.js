/**
 * Per-fragment encryptor.
 *
 * Each fragment is a list of 32-bit instructions. We serialize them
 * to a byte array (little-endian) and XOR with the fragment key.
 * The result is what gets embedded in the output.
 *
 * We also compute an integrity checksum for each encrypted fragment.
 * The VM verifies the checksum before decrypting. This prevents an
 * attacker from swapping fragments between different runs.
 *
 * Chain mode: the key for fragment N depends on the key for fragment
 * N-1. This means an attacker cannot decrypt fragment 5 without
 * first decrypting fragments 1-4 in order.
 */

import { deriveFragmentKey } from './key-schedule.js';
import { computeChecksum } from './integrity.js';

/**
 * Encrypt a program's fragments.
 *
 * @param {object} fragments — output of splitProgram
 * @param {Uint8Array} sessionKey — 32-byte session key
 * @returns {object} — {
 *     encryptedFragments: [ { index, bytes: [int], checksum: [int] } ],
 *     ...
 *   }
 */
export function encryptFragments(fragments, sessionKey) {
  // Chain mode: previous fragment key starts as a zero vector
  let previousKey = new Uint8Array(32);

  const encryptOne = (frag, globalIndex) => {
    const key = deriveFragmentKey(sessionKey, globalIndex, previousKey);
    previousKey = key;

    // Serialize instructions to bytes (little-endian)
    const bytes = new Uint8Array(frag.instructions.length * 4);
    for (let i = 0; i < frag.instructions.length; i++) {
      const word = frag.instructions[i] >>> 0;
      bytes[i * 4 + 0] = word & 0xff;
      bytes[i * 4 + 1] = (word >> 8) & 0xff;
      bytes[i * 4 + 2] = (word >> 16) & 0xff;
      bytes[i * 4 + 3] = (word >> 24) & 0xff;
    }

    // XOR with key (cycled)
    const encrypted = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      encrypted[i] = bytes[i] ^ key[i % key.length];
    }

    // Compute checksum of encrypted bytes
    const checksum = computeChecksum(encrypted);

    return {
      index: frag.index,
      globalIndex: frag.globalIndex,
      startPC: frag.startPC,
      size: frag.size,
      bytes: Array.from(encrypted),
      checksum: Array.from(checksum),
    };
  };

  const encryptedMain = fragments.mainFragments.map(f => encryptOne(f, f.globalIndex));
  const encryptedProtos = fragments.protoFragments.map(pf => ({
    protoIndex: pf.protoIndex,
    fragments: pf.fragments.map(f => encryptOne(f, f.globalIndex)),
  }));

  return {
    encryptedMain,
    encryptedProtos,
    metadata: fragments.metadata,
    constants: fragments.constants,
    protos: fragments.protos,
  };
}

export default { encryptFragments };