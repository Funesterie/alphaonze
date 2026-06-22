'use strict';

const publicPackageName = '@nossen/envaptex';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/envaptex-nossen',
  publicPackageName,
  version: '2.0.1',
  loadPublicPackage,
};
