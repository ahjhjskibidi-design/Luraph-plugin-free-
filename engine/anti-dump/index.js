/**
 * Anti-dump — main entry point.
 *
 * Usage:
 *   import { encryptProgram } from './engine/anti-dump/index.js';
 *   const result = encryptProgram(program);
 *   // result = { output: 'lua source', seed, stats }
 *
 * The function:
 *   1. Splits the compiled program into fragments
 *   2. Generates a random session seed
 *   3. Encrypts each fragment with a chained key schedule
 *   4. Builds a Lua runtime that decrypts and executes on demand
 *   5. Returns the final Lua source
 */

import { randomBytes } from 'node:crypto';
import { splitProgram } from './fragment.js';
import { encryptFragments } from './encryptor.js';
import { wrapOutput } from './wrapper.js';
import { SEED_LENGTH } from './constants.js';

/**
 * Transform a compiled program into an obfuscated, anti-dump Lua
 * script.
 *
 * @param {object} program — output of compile(ast)
 * @param {object} options — { antiTamperGuards, header }
 * @returns {object} — { output, seed, stats }
 */
export function encryptProgram(program, options) {
  options = options || {};

  // 1. Split into fragments
  const fragments = splitProgram(program);

  // 2. Generate a random seed
  const seed = randomBytes(SEED_LENGTH);

  // 3. Encrypt fragments with the seed
  const encrypted = encryptFragments(fragments, seed);

  // 4. Build output
  const output = wrapOutput(encrypted, seed, options);

  // 5. Stats
  const stats = {
    totalInstructions: fragments.metadata.totalInstructions,
    fragmentCount:
      fragments.metadata.mainFragmentCount +
      fragments.metadata.protoFragmentCount.reduce((a, b) => a + b, 0),
    outputBytes: output.length,
    seedBytes: seed.length,
  };

  return { output, seed, stats };
}

export default { encryptProgram };