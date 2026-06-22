'use strict';

const publicPackageName = '@nossen/scream';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/scream-nossen',
  publicPackageName,
  version: '2.0.2',
  loadPublicPackage,
};
