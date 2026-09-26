/**
 * Wrapper — compose the final Lua output.
 *
 * Takes the encrypted program and the runtime source, and produces
 * the Lua script the user will paste into Roblox.
 *
 * The output structure is:
 *   1. Anti-tamper guards (from Module 7)
 *   2. The anti-dump runtime (from builder.js)
 *   3. Entry point
 *
 * The runtime contains the encrypted fragments, seed, and metadata
 * embedded as Lua table literals.
 */

import { buildRuntime } from './builder.js';

/**
 * Build the complete output script.
 *
 * @param {object} encrypted — output of encryptFragments
 * @param {Uint8Array} seed — random seed
 * @param {object} options — { antiTamperLevel, header }
 * @returns {string} — Lua source
 */
export function wrapOutput(encrypted, seed, options) {
  options = options || {};
  const parts = [];

  // Header comment
  const header = options.header || 'Lua Obf output';
  parts.push('-- ' + header);
  parts.push('-- Generated ' + new Date().toISOString());
  parts.push('');

  // Anti-tamper guards (optional, injected by caller if used)
  if (options.antiTamperGuards) {
    parts.push(options.antiTamperGuards);
    parts.push('');
  }

  // Runtime
  parts.push(buildRuntime(encrypted, seed));

  return parts.join('\n');
}

export default { wrapOutput };