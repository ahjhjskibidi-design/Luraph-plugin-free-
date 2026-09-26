/**
 * Compile statements to bytecode.
 */

import { NODE } from '../parser/types.js';
import { OP } from './opcodes.js';
import { compileExpr } from './compile-expr.js';
import { asConstRk, asRegisterRk } from './instruction.js';

export function compileStmt(C, node) {
  switch (node.type) {
    case NODE.LOCAL:       return compileLocal(C, node);
    case NODE.ASSIGN:      return compileAssign(C, node);
    case NODE.CALL_STMT:   return compileCallStmt(C, node);
    case NODE.IF:          return compileIf(C, node);
    case NODE.WHILE:       return compileWhile(C, node);
    case NODE.REPEAT:      return compileRepeat(C, node);
    case NODE.FOR_NUM:     return compileNumericFor(C, node);
    case NODE.FOR_GEN:     return compileGenericFor(C, node);
    case NODE.DO:          return compileDo(C, node);
    case NODE.RETURN:      return compileReturn(C, node);
    case NODE.BREAK:       return compileBreak(C);
    case NODE.FUNC_DECL:   return compileFunctionDecl(C, node);
    case NODE.LOCAL_FUNC:  return compileLocalFunction(C, node);
    default:
      throw new Error('Cannot compile statement: ' + node.type);
  }
}

function compileLocal(C, node) {
  // Compile values first
  const regs = [];
  for (const v of node.values) {
    regs.push(compileExpr(C, v));
  }

  // Declare locals in scope, moving results into their registers
  for (let i = 0; i < node.names.length; i++) {
    const local = C.scope.declareLocal(node.names[i].name);
    if (i < regs.length) {
      if (regs[i] !== local.register) {
        C.emit(OP.MOVE, local.register, regs[i], 0);
      }
    } else {
      C.emit(OP.LOADNIL, local.register, 0, 0);
    }
  }

  for (const r of regs) C.freeTemp(r);
}

function compileAssign(C, node) {
  // Compile values first
  const valueRegs = [];
  for (const v of node.values) {
    valueRegs.push(compileExpr(C, v));
  }

  for (let i = 0; i < node.targets.length; i++) {
    const target = node.targets[i];
    const valReg = valueRegs[i] || valueRegs[valueRegs.length - 1];

    if (target.type === NODE.IDENT) {
      const res = C.scope.resolve(target.name);
      if (res.kind === 'local') {
        C.emit(OP.MOVE, res.register, valReg, 0);
      } else if (res.kind === 'upvalue') {
        C.emit(OP.SETUPVAL, valReg, res.index, 0);
      } else {
        const k = C.constants.add(target.name);
        C.emit(OP.SETGLOBAL, valReg, k, 0);
      }
    } else if (target.type === NODE.INDEX) {
      const obj = compileExpr(C, target.object);
      let keyRk;
      let keyReg = null;
      if (!target.computed) {
        const k = C.constants.add(target.key.value);
        keyRk = asConstRk(k);
      } else {
        keyReg = compileExpr(C, target.key);
        keyRk = asRegisterRk(keyReg);
      }
      C.emit(OP.SETTABLE, obj, keyRk, asRegisterRk(valReg));
      C.freeTemp(obj);
      if (keyReg !== null) C.freeTemp(keyReg);
    } else {
      throw new Error('Invalid assignment target: ' + target.type);
    }
  }

  for (const r of valueRegs) C.freeTemp(r);
}

function compileCallStmt(C, node) {
  // Calls as statements: no result needed
  compileExpr(C, node.expression);
}

