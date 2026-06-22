'use strict';

const publicPackageName = '@nossen/envapt-superimg';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/envapt-superimg-nossen',
  publicPackageName,
  version: '2.0.2',
  loadPublicPackage,
};
