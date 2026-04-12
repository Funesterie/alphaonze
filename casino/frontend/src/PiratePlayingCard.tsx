import * as React from "react";
import cardArtwork from "./images/Cartes de pirate au crépuscule.png";
import { getPirateSuitMeta, type PiratePlayingCard } from "./lib/pirateCards";

type PiratePlayingCardViewProps = {
  card: PiratePlayingCard | null;
  hidden?: boolean;
  emphasis?: "normal" | "strong";
  dealt?: boolean;
  dealDelayMs?: number;
};

export default function PiratePlayingCardView({
  card,
  hidden = false,
  emphasis = "normal",
  dealt = false,
  dealDelayMs = 0,
}: PiratePlayingCardViewProps) {
  const animationStyle = dealt
    ? { ["--pirate-card-deal-delay" as string]: `${dealDelayMs}ms` }
    : undefined;

  if (!card) {
    return (
      <div
        className={`pirate-card pirate-card--empty ${dealt ? "pirate-card--dealt" : ""}`}
        style={animationStyle}
        aria-hidden="true"
      />
    );
  }

  if (hidden) {
    return (
      <div
        className={`pirate-card pirate-card--hidden pirate-card--${emphasis} ${dealt ? "pirate-card--dealt" : ""}`}
        style={{
          ["--pirate-card-art" as string]: `url("${cardArtwork}")`,
          ...(animationStyle || {}),
        }}
        aria-label="Carte cachee"
      >
        <span className="pirate-card__back-mark">☠</span>
      </div>
    );
  }

  const suitMeta = getPirateSuitMeta(card.suit);

  return (
    <div
      className={`pirate-card pirate-card--face pirate-card--${emphasis} ${dealt ? "pirate-card--dealt" : ""}`}
      style={{
        ["--pirate-card-accent" as string]: suitMeta.accent,
        ...(animationStyle || {}),
      }}
      aria-label={`${card.rank} de ${suitMeta.label}`}
    >
      <div className="pirate-card__corner pirate-card__corner--top">
        <strong>{card.rank}</strong>
        <span>{suitMeta.glyph}</span>
      </div>

      <div className="pirate-card__center">
        <span>{suitMeta.glyph}</span>
      </div>

      <div className="pirate-card__corner pirate-card__corner--bottom">
        <strong>{card.rank}</strong>
        <span>{suitMeta.glyph}</span>
      </div>
    </div>
  );
}
