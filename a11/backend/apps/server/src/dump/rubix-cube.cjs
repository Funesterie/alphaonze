'use strict';
/**
 * RUBIXCUBE RGBA — Transport stéganographique à rotation
 *
 * Le RubixCube découpe les données en fragments et les distribue
 * sur les faces R, G, B du cube. Le canal A porte le checksum,
 * l'ordre et l'intégrité.
 *
 * Le cube a une ROTATION qui change à chaque époque. La rotation
 * détermine quelle face porte quel fragment logique. Les données
 * ne bougent pas — c'est le mappage qui tourne, comme un Rubik's Cube.
 *
 *   Époque 1 : R=frag1  G=frag2  B=frag3  A=checksum
 *   Époque 2 : R=frag3  G=frag1  B=frag2  A=checksum  (rotation +120°)
 *   Époque 3 : R=frag2  G=frag3  B=frag1  A=checksum  (rotation +240°)
 *
 * Combined with LSB steganography : les fragments sont cachés dans
 * les bits de poids faible des pixels, et le cube détermine quels
 * canaux portent quels fragments.
 *
 * HENRY rend les couloirs mouvants : le cube change la position
 * logique des fragments entre les pipelines sans déplacer les données.
 */

const crypto = require('node:crypto');

const SCHEMA = 'nossen.rubix_cube.rgba.v1';
const FACE_R = 'R';
const FACE_G = 'G';
const FACE_B = 'B';
const FACE_A = 'A';
const DATA_FACES = [FACE_R, FACE_G, FACE_B];

// ─── Cube state ──────────────────────────────────────────────────────────────

/**
 * Compute the cube rotation for a given epoch.
 * The rotation is deterministic from the epoch seed.
 * @param {string} epochSeed — hex string from epoch-sync (quinté/lottery derived)
 * @returns {number} rotation in degrees (0, 120, 240)
 */
function cubeRotation(epochSeed) {
  const hash = crypto.createHash('sha256').update(`rubix:${epochSeed}`).digest();
  // 3 possible rotations (0, 120, 240 degrees for a 3-face cycle)
  return (hash[0] % 3) * 120;
}

/**
 * Get the face mapping for a given rotation.
 * @param {number} rotation — 0, 120, or 240
 * @returns {object} { R: logicalFragment, G: logicalFragment, B: logicalFragment }
 */
function faceMap(rotation) {
  const fragments = ['frag1', 'frag2', 'frag3'];
  const offset = Math.round(rotation / 120);
  return {
    [FACE_R]: fragments[offset % 3],
    [FACE_G]: fragments[(offset + 1) % 3],
    [FACE_B]: fragments[(offset + 2) % 3],
  };
}

// ─── Fragmentation ──────────────────────────────────────────────────────────

/**
 * Split data into 3 fragments of roughly equal size.
 * @param {Buffer} data
 * @returns {Buffer[]} [frag1, frag2, frag3]
 */
function fragment(data) {
  const third = Math.ceil(data.length / 3);
  return [
    data.slice(0, third),
    data.slice(third, third * 2),
    data.slice(third * 2),
  ];
}

/**
 * Reassemble 3 fragments back into the original data.
 * @param {Buffer[]} fragments — [frag1, frag2, frag3]
 * @returns {Buffer}
 */
function reassemble(fragments) {
  return Buffer.concat(fragments);
}

/**
 * Compute the A-channel checksum : SHA-256 of all fragments + their lengths.
 * This is stored in the A channel to verify integrity and order.
 * @param {Buffer[]} fragments
 * @returns {Buffer} 32-byte checksum
 */
function computeChecksum(fragments) {
  const h = crypto.createHash('sha256');
  for (let i = 0; i < fragments.length; i++) {
    h.update(Buffer.from(`frag${i}:${fragments[i].length}:`));
    h.update(fragments[i]);
  }
  return h.digest();
}

/**
 * Verify the A-channel checksum.
 * @param {Buffer[]} fragments
 * @param {Buffer} checksum
 * @returns {boolean}
 */
function verifyChecksum(fragments, checksum) {
  return computeChecksum(fragments).equals(checksum);
}

// ─── Cube encode ────────────────────────────────────────────────────────────

/**
 * Encode data into a RubixCube packet for a given epoch.
 *
 * The packet contains:
 *   - schema : "nossen.rubix_cube.rgba.v1"
 *   - epoch  : epoch identifier
 *   - rotation : cube rotation in degrees
 *   - faceMap : which logical fragment is on which face
 *   - channels : { R: bytes, G: bytes, B: bytes, A: checksum }
 *   - meta : { originalLength, fragmentLengths, createdAt }
 *
 * @param {Buffer|string} data — data to transport
 * @param {string} epochSeed — hex seed from epoch-sync
 * @param {string} epochId — human-readable epoch identifier
 * @returns {object} RubixCube packet
 */
