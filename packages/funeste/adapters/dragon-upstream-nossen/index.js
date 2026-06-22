'use strict';

const publicPackageName = '@nossen/dragon-upstream';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/dragon-upstream-nossen',
  publicPackageName,
  version: '2.0.2',
  loadPublicPackage,
};
