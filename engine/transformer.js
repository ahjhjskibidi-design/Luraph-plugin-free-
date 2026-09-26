/**
 * Lua Obf — AST transformer.
 * Renames identifiers (locals, params, loop vars) while preserving globals.
 */

import * as A from './ast.js';

// Globals that must never be renamed (Lua standard library + Roblox common)
const PROTECTED_NAMES = new Set([
  // Lua standard
  '_G', '_VERSION', '_ENV',
  'assert', 'collectgarbage', 'dofile', 'error', 'getfenv', 'getmetatable',
  'ipairs', 'load', 'loadfile', 'loadstring', 'module', 'next', 'pairs',
  'pcall', 'print', 'rawequal', 'rawget', 'rawlen', 'rawset', 'require',
  'select', 'setfenv', 'setmetatable', 'tonumber', 'tostring', 'type',
  'unpack', 'xpcall',
  'coroutine', 'debug', 'io', 'math', 'os', 'package', 'string', 'table',
  'bit32', 'utf8',
  'true', 'false', 'nil', 'self',
  // Roblox
  'game', 'workspace', 'script', 'Instance', 'Vector3', 'Vector2', 'CFrame',
  'Color3', 'BrickColor', 'UDim', 'UDim2', 'Rect', 'Ray', 'Region3',
  'TweenInfo', 'NumberRange', 'NumberSequence', 'ColorSequence',
  'PhysicalProperties', 'Enum', 'wait', 'spawn', 'delay', 'tick',
  'time', 'os', 'task', 'typeof', 'warn', 'Random', 'Random.new',
  'debug', 'shared', 'getgenv', 'getrenv', 'getreg', 'hookfunction',
  'getrawmetatable', 'setreadonly', 'isreadonly', 'firetouchinterest',
  'fireclickdetector', 'getconnections', 'getnilinstances',
  // Common Lua libraries not in the standard but common in Roblox
  'JSON', 'Http', 'HttpService', 'Players', 'RunService', 'UserInputService',
  'ReplicatedStorage', 'ServerStorage', 'ServerScriptService', 'StarterGui',
  'StarterPack', 'StarterPlayer', 'Lighting', 'SoundService', 'TweenService',
  'ContextActionService', 'PathfindingService', 'TeleportService',
  'MarketplaceService', 'DataStoreService', 'MessagingService',
]);

// --- Random name generator ---

class NameGenerator {
  constructor(prefix, minLen, maxLen) {
    this.prefix = prefix;
    this.minLen = minLen;
    this.maxLen = maxLen;
    this.counter = 0;
    this.used = new Set();
  }

  next() {
    while (true) {
      this.counter++;
      const len = this.minLen + Math.floor(Math.random() * (this.maxLen - this.minLen + 1));
      let suffix = '';
      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      for (let i = 0; i < len; i++) {
        suffix += chars[Math.floor(Math.random() * chars.length)];
      }
      const name = this.prefix + suffix;
      if (!this.used.has(name) && !PROTECTED_NAMES.has(name)) {
        this.used.add(name);
        return name;
      }
      // Guard against infinite loop
      if (this.counter > 100000) throw new Error('Name generator exhausted');
    }
  }
}

// --- Scope management ---

class Scope {
  constructor(parent) {
    this.parent = parent;
    this.bindings = new Map(); // original name -> renamed
    this.declared = new Set(); // locals declared in this scope
  }

  declare(name) {
    if (this.declared.has(name)) return;
    this.declared.add(name);
    if (!this.bindings.has(name)) {
      this.bindings.set(name, null); // will be filled by generator
    }
  }

  resolve(name) {
    let scope = this;
    while (scope) {
      if (scope.bindings.has(name) && scope.bindings.get(name) !== null) {
        return scope.bindings.get(name);
      }
      scope = scope.parent;
    }
    return null;
  }

  assign(name, newName) {
    this.bindings.set(name, newName);
  }

  isLocal(name) {
    let scope = this;
    while (scope) {
      if (scope.declared.has(name)) return true;
      scope = scope.parent;
    }
    return false;
  }
}

// --- Transformer ---

class Transformer {
  constructor(config) {
    this.config = config;
    this.generator = new NameGenerator(config.prefix, config.minNameLen, config.maxNameLen);
  }

  transform(chunk) {
    const scope = new Scope(null);
    // Top-level is a special case: everything is either local or global
    this.visitBlock(chunk.body, scope);
    return chunk;
  }

  // --- Statements ---

  visitBlock(block, parentScope) {
    const scope = new Scope(parentScope);
    for (const stmt of block.body) {
      this.visitStatement(stmt, scope);
    }
  }

  visitStatement(node, scope) {
    if (!node) return;

    switch (node.type) {
      case A.NodeType.LOCAL:
        this.visitLocal(node, scope);
        break;
      case A.NodeType.ASSIGN:
        this.visitAssign(node, scope);
        break;
      case A.NodeType.LOCAL_FUNCTION:
        this.visitLocalFunction(node, scope);
        break;
      case A.NodeType.FUNCTION_DECL:
        this.visitFunctionDecl(node, scope);
        break;
      case A.NodeType.IF:
        this.visitIf(node, scope);
        break;
      case A.NodeType.WHILE:
        this.visitWhile(node, scope);
        break;
      case A.NodeType.REPEAT:
        this.visitRepeat(node, scope);
        break;
      case A.NodeType.FOR_NUMERIC:
        this.visitForNumeric(node, scope);
        break;
      case A.NodeType.FOR_GENERIC:
        this.visitForGeneric(node, scope);
        break;
      case A.NodeType.DO:
        this.visitBlock(node.body, scope);
        break;
      case A.NodeType.RETURN:
        for (const v of node.values || []) this.visitExpression(v, scope);
        break;
      case A.NodeType.CALL_STATEMENT:
        this.visitExpression(node.expression, scope);
        break;
      // breakStatement: no-op
    }
  }

