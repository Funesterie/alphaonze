'use strict';

const publicPackageName = '@nossen/beam';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/beam-nossen',
  publicPackageName,
  version: '2.0.1',
  loadPublicPackage,
};
