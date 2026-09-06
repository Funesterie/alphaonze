'use strict';

// Banc symbolique reproductible pour la candidate de changement de repere
// documentee le 2026-08-05. Ce script ne definit PAS M et ne touche pas au DSP.

const EPSILON = 1e-12;
const S = Math.SQRT1_2;
const D_CROSS = Object.freeze([
  Object.freeze([-S, S]),
  Object.freeze([S, S]),
]);

const REFERENCE_STATES = Object.freeze([
  Object.freeze({ name: '+real', vector: Object.freeze([1, 0]), expected: 'NW' }),
  Object.freeze({ name: '+imag', vector: Object.freeze([0, 1]), expected: 'NE' }),
  Object.freeze({ name: '-real', vector: Object.freeze([-1, 0]), expected: 'SE' }),
  Object.freeze({ name: '-imag', vector: Object.freeze([0, -1]), expected: 'SW' }),
]);

function multiplyMatrix(left, right) {
  return left.map((row, y) => right[0].map((_, x) => (
    row.reduce((sum, value, index) => sum + value * right[index][x], 0)
  )));
}

function transpose(matrix) {
  return matrix[0].map((_, x) => matrix.map((row) => row[x]));
}

function applyMatrix(matrix, vector) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function determinant2(matrix) {
  return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
}

function nearlyEqual(left, right, epsilon = EPSILON) {
  return Math.abs(left - right) <= epsilon;
}

function matrixNearlyEqual(left, right, epsilon = EPSILON) {
  return left.every((row, y) => row.every((value, x) => nearlyEqual(value, right[y][x], epsilon)));
}

function quadrant([x, y]) {
  if (x < 0 && y > 0) return 'NW';
  if (x > 0 && y > 0) return 'NE';
  if (x > 0 && y < 0) return 'SE';
  if (x < 0 && y < 0) return 'SW';
  return 'axis';
}

function verifyCrossTransform() {
  const identity = [[1, 0], [0, 1]];
  const dtD = multiplyMatrix(transpose(D_CROSS), D_CROSS);
  const dSquared = multiplyMatrix(D_CROSS, D_CROSS);
  const mapping = REFERENCE_STATES.map((state) => {
    const diagonal = applyMatrix(D_CROSS, state.vector);
    const returned = applyMatrix(D_CROSS, diagonal);
    return {
      state: state.name,
      reference: state.vector,
      diagonal,
      screenQuadrant: quadrant(diagonal),
      expectedQuadrant: state.expected,
      returned,
      returnError: Math.hypot(returned[0] - state.vector[0], returned[1] - state.vector[1]),
    };
  });

  const checks = {
    normPreserved: matrixNearlyEqual(dtD, identity),
    orientationReversed: nearlyEqual(determinant2(D_CROSS), -1),
    involution: matrixNearlyEqual(dSquared, identity),
    canonicalMap: mapping.every((entry) => entry.screenQuadrant === entry.expectedQuadrant),
    exactReturn: mapping.every((entry) => entry.returnError <= EPSILON),
  };

  return {
    candidateStatus: 'coordinate-transform-hypothesis-not-definition-of-M',
    unknownOperator: 'C_ref = T_M(C_h)',
    cycle: ['+real', '+imag', '-real', '-imag'],
    matrix: D_CROSS,
    determinant: determinant2(D_CROSS),
    transposeTimesMatrix: dtD,
    matrixSquared: dSquared,
    mapping,
    checks,
    ok: Object.values(checks).every(Boolean),
  };
}

if (require.main === module) {
  const report = verifyCrossTransform();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

module.exports = {
  D_CROSS,
  REFERENCE_STATES,
  applyMatrix,
  determinant2,
  multiplyMatrix,
  verifyCrossTransform,
};
