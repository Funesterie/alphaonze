export type CasinoSymbolId =
  | "a11"
  | "mecha"
  | "nova"
  | "flux"
  | "vault"
  | "signal";

export type CasinoTier = "jackpot" | "triple" | "pair" | "spark";

export type CasinoSymbol = {
  id: CasinoSymbolId;
  label: string;
  shortLabel: string;
  color: string;
};

export type CasinoSpinResult = {
  id: string;
  reels: CasinoSymbol[];
  stake: number;
  payout: number;
  multiplier: number;
  tier: CasinoTier;
  comboName: string;
  createdAt: string;
};

export type CasinoGalleryItem = {
  id: string;
  kind: "image" | "video";
  title: string;
  prompt: string;
  createdAt: string;
  sourceSpinId: string;
};

export type CasinoUserPhoto = {
  id: string;
  name: string;
  objectUrl: string;
  addedAt: string;
};

export type CasinoSession = {
  credits: number;
  history: CasinoSpinResult[];
  gallery: CasinoGalleryItem[];
  updatedAt: string;
};

export type CasinoInvocationPack = {
  title: string;
  imagePrompt: string;
  videoPrompt: string;
  videoScenes: string[];
  palette: string[];
  symbols: string[];
};

export type CasinoDriveManifest = {
  fileName: string;
  driveLabel: string;
  createdAt: string;
  credits: number;
  lastCombo: string;
  revenueSplit: CasinoRevenueSplit;
  assets: Array<{
    type: "json" | "image-prompt" | "video-brief" | "photo-reference";
    name: string;
    content: string;
  }>;
};

export type CasinoRevenueSplit = {
  amountCents: number;
  currency: string;
  creatorShareBps: number;
  platformShareBps: number;
  creatorAmountCents: number;
  platformAmountCents: number;
  stripeMode: "connect_destination_charge";
  note: string;
};

export const CASINO_STORAGE_KEY = "a11:alphaonze-casino";
export const CASINO_STARTING_CREDITS = 250;
export const CASINO_PACK_PRICE_CENTS = 1000;

export const CASINO_SYMBOLS: CasinoSymbol[] = [
  { id: "a11", label: "A11 Core", shortLabel: "A11", color: "#67e8f9" },
  { id: "mecha", label: "Alpha Mecha", shortLabel: "MX", color: "#2dd4bf" },
  { id: "nova", label: "Nova Lens", shortLabel: "NV", color: "#facc15" },
  { id: "flux", label: "Flux Gate", shortLabel: "FX", color: "#fb7185" },
  { id: "vault", label: "Drive Vault", shortLabel: "DV", color: "#a78bfa" },
  { id: "signal", label: "Signal Forge", shortLabel: "SG", color: "#93c5fd" },
];

const SYMBOL_BY_ID = new Map<CasinoSymbolId, CasinoSymbol>(
  CASINO_SYMBOLS.map((symbol) => [symbol.id, symbol])
);

export function createDefaultCasinoSession(now = new Date().toISOString()): CasinoSession {
  return {
    credits: CASINO_STARTING_CREDITS,
    history: [],
    gallery: [],
    updatedAt: now,
  };
}

