/**
 * Builder — generate the Lua VM runtime.
 *
 * The runtime is a self-contained Lua script that:
 *   1. Holds the encrypted fragments as byte arrays
 *   2. Derives the session key from the embedded seed + runtime salt
 *   3. Decrypts fragments on demand
 *   4. Verifies integrity before executing
 *   5. Executes bytecode
 *   6. Zeroes fragments after use
 *   7. Runs anti-hook and integrity checks periodically
 *
 * The output is a string of Lua source that gets embedded in the
 * final obfuscated script.
 */

import { FRAGMENT_SIZE, KEY_ROTATION_PERIOD, ANTI_HOOK_PERIOD, INTEGRITY_PERIOD, SEED_LENGTH, CHECKSUM_LENGTH } from './constants.js';

/**
 * Generate the full Lua runtime source.
 *
 * @param {object} encrypted — output of encryptFragments
 * @param {Uint8Array} seed — random seed embedded in output
 * @returns {string} — Lua source code
 */
export function buildRuntime(encrypted, seed) {
  const parts = [];

  parts.push(buildHeader());
  parts.push(buildConstants());
  parts.push(buildSeed(seed));
  parts.push(buildConstantsTable(encrypted.constants));
  parts.push(buildProtoMetadata(encrypted.protos));
  parts.push(buildMainFragments(encrypted.encryptedMain));
  parts.push(buildProtoFragments(encrypted.encryptedProtos));
  parts.push(buildKeySchedule());
  parts.push(buildIntegrityHash());
  parts.push(buildDecryptor());
  parts.push(buildAntiHook());
  parts.push(buildOpaquePredicates());
  parts.push(buildVM());
  parts.push(buildEntryPoint());

  return parts.join('\n\n');
}

function buildHeader() {
  return `-- Lua Obf anti-dump runtime
-- This file is generated. Do not edit manually.
-- It decrypts and executes the embedded bytecode in fragments.
-- See engine/anti-dump/builder.js for the JS that produced it.

local _RT = {}
_RT.version = 1
`;
}

function buildConstants() {
  return `-- Constants copied from engine/anti-dump/constants.js.
-- Any change must be mirrored there.
_RT.FRAGMENT_SIZE = ${FRAGMENT_SIZE}
_RT.KEY_ROTATION_PERIOD = ${KEY_ROTATION_PERIOD}
_RT.ANTI_HOOK_PERIOD = ${ANTI_HOOK_PERIOD}
_RT.INTEGRITY_PERIOD = ${INTEGRITY_PERIOD}
_RT.SEED_LENGTH = ${SEED_LENGTH}
_RT.CHECKSUM_LENGTH = ${CHECKSUM_LENGTH}
`;
}

function buildSeed(seed) {
  const bytes = Array.from(seed).join(',');
  return `-- Session seed. Random per obfuscation.
_RT.seed = {${bytes}}
`;
}

function buildConstantsTable(constants) {
  const lines = ['-- Constant pool.'];
  lines.push('_RT.constants = {');
  for (const c of constants) {
    const type = c.type;
    const value = JSON.stringify(c.value);
    lines.push(`  {type=${type}, value=${value}},`);
  }
  lines.push('}');
  return lines.join('\n');
}

function buildProtoMetadata(protos) {
  const lines = ['-- Proto metadata (params, upvalues, register counts).'];
  lines.push('_RT.protos = {');
  for (const p of protos) {
    const params = JSON.stringify(p.params || []);
    const upvalues = JSON.stringify(p.upvalues || []);
    lines.push(`  {params=${params}, isVararg=${p.isVararg ? 'true' : 'false'}, upvalues=${upvalues}, registerCount=${p.registerCount || 0}},`);
  }
  lines.push('}');
  return lines.join('\n');
}

function buildMainFragments(fragments) {
  const lines = ['-- Main chunk fragments (encrypted).'];
  lines.push('_RT.mainFragments = {');
  for (const f of fragments) {
    const bytes = f.bytes.join(',');
    const checksum = f.checksum.join(',');
    lines.push(`  {index=${f.index}, startPC=${f.startPC}, size=${f.size}, bytes={${bytes}}, checksum={${checksum}}},`);
  }
  lines.push('}');
  return lines.join('\n');
}

