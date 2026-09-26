/**
 * Lua Obfuscator — text-level engine.
 * Renames locals, encodes strings and numbers, injects dead code,
 * wraps in loadstring layers. Does not use a VM; the output is pure
 * Lua that runs in Roblox.
 *
 * For the full pipeline (parser → compiler → VM), see engine/.
 */

export function obfuscate(source, preset) {
  const config = getConfig(preset);
  let code = source;
  code = stripComments(code);
  code = renameIdentifiers(code, config);
  if (config.encodeStrings) code = encodeStrings(code);
  if (config.encodeNumbers) code = encodeNumbers(code);
  if (config.deadCode > 0) code = injectDeadCode(code, config);
  if (config.layers > 1) code = wrapLayers(code, config.layers);
  return code;
}

function getConfig(preset) {
  if (preset === 'light') {
    return { rename: true, encodeStrings: false, encodeNumbers: false, deadCode: 0, layers: 1 };
  }
  if (preset === 'heavy') {
    return { rename: true, encodeStrings: true, encodeNumbers: true, deadCode: 8, layers: 3 };
  }
  return { rename: true, encodeStrings: true, encodeNumbers: true, deadCode: 4, layers: 2 };
}

// --- Strip comments ---

function stripComments(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];

    // Long comment --[[ ]] or --[=[ ]=]
    if (c === '-' && code[i + 1] === '-' && code[i + 2] === '[') {
      let j = i + 3;
      let level = 0;
      while (code[j] === '=') { level++; j++; }
      if (code[j] === '[') {
        const close = ']' + '='.repeat(level) + ']';
        const end = code.indexOf(close, j + 1);
        if (end !== -1) { i = end + close.length; continue; }
      }
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }

    // Line comment --
    if (c === '-' && code[i + 1] === '-') {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }

    // Short string — copy verbatim
    if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i++;
      while (i < code.length) {
        if (code[i] === '\\') { out += code[i] + code[i + 1]; i += 2; continue; }
        if (code[i] === quote) { out += code[i]; i++; break; }
        out += code[i]; i++;
      }
      continue;
    }

    // Long string — copy verbatim
    if (c === '[' && (code[i + 1] === '[' || code[i + 1] === '=')) {
      let j = i + 1;
      let level = 0;
      while (code[j] === '=') { level++; j++; }
      if (code[j] === '[') {
        const close = ']' + '='.repeat(level) + ']';
        const end = code.indexOf(close, j + 1);
        if (end !== -1) {
          out += code.slice(i, end + close.length);
          i = end + close.length;
          continue;
        }
      }
    }

    out += c;
    i++;
  }
  return out;
}

// --- Rename identifiers ---

const LUA_KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for',
  'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat',
  'return', 'then', 'true', 'until', 'while',
]);

const PROTECTED = new Set([
  '_G', '_VERSION', '_ENV', 'self',
  'assert', 'collectgarbage', 'dofile', 'error', 'getfenv', 'getmetatable',
  'ipairs', 'load', 'loadfile', 'loadstring', 'module', 'next', 'pairs',
  'pcall', 'print', 'rawequal', 'rawget', 'rawlen', 'rawset', 'require',
  'select', 'setfenv', 'setmetatable', 'tonumber', 'tostring', 'type',
  'unpack', 'xpcall',
  'coroutine', 'debug', 'io', 'math', 'os', 'package', 'string', 'table',
  'bit32', 'utf8',
  'game', 'workspace', 'script', 'Instance', 'Vector3', 'Vector2', 'CFrame',
  'Color3', 'BrickColor', 'UDim', 'UDim2', 'Rect', 'Ray', 'Region3',
  'TweenInfo', 'NumberRange', 'NumberSequence', 'ColorSequence',
  'PhysicalProperties', 'Enum', 'wait', 'spawn', 'delay', 'tick',
  'time', 'task', 'typeof', 'warn', 'Random', 'shared',
  'getgenv', 'getrenv', 'getreg', 'hookfunction',
  'getrawmetatable', 'setreadonly', 'isreadonly',
  'firetouchinterest', 'fireclickdetector', 'getconnections', 'getnilinstances',
  'JSON', 'HttpService', 'Players', 'RunService', 'UserInputService',
  'ReplicatedStorage', 'ServerStorage', 'ServerScriptService', 'StarterGui',
  'StarterPack', 'StarterPlayer', 'Lighting', 'SoundService', 'TweenService',
  'ContextActionService', 'PathfindingService', 'TeleportService',
  'MarketplaceService', 'DataStoreService', 'MessagingService',
]);

function makeRandomName(used) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let t = 0; t < 1000; t++) {
    let name = '_0x';
    for (let i = 0; i < 6; i++) {
      name += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!used.has(name) && !LUA_KEYWORDS.has(name) && !PROTECTED.has(name)) {
      used.add(name);
      return name;
    }
  }
  return '_0x' + Date.now().toString(36);
}

