import assert from "node:assert/strict";
import test from "node:test";
import { downloadMediaUrl } from "./api.ts";

test("a missing Vivy asset is fetched once before the authenticated proxy fallback", async () => {
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
      if (url.includes("/api/vivy/studio/assets/missing.mp3")) {
        return new Response("missing", { status: 404 });
      }
      return new Response(new Blob(["audio"]), {
        status: 200,
        headers: { "content-disposition": 'attachment; filename="missing.mp3"' },
      });
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

  assert.equal(requests.filter(({ url }) => url.includes("/api/vivy/studio/assets/missing.mp3")).length, 1);
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /\/api\/media\/download\?url=/);
  assert.equal(requests[0].init?.credentials, "include");
});
