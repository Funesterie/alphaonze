'use strict';

const publicPackageName = '@nossen/morphing';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/morphing-nossen',
  publicPackageName,
  version: '2.1.0',
  loadPublicPackage,
};
