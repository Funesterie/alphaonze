'use strict';

const publicPackageName = '@nossen/spyder';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/spyder-nossen',
  publicPackageName,
  version: '2.0.2',
  loadPublicPackage,
};