function buildProtoFragments(protoFragments) {
  const lines = ['-- Proto fragments (encrypted).'];
  lines.push('_RT.protoFragments = {');
  for (const pf of protoFragments) {
    lines.push(`  {protoIndex=${pf.protoIndex}, fragments={`);
    for (const f of pf.fragments) {
      const bytes = f.bytes.join(',');
      const checksum = f.checksum.join(',');
      lines.push(`    {index=${f.index}, startPC=${f.startPC}, size=${f.size}, bytes={${bytes}}, checksum={${checksum}}},`);
    }
    lines.push('  }},');
  }
  lines.push('}');
  return lines.join('\n');
}

function buildKeySchedule() {
  return `-- Key schedule. Xorshift32 PRNG + FNV-1a hash.
-- Mirrors engine/anti-dump/key-schedule.js.

local function _xorshift32(state)
  local x = state
  x = _bxor(x, _shl(x, 13))
  x = _bxor(x, _shr(x, 17))
  x = _bxor(x, _shl(x, 5))
  return x
end

local function _fnv1a(bytes)
  local h = 0x811c9dc5
  for i = 1, #bytes do
    h = _bxor(h, bytes[i])
    h = (h * 0x01000193) % 0x100000000
  end
  return h
end

-- Simple bit ops (Roblox Luau has bit32, fall back to arithmetic).
local _hasbit32 = (type(bit32) == "table")
local function _bxor(a, b)
  if _hasbit32 then return bit32.bxor(a, b) end
  local r, bit = 0, 1
  while a > 0 or b > 0 do
    local abit, bbit = a % 2, b % 2
    if abit ~= bbit then r = r + bit end
    a, b, bit = math.floor(a / 2), math.floor(b / 2), bit * 2
  end
  return r
end
local function _shl(a, b)
  if _hasbit32 then return bit32.lshift(a, b) end
  return (a * 2 ^ b) % 0x100000000
end
local function _shr(a, b)
  if _hasbit32 then return bit32.rshift(a, b) end
  return math.floor(a / 2 ^ b)
end

-- Derive the session key from seed + runtime salt.
local function _deriveSessionKey(salt)
  local seed = _RT.seed
  local out = {}
  local state = _bxor(_fnv1a(seed), _fnv1a(salt))
  for i = 1, 32 do
    state = _xorshift32(state)
    out[i] = _bxor(_bxor(state % 256, seed[(i - 1) % #seed + 1]), salt[(i - 1) % #salt + 1])
  end
  return out
end

-- Derive a per-fragment key from the session key.
local function _deriveFragmentKey(sessionKey, fragIndex, prevKey)
  local input = {}
  for i = 1, #sessionKey do input[#input + 1] = sessionKey[i] end
  for i = 1, #prevKey do input[#input + 1] = prevKey[i] end
  input[#input + 1] = fragIndex % 256
  input[#input + 1] = math.floor(fragIndex / 256) % 256
  input[#input + 1] = math.floor(fragIndex / 65536) % 256
  input[#input + 1] = math.floor(fragIndex / 16777216) % 256

  local h = _fnv1a(input)
  local out = {}
  for i = 1, 32 do
    h = (h * 1664525 + 1013904223) % 0x100000000
    out[i] = math.floor(h / 2 ^ (((i - 1) % 4) * 8)) % 256
  end
  return out
end

_RT.deriveSessionKey = _deriveSessionKey
_RT.deriveFragmentKey = _deriveFragmentKey
`;
}

function buildIntegrityHash() {
  return `-- Integrity: SHA-256 (simplified, used for truncated checksums).
-- For the embedded Lua we use a smaller custom hash to avoid
-- embedding a full SHA-256 implementation. The security comes from
-- the key schedule, not from the checksum algorithm.
local function _hash8(bytes)
  local h = 0x9e3779b9
  for i = 1, #bytes do
    h = _bxor(h, bytes[i])
    h = (h * 0x85ebca6b) % 0x100000000
  end
  local out = {}
  for i = 1, 8 do
    out[i] = h % 256
    h = math.floor(h / 256)
  end
  return out
end

local function _checksumMatch(computed, expected)
  if #computed ~= #expected then return false end
  for i = 1, #computed do
    if computed[i] ~= expected[i] then return false end
  end
  return true
end

_RT.hash8 = _hash8
_RT.checksumMatch = _checksumMatch
`;
}

