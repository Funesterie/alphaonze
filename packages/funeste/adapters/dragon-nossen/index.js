'use strict';

const publicPackageName = '@nossen/dragon';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/dragon-nossen',
  publicPackageName,
  version: '2.0.2',
  loadPublicPackage,
};
