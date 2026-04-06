"use strict";
// ROME-TAG: 0xF1CEBF
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROME_TAG_COMMENT_PREFIX = exports.ROME_TAG_VERSION = void 0;
exports.normalizeRomePath = normalizeRomePath;
exports.extractExt = extractExt;
exports.fnv1a24 = fnv1a24;
exports.computeRomeTag = computeRomeTag;
exports.toRomeTagHex = toRomeTagHex;
exports.fromRomeTagHex = fromRomeTagHex;
exports.makeRomeTagRecord = makeRomeTagRecord;
exports.getOrCreateRomeTag = getOrCreateRomeTag;
exports.buildRomeTagComment = buildRomeTagComment;
exports.parseRomeTagComment = parseRomeTagComment;
const path = __importStar(require("path"));
exports.ROME_TAG_VERSION = 1;
exports.ROME_TAG_COMMENT_PREFIX = '// ROME-TAG:';
function normalizeRomePath(p) {
    let normalized = p.replace(/\\/g, '/');
    normalized = normalized.replace(/^\.?\//, '');
    normalized = normalized.replace(/\/+/g, '/');
    return normalized;
}
function extractExt(p) {
    const ext = path.extname(p);
    return ext ? ext.slice(1) : undefined;
}
function fnv1a24(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return hash & 0xffffff;
}
function computeRomeTag(meta) {
    const type = meta.type || 'file';
    const p = normalizeRomePath(meta.path);
    const input = `${type}|${p}`;
    return fnv1a24(input);
}
function toRomeTagHex(tag) {
    return '0x' + (tag & 0xffffff).toString(16).padStart(6, '0').toUpperCase();
}
function fromRomeTagHex(hex) {
    const m = /^0x([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (!m)
        return null;
    return parseInt(m[1], 16) & 0xffffff;
}
function makeRomeTagRecord(meta, date = new Date()) {
    var _a;
    const pathNorm = normalizeRomePath(meta.path);
    const ext = (_a = meta.ext) !== null && _a !== void 0 ? _a : extractExt(pathNorm);
    const tag = computeRomeTag({ ...meta, path: pathNorm, ext });
    return {
        type: meta.type,
        path: pathNorm,
        ext,
        tag,
        tagHex: toRomeTagHex(tag),
        savedAt: date.toISOString(),
        version: exports.ROME_TAG_VERSION,
    };
}
function getOrCreateRomeTag(index, meta, date = new Date()) {
    const pathNorm = normalizeRomePath(meta.path);
    const existing = index[pathNorm];
    if (existing)
        return existing;
    const record = makeRomeTagRecord({ ...meta, path: pathNorm }, date);
    index[pathNorm] = record;
    return record;
}
function buildRomeTagComment(tag) {
    return `${exports.ROME_TAG_COMMENT_PREFIX} ${toRomeTagHex(tag)}`;
}
function parseRomeTagComment(line) {
    const idx = line.indexOf(exports.ROME_TAG_COMMENT_PREFIX);
    if (idx === -1)
        return null;
    const rest = line.slice(idx + exports.ROME_TAG_COMMENT_PREFIX.length).trim();
    const maybeTag = rest.split(/\s+/)[0];
    return fromRomeTagHex(maybeTag);
}
//# sourceMappingURL=rome-tag.js.map