/**
 * Shared constants for the anti-dump module.
 *
 * These values must be identical between the JavaScript encoder
 * (running on Codespace) and the Lua decoder (running in Roblox).
 * Any drift means the output will not decrypt.
 */

/**
 * Fragment size in instructions. Smaller fragments mean better
 * anti-dump protection but slower execution because more decrypt
 * cycles happen. 32 is a balance.
 */
export const FRAGMENT_SIZE = 32;

/**
 * Key rotation period in instructions. Every N instructions, the
 * key schedule advances and the next fragment uses a new key.
 */
export const KEY_ROTATION_PERIOD = 100;

/**
 * Anti-hook check period in instructions. Every N instructions, the
 * VM verifies that critical functions have not been replaced.
 */
export const ANTI_HOOK_PERIOD = 500;

/**
 * Integrity check period. Every N instructions, the VM verifies the
 * currently-loaded fragment has not been tampered with.
 */
export const INTEGRITY_PERIOD = 200;

/**
 * Number of key schedule rounds. More rounds means slower key
 * derivation but stronger keys. 4 is enough for our purposes.
 */
export const KEY_SCHEDULE_ROUNDS = 4;

/**
 * Seed length in bytes. The seed is embedded in the output and is
 * used with a runtime salt to derive keys.
 */
export const SEED_LENGTH = 32;

/**
 * Checksum length per fragment. SHA-256 truncated to 8 bytes is
 * enough for integrity checking.
 */
export const CHECKSUM_LENGTH = 8;

export default {
  FRAGMENT_SIZE,
  KEY_ROTATION_PERIOD,
  ANTI_HOOK_PERIOD,
  INTEGRITY_PERIOD,
  KEY_SCHEDULE_ROUNDS,
  SEED_LENGTH,
  CHECKSUM_LENGTH,
};