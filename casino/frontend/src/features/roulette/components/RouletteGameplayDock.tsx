import React from "react";
import PirateInspector from "../../../PirateInspector";
import { formatCredits } from "../../../lib/casinoRoomState";
import type { RouletteRoom } from "../../../lib/casinoApi";
import type { SelectedBet } from "./AtsRouletteBoard";
import RouletteResultPreview from "./RouletteResultPreview";
import {
  ROULETTE_AMOUNT_PRESETS,
  getBetLabel,
  type RouletteAnimationState,
} from "../model";

type ActiveRouletteBet = {
  betType: string;
  betValue: string;
  label: string;
  amount: number;
};

type WheelPocket = {
  number: number;
  color: string;
  angle: number;
};

type RouletteGameplayDockProps = {
  room: RouletteRoom | null;
  amount: number;
  selectedBet: SelectedBet;
  working: boolean;
  infoTab: "mises" | "participants" | "historique";
  animation: RouletteAnimationState;
  wheelPockets: WheelPocket[];
  onAmountChange: (amount: number) => void;
  onSubmitBet: () => void;
  onClearBets: () => void;
  onInfoTabChange: (tab: "mises" | "participants" | "historique") => void;
  chipImageSrc: string;
  wheelBaseImageSrc: string;
  wheelTurntableImageSrc: string;
  historyPreviewImageSrc: string;
  canSubmitBet: boolean;
  hideBoard?: boolean;
};

