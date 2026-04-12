import PiratePlayingCardView from "../../../PiratePlayingCard";
import jetonImg from "../../../images/jeton.png";
import { formatCredits } from "../../../lib/casinoRoomState";
import type { PokerSeat, PokerState } from "../../../lib/casinoApi";

const POKER_SEAT_LAYOUT = [
  { x: "15%", y: "34%", align: "start", tag: "UTG" },
  { x: "35%", y: "18%", align: "center", tag: "HJ" },
  { x: "65%", y: "18%", align: "center", tag: "CO" },
  { x: "85%", y: "34%", align: "end", tag: "BTN" },
] as const;

type PokerTableSceneProps = {
  state: PokerState | null;
  stage: "idle" | PokerState["stage"];
  playerName: string;
  activeAnte: number;
  smallBlind: number;
  isDecisionPhase: boolean;
  dealtCardDelays: Record<string, number>;
};

function getSeatReadLabel(seat: PokerSeat, stage: PokerState["stage"] | "idle") {
  if (seat.folded) return "Main couchee";
  if (seat.isWinner) return "Main gagnante";
  if (stage === "showdown") return seat.hand?.label || "Showdown";
  if (seat.isActive) return "Parole en cours";
  if (seat.lastAction) return seat.lastAction;
  return "En jeu";
}

export default function PokerTableScene({
  state,
  stage,
  playerName,
  activeAnte,
  smallBlind,
  isDecisionPhase,
  dealtCardDelays,
}: PokerTableSceneProps) {
  void activeAnte;
  void smallBlind;
  const communityCards = state?.communityCards || [];
  const remoteSeats = (state?.aiSeats || []).slice(0, POKER_SEAT_LAYOUT.length);

  return (
    <>
      <div className={`casino-card-felt casino-card-felt--poker casino-card-felt--table ${isDecisionPhase ? "is-decision-phase" : ""}`}>
        <div className={`casino-felt-table casino-felt-table--poker ${isDecisionPhase ? "is-decision-phase" : ""}`}>
          <div className="casino-felt-table__halo" />

          {remoteSeats.map((seat, index) => {
            const layout = POKER_SEAT_LAYOUT[index] || POKER_SEAT_LAYOUT[POKER_SEAT_LAYOUT.length - 1];
            const shouldRevealCards = stage === "showdown" || seat.isWinner;

            return (
              <article
                key={seat.id}
                className={`casino-oval-seat casino-oval-seat--poker-peer casino-oval-seat--${layout.align} ${seat.folded ? "is-folded" : ""} ${seat.isWinner ? "is-winner" : ""} ${seat.isActive ? "is-focus" : ""} ${isDecisionPhase && !seat.isActive ? "is-muted" : ""}`}
                style={{
                  ["--seat-x" as string]: layout.x,
                  ["--seat-y" as string]: layout.y,
                }}
              >
                <div className="casino-poker-seat-banner">
                  <strong>{seat.name}</strong>
                  <span>{getSeatReadLabel(seat, stage)}</span>
                </div>
                <div className="casino-card-row casino-card-row--player casino-card-row--fan casino-card-row--fan-player casino-card-row--poker-peer">
                  {(seat.cards || []).length ? (
                    seat.cards.map((card, cardIndex) => (
                      <PiratePlayingCardView
                        key={`${seat.id}-${card.id}-${cardIndex}`}
                        card={card}
                        hidden={!shouldRevealCards}
                        dealt={Boolean(dealtCardDelays[`${seat.id}-${card.id}-${cardIndex}`] !== undefined)}
                        dealDelayMs={dealtCardDelays[`${seat.id}-${card.id}-${cardIndex}`] || 0}
                      />
                    ))
                  ) : (
                    <div className="casino-empty-seat casino-empty-seat--poker-peer">
                      <strong>Siege occupe</strong>
                      <span>En attente de distribution</span>
                    </div>
                  )}
                </div>
                <div className="casino-poker-seat-banner casino-poker-seat-banner--chips">
                  <strong className="casino-token-inline"><img src={jetonImg} alt="" />{formatCredits(seat.totalCommitted || 0)}</strong>
                  <span>Stack {formatCredits(seat.chips || 0)}</span>
                </div>
              </article>
            );
          })}

          <section className={`casino-table-core casino-table-core--poker ${isDecisionPhase ? "is-focus" : ""}`}>
            <div className="casino-table-core__headline">
              <strong>{stage === "idle" ? "Table au repos" : state?.stageLabel || "Street en cours"}</strong>
              <span className="casino-token-inline"><img src={jetonImg} alt="" />Pot {formatCredits(state?.tablePot || state?.pot || 0)}</span>
            </div>
            <div className="casino-poker-board">
              {Array.from({ length: 5 }, (_, index) => {
                const card = communityCards[index] || null;
                const cardKey = card ? `community-${card.id}-${index}` : `community-slot-${index}`;
                return card ? (
                  <PiratePlayingCardView
                    key={cardKey}
                    card={card}
                    dealt={Boolean(dealtCardDelays[cardKey] !== undefined)}
                    dealDelayMs={dealtCardDelays[cardKey] || 0}
                  />
                ) : (
                  <div key={cardKey} className="pirate-card pirate-card--ghost" aria-hidden="true">
                    <span>{index + 1}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <article className={`casino-oval-seat casino-oval-seat--player ${state?.playerFolded ? "is-folded" : ""} ${isDecisionPhase ? "is-focus" : ""}`}>
            <div className="casino-poker-seat-banner">
              <strong>{playerName}</strong>
              <span>{state?.playerFolded ? "Main couchee" : state?.playerHand?.label || (stage === "showdown" ? "Showdown" : "Decision ouverte")}</span>
            </div>
            <div className="casino-card-row casino-card-row--player casino-card-row--fan casino-card-row--fan-player">
              {state?.playerCards.length ? (
                state.playerCards.map((card, index) => (
                  <PiratePlayingCardView
                    key={`poker-player-${card.id}-${index}`}
                    card={card}
                    emphasis="strong"
                    dealt={Boolean(dealtCardDelays[`poker-player-${card.id}-${index}`] !== undefined)}
                    dealDelayMs={dealtCardDelays[`poker-player-${card.id}-${index}`] || 0}
                  />
                ))
              ) : (
                <div className="casino-empty-seat">Le joueur n'a pas encore touche ses cartes.</div>
              )}
            </div>
            <div className="casino-poker-seat-banner casino-poker-seat-banner--chips">
              <strong className="casino-token-inline"><img src={jetonImg} alt="" />{formatCredits(state?.playerCommitted || 0)}</strong>
              <span>Stack {formatCredits(state?.playerChips || 0)}</span>
            </div>
          </article>
        </div>
      </div>
    </>
  );
}