function renameIdentifiers(code, config) {
  if (!config.rename) return code;

  const used = new Set();
  const locals = new Set();
  let m;

  // Find local declarations
  const localDeclRegex = /\blocal\s+([\w,\s]+?)(?=\s*[=\(]|\s*$)/gm;
  while ((m = localDeclRegex.exec(code)) !== null) {
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const n of names) {
      if (/^[A-Za-z_]\w*$/.test(n)) locals.add(n);
    }
  }

  // Find function parameters
  const paramRegex = /\bfunction\s*\(([^)]*)\)/g;
  while ((m = paramRegex.exec(code)) !== null) {
    const params = m[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const p of params) {
      if (/^[A-Za-z_]\w*$/.test(p) && p !== '...') locals.add(p);
    }
  }

  // Find for-loop variables
  const forRegex = /\bfor\s+([\w\s,]+?)\s*(?:=|in)\b/g;
  while ((m = forRegex.exec(code)) !== null) {
    const vars = m[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const v of vars) {
      if (/^[A-Za-z_]\w*$/.test(v)) locals.add(v);
    }
  }

  const map = new Map();
  for (const name of locals) {
    if (PROTECTED.has(name) || LUA_KEYWORDS.has(name)) continue;
    map.set(name, makeRandomName(used));
  }

  // Replace identifiers, skipping string contents
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];

    if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i++;
      while (i < code.length) {
        if (code[i] === '\\') { out += code[i] + code[i + 1]; i += 2; continue; }
        if (code[i] === quote) { out += code[i]; i++; break; }
        out += code[i]; i++;
      }
      continue;
    }

    if (c === '[' && (code[i + 1] === '[' || code[i + 1] === '=')) {
      let j = i + 1;
      let level = 0;
      while (code[j] === '=') { level++; j++; }
      if (code[j] === '[') {
        const close = ']' + '='.repeat(level) + ']';
        const end = code.indexOf(close, j + 1);
        if (end !== -1) {
          out += code.slice(i, end + close.length);
          i = end + close.length;
          continue;
        }
      }
    }

    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < code.length && /[A-Za-z0-9_]/.test(code[i])) i++;
      const word = code.slice(start, i);
      out += map.has(word) ? map.get(word) : word;
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

// --- Encode strings ---

function encodeStrings(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];

    // Skip long strings
    if (c === '[' && (code[i + 1] === '[' || code[i + 1] === '=')) {
      let j = i + 1;
      let level = 0;
      while (code[j] === '=') { level++; j++; }
      if (code[j] === '[') {
        const close = ']' + '='.repeat(level) + ']';
        const end = code.indexOf(close, j + 1);
        if (end !== -1) {
          out += code.slice(i, end + close.length);
          i = end + close.length;
          continue;
        }
      }
    }

    // Short string
    if (c === '"' || c === "'") {
      const quote = c;
      let value = '';
      i++;
      let closed = false;
      while (i < code.length) {
        if (code[i] === '\\') {
          const esc = code[i + 1];
          if (esc === 'n') value += '\n';
          else if (esc === 't') value += '\t';
          else if (esc === 'r') value += '\r';
          else if (esc === '\\') value += '\\';
          else if (esc === '"') value += '"';
          else if (esc === "'") value += "'";
          else value += esc;
          i += 2;
          continue;
        }
        if (code[i] === quote) { i++; closed = true; break; }
        value += code[i];
        i++;
      }
      if (!closed) { out += quote + value; continue; }
      if (value.length === 0) { out += '""'; continue; }
      const codes = [];
      for (let k = 0; k < value.length; k++) codes.push(value.charCodeAt(k));
      out += 'string.char(' + codes.join(',') + ')';
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

// --- Encode numbers ---

function encodeNumbers(code) {
  let out = '';
  let i = 0;
  let inString = false;
  let stringQuote = '';

  while (i < code.length) {
    const c = code[i];

    if (inString) {
      if (c === '\\') { out += c + code[i + 1]; i += 2; continue; }
      if (c === stringQuote) { inString = false; stringQuote = ''; }
      out += c;
      i++;
      continue;
    }

    if (c === '"' || c === "'") {
      inString = true;
      stringQuote = c;
      out += c;
      i++;
      continue;
    }

    if (/[0-9]/.test(c) && (i === 0 || !/[\w.]/.test(code[i - 1]))) {
      const start = i;
      while (i < code.length && /[0-9]/.test(code[i])) i++;
      if (i < code.length && /[\w.]/.test(code[i])) {
        out += code.slice(start, i);
        continue;
      }
      const n = parseInt(code.slice(start, i), 10);
      if (isNaN(n) || n === 0 || n > 100000) {
        out += code.slice(start, i);
      } else {
        out += '0x' + n.toString(16);
      }
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

// --- Dead code injection ---

function injectDeadCode(code, config) {
  function snippet() {
    const kind = Math.floor(Math.random() * 3);
    if (kind === 0) {
      const a = Math.floor(Math.random() * 1000);
      const b = Math.floor(Math.random() * 1000);
      return 'if ' + a + ' == ' + b + ' then local _x = ' + a + ' end';
    }
    if (kind === 1) {
      return 'if false then print(' + Math.floor(Math.random() * 100) + ') end';
    }
    return 'local _d = ' + Math.floor(Math.random() * 100) + ' * ' + Math.floor(Math.random() * 100);
  }

  const lines = code.split('\n');
  for (let k = 0; k < config.deadCode; k++) {
    const idx = Math.floor(Math.random() * (lines.length + 1));
    lines.splice(idx, 0, snippet());
  }
  return lines.join('\n');
}

// --- Multi-layer wrap ---

function wrapLayers(code, layers) {
  let current = code;
  for (let i = 0; i < layers - 1; i++) {
    const bytes = [];
    for (let k = 0; k < current.length; k++) bytes.push(current.charCodeAt(k));
    current =
      'local _c={' + bytes.join(',') + '}\n' +
      'local _f=loadstring(string.char(unpack(_c)))\n' +
      '_f()';
  }
  return current;
}