export default function RouletteGameplayDock({
  room,
  amount,
  selectedBet,
  working,
  infoTab,
  animation,
  wheelPockets,
  onAmountChange,
  onSubmitBet,
  onClearBets,
  onInfoTabChange,
  chipImageSrc,
  wheelBaseImageSrc,
  wheelTurntableImageSrc,
  historyPreviewImageSrc,
  canSubmitBet,
  hideBoard = false,
}: RouletteGameplayDockProps) {
  const latestResult = room?.recentResults?.[0] || null;
  const activeBets: ActiveRouletteBet[] = [];
  const activeBetAmounts = new Map<string, number>();
  for (const bet of room?.round.myBets || []) {
    const key = `${bet.betType}::${bet.betValue}`;
    activeBetAmounts.set(key, (activeBetAmounts.get(key) || 0) + bet.amount);
  }

  for (const [key, totalAmount] of activeBetAmounts.entries()) {
    const [betType, betValue] = key.split("::");
    activeBets.push({
      betType,
      betValue,
      label: getBetLabel(betType, betValue),
      amount: totalAmount,
    });
  }
  const activeTotal = activeBets.reduce((sum, bet) => sum + bet.amount, 0);
  const hasActiveBets = activeBets.length > 0;

  return (
    <div className="casino-stage-sidebar casino-stage-sidebar--roulette">
      <div className={`casino-command-dock casino-command-dock--roulette ${hideBoard ? "is-board-hidden" : ""}`}>
        <div className="casino-roulette-main-layout">
          {!hideBoard ? (
            <div className="casino-roulette-main-layout__left">
              <div className="casino-roulette-board casino-roulette-board--compact casino-roulette-board--ats" />
            </div>
          ) : null}

          <div className="casino-roulette-main-layout__right">
            <div className="casino-roulette-bet-recap" aria-live="polite">
              <div className="casino-roulette-bet-recap__header">
                <span className="casino-chip">Mises actives</span>
                <strong>{activeBets.length ? `${activeBets.length} position(s)` : "Aucune mise"}</strong>
              </div>
              <div className="casino-roulette-bet-recap__list">
                {activeBets.length ? (
                  activeBets.map((bet) => (
                    <article key={`${bet.betType}-${bet.betValue}`} className="casino-roulette-bet-recap__entry">
                      <span>{bet.label}</span>
                      <strong>{formatCredits(bet.amount)}</strong>
                    </article>
                  ))
                ) : (
                  <p className="casino-history-empty">Ajoute des mises depuis le tapis.</p>
                )}
              </div>
              <div className="casino-roulette-bet-recap__footer">
                <span>Total</span>
                <strong>{formatCredits(activeTotal)}</strong>
              </div>
            </div>
            <div
              className="casino-roulette-console"
              style={{
                ["--roulette-chip-art" as string]: `url("${chipImageSrc}")`,
              }}
            >
              <div className="casino-roulette-console__wheel-shell">
                <img
                  className="casino-roulette-console__wheel-base"
                  src={wheelBaseImageSrc}
                  alt=""
                  aria-hidden="true"
                />
                <div
                  className="casino-roulette-console__wheel"
                  style={{ transform: `translate(-50%, -50%) rotate(${animation.wheelRotation}deg)` }}
                >
                  <img
                    className="casino-roulette-wheel__plateau casino-roulette-wheel__plateau--turntable"
                    src={wheelTurntableImageSrc}
                    alt=""
                    aria-hidden="true"
                  />
                  {wheelPockets.map((pocket) => (
                    <div
                      key={`console-${pocket.number}`}
                      className={`casino-roulette-pocket is-${pocket.color} ${animation.highlightedNumber === pocket.number ? "is-winning" : ""}`}
                      style={{ ["--pocket-angle" as string]: `${pocket.angle}deg` }}
                    >
                      <span>{pocket.number}</span>
                    </div>
                  ))}
                </div>

                <div
                  className="casino-roulette-orb casino-roulette-orb--console"
                  style={{
                    left: `${animation.ballX}%`,
                    top: `${animation.ballY}%`,
                    transform: `translate(-50%, -50%) scale(${0.94 + (animation.fireScale - 1) * 0.4})`,
                  }}
                >
                  <span
                    className="casino-roulette-orb__trail"
                    style={{ transform: `translate(-50%, -50%) rotate(${animation.fireRotation}deg)` }}
                  />
                </div>

                <div className="casino-roulette-console__chip-stack" aria-hidden="true">
                  <img src={chipImageSrc} alt="" />
                  <img src={chipImageSrc} alt="" />
                </div>
              </div>

              <div className="casino-roulette-console__summary">
                <span className="casino-chip">Roulette gameplay</span>
                <strong>{selectedBet ? `Cible: ${selectedBet.label}` : "Choisis une poche ou une mise rapide"}</strong>
                <p>La roue tournante, la bille et les infos critiques restent ici pour une lecture nette sur grand ecran comme sur telephone.</p>
                <div className="casino-roulette-console__stats">
                  <span>
                    <small>Dernier tir</small>
                    <b className={latestResult ? `is-${latestResult.winningColor}` : ""}>
                      {latestResult ? latestResult.winningNumber : "--"}
                    </b>
                  </span>
                  <span>
                    <small>Joueurs</small>
                    <b>{room?.round.playerCount || 0}</b>
                  </span>
                </div>
              </div>
            </div>
            <div className="casino-chip-row">
              <span className="casino-chip casino-chip--token"><img src={chipImageSrc} alt="" />Pot {formatCredits(room?.round.totalPot || 0)}</span>
              <span className="casino-chip">Joueurs {room?.round.playerCount || 0}</span>
              <span className="casino-chip">{selectedBet ? selectedBet.label : "Aucune cible"}</span>
            </div>

            <div className="casino-command-dock__actions casino-command-dock__actions--roulette">
              <button
                type="button"
                className="casino-primary-button"
                onClick={onSubmitBet}
                disabled={!canSubmitBet}
              >
                Miser {selectedBet ? `sur ${selectedBet.label}` : ""}
              </button>
              <button
                type="button"
                className="casino-ghost-button"
                onClick={onClearBets}
                disabled={working || !hasActiveBets}
              >
                Effacer
              </button>
            </div>

            <PirateInspector
              title="Carnet de tir"
              eyebrow="Roulette"
              activeTab={infoTab}
              onChange={(tabId) => onInfoTabChange(tabId as typeof infoTab)}
              tabs={[
                {
                  id: "mises",
                  label: "Mes mises",
                  badge: room?.round.myBets?.length || 0,
                  caption: "Lecture compacte du tour courant.",
                  content: (
                    <div className="casino-history-list">
                      {(room?.round.myBets || []).length ? (
                        room?.round.myBets.map((bet) => (
                          <article key={bet.id} className="casino-history-entry">
                            <div>
                              <span>{getBetLabel(bet.betType, bet.betValue)}</span>
                              <strong className="casino-token-inline"><img src={chipImageSrc} alt="" />{formatCredits(bet.amount)}</strong>
                            </div>
                            <div className={bet.payout > 0 ? "is-positive" : ""}>
                              {bet.payout > 0 ? `+${formatCredits(bet.payout)}` : "en attente"}
                            </div>
                          </article>
                        ))
                      ) : (
                        <p className="casino-history-empty">Aucune mise active sur le tour courant.</p>
                      )}
                    </div>
                  ),
                },
                {
                  id: "participants",
                  label: "Participants",
                  badge: room?.round.participants?.length || 0,
                  caption: "Marins presents sur le tir.",
                  content: (
                    <div className="casino-prize-stack">
                      {(room?.round.participants || []).length ? (
                        room?.round.participants.map((entry) => (
                          <article key={entry.userId} className="casino-prize-card">
                            <div className="casino-prize-card__glyph"><img src={chipImageSrc} alt="" /></div>
                            <div>
                              <strong>{entry.username}</strong>
                              <span>{formatCredits(entry.totalAmount)} sur {entry.betCount} mise{entry.betCount > 1 ? "s" : ""}</span>
                            </div>
                          </article>
                        ))
                      ) : (
                        <p className="casino-history-empty">Aucun joueur n'a encore verrouille de mise sur ce tour.</p>
                      )}
                    </div>
                  ),
                },
                {
                  id: "historique",
                  label: "Historique",
                  badge: room?.recentResults?.length || 0,
                  caption: "Derniers numeros tombes.",
                  content: (
                    <div className="casino-roulette-history-panel">
                      {latestResult ? (
                        <RouletteResultPreview
                          winningNumber={latestResult.winningNumber}
                          winningColor={latestResult.winningColor}
                          previewImageSrc={historyPreviewImageSrc}
                        />
                      ) : null}

                      <div className="casino-chip-row">
                        {(room?.recentResults || []).map((entry) => (
                          <span key={entry.id} className={`casino-roulette-history-chip is-${entry.winningColor}`}>
                            {entry.winningNumber}
                          </span>
                        ))}
                      </div>
                    </div>
                  ),
                },
              ]}
            />

            <div className="casino-bet-pills casino-bet-pills--roulette">
              {ROULETTE_AMOUNT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`casino-bet-pill casino-bet-pill--dubloon casino-bet-pill--roulette ${amount === preset ? "is-active" : ""}`}
                  onClick={() => onAmountChange(preset)}
                  disabled={working}
                >
                  <img src={chipImageSrc} alt="" aria-hidden="true" />
                  <span className="casino-bet-pill__content">
                    <small>Mise</small>
                    <strong>{preset}</strong>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
