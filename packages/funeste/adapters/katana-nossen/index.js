'use strict';

const publicPackageName = '@nossen/katana';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/katana-nossen',
  publicPackageName,
  version: '2.0.0',
  loadPublicPackage,
};