function compileIf(C, node) {
  const endJumps = [];

  for (let i = 0; i < node.clauses.length; i++) {
    const clause = node.clauses[i];
    const condReg = compileExpr(C, clause.condition);
    C.freeTemp(condReg);

    // TEST: if reg is false (for `if`), jump to next clause
    C.emit(OP.TEST, condReg, 0, 0); // 0 = test for truthiness
    const skipJump = C.emitJumpForward(OP.JMP);

    // Body
    C.scope.enterBlock();
    for (const stmt of clause.body.body) compileStmt(C, stmt);
    C.scope.exitBlock();

    if (i < node.clauses.length - 1 || node.elseBody) {
      const endJump = C.emitJumpForward(OP.JMP);
      endJumps.push(endJump);
    }

    C.patchHere(skipJump);
  }

  if (node.elseBody) {
    C.scope.enterBlock();
    for (const stmt of node.elseBody.body) compileStmt(C, stmt);
    C.scope.exitBlock();
  }

  for (const j of endJumps) C.patchHere(j);
}

function compileWhile(C, node) {
  const top = C.emitter.freshMarker();
  C.emitter.placeMarker(top);

  const condReg = compileExpr(C, node.condition);
  C.freeTemp(condReg);
  C.emit(OP.TEST, condReg, 0, 0);
  const exitJump = C.emitJumpForward(OP.JMP);

  C.breakStack.push(exitJump);
  C.scope.enterBlock();
  for (const stmt of node.body.body) compileStmt(C, stmt);
  C.scope.exitBlock();
  C.breakStack.pop();

  // Loop back
  const backJump = C.emitter.instructions.length;
  C.emitter.instructions.push(0);
  const offset = top - (backJump + 1);
  // We can't use placeMarker after the loop; patch directly
  C.patchBackward(backJump, top);

  C.patchHere(exitJump);
}

function compileRepeat(C, node) {
  const top = C.emitter.instructions.length;
  C.scope.enterBlock();
  C.breakStack.push(-1); // placeholder — we patch repeat exit below
  const breakIdx = C.breakStack.length - 1;

  for (const stmt of node.body.body) compileStmt(C, stmt);

  const condReg = compileExpr(C, node.condition);
  C.freeTemp(condReg);

  // Emit backward jump if condition false
  C.emit(OP.TEST, condReg, 1, 0); // test for falseness
  const backJump = C.emitter.instructions.length;
  C.emitter.instructions.push(0);
  C.patchBackward(backJump, top);

  C.scope.exitBlock();
  C.breakStack.pop();
}

function compileNumericFor(C, node) {
  // for i = start, end, step do body end
  // Compile start, end, step into three consecutive registers
  const base = C.scope.nextRegister;
  compileExpr(C, node.start, base);
  compileExpr(C, node.end, base + 1);
  if (node.step) compileExpr(C, node.step, base + 2);
  else C.emit(OP.LOADK, base + 2, C.constants.add(1), 0);

  // Declare the loop variable as a local
  const local = C.scope.declareLocal(node.variable.name);
  // Local register is next; we'll use base + 3 as the loop variable
  // For simplicity, use base + 3 and MOVE the current value there
  // Actually simpler: MOVE start to loop var, then loop

  // This is a simplified compilation. Full Lua semantics with numeric
  // for are more involved (integer vs float counters, precomputed
  // limit, step direction). We approximate for correctness on common
  // cases.

  const loopTop = C.emitter.instructions.length;

  // Loop var = base (start)
  C.emit(OP.MOVE, local.register, base, 0);

  // Test: if loop var > end then exit
  C.emit(OP.LE, local.register, asRegisterRk(base), asRegisterRk(base + 1));
  const exitJump = C.emitJumpForward(OP.JMP);

  C.breakStack.push(exitJump);
  C.scope.enterBlock();
  for (const stmt of node.body.body) compileStmt(C, stmt);
  C.scope.exitBlock();
  C.breakStack.pop();

  // loop var += step
  C.emit(OP.ADD, local.register, asRegisterRk(local.register), asRegisterRk(base + 2));

  // Jump back to top
  const backJump = C.emitter.instructions.length;
  C.emitter.instructions.push(0);
  C.patchBackward(backJump, loopTop);

  C.patchHere(exitJump);
}

