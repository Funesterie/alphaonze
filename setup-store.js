"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupStore = void 0;
const electron_store_1 = __importDefault(require("electron-store"));
const app_paths_1 = require("../app-paths");
const setupStore = (name, schema, defaults) => {
    return new electron_store_1.default({
        name,
        cwd: app_paths_1.AppPaths.stores,
        fileExtension: 'store',
        watch: true,
        // @ts-expect-error The schema types from typebox don't seem to play well
        // with the types expected by electron-store.
        schema: schema.properties,
        defaults,
        // This is done to prevent manual editing of the stored json
        serialize: (value) => Buffer.from(JSON.stringify(value), 'utf-8').toString('base64'),
        deserialize: (value) => JSON.parse(Buffer.from(value, 'base64').toString('utf-8')),
    });
};
exports.setupStore = setupStore;
//# sourceMappingURL=setup-store.js.map