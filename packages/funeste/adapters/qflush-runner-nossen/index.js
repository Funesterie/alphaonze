'use strict';

const publicPackageName = '@nossen/qflush-runner';

function loadPublicPackage() {
  return require(publicPackageName);
}

module.exports = {
  name: '@funeste/qflush-runner-nossen',
  publicPackageName,
  version: '2.0.2',
  loadPublicPackage,
};
