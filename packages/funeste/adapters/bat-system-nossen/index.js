'use strict';

const publicPackageName = '@nossen/bat-system';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/bat-system-nossen',
  publicPackageName,
  version: '2.0.2',
  loadPublicPackage,
};