function encodeCube(data, epochSeed, epochId) {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const frags = fragment(buf);
  const rotation = cubeRotation(epochSeed);
  const fm = faceMap(rotation);
  const checksum = computeChecksum(frags);

  // Map fragments to faces based on rotation
  const fragMap = { frag1: frags[0], frag2: frags[1], frag3: frags[2] };

  return {
    schema: SCHEMA,
    epoch: epochId,
    rotation,
    faceMap: fm,
    channels: {
      R: fragMap[fm.R],
      G: fragMap[fm.G],
      B: fragMap[fm.B],
      A: checksum,
    },
    meta: {
      originalLength: buf.length,
      fragmentLengths: frags.map((f) => f.length),
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Decode a RubixCube packet back into the original data.
 *
 * @param {object} packet — RubixCube packet from encodeCube
 * @param {string} epochSeed — must match the seed used for encoding
 * @returns {object} { ok, data, rotation, checksumMatch }
 */
function decodeCube(packet, epochSeed) {
  if (!packet || packet.schema !== SCHEMA) {
    return { ok: false, error: 'invalid_schema' };
  }

  const expectedRotation = cubeRotation(epochSeed);
  if (packet.rotation !== expectedRotation) {
    return { ok: false, error: 'rotation_mismatch', expected: expectedRotation, actual: packet.rotation };
  }

  const fm = packet.faceMap;
  const fragMap = {
    frag1: packet.channels.R,
    frag2: packet.channels.G,
    frag3: packet.channels.B,
  };

  // Reconstruct fragments in logical order
  const frags = [
    fragMap[fm.R],
    fragMap[fm.G],
    fragMap[fm.B],
  ];

  // Wait — the faceMap tells us which logical fragment is on which face.
  // So to get frag1, we look at which face the faceMap says is "frag1"
  const logicalFrags = [0, 1, 2].map((i) => {
    const logicalName = `frag${i + 1}`;
    const face = Object.keys(fm).find((f) => fm[f] === logicalName);
    return packet.channels[face];
  });

  // Verify checksum
  const checksumMatch = verifyChecksum(logicalFrags, packet.channels.A);
  if (!checksumMatch) {
    return { ok: false, error: 'checksum_failed' };
  }

  const data = reassemble(logicalFrags);
  return {
    ok: true,
    data,
    rotation: packet.rotation,
    checksumMatch: true,
    originalLength: packet.meta.originalLength,
  };
}

// ─── Pipeline routing ───────────────────────────────────────────────────────

/**
 * Determine which pipeline a fragment should be routed to.
 * Each face of the cube corresponds to a pipeline:
 *   R → memory pipeline (conversations, context)
 *   G → tools pipeline (MCP, commands)
 *   B → data pipeline (files, media)
 *
 * The rotation means the logical fragment on each face changes,
 * but the pipeline each face feeds stays the same.
 *
 * @param {string} face — R, G, or B
 * @returns {string} pipeline name
 */
function faceToPipeline(face) {
  switch (face) {
    case FACE_R: return 'memory';
    case FACE_G: return 'tools';
    case FACE_B: return 'data';
    case FACE_A: return 'integrity';
    default: return 'unknown';
  }
}

/**
 * Get the pipeline assignment for a given rotation.
 * @param {number} rotation
 * @returns {object} { R: pipeline, G: pipeline, B: pipeline, A: 'integrity' }
 */
function pipelineAssignment(rotation) {
  const fm = faceMap(rotation);
  return {
    R: `${faceToPipeline(FACE_R)}:${fm.R}`,
    G: `${faceToPipeline(FACE_G)}:${fm.G}`,
    B: `${faceToPipeline(FACE_B)}:${fm.B}`,
    A: 'integrity:checksum',
  };
}

// ─── Capsule extraction ─────────────────────────────────────────────────────

/**
 * Extract only the fragment that a specific pipeline needs.
 * Agents receive only their fragment, not the full data.
 *
 * @param {object} packet — RubixCube packet
 * @param {string} pipeline — 'memory', 'tools', or 'data'
 * @returns {Buffer|null} the fragment for this pipeline, or null
 */
function extractPipelineFragment(packet, pipeline) {
  const faceForPipeline = { memory: FACE_R, tools: FACE_G, data: FACE_B };
  const face = faceForPipeline[pipeline];
  if (!face || !packet.channels[face]) return null;
  return packet.channels[face];
}

module.exports = {
  SCHEMA,
  FACE_R, FACE_G, FACE_B, FACE_A,
  cubeRotation,
  faceMap,
  fragment,
  reassemble,
  computeChecksum,
  verifyChecksum,
  encodeCube,
  decodeCube,
  faceToPipeline,
  pipelineAssignment,
  extractPipelineFragment,
};
