'use strict';

const publicPackageName = '@nossen/freeland-bros';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/freeland-bros-nossen',
  publicPackageName,
  version: '2.0.4',
  loadPublicPackage,
};
