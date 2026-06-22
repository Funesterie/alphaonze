'use strict';

const publicPackageName = '@nossen/dragon-contracts';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/dragon-contracts-nossen',
  publicPackageName,
  version: '2.0.1',
  loadPublicPackage,
};
