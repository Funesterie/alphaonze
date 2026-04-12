import * as React from "react";
import {
  SLOT_AMBIENT_MEDIA,
  SLOT_FEATURE_MEDIA,
  SLOT_INTRO_MEDIA,
  getSlotGridSymbolAtIndex,
  getSlotDisplaySymbolId,
  getSlotSymbolMeta,
  type SlotFeatureKey,
} from "../catalog";
import { formatCredits } from "../../../lib/casinoRoomState";
import type { CasinoProfile, CasinoSpin } from "../../../lib/casinoApi";

type SlotsFeatureMedia = (typeof SLOT_INTRO_MEDIA | typeof SLOT_AMBIENT_MEDIA | (typeof SLOT_FEATURE_MEDIA)[SlotFeatureKey]);

type SlotsSideRailProps = {
  profile: CasinoProfile;
  mediaReady: boolean;
  featureMedia: SlotsFeatureMedia;
  slotIntroPlayed: boolean;
  isAlertFeatureActive: boolean;
  featureVideoRef: { current: HTMLVideoElement | null };
  lastSpin: CasinoSpin | null;
  recapGrid?: string[][] | null;
  onMarkSlotsIntroPlayed: () => void;
  onRequestMediaPlayback?: () => void;
};

function isRenderableGrid(grid: string[][] | null | undefined, spin: CasinoSpin) {
  return Array.isArray(grid)
    && grid.length === spin.rowCount
    && grid.every((row) => Array.isArray(row) && row.length === spin.reelCount);
}

function pickDisplaySymbolId(
  fallbackSymbolId: string,
  symbols: string[],
) {
  const nonJokerSymbols = symbols
    .filter((symbolId) => symbolId && symbolId !== "JOKER")
    .map((symbolId) => getSlotDisplaySymbolId(symbolId));
  if (!nonJokerSymbols.length) return fallbackSymbolId;

  const counts = new Map<string, number>();
  nonJokerSymbols.forEach((symbolId) => {
    counts.set(symbolId, Number(counts.get(symbolId) || 0) + 1);
  });

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || fallbackSymbolId;
}

function resolveWinTrail(spin: CasinoSpin, win: CasinoSpin["wins"][number], grid: string[][]) {
  const trailSymbols = win.indexes.map((index) => getSlotGridSymbolAtIndex(grid, spin.reelCount, index) || win.symbol);
  const displaySymbolId = pickDisplaySymbolId(win.symbol, trailSymbols);
  const displayMeta = getSlotSymbolMeta(displaySymbolId);
  const displayLabel = displayMeta.label || win.label;
  const trail = trailSymbols.map((symbolId, trailIndex) => {
    const meta = getSlotSymbolMeta(symbolId);
    return {
      index: win.indexes[trailIndex],
      symbolId,
      meta,
      isWild: symbolId === "JOKER" && displaySymbolId !== "JOKER",
    };
  });

  return {
    trail,
    displayMeta,
    displayLabel,
    wildCount: trail.filter((entry) => entry.isWild).length,
  };
}

export default function SlotsSideRail({
  profile,
  mediaReady,
  featureMedia,
  slotIntroPlayed,
  isAlertFeatureActive,
  featureVideoRef,
  lastSpin,
  recapGrid = null,
  onMarkSlotsIntroPlayed,
  onRequestMediaPlayback,
}: SlotsSideRailProps) {
  void profile;
  void mediaReady;
  void featureMedia;
  void slotIntroPlayed;
  void isAlertFeatureActive;
  void featureVideoRef;
  void onMarkSlotsIntroPlayed;
  void onRequestMediaPlayback;

  return (
    <aside className="casino-side-rail casino-side-rail--slots">
      {lastSpin ? (
        <section className="casino-panel">
          <div className="casino-panel__header">
            <span className="casino-chip">Dernier spin</span>
            <h3>Alignements</h3>
          </div>
          <div className="casino-win-list">
            {lastSpin.wins.length ? (
              lastSpin.wins.map((win) => {
                const sourceGrid = isRenderableGrid(recapGrid, lastSpin)
                  ? recapGrid
                  : lastSpin.bonus?.triggered && isRenderableGrid(lastSpin.bonus.openingGrid, lastSpin)
                    ? lastSpin.bonus.openingGrid
                    : lastSpin.grid;
                const resolvedWin = resolveWinTrail(lastSpin, win, sourceGrid);
                return (
                  <article key={`${win.lineIndex}-${win.symbol}-${win.indexes.join("-")}`} className="casino-win-entry">
                    <div className="casino-win-entry__summary">
                      <img className="casino-paytable__symbol-art" src={resolvedWin.displayMeta.image} alt="" aria-hidden="true" />
                      <div className="casino-win-entry__copy">
                        <strong>{resolvedWin.displayLabel}</strong>
                        <span>
                          Ligne {win.lineIndex + 1} · {win.matchCount} symboles
                        </span>
                        {resolvedWin.wildCount ? (
                          <span className="casino-win-entry__note">
                            {resolvedWin.wildCount} joker{resolvedWin.wildCount > 1 ? "s" : ""} wild complete{resolvedWin.wildCount > 1 ? "nt" : ""} la ligne
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <b>+{formatCredits(win.payout)}</b>
                    <div className="casino-win-entry__trail" aria-label={`Symboles de la ligne ${win.lineIndex + 1}`}>
                      {resolvedWin.trail.map((entry, trailIndex) => (
                        <div
                          key={`${win.lineIndex}-${entry.index}-${trailIndex}`}
                          className={`casino-win-entry__tile ${entry.isWild ? "is-wild" : ""}`}
                        >
                          <img className="casino-paytable__symbol-art" src={entry.meta.image} alt="" aria-hidden="true" />
                          <span>{entry.meta.label}</span>
                          {entry.isWild ? <small>Wild</small> : null}
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="casino-history-empty">Le dernier spin n’a valide aucune ligne payante.</p>
            )}
          </div>
        </section>
      ) : null}
    </aside>
  );
}
