'use strict';

const ZEN_CANON = Object.freeze({
  id: 'format.zen.container',
  label: 'ZEN - Zero-Exposed NEZ archive',
  shortDefinition: 'ZEN is an opaque encrypted multiload corpus container built as NEZ inverse.',
  canonicalDefinition: 'ZEN is a reverse zip: it does not only compress files; it hides the order in which they exist.',
  guardrails: [
    'Do not describe ZEN as a renamed zip.',
    'Do not expose file names, file count, types, routes, or reconstruction order in the public header.',
    'Do not store keys inside .zen files or repositories.',
    'Use standard audited cryptography for the encryption layer.',
    'Keep research claims separate from mathematical proof claims.'
  ],
  publicHeaderPolicy: {
    visibility: 'minimal-public',
    exposes: ['format', 'version', 'mode', 'codec', 'cipher', 'kdf', 'checksums'],
    hides: ['fileCount', 'fileNames', 'payloadTypes', 'reconstructionOrder', 'corpusIndex', 'routingMap']
  },
  spatialImaginaryMap: {
    summary: 'Prime numbers are the real projection; ZEN uses the fuller imaginary map.',
    axes: ['R', '-R', '+i', '-i', '+j', '-j', '+k', '-k'],
    zoneModel: 'Z_m(n) = zone induced by m imaginary axes or symbols',
    ring: 'pi acts as a circular ring / Stargate between the map and the reconstruction zone',
    passage: ['fragment', 'imaginary coordinates', 'ring / zone', 'reconstruction order', 'final payload']
  },
  pipeline: [
    ['files', 'normalize into', 'corpus'],
    ['corpus', 'projects into', 'RGBA cubes / fragment map'],
    ['fragment map', 'routes through', 'imaginary coordinates'],
    ['zone key', 'reconstructs', 'order and payload relations'],
    ['encrypted payload', 'stores', 'manifest, shards and graph hints']
  ],
  neo4jRelations: [
    ['ZEN', 'USES', 'Spatial Imaginary Map'],
    ['Qflush RGBA Cube', 'ROUTES', 'ZEN'],
    ['NUMA', 'ENCODES', 'Magenta Line'],
    ['Magenta Line', 'MAPS', 'Prime/Composite/Gaps']
  ]
});

function cloneCanon() {
  return JSON.parse(JSON.stringify(ZEN_CANON));
}

module.exports = {
  ZEN_CANON,
  cloneCanon
};
