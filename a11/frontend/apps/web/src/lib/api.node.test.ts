import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { downloadMediaUrl, resolvePublicVivyMediaDownloadUrl } from "./api.ts";

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

test("a missing same-origin Vivy asset triggers a single request with no proxy fallback", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  Object.assign(globalThis, {
    location: { origin: "https://vivy.funesterie.me" },
    document: {
      createElement: () => ({ style: {}, click() {}, remove() {} }),
      body: { appendChild() {} },
    },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      return new Response("missing", { status: 404 });
    },
  });

  try {
    await downloadMediaUrl("/api/vivy/studio/assets/missing.mp3");
  } finally {
    Object.assign(globalThis, {
      fetch: originalFetch,
      document: originalDocument,
      location: originalLocation,
    });
  }

  // Only one request: the direct fetch. The authenticated proxy is not called
  // because it would resolve to the same same-origin endpoint and produce a
  // second identical 404.
  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.includes("/api/vivy/studio/assets/missing.mp3"));
  assert.equal(requests[0].init?.credentials, "include");
});

test("an external Vivy-shaped URL is fetched without API credentials", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalLocalStorage = globalThis.localStorage;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const testJwt = [
    JSON.stringify({ alg: "none" }),
    JSON.stringify({ exp: 4102444800 }),
    "signature",
  ].map((part) => Buffer.from(part).toString("base64url")).join(".");

  Object.assign(globalThis, {
    location: { origin: "https://vivy.funesterie.me" },
    localStorage: {
      getItem: (key: string) => key === "a11-auth-token"
        ? testJwt
        : null,
    },
    document: {
      createElement: () => ({ style: {}, click() {}, remove() {} }),
      body: { appendChild() {} },
    },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return new Response(new Blob(["audio"]), { status: 200 });
    },
  });

  try {
    await downloadMediaUrl("https://untrusted.example/api/vivy/studio/assets/song.mp3");
  } finally {
    Object.assign(globalThis, {
      fetch: originalFetch,
      document: originalDocument,
      location: originalLocation,
      localStorage: originalLocalStorage,
    });
  }

  assert.equal(requests.length, 1);
  assert.equal(requests[0].init?.credentials, "omit");
  assert.equal(new Headers(requests[0].init?.headers).has("Authorization"), false);
});

test("resolvePublicVivyMediaDownloadUrl recognises subdirectory asset paths like covers/ville.png", () => {
  const originalLocation = globalThis.location;
  Object.assign(globalThis, { location: { origin: "https://vivy.funesterie.me" } });

  try {
    const flat = resolvePublicVivyMediaDownloadUrl("/api/vivy/studio/assets/song.mp3");
    assert.ok(flat?.includes("/api/vivy/studio/assets/song.mp3"), "flat path must be recognised");

    const cover = resolvePublicVivyMediaDownloadUrl("/api/vivy/studio/assets/covers/ville.png");
    assert.ok(cover?.includes("/api/vivy/studio/assets/covers/ville.png"), "covers/ subdirectory must be recognised");

    // External hosts must not receive auth credentials regardless of path shape.
    const external = resolvePublicVivyMediaDownloadUrl(
      "https://untrusted.example/api/vivy/studio/assets/covers/ville.png",
    );
    // resolvePublicVivyMediaDownloadUrl may return the URL but downloadPublicMediaUrl
    // will fetch it with credentials:'omit' since it is not an API origin.
    // The important invariant is it does NOT return null (so the direct fetch is
    // attempted) — and no auth headers are attached (verified in the cross-origin test).
    assert.ok(external !== null, "external subdirectory URL should be attempted directly (no auth)");
  } finally {
    Object.assign(globalThis, { location: originalLocation });
  }
});

