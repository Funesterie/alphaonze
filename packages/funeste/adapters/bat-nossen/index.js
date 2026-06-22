'use strict';

const publicPackageName = '@nossen/bat';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/bat-nossen',
  publicPackageName,
  version: '2.0.2',
  loadPublicPackage,
};