export function createSeededRng(seed: string | number) {
  const seedText = String(seed);
  let state = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    state ^= seedText.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function spinWithRng(
  stake: number,
  rng: () => number = Math.random,
  createdAt = new Date().toISOString()
) {
  const reels = Array.from({ length: 3 }, () => {
    const index = Math.min(
      CASINO_SYMBOLS.length - 1,
      Math.floor(Math.max(0, Math.min(0.999999, rng())) * CASINO_SYMBOLS.length)
    );
    return CASINO_SYMBOLS[index].id;
  });
  return resolveSpin(reels, stake, createdAt);
}

export function pickPhotoForMontage(
  photos: CasinoUserPhoto[],
  rng: () => number = Math.random
) {
  if (!photos.length) return null;
  const index = Math.min(
    photos.length - 1,
    Math.floor(Math.max(0, Math.min(0.999999, rng())) * photos.length)
  );
  return photos[index];
}

export function buildRevenueSplit(
  amountCents = CASINO_PACK_PRICE_CENTS,
  currency = "eur"
): CasinoRevenueSplit {
  const normalizedAmount = Math.max(0, Math.floor(Number(amountCents) || 0));
  const creatorAmountCents = Math.floor(normalizedAmount / 2);
  const platformAmountCents = normalizedAmount - creatorAmountCents;
  return {
    amountCents: normalizedAmount,
    currency: String(currency || "eur").toLowerCase(),
    creatorShareBps: 5000,
    platformShareBps: 5000,
    creatorAmountCents,
    platformAmountCents,
    stripeMode: "connect_destination_charge",
    note: "Revenue split for paid generation packs only. Casino credits remain fictional and are not redeemable.",
  };
}

export function resolveSpin(
  reelIds: CasinoSymbolId[],
  stake: number,
  createdAt = new Date().toISOString()
): CasinoSpinResult {
  if (reelIds.length !== 3) {
    throw new Error("A casino spin needs exactly 3 reels.");
  }

  const normalizedStake = Math.max(1, Math.floor(Number(stake) || 1));
  const reels = reelIds.map((id) => {
    const symbol = SYMBOL_BY_ID.get(id);
    if (!symbol) throw new Error(`Unknown casino symbol: ${id}`);
    return symbol;
  });
  const counts = new Map<CasinoSymbolId, number>();
  for (const symbol of reels) {
    counts.set(symbol.id, (counts.get(symbol.id) || 0) + 1);
  }
  const bestCount = Math.max(...counts.values());
  const allA11 = bestCount === 3 && reels[0].id === "a11";

  let tier: CasinoTier = "spark";
  let multiplier = 0;
  let comboName = "Signal spark";

  if (allA11) {
    tier = "jackpot";
    multiplier = 18;
    comboName = "AlphaOnze jackpot";
  } else if (bestCount === 3) {
    tier = "triple";
    multiplier = 12;
    comboName = `${reels[0].label} triple`;
  } else if (bestCount === 2) {
    const pairSymbol = reels.find((symbol) => counts.get(symbol.id) === 2);
    tier = "pair";
    multiplier = 3;
    comboName = `${pairSymbol?.label || "Alpha"} pair`;
  }

  return {
    id: `spin-${Date.parse(createdAt) || Date.now()}-${reels.map((symbol) => symbol.id).join("-")}`,
    reels,
    stake: normalizedStake,
    payout: normalizedStake * multiplier,
    multiplier,
    tier,
    comboName,
    createdAt,
  };
}

export function applySpinResult(
  session: CasinoSession,
  result: CasinoSpinResult,
  userPhoto?: CasinoUserPhoto | null
): CasinoSession {
  const credits = Math.max(0, Math.floor(session.credits - result.stake + result.payout));
  const pack = buildInvocationPack(result, userPhoto);
  const galleryItem: CasinoGalleryItem | null = result.payout > 0
    ? {
        id: `asset-${result.id}`,
        kind: result.tier === "jackpot" ? "video" : "image",
        title: result.tier === "jackpot" ? "AlphaOnze mecha jackpot montage" : result.comboName,
        prompt: result.tier === "jackpot" ? pack.videoPrompt : pack.imagePrompt,
        createdAt: result.createdAt,
        sourceSpinId: result.id,
      }
    : null;

  return {
    credits,
    history: [result, ...session.history].slice(0, 12),
    gallery: galleryItem ? [galleryItem, ...session.gallery].slice(0, 9) : session.gallery,
    updatedAt: result.createdAt,
  };
}

export function buildInvocationPack(
  result: CasinoSpinResult,
  userPhoto?: CasinoUserPhoto | null
): CasinoInvocationPack {
  const symbolLine = result.reels.map((symbol) => symbol.label).join(", ");
  const mood = result.tier === "jackpot"
    ? "full jackpot transformation, heroic neon casino energy, giant original AlphaOnze mecha"
    : "sleek casino ritual, luminous cards, custom AlphaOnze machine altar";
  const photoLine = userPhoto
    ? `Use the user-granted photo named "${userPhoto.name}" as a respectful montage reference, keeping the person or subject recognizable but transformed into original AlphaOnze casino art.`
    : "No user photo selected; create a fully original AlphaOnze visual.";

  return {
    title: `AlphaOnze Casino - ${result.comboName}`,
    imagePrompt: [
      "Original AlphaOnze casino key art.",
      `Combo: ${result.comboName}.`,
      `Symbols: ${symbolLine}.`,
      `${mood}.`,
      photoLine,
      "No licensed characters, no brand logos, cinematic lighting, sharp readable A11 iconography.",
    ].join(" "),
    videoPrompt: [
      "Create a short original AlphaOnze casino montage.",
      "Scene rhythm: ignition, symbol lock, mecha assembly, jackpot beam.",
      `Winning combo: ${result.comboName}.`,
      photoLine,
      "The style is sentai-inspired giant robot spectacle without using protected characters or names.",
    ].join(" "),
    videoScenes: [
      "A11 casino console wakes up with teal scanlines and gold win counters.",
      `The reels lock on ${result.reels.map((symbol) => symbol.shortLabel).join(" / ")} with a bass-hit flash.`,
      "Armor plates assemble into an original AlphaOnze mecha silhouette above the slot machine.",
      "Final beam forms the A11 mark, then resolves into an export-ready jackpot poster frame.",
    ],
    palette: result.reels.map((symbol) => symbol.color),
    symbols: result.reels.map((symbol) => symbol.shortLabel),
  };
}

export function buildDriveManifest(input: {
  session: CasinoSession;
  pack: CasinoInvocationPack;
  selectedPhoto?: CasinoUserPhoto | null;
}): CasinoDriveManifest {
  const createdAt = input.session.updatedAt || new Date().toISOString();
  const dateStamp = createdAt.slice(0, 10);
  const lastCombo = input.session.history[0]?.comboName || input.pack.title;
  const assets: CasinoDriveManifest["assets"] = [
    {
      type: "json",
      name: "session-manifest.json",
      content: JSON.stringify(input.session, null, 2),
    },
    {
      type: "image-prompt",
      name: "alphaonze-image-prompt.txt",
      content: input.pack.imagePrompt,
    },
    {
      type: "video-brief",
      name: "alphaonze-video-brief.txt",
      content: [input.pack.videoPrompt, ...input.pack.videoScenes.map((scene, index) => `${index + 1}. ${scene}`)].join("\n"),
    },
  ];

  if (input.selectedPhoto) {
    assets.push({
      type: "photo-reference",
      name: "user-granted-photo-reference.txt",
      content: `Selected from user-granted local photo pool: ${input.selectedPhoto.name}`,
    });
  }

  return {
    fileName: `alphaonze-casino-${dateStamp}.json`,
    driveLabel: `AlphaOnze Casino Pack - ${dateStamp}`,
    createdAt,
    credits: input.session.credits,
    lastCombo,
    revenueSplit: buildRevenueSplit(),
    assets,
  };
}

export function serializeCasinoSession(session: CasinoSession) {
  return JSON.stringify(session, null, 2);
}

export function parseCasinoSession(raw: string | null): CasinoSession {
  if (!raw) return createDefaultCasinoSession();
  try {
    const parsed = JSON.parse(raw) as Partial<CasinoSession>;
    if (
      typeof parsed.credits !== "number"
      || !Array.isArray(parsed.history)
      || !Array.isArray(parsed.gallery)
    ) {
      return createDefaultCasinoSession();
    }
    return {
      credits: Math.max(0, Math.floor(parsed.credits)),
      history: parsed.history.slice(0, 12) as CasinoSpinResult[],
      gallery: parsed.gallery.slice(0, 9) as CasinoGalleryItem[],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return createDefaultCasinoSession();
  }
}
