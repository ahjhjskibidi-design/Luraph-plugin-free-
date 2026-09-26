/**
 * Lua Obf — AST node types.
 * Every node is a plain object with a `type` field.
 * No classes — simpler to serialize, transform, and reconstruct.
 */

// --- Node types ---

export const NodeType = {
  // Program
  CHUNK: 'Chunk',
  BLOCK: 'Block',

  // Statements
  LOCAL: 'LocalStatement',
  ASSIGN: 'AssignStatement',
  CALL_STATEMENT: 'CallStatement',
  IF: 'IfStatement',
  WHILE: 'WhileStatement',
  REPEAT: 'RepeatStatement',
  FOR_NUMERIC: 'ForNumericStatement',
  FOR_GENERIC: 'ForGenericStatement',
  RETURN: 'ReturnStatement',
  BREAK: 'BreakStatement',
  DO: 'DoStatement',
  FUNCTION_DECL: 'FunctionDeclaration',
  LOCAL_FUNCTION: 'LocalFunctionDeclaration',

  // Expressions
  IDENTIFIER: 'Identifier',
  LITERAL_STRING: 'StringLiteral',
  LITERAL_NUMBER: 'NumberLiteral',
  LITERAL_BOOL: 'BoolLiteral',
  LITERAL_NIL: 'NilLiteral',
  LITERAL_VARARG: 'VarargLiteral',
  BINARY: 'BinaryExpression',
  UNARY: 'UnaryExpression',
  CALL: 'CallExpression',
  METHOD_CALL: 'MethodCallExpression',
  INDEX: 'IndexExpression',
  TABLE: 'TableConstructor',
  FUNCTION_EXPR: 'FunctionExpression',
  PAREN: 'ParenExpression',
};

// --- Constructors ---

export function chunk(body) {
  return { type: NodeType.CHUNK, body };
}

export function block(body) {
  return { type: NodeType.BLOCK, body };
}

export function local(names, values) {
  return { type: NodeType.LOCAL, names, values };
}

export function assign(targets, values) {
  return { type: NodeType.ASSIGN, targets, values };
}

export function callStatement(expr) {
  return { type: NodeType.CALL_STATEMENT, expression: expr };
}

export function ifStatement(clauses, elseBody) {
  return { type: NodeType.IF, clauses, elseBody };
}

export function whileStatement(condition, body) {
  return { type: NodeType.WHILE, condition, body };
}

export function repeatStatement(body, condition) {
  return { type: NodeType.REPEAT, body, condition };
}

export function forNumeric(variable, start, end, step, body) {
  return { type: NodeType.FOR_NUMERIC, variable, start, end, step, body };
}

export function forGeneric(variables, iterators, body) {
  return { type: NodeType.FOR_GENERIC, variables, iterators, body };
}

export function returnStatement(values) {
  return { type: NodeType.RETURN, values };
}

export function breakStatement() {
  return { type: NodeType.BREAK };
}

export function doStatement(body) {
  return { type: NodeType.DO, body };
}

export function functionDecl(name, params, body, isLocal) {
  return { type: isLocal ? NodeType.LOCAL_FUNCTION : NodeType.FUNCTION_DECL, name, params, body };
}

export function identifier(name) {
  return { type: NodeType.IDENTIFIER, name };
}

export function stringLiteral(value, quote, raw) {
  return { type: NodeType.LITERAL_STRING, value, quote: quote || '"', raw };
}

export function numberLiteral(value, raw) {
  return { type: NodeType.LITERAL_NUMBER, value, raw };
}

export function boolLiteral(value) {
  return { type: NodeType.LITERAL_BOOL, value };
}

export function nilLiteral() {
  return { type: NodeType.LITERAL_NIL };
}

export function varargLiteral() {
  return { type: NodeType.LITERAL_VARARG };
}

export function binary(left, operator, right) {
  return { type: NodeType.BINARY, left, operator, right };
}

export function unary(operator, argument) {
  return { type: NodeType.UNARY, operator, argument };
}

export function call(callee, args) {
  return { type: NodeType.CALL, callee, args };
}

export function methodCall(object, method, args) {
  return { type: NodeType.METHOD_CALL, object, method, args };
}

export function index(object, key, computed) {
  return { type: NodeType.INDEX, object, key, computed: computed !== false };
}

export function table(fields) {
  return { type: NodeType.TABLE, fields };
}

export function functionExpr(params, body, isVararg) {
  return { type: NodeType.FUNCTION_EXPR, params, body, isVararg: !!isVararg };
}

export function paren(expr) {
  return { type: NodeType.PAREN, expression: expr };
}

// --- Walkers ---

/**
 * Walk every node in the tree, depth-first.
 * Visitor receives (node, parent).
 * Return false from visitor to skip children.
 */
export function walk(node, visitor, parent) {
  if (!node || typeof node !== 'object') return;
  if (node.type) {
    const result = visitor(node, parent);
    if (result === false) return;
  }
  for (const key of Object.keys(node)) {
    if (key === 'type') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visitor, node);
    } else if (value && typeof value === 'object' && value.type) {
      walk(value, visitor, node);
    }
  }
}

/**
 * Collect every identifier name used in the tree.
 */
export function collectIdentifiers(node) {
  const names = new Set();
  walk(node, function (n) {
    if (n.type === NodeType.IDENTIFIER) names.add(n.name);
  });
  return names;
}

/**
 * Collect every string value used in the tree.
 */
export function collectStrings(node) {
  const values = [];
  walk(node, function (n) {
    if (n.type === NodeType.LITERAL_STRING) values.push(n.value);
  });
  return values;
}

/**
 * Collect every number value used in the tree.
 */
export function collectNumbers(node) {
  const values = [];
  walk(node, function (n) {
    if (n.type === NodeType.LITERAL_NUMBER) values.push(n.value);
  });
  return values;
}