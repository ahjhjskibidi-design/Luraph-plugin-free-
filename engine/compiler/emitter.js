/**
 * Emitter — instruction stream builder.
 *
 * The emitter collects instructions and handles jump patching. When
 * compiling an if-statement, for example, we emit a forward jump with
 * a placeholder target, compile the body, then patch the jump to
 * point at the current position.
 */

import { encode, encodeJump } from './instruction.js';
import { OP } from './opcodes.js';

export class Emitter {
  constructor() {
    this.instructions = [];
    this.pendingJumps = []; // { index, targetMarker }
    this.markers = new Map();
    this.nextMarker = 0;
  }

  /**
   * Emit a 3-address instruction.
   */
  emit(op, a, b, c) {
    this.instructions.push(encode(op, a | 0, b | 0, c | 0));
    return this.instructions.length - 1;
  }

  /**
   * Emit an instruction and return its index (for later patching).
   */
  emitAt(op, a, b, c) {
    return this.emit(op, a, b, c);
  }

  /**
   * Emit a jump forward to a marker that has not been placed yet.
   * Returns the index of the jump instruction.
   */
  emitJumpForward(op) {
    const marker = this.nextMarker++;
    const idx = this.instructions.length;
    this.instructions.push(0); // placeholder
    this.pendingJumps.push({ index: idx, marker, op: op || OP.JMP });
    return idx;
  }

  /**
   * Place a marker at the current position, patching any jumps that
   * target it.
   */
  placeMarker(marker) {
    const target = this.instructions.length;
    for (const pj of this.pendingJumps) {
      if (pj.marker === marker) {
        const offset = target - (pj.index + 1);
        this.instructions[pj.index] = encodeJump(pj.op || OP.JMP, 0, offset);
      }
    }
    this.pendingJumps = this.pendingJumps.filter(pj => pj.marker !== marker);
  }

  /**
   * Create a fresh marker id. Used by control-flow compilers.
   */
  freshMarker() {
    return this.nextMarker++;
  }

  /**
   * Emit a jump to a specific marker (placed later).
   */
  emitJumpTo(marker, op) {
    const idx = this.instructions.length;
    this.instructions.push(0);
    this.pendingJumps.push({ index: idx, marker, op: op || OP.JMP });
    return idx;
  }

  /**
   * Patch a previously emitted jump to point at the current position.
   */
  patchHere(jumpIndex) {
    const target = this.instructions.length;
    const offset = target - (jumpIndex + 1);
    this.instructions[jumpIndex] = encodeJump(OP.JMP, 0, offset);
  }

  size() {
    return this.instructions.length;
  }

  toArray() {
    if (this.pendingJumps.length > 0) {
      throw new Error('Unpatched jumps remain: ' + this.pendingJumps.length);
    }
    return this.instructions.slice();
  }
}

export default { Emitter };