'use strict';

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function isInternalPackage(name) {
  return String(name || '').startsWith('@nossen/') || String(name || '').startsWith('@funeste/');
}

function isExactVersion(value) {
  return EXACT_VERSION.test(String(value || ''));
}

function findNonExactInternalDependencies(manifest) {
  return Object.entries(manifest.dependencies || {})
    .filter(([name, version]) => isInternalPackage(name) && !isExactVersion(version))
    .map(([dependency, declared]) => ({ package: manifest.name, dependency, declared }))
    .sort((a, b) => a.dependency.localeCompare(b.dependency));
}

function compareIndexToManifest(dependencies, packages) {
  const declared = new Set(Object.keys(dependencies || {}));
  const indexed = new Set(packages || []);
  return {
    missingFromIndex: [...declared].filter((name) => !indexed.has(name)).sort(),
    extraInIndex: [...indexed].filter((name) => !declared.has(name)).sort()
  };
}

function findRegistryDrift(declared, latest) {
  return Object.entries(declared || {})
    .filter(([name, version]) => latest[name] && latest[name] !== version)
    .map(([name, version]) => ({ name, declared: version, latest: latest[name] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildAdapterTargets(adapters, publicTargets) {
  return adapters.map((adapter) => {
    const target = publicTargets[adapter.publicPackage];
    if (!target) throw new Error(`Missing public target for ${adapter.publicPackage}`);
    return {
      privatePackage: adapter.privatePackage,
      publicPackage: adapter.publicPackage,
      sourcePrivateVersion: adapter.currentPrivateVersion,
      targetPrivateVersion: target,
      targetPublicVersion: target
    };
  }).sort((a, b) => a.privatePackage.localeCompare(b.privatePackage));
}

module.exports = {
  buildAdapterTargets,
  compareIndexToManifest,
  findNonExactInternalDependencies,
  findRegistryDrift,
  isExactVersion
};
