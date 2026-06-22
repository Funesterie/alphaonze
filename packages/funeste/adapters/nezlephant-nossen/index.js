'use strict';

const publicPackageName = '@nossen/nezlephant';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/nezlephant-nossen',
  publicPackageName,
  version: '2.0.2',
  loadPublicPackage,
};
