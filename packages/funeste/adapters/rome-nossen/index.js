'use strict';

const publicPackageName = '@nossen/rome';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/rome-nossen',
  publicPackageName,
  version: '2.0.3',
  loadPublicPackage,
};
