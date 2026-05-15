import assert from "node:assert/strict";
import test from "node:test";
import {
  applySpinResult,
  buildDriveManifest,
  buildInvocationPack,
  buildRevenueSplit,
  createSeededRng,
  pickPhotoForMontage,
  resolveSpin,
  spinWithRng,
  type CasinoSession,
} from "./casino.ts";

test("resolveSpin pays a jackpot when all reels show A11", () => {
  const result = resolveSpin(["a11", "a11", "a11"], 20);

  assert.equal(result.tier, "jackpot");
  assert.equal(result.comboName, "AlphaOnze jackpot");
  assert.equal(result.payout, 360);
  assert.equal(result.reels.map((symbol) => symbol.id).join(","), "a11,a11,a11");
});

test("applySpinResult debits the stake and credits the payout", () => {
  const session: CasinoSession = {
    credits: 100,
    history: [],
    gallery: [],
    updatedAt: "2026-04-29T10:00:00.000Z",
  };
  const result = resolveSpin(["mecha", "mecha", "nova"], 20, "2026-04-29T10:01:00.000Z");

  const next = applySpinResult(session, result);

  assert.equal(result.tier, "pair");
  assert.equal(result.payout, 60);
  assert.equal(next.credits, 140);
  assert.equal(next.history.length, 1);
  assert.equal(next.gallery.length, 1);
  assert.equal(next.gallery[0].kind, "image");
});

test("seeded rng produces deterministic spin reels", () => {
  const first = spinWithRng(10, createSeededRng("alphaonze"));
  const second = spinWithRng(10, createSeededRng("alphaonze"));

  assert.deepEqual(
    first.reels.map((symbol) => symbol.id),
    second.reels.map((symbol) => symbol.id)
  );
  assert.equal(first.stake, 10);
});

test("invocation pack and Drive manifest describe the generated casino assets", () => {
  const result = resolveSpin(["a11", "a11", "a11"], 25, "2026-04-29T10:02:00.000Z");
  const pack = buildInvocationPack(result);
  const manifest = buildDriveManifest({
    session: {
      credits: 435,
      history: [result],
      gallery: [],
      updatedAt: "2026-04-29T10:03:00.000Z",
    },
    pack,
  });

  assert.equal(pack.videoScenes.length, 4);
  assert.match(pack.imagePrompt, /AlphaOnze/i);
  assert.match(manifest.fileName, /^alphaonze-casino-2026-04-29/);
  assert.equal(manifest.assets.length, 3);
  assert.equal(manifest.assets[0].type, "json");
});

test("photo pool selection only picks from user-granted photos", () => {
  const photos = [
    { id: "p1", name: "portrait.png", objectUrl: "blob:portrait", addedAt: "2026-04-29T10:00:00.000Z" },
    { id: "p2", name: "city.png", objectUrl: "blob:city", addedAt: "2026-04-29T10:01:00.000Z" },
    { id: "p3", name: "logo.png", objectUrl: "blob:logo", addedAt: "2026-04-29T10:02:00.000Z" },
  ];

  const picked = pickPhotoForMontage(photos, createSeededRng("jackpot-photo"));

  assert.ok(picked);
  assert.ok(photos.some((photo) => photo.id === picked?.id));
  assert.equal(
    pickPhotoForMontage([], createSeededRng("jackpot-photo")),
    null
  );
});

test("revenue split keeps pack revenue at 50/50 before processor fees", () => {
  const split = buildRevenueSplit(1000, "eur");

  assert.equal(split.creatorAmountCents, 500);
  assert.equal(split.platformAmountCents, 500);
  assert.equal(split.creatorShareBps, 5000);
  assert.equal(split.platformShareBps, 5000);
  assert.equal(split.stripeMode, "connect_destination_charge");
});