function compileGenericFor(C, node) {
  // for k, v in pairs(t) do body end
  // Compile iterators into consecutive registers
  const base = C.scope.nextRegister;
  for (const it of node.iterators) {
    compileExpr(C, it, C.scope.allocTemp());
  }

  // The loop body is complex. For simplicity, emit a CALL to next()
  // for each iteration. Full Lua generic for semantics are more
  // nuanced (iterator function + state + control var). We approximate
  // by assuming the first iterator returns a function that the VM
  // can call repeatedly.

  const loopTop = C.emitter.instructions.length;

  // Call iterator function: R[base] = R[base](R[base+1], R[base+2])
  C.emit(OP.CALL, base, 2, 2); // 2 args, 1 result

  // Test: if result is nil, exit
  const testReg = C.scope.allocTemp();
  C.emit(OP.MOVE, testReg, base, 0);
  C.emit(OP.EQ, 0, asRegisterRk(testReg), asConstRk(C.constants.add(null)));
  const exitJump = C.emitJumpForward(OP.JMP);

  // Declare loop variables
  for (const v of node.variables) {
    C.scope.declareLocal(v.name);
  }

  C.breakStack.push(exitJump);
  C.scope.enterBlock();
  for (const stmt of node.body.body) compileStmt(C, stmt);
  C.scope.exitBlock();
  C.breakStack.pop();

  // Jump back
  const backJump = C.emitter.instructions.length;
  C.emitter.instructions.push(0);
  C.patchBackward(backJump, loopTop);

  C.patchHere(exitJump);
  C.freeTemp(testReg);
}

function compileDo(C, node) {
  C.scope.enterBlock();
  for (const stmt of node.body.body) compileStmt(C, stmt);
  C.scope.exitBlock();
}

function compileReturn(C, node) {
  const regs = [];
  for (const v of node.values) {
    regs.push(compileExpr(C, v));
  }
  const base = regs.length > 0 ? regs[0] : 0;
  C.emit(OP.RETURN, base, regs.length + 1, 0);
  for (const r of regs) C.freeTemp(r);
}

function compileBreak(C) {
  if (C.breakStack.length === 0) {
    throw new Error('break outside loop');
  }
  const jumpIdx = C.emitJumpForward(OP.JMP);
  C.pendingBreaks.push(jumpIdx);
}

function compileFunctionDecl(C, node) {
  // Compile the body into a proto, then assign to global or local
  const proto = C.compileNestedFunction({
    type: NODE.FUNC_EXPR,
    params: node.params,
    body: node.body,
    isVararg: false,
  });
  const protoIdx = C.addProto(proto);
  const funcReg = C.scope.allocTemp();
  C.emit(OP.CLOSimportURE, funcReg, protoIdx, 0);

  // Assign to name
  const nameParts = node.name.name.split('.');
  { if (nameParts.length === 1) {
    const res = C.scope.resolve(nameParts[0]);
    if (res.kind === 'local') {
      C.emit(OP.MOVE, res.register, funcReg, 0);
    } else {
      const k = C.constants.add(nameParts[0]);
      C.emit(OP.SETGLOBAL, funcReg, k, 0);
    }
  } else {
    // Chained assignment a.b.c = f: complex, for now store as global with full name
    const k = C.constants.add(node.name.name);
    C.emit(OP.SETGLOBAL, funcReg, k, 0);
  }
  C.freeTemp(funcReg);
}

function compileLocalFunction(C, node) {
  // Declare name first (recursive)
  const local = C.scope.declareLocal(node.name.name);

  // Compile body
  const proto = C.compileNestedFunction({
    type: NODE.FUNC_EXPR,
    params: node.params,
    body: node.body,
    isVararg: false,
  });
  const protoIdx = C.addProto(proto);
  C.emit(OP.CLOSURE, local.register, protoIdx, 0);
}

export default { compileStmt };