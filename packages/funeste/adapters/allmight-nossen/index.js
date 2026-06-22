'use strict';

const publicPackageName = '@nossen/allmight';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/allmight-nossen',
  publicPackageName,
  version: '2.0.1',
  loadPublicPackage,
};