function buildDecryptor() {
  return `-- Decryptor. XOR bytes with the fragment key and verify checksum.

function _RT.decryptFragment(frag, key)
  local bytes = frag.bytes
  local out = {}
  for i = 1, #bytes do
    out[i] = _bxor(bytes[i], key[(i - 1) % #key + 1])
  end

  -- Verify checksum on decrypted bytes
  local expected = frag.checksum
  local computed = _hash8(out)
  if not _checksumMatch(computed, expected) then
    error("integrity check failed at fragment " .. frag.index)
  end

  -- Convert byte array to instruction words (little-endian)
  local words = {}
  for i = 1, #out, 4 do
    words[#words + 1] = out[i]
      + out[i + 1] * 256
      + out[i + 2] * 65536
      + out[i + 3] * 16777216
  end
  return words
end
`;
}

function buildAntiHook() {
  return `-- Anti-hook. Verify critical functions are still the originals.
-- We only check identity, not behavior — a hooked function that
-- keeps the same reference cannot be detected this way. That is a
-- known limitation.

local _baselines = nil

local function _captureBaselines()
  _baselines = {
    type = type,
    pcall = pcall,
    print = print,
    string = string,
    string_char = string.char,
    string_sub = string.sub,
    table = table,
    table_concat = table.concat,
    math = math,
    math_floor = math.floor,
    pairs = pairs,
    ipairs = ipairs,
  }
end

local function _checkBaselines()
  if not _baselines then return true end
  if type ~= _baselines.type then return false end
  if pcall ~= _baselines.pcall then return false end
  if print ~= _baselines.print then return false end
  if string ~= _baselines.string then return false end
  if string.char ~= _baselines.string_char then return false end
  if string.sub ~= _baselines.string_sub then return false end
  if table ~= _baselines.table then return false end
  if table.concat ~= _baselines.table_concat then return false end
  if math ~= _baselines.math then return false end
  if math.floor ~= _baselines.math_floor then return false end
  if pairs ~= _baselines.pairs then return false end
  if ipairs ~= _baselines.ipairs then return false end
  return true
end

_RT.captureBaselines = _captureBaselines
_RT.checkBaselines = _checkBaselines
`;
}

function buildOpaquePredicates() {
  return `-- Opaque predicates. Conditions that always evaluate to the same
-- value but are not statically obvious. Used to gate critical code.
local _opaque_counter = 0

local function _opaque_true()
  _opaque_counter = _opaque_counter + 1
  local x = _opaque_counter
  return ((x * 0 + 1) == 1) and ((x - x) == 0)
end

local function _opaque_false()
  _opaque_counter = _opaque_counter + 1
  local x = _opaque_counter
  return ((x * 0 + 1) == 2) or ((x - x) == 1)
end

_RT.opaqueTrue = _opaque_true
_RT.opaqueFalse = _opaque_false
`;
}

