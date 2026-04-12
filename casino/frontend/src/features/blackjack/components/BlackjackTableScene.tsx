import PiratePlayingCardView from "../../../PiratePlayingCard";
import jetonImg from "../../../images/jeton.png";
import { formatCredits } from "../../../lib/casinoRoomState";
import type { BlackjackSeat, BlackjackState } from "../../../lib/casinoApi";

const BLACKJACK_PEER_LAYOUT = [
  { x: "17%", y: "58%", align: "start" },
  { x: "50%", y: "48%", align: "center" },
  { x: "83%", y: "58%", align: "end" },
] as const;

type BlackjackTableSceneProps = {
  state: BlackjackState | null;
  playerName: string;
  bet: number;
  isDecisionPhase: boolean;
  dealtCardDelays: Record<string, number>;
  resultFlash: { label: string; detail?: string; tone: "win" | "lose" } | null;
};

function getPeerOutcome(seat: BlackjackSeat, stage: BlackjackState["stage"]) {
  if (stage !== "resolved") return null;
  const delta = Number(seat.lastDelta || 0);
  if (delta > 0) {
    return {
      label: "WIN",
      detail: `+${formatCredits(delta)}`,
      tone: "win" as const,
    };
  }
  if (delta < 0) {
    return {
      label: "LOSE",
      detail: `-${formatCredits(Math.abs(delta))}`,
      tone: "lose" as const,
    };
  }
  return seat.result
    ? {
        label: seat.result.toUpperCase(),
        tone: "win" as const,
      }
    : null;
}

export default function BlackjackTableScene({
  state,
  playerName,
  bet,
  isDecisionPhase,
  dealtCardDelays,
  resultFlash,
}: BlackjackTableSceneProps) {
  void bet;
  const playerDelta = state?.lastDelta || 0;
  const playerOutcome =
    state?.stage === "resolved"
      ? resultFlash || (
          playerDelta > 0
            ? { label: "WIN", detail: `+${formatCredits(playerDelta)}`, tone: "win" as const }
            : playerDelta < 0
              ? { label: "LOSE", detail: `-${formatCredits(Math.abs(playerDelta))}`, tone: "lose" as const }
              : null
        )
      : null;
  const playerSeatName = String(playerName || "Toi").trim();
  const peerSeats = (state?.aiSeats || []).slice(0, BLACKJACK_PEER_LAYOUT.length);

  return (
    <div className={`casino-card-felt casino-card-felt--blackjack casino-card-felt--table ${isDecisionPhase ? "is-decision-phase" : ""}`}>
      <div className={`casino-felt-table casino-felt-table--blackjack ${isDecisionPhase ? "is-decision-phase" : ""}`}>
        <section className="casino-blackjack-dealer-rail">
          <div className="casino-blackjack-player-banner casino-blackjack-player-banner--dealer" aria-label="Main du croupier">
            <strong>Croupier</strong>
            <span>{state?.dealerHidden ? "Main cachee" : `${state?.dealerScore.total || 0} points`}</span>
          </div>
          <div className="casino-card-row casino-card-row--dealer casino-card-row--fan casino-card-row--fan-dealer">
            {(state?.dealerCards || []).length ? (
              (state?.dealerCards || []).map((card, index) => (
                <PiratePlayingCardView
                  key={`dealer-${card.id}-${index}`}
                  card={card}
                  hidden={Boolean(state?.dealerHidden && index === 1)}
                  dealt={Boolean(dealtCardDelays[`dealer-${card.id}-${index}`] !== undefined)}
                  dealDelayMs={dealtCardDelays[`dealer-${card.id}-${index}`] || 0}
                />
              ))
            ) : null}
          </div>
        </section>

        {peerSeats.map((seat, index) => {
          const layout = BLACKJACK_PEER_LAYOUT[index] || BLACKJACK_PEER_LAYOUT[BLACKJACK_PEER_LAYOUT.length - 1];
          const seatScore = seat.score?.total || 0;
          const outcome = getPeerOutcome(seat, state?.stage || "waiting");
          return (
            <article
              key={seat.id}
              className={`casino-oval-seat casino-oval-seat--blackjack-peer casino-oval-seat--${layout.align} ${seat.isActive ? "is-focus" : ""}`}
              style={{
                ["--seat-x" as string]: layout.x,
                ["--seat-y" as string]: layout.y,
              }}
            >
              <div className="casino-card-row casino-card-row--dealer casino-card-row--fan casino-card-row--fan-dealer casino-card-row--blackjack-peer">
                {(seat.cards || []).map((card, cardIndex) => (
                  <PiratePlayingCardView
                    key={`${seat.id}-${card.id}-${cardIndex}`}
                    card={card}
                    dealt={Boolean(dealtCardDelays[`${seat.id}-${card.id}-${cardIndex}`] !== undefined)}
                    dealDelayMs={dealtCardDelays[`${seat.id}-${card.id}-${cardIndex}`] || 0}
                  />
                ))}
              </div>
              <div className="casino-blackjack-player-banner">
                <strong>{seat.name}</strong>
                <span>{seatScore} points • Mise {formatCredits(seat.wager || 0)}</span>
              </div>
              <div className="casino-blackjack-player-banner casino-blackjack-player-banner--stack">
                <strong className="casino-token-inline"><img src={jetonImg} alt="" />{formatCredits(seat.wager || 0)}</strong>
                <span>Stack {formatCredits(seat.chips || 0)}</span>
              </div>
              {outcome ? (
                <div className={`casino-blackjack-seat-outcome is-${outcome.tone}`} aria-live="polite">
                  <strong>{outcome.label}</strong>
                  {outcome.detail ? <span>{outcome.detail}</span> : null}
                </div>
              ) : null}
            </article>
          );
        })}

        <article className={`casino-oval-seat casino-oval-seat--player casino-oval-seat--blackjack-player ${isDecisionPhase ? "is-focus" : ""}`}>
          <header className="casino-blackjack-hand-meta casino-blackjack-hand-meta--player">
            <span>Joueur</span>
            <strong>{state?.playerScore.total || 0} points</strong>
          </header>

          <div className="casino-card-row casino-card-row--player casino-card-row--fan casino-card-row--fan-player">
            {state?.playerCards.length ? (
              state.playerCards.map((card, index) => (
                <PiratePlayingCardView
                  key={`player-${card.id}-${index}`}
                  card={card}
                  emphasis="strong"
                  dealt={Boolean(dealtCardDelays[`player-${card.id}-${index}`] !== undefined)}
                  dealDelayMs={dealtCardDelays[`player-${card.id}-${index}`] || 0}
                />
              ))
            ) : null}
          </div>

          <div className="casino-blackjack-player-banner" aria-label={`Main de ${playerSeatName}`}>
            <strong>{playerSeatName}</strong>
            <span>{state?.playerScore.total || 0} points</span>
          </div>

          {playerOutcome ? (
            <div className={`casino-blackjack-seat-outcome is-${playerOutcome.tone}`} aria-live="polite">
              <strong>{playerOutcome.label}</strong>
              {playerOutcome.detail ? <span>{playerOutcome.detail}</span> : null}
            </div>
          ) : null}
        </article>
      </div>
    </div>
  );
}
