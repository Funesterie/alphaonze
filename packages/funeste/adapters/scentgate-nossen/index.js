'use strict';

const publicPackageName = '@nossen/scentgate';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/scentgate-nossen',
  publicPackageName,
  version: '2.0.1',
  loadPublicPackage,
};
