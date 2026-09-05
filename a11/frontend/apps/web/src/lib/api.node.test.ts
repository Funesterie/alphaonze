import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { downloadMediaUrl } from "./api.ts";

const apiSource = fs.readFileSync(new URL("./api.ts", import.meta.url), "utf8");

test("D40 API calls without an explicit mode use V10 Boom", () => {
  assert.match(
    apiSource,
    /const requestedMode: DoubleHarmonicProcessMode = options\?\.mode \|\| 'v10boom';/,
  );
  assert.match(
    apiSource,
    /const endpoint = requestedMode === 'v10boom'\s*\?\s*'\/api\/double-harmonic\/v10boom\/process'/,
  );
});

// --- Tests for downloadMediaUrl HTTP error handling ---
// These tests verify that HTTP errors (401, 403, 404) are NEVER silently transformed into success.

test("downloadMediaUrl throws on 404 for missing resource", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalLocalStorage = globalThis.localStorage;

  Object.assign(globalThis, {
    location: { origin: "https://vivy.funesterie.me" },
    localStorage: { getItem: () => null, removeItem: () => {} },
    document: {
      createElement: () => ({ style: {}, click() {}, remove() {} }),
      body: { appendChild() {}, removeChild() {} },
    },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} } as any,
    fetch: async () => new Response("not found", { status: 404, statusText: "Not Found" }),
  });

  try {
    await assert.rejects(
      downloadMediaUrl("/api/vivy/studio/assets/missing.mp3"),
      /Resource download failed/,
    );
  } finally {
    Object.assign(globalThis, {
      fetch: originalFetch,
      document: originalDocument,
      location: originalLocation,
      localStorage: originalLocalStorage,
    });
  }
});

test("downloadMediaUrl throws on 401 Unauthorized", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalLocalStorage = globalThis.localStorage;

  Object.assign(globalThis, {
    location: { origin: "https://vivy.funesterie.me" },
    localStorage: { getItem: () => null, removeItem: () => {} },
    document: {
      createElement: () => ({ style: {}, click() {}, remove() {} }),
      body: { appendChild() {}, removeChild() {} },
    },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} } as any,
    fetch: async () => new Response("unauthorized", { status: 401, statusText: "Unauthorized" }),
  });

  try {
    // 401 may trigger auth invalidation, but should still throw
    await assert.rejects(
      downloadMediaUrl("/api/vivy/studio/assets/private.mp3"),
      /.*/,
    );
  } finally {
    Object.assign(globalThis, {
      fetch: originalFetch,
      document: originalDocument,
      location: originalLocation,
      localStorage: originalLocalStorage,
    });
  }
});

test("downloadMediaUrl throws on 403 Forbidden", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalLocalStorage = globalThis.localStorage;

  Object.assign(globalThis, {
    location: { origin: "https://vivy.funesterie.me" },
    localStorage: { getItem: () => null, removeItem: () => {} },
    document: {
      createElement: () => ({ style: {}, click() {}, remove() {} }),
      body: { appendChild() {}, removeChild() {} },
    },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} } as any,
    fetch: async () => new Response("forbidden", { status: 403, statusText: "Forbidden" }),
  });

  try {
    await assert.rejects(
      downloadMediaUrl("/api/vivy/studio/assets/restricted.mp3"),
      /Resource download failed/,
    );
  } finally {
    Object.assign(globalThis, {
      fetch: originalFetch,
      document: originalDocument,
      location: originalLocation,
      localStorage: originalLocalStorage,
    });
  }
});

test("downloadMediaUrl succeeds with valid audio (200 OK)", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalLocalStorage = globalThis.localStorage;
  let downloadTriggered = false;

  Object.assign(globalThis, {
    location: { origin: "https://vivy.funesterie.me" },
    localStorage: { getItem: () => null, removeItem: () => {} },
    document: {
      createElement: (tag: string) => {
        if (tag === 'a') {
          return {
            style: {},
            href: '',
            download: '',
            click() { downloadTriggered = true; },
            remove() {},
          };
        }
        return { style: {}, click() {}, remove() {} };
      },
      body: { appendChild() {}, removeChild() {} },
    },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} } as any,
    fetch: async () => {
      const blob = new Blob(["audio data"], { type: 'audio/mpeg' });
      return new Response(blob, {
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="test.mp3"' },
      });
    },
  });

  try {
    // Should not throw on success
    await downloadMediaUrl("/api/vivy/studio/assets/test.mp3");
    assert.equal(downloadTriggered, true, "download should be triggered");
  } finally {
    Object.assign(globalThis, {
      fetch: originalFetch,
      document: originalDocument,
      location: originalLocation,
      localStorage: originalLocalStorage,
    });
  }
});

test("downloadMediaUrl handles empty file (200 OK with empty blob)", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalLocalStorage = globalThis.localStorage;
  let downloadTriggered = false;

  Object.assign(globalThis, {
    location: { origin: "https://vivy.funesterie.me" },
    localStorage: { getItem: () => null, removeItem: () => {} },
    document: {
      createElement: (tag: string) => {
        if (tag === 'a') {
          return {
            style: {},
            href: '',
            download: '',
            click() { downloadTriggered = true; },
            remove() {},
          };
        }
        return { style: {}, click() {}, remove() {} };
      },
      body: { appendChild() {}, removeChild() {} },
    },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} } as any,
    fetch: async () => new Response(new Blob([]), { status: 200 }),
  });

  try {
    await downloadMediaUrl("/api/vivy/studio/assets/empty.mp3");
    assert.equal(downloadTriggered, true, "download should be triggered even for empty file");
  } finally {
    Object.assign(globalThis, {
      fetch: originalFetch,
      document: originalDocument,
      location: originalLocation,
      localStorage: originalLocalStorage,
    });
  }
});