  visitLocal(node, scope) {
    // Visit values first (before declaring names)
    for (const v of node.values) this.visitExpression(v, scope);

    // Declare and rename
    for (let i = 0; i < node.names.length; i++) {
      const name = node.names[i].name;
      scope.declare(name);
      const newName = this.generator.next();
      scope.assign(name, newName);
      node.names[i] = A.identifier(newName);
    }
  }

  visitLocalFunction(node, scope) {
    // Declare name first (recursive)
    const originalName = node.name.name;
    scope.declare(originalName);
    const newName = this.generator.next();
    scope.assign(originalName, newName);
    node.name = A.identifier(newName);

    // Visit body in a new scope (function boundary)
    const funcScope = new Scope(scope);
    for (const p of node.params) {
      const pName = p.name;
      funcScope.declare(pName);
      const pNew = this.generator.next();
      funcScope.assign(pName, pNew);
      p.name = pNew;
    }
    this.visitBlock(node.body, funcScope);
  }

  visitFunctionDecl(node, scope) {
    // Function declarations in Lua are sugar for `name = function(...)`
    // The name may be an index expression (e.g., `foo.bar`), so we only visit
    // the body. Do not rename the name itself.
    const funcScope = new Scope(scope);
    for (const p of node.params) {
      const pName = p.name;
      funcScope.declare(pName);
      const pNew = this.generator.next();
      funcScope.assign(pName, pNew);
      p.name = pNew;
    }
    this.visitBlock(node.body, funcScope);
  }

  visitAssign(node, scope) {
    // Visit values first
    for (const v of node.values) this.visitExpression(v, scope);
    // Visit targets
    for (const t of node.targets) this.visitExpression(t, scope);
  }

  visitIf(node, scope) {
    for (const clause of node.clauses) {
      this.visitExpression(clause.condition, scope);
      this.visitBlock(clause.body, scope);
    }
    if (node.elseBody) this.visitBlock(node.elseBody, scope);
  }

  visitWhile(node, scope) {
    this.visitExpression(node.condition, scope);
    this.visitBlock(node.body, scope);
  }

  visitRepeat(node, scope) {
    // Repeat: body runs in new scope, condition can see body's locals
    const innerScope = new Scope(scope);
    this.visitBlock(node.body, innerScope);
    this.visitExpression(node.condition, innerScope);
  }

  visitForNumeric(node, scope) {
    this.visitExpression(node.start, scope);
    this.visitExpression(node.end, scope);
    if (node.step) this.visitExpression(node.step, scope);

    const innerScope = new Scope(scope);
    const varName = node.variable.name;
    innerScope.declare(varName);
    const newName = this.generator.next();
    innerScope.assign(varName, newName);
    node.variable = A.identifier(newName);

    this.visitBlock(node.body, innerScope);
  }

  visitForGeneric(node, scope) {
    for (const it of node.iterators) this.visitExpression(it, scope);

    const innerScope = new Scope(scope);
    for (const v of node.variables) {
      const name = v.name;
      innerScope.declare(name);
      const newName = this.generator.next();
      innerScope.assign(name, newName);
      v.name = newName;
    }

    this.visitBlock(node.body, innerScope);
  }

  // --- Expressions ---

  visitExpression(node, scope) {
    if (!node) return;

    switch (node.type) {
      case A.NodeType.IDENTIFIER: {
        const newName = scope.resolve(node.name);
        if (newName) node.name = newName;
        // Otherwise it's a global — leave alone
        break;
      }
      case A.NodeType.BINARY:
        this.visitExpression(node.left, scope);
        this.visitExpression(node.right, scope);
        break;
      case A.NodeType.UNARY:
        this.visitExpression(node.argument, scope);
        break;
      case A.NodeType.CALL:
        this.visitExpression(node.callee, scope);
        for (const a of node.args) this.visitExpression(a, scope);
        break;
      case A.NodeType.METHOD_CALL:
        this.visitExpression(node.object, scope);
        for (const a of node.args) this.visitExpression(a, scope);
        // Do not rename method name — it's a string key
        break;
      case A.NodeType.INDEX:
        this.visitExpression(node.object, scope);
        if (node.computed) this.visitExpression(node.key, scope);
        break;
      case A.NodeType.TABLE:
        for (const f of node.fields) {
          if (f.type === 'key') {
            this.visitExpression(f.key, scope);
            this.visitExpression(f.value, scope);
          } else {
            this.visitExpression(f.value, scope);
          }
        }
        break;
      case A.NodeType.FUNCTION_EXPR: {
        const funcScope = new Scope(scope);
        for (const p of node.params) {
          const pName = p.name;
          funcScope.declare(pName);
          const pNew = this.generator.next();
          funcScope.assign(pName, pNew);
          p.name = pNew;
        }
        this.visitBlock(node.body, funcScope);
        break;
      }
      case A.NodeType.PAREN:
        this.visitExpression(node.expression, scope);
        break;
      // Literals: no-op
    }
  }
}

export function transform(ast, config) {
  const t = new Transformer(config);
  return t.transform(ast);
}