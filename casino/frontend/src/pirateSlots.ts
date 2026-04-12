// Pirate Slots RNG & Logic
import { randInt } from "./rng";
import * as React from "react";

export type PirateSymbolId = "PIRATE" | "CHEST" | "COIN" | "BAT" | "BLUNDERBUSS" | "MAP" | "SOLDAT";

export const pirateSymbols: { id: PirateSymbolId; weight: number; emoji: string }[] = [
  { id: "PIRATE", weight: 18, emoji: "🏴‍☠️" }, // pirate
  { id: "CHEST", weight: 15, emoji: "🧰" }, // chest
  { id: "COIN", weight: 22, emoji: "🪙" }, // coin
  { id: "BAT", weight: 14, emoji: "🦇" }, // bat
  { id: "BLUNDERBUSS", weight: 10, emoji: "🔫" }, // gun
  { id: "MAP", weight: 12, emoji: "🗺️" }, // map
  { id: "SOLDAT", weight: 9, emoji: "🛡️" } // soldat
];

export function pickWeightedPirate(): PirateSymbolId {
  const total = pirateSymbols.reduce((s, x) => s + x.weight, 0);
  let roll = randInt(1, total);
  for (const s of pirateSymbols) {
    roll -= s.weight;
    if (roll <= 0) return s.id;
  }
  return "COIN";
}

export type PirateSpinResult = {
  reels: [PirateSymbolId, PirateSymbolId, PirateSymbolId, PirateSymbolId, PirateSymbolId];
  win: number;
  payout: number;
};

export function spinPirateSlots(bet: number): PirateSpinResult {
  const reels: [PirateSymbolId, PirateSymbolId, PirateSymbolId, PirateSymbolId, PirateSymbolId] = [
    pickWeightedPirate(), pickWeightedPirate(), pickWeightedPirate(), pickWeightedPirate(), pickWeightedPirate()
  ];

  // Paytable pirate
  const [a, b, c, d, e] = reels;
  let payout = 0;

  const allSame = a === b && b === c && c === d && d === e;
  const fourSame = [a, b, c, d, e].some((v, i, arr) => arr.filter(x => x === v).length === 4);
  const threeSame = [a, b, c, d, e].some((v, i, arr) => arr.filter(x => x === v).length === 3);

  if (allSame) {
    if (a === "PIRATE") payout = bet * 50;
    else if (a === "CHEST") payout = bet * 30;
    else if (a === "COIN") payout = bet * 20;
    else payout = bet * 10;
  } else if (fourSame) {
    payout = bet * 5;
  } else if (threeSame) {
    payout = bet * 2;
  }

  const win = payout;
  return { reels, win, payout };
}