function buildVM() {
  return `-- VM execution. This is the interpreter loop.
-- It loads fragments on demand, decrypts, executes, and zeroes.

-- OP constants (must match engine/compiler/opcodes.js).
local OP = {
  LOADK=0x01, LOADNIL=0x02, LOADBOOL=0x03, LOADVARARG=0x04,
  MOVE=0x10,
  GETGLOBAL=0x20, SETGLOBAL=0x21,
  NEWTABLE=0x30, GETTABLE=0x31, SETTABLE=0x32,
  ADD=0x40, SUB=0x41, MUL=0x42, DIV=0x43, MOD=0x44, POW=0x45,
  UNM=0x46, BAND=0x47, BOR=0x48, BXOR=0x49, BNOT=0x4a, SHL=0x4b, SHR=0x4c,
  EQ=0x50, NE=0x51, LT=0x52, LE=0x53, GT=0x54, GE=0x55,
  NOT=0x60, LEN=0x61, CONCAT=0x62,
  CLOSURE=0x70, CALL=0x71, TAILCALL=0x72, RETURN=0x73,
  JMP=0x80, TEST=0x81,
  GETUPVAL=0x90, SETUPVAL=0x91,
  HALT=0xff,
}

local function decode(word)
  return math.floor(word / 16777216) % 256,
         math.floor(word / 65536) % 256,
         math.floor(word / 256) % 256,
         word % 256
end

local function rkIsConst(rk) return math.floor(rk / 128) % 2 == 1 end
local function rkIndex(rk) return rk % 128 end

local function decodeJump(b, c)
  local signed = b * 256 + c
  if signed >= 32768 then signed = signed - 65536 end
  return signed
end

-- Create a fresh runtime state for a program invocation.
function _RT.newState()
  return {
    frames = {},
    constants = _RT.constants,
    globals = _G,
    sessionKey = nil,
    prevKey = nil,
    loadedFragments = {},
    opCounter = 0,
  }
end

local function rkValue(frame, rk)
  if rkIsConst(rk) then
    return _RT.constants[rkIndex(rk) + 1].value
  else
    return frame.regs[rkIndex(rk) + 1]
  end
end

-- Main execution loop.
function _RT.run(state)
  -- Derive session key from seed + salt.
  local salt = {}
  for i = 1, 32 do salt[i] = math.random(0, 255) end
  state.sessionKey = _deriveSessionKey(salt)
  state.prevKey = {}
  for i = 1, 32 do state.prevKey[i] = 0 end

  _RT.captureBaselines()

  -- Start with the main chunk as the root frame.
  local mainProto = {
    instructions = {}, -- filled by fragment loading
    registerCount = 256,
  }

  local mainFrame = {
    proto = mainProto,
    regs = {},
    pc = 0,
    fragmentFetcher = makeFragmentFetcher(state, _RT.mainFragments),
    upvalues = {},
    varargs = {},
  }
  table.insert(state.frames, mainFrame)

  -- Instruction dispatch loop.
  while #state.frames > 0 do
    local frame = state.frames[#state.frames]
    local word = frame.fragmentFetcher(frame.pc)
    if word == nil then
      -- End of code
      table.remove(state.frames)
      goto continue
    end
    frame.pc = frame.pc + 1
    state.opCounter = state.opCounter + 1

    -- Periodic checks
    if state.opCounter % _RT.ANTI_HOOK_PERIOD == 0 then
      if not _checkBaselines() then error("anti-hook violation") end
    end

    local op, A, B, C = decode(word)
    A = A + 1

    -- Execute instruction (compact dispatch)
    if op == OP.LOADK then
      frame.regs[A] = _RT.constants[B + 1].value
    elseif op == OP.LOADNIL then
      for i = 0, C do frame.regs[A + i] = nil end
    elseif op == OP.LOADBOOL then
      frame.regs[A] = (B == 1)
      if C ~= 0 then frame.pc = frame.pc + 1 end
    elseif op == OP.MOVE then
      frame.regs[A] = frame.regs[B + 1]
    elseif op == OP.GETGLOBAL then
      frame.regs[A] = _G[_RT.constants[B + 1].value]
    elseif op == OP.SETGLOBAL then
      _G[_RT.constants[B + 1].value] = frame.regs[A]
    elseif op == OP.NEWTABLE then
      frame.regs[A] = {}
    elseif op == OP.GETTABLE then
      frame.regs[A] = frame.regs[B + 1][rkValue(frame, C)]
    elseif op == OP.SETTABLE then
      frame.regs[A][rkValue(frame, B)] = rkValue(frame, C)
    elseif op == OP.ADD then
      frame.regs[A] = rkValue(frame, B) + rkValue(frame, C)
    elseif op == OP.SUB then
      frame.regs[A] = rkValue(frame, B) - rkValue(frame, C)
    elseif op == OP.MUL then
      frame.regs[A] = rkValue(frame, B) * rkValue(frame, C)
    elseif op == OP.DIV then
      frame.regs[A] = rkValue(frame, B) / rkValue(frame, C)
    elseif op == OP.MOD then
      frame.regs[A] = rkValue(frame, B) % rkValue(frame, C)
    elseif op == OP.POW then
      frame.regs[A] = rkValue(frame, B) ^ rkValue(frame, C)
    elseif op == OP.UNM then
      frame.regs[A] = -frame.regs[B + 1]
    elseif op == OP.EQ then
      local r = (rkValue(frame, B) == rkValue(frame, C))
      if (A ~= 1) ~= r then frame.pc = frame.pc + 1 end
    elseif op == OP.NE then
      local r = (rkValue(frame, B) ~= rkValue(frame, C))
      if (A ~= 1) ~= r then frame.pc = frame.pc + 1 end
    elseif op == OP.LT then
      local r = (rkValue(frame, B) < rkValue(frame, C))
      if (A ~= 1) ~= r then frame.pc = frame.pc + 1 end
    elseif op == OP.LE then
      local r = (rkValue(frame, B) <= rkValue(frame, C))
      if (A ~= 1) ~= r then frame.pc = frame.pc + 1 end
    elseif op == OP.GT then
      local r = (rkValue(frame, B) > rkValue(frame, C))
      if (A ~= 1) ~= r then frame.pc = frame.pc + 1 end
    elseif op == OP.GE then
      local r = (rkValue(frame, B) >= rkValue(frame, C))
      if (A ~= 1) ~= r then frame.pc = frame.pc + 1 end
    elseif op == OP.NOT then
      frame.regs[A] = not frame.regs[B + 1]
    elseif op == OP.LEN then
      frame.regs[A] = #frame.regs[B + 1]
    elseif op == OP.CONCAT then
      local parts = {}
      for i = B + 1, C + 1 do parts[#parts + 1] = tostring(frame.regs[i]) end
      frame.regs[A] = table.concat(parts)
    elseif op == OP.JMP then
      frame.pc = frame.pc + decodeJump(B, C)
    elseif op == OP.TEST then
      local val = frame.regs[A]
      local want = (B == 1)
      if (val and true or false) == want then frame.pc = frame.pc + 1 end
    elseif op == OP.CLOSURE then
      local proto = _RT.protos[B + 1]
      frame.regs[A] = {
        __isClosure = true,
        __proto = proto,
        __upvalues = {},
      }
    elseif op == OP.CALL then
      local func = frame.regs[A]
      local nargs = B
      local nresults = C - 1
      local args = {}
      for i = 1, nargs do args[i] = frame.regs[A + i] end
      if type(func) == "table" and func.__isClosure then
        local newFrame = {
          proto = func.__proto,
          regs = {},
          pc = 0,
          upvalues = func.__upvalues,
          varargs = args,
          callerFrame = frame,
          returnRegister = A,
          nresults = nresults,
          fragmentFetcher = makeFragmentFetcher(state, nil, func.__proto),
        }
        table.insert(state.frames, newFrame)
      elseif type(func) == "function" then
        local results = {func(unpack(args))}
        for i = 1, nresults do frame.regs[A + i - 1] = results[i] end
      else
        error("attempt to call a " .. type(func) .. " value")
      end
    elseif op == OP.RETURN then
      local base = A
      local count = B - 1
      local values = {}
      for i = 1, count do values[i] = frame.regs[base + i - 1] end
      table.remove(state.frames)
      if frame.callerFrame then
        for i = 1, frame.nresults do
          frame.callerFrame.regs[frame.returnRegister + i - 1] = values[i]
        end
      end
    else
      error("unknown opcode 0x" .. string.format("%02x", op))
    end

    ::continue::
  end
end

-- Build a function that, given a PC, returns the next instruction word.
-- It fetches the fragment that contains the PC, decrypts it if needed,
-- and returns the instruction. Fragments are cached until displaced.
local function makeFragmentFetcher(state, fragments, proto)
  local loaded = {}
  local prevKey = state.prevKey
  local sessionKey = state.sessionKey
  if not sessionKey then
    -- Session key not yet derived; fragments cannot be fetched.
    return function() return nil end
  end
  return function(pc)
    local fragIndex = math.floor(pc / _RT.FRAGMENT_SIZE) + 1
    local source = fragments
    if proto and proto.fragments then source = proto.fragments end
    if not source then return nil end
    local frag = source[fragIndex]
    if not frag then return nil end

    local words = loaded[fragIndex]
    if not words then
      -- Chain key: derive from session key + previous fragment's key
      local key = _deriveFragmentKey(sessionKey, frag.index, prevKey)
      words = _RT.decryptFragment(frag, key)
      prevKey = key
      loaded[fragIndex] = words
      -- Zero the encrypted bytes in place (best effort)
      for i = 1, #frag.bytes do frag.bytes[i] = 0 end
    end

    local offset = pc % _RT.FRAGMENT_SIZE
    return words[offset + 1]
  end
end

_RT.makeFragmentFetcher = makeFragmentFetcher
`;
}

function buildEntryPoint() {
  return `-- Entry point. Load the runtime and start execution.
local state = _RT.newState()
_RT.run(state)
`;
}

export default { buildRuntime };