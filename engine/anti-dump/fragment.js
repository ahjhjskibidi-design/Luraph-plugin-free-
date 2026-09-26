/**
 * Fragment splitter — divides a bytecode program into fixed-size
 * fragments. Each fragment is encrypted independently.
 *
 * The fragment boundaries are important: the VM must be able to
 * resume execution at any fragment boundary. To make this possible,
 * fragments never split an instruction in half. Since every
 * instruction is a 32-bit word, we align fragments to 32-bit
 * boundaries (which is natural: FRAGMENT_SIZE is a count of
 * instructions, not bytes).
 */

import { FRAGMENT_SIZE } from './constants.js';

/**
 * Split a program into fragments.
 *
 * @param {object} program — output of the compiler
 * @returns {object} — {
 *     fragments: [ { index, instructions: [Uint32], size } ],
 *     metadata: { totalInstructions, fragmentCount, fragmentSize },
 *     protos: [...], // protos split into fragments too
 *     constants: [...], // not fragmented
 *   }
 */
export function splitProgram(program) {
  const mainFragments = splitInstructions(program.main.instructions, 0);

  // Also split every proto's instructions
  const protoFragments = program.protos.map((proto, protoIdx) => {
    const frags = splitInstructions(proto.instructions, protoIdx + 1000);
    return {
      protoIndex: protoIdx,
      proto: proto,
      fragments: frags,
    };
  });

  const totalInstructions =
    program.main.instructions.length +
    program.protos.reduce((sum, p) => sum + p.instructions.length, 0);

  return {
    mainFragments,
    protoFragments,
    metadata: {
      totalInstructions,
      mainFragmentCount: mainFragments.length,
      protoFragmentCount: protoFragments.map(pf => pf.fragments.length),
      fragmentSize: FRAGMENT_SIZE,
    },
    constants: program.constants,
    protos: program.protos.map(p => ({
      params: p.params,
      isVararg: p.isVararg,
      upvalues: p.upvalues,
      registerCount: p.registerCount,
    })),
  };
}

/**
 * Split an array of instructions into fragments of FRAGMENT_SIZE.
 * The last fragment may be shorter.
 */
function splitInstructions(instructions, baseIndex) {
  const frags = [];
  for (let i = 0; i < instructions.length; i += FRAGMENT_SIZE) {
    const chunk = instructions.slice(i, i + FRAGMENT_SIZE);
    frags.push({
      index: frags.length,
      globalIndex: baseIndex + frags.length,
      startPC: i,
      size: chunk.length,
      instructions: chunk,
    });
  }
  return frags;
}

export default { splitProgram };