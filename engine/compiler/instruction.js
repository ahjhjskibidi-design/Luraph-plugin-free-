/**
 * Instruction encoding and decoding.
 *
 * Every instruction is a 32-bit integer:
 *   [opcode:8][A:8][B:8][C:8]
 *
 * RK operands: for opcodes that accept either a register or a constant,
 * the top bit of the operand distinguishes: 0 = register, 1 = constant.
 * Register numbers then range 0-127 for those operands.
 */

const MASK_8 = 0xff;
const MASK_RK = 0x7f;
const RK_CONST = 0x80;

export function encode(op, a, b, c) {
  return (
    ((op & MASK_8) << 24) |
    ((a & MASK_8) << 16) |
    ((b & MASK_8) << 8) |
    (c & MASK_8)
  );
}

export function decode(word) {
  return {
    op: (word >>> 24) & MASK_8,
    a: (word >>> 16) & MASK_8,
    b: (word >>> 8) & MASK_8,
    c: word & MASK_8,
  };
}

export function rk(reg) {
  return reg & MASK_RK;
}

export function rkIsConst(rkVal) {
  return (rkVal & RK_CONST) !== 0;
}

export function rkConstIndex(rkVal) {
  return rkVal & MASK_RK;
}

export function asConstRk(constIndex) {
  return (constIndex & MASK_RK) | RK_CONST;
}

export function asRegisterRk(reg) {
  return reg & MASK_RK;
}

/**
 * Encode a signed jump offset as a 16-bit signed integer stored in B+C.
 * Used only for JMP instructions where B is high byte and C is low byte.
 */
export function encodeJump(op, a, sBx) {
  const signed = sBx + 0x8000; // offset by half range
  const b = (signed >>> 8) & MASK_8;
  const c = signed & MASK_8;
  return encode(op, a, b, c);
}

export function decodeJump(word) {
  const inst = decode(word);
  const signed = ((inst.b << 8) | inst.c) - 0x8000;
  return { op: inst.op, a: inst.a, sBx: signed };
}

export default {
  encode,
  decode,
  rk,
  rkIsConst,
  rkConstIndex,
  asConstRk,
  asRegisterRk,
  encodeJump,
  decodeJump,
};