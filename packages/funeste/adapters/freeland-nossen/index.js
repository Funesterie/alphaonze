'use strict';

const publicPackageName = '@nossen/freeland';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/freeland-nossen',
  publicPackageName,
  version: '2.0.2',
  loadPublicPackage,
};
