"use strict";

module.exports = {
  privatePackage: "@funeste/spyder-graph-nossen",
  publicPackage: "@nossen/spyder",
  publicVersion: "2.0.2",
  loadPublicPackage() {
    return require("@nossen/spyder");
  }
};
