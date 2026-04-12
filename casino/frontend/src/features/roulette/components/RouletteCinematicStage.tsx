import type { RouletteResult } from "../../../lib/casinoApi";
import type { RouletteSequencePhase } from "../model";

type RouletteCinematicStageProps = {
  sequencePhase: RouletteSequencePhase;
  latestResolved: RouletteResult | null;
  introVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
  reloadVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
  introVideoSrc: string;
  reloadVideoSrc: string;
  idleImageSrc: string;
};

export default function RouletteCinematicStage({
  sequencePhase,
  latestResolved,
  introVideoRef,
  reloadVideoRef,
  introVideoSrc,
  reloadVideoSrc,
  idleImageSrc,
}: RouletteCinematicStageProps) {
  const showHero = sequencePhase === "idle" || sequencePhase === "spin" || sequencePhase === "hold";

  return (
    <div className="casino-roulette-stage-view">
      <div className={`casino-roulette-visual casino-roulette-visual--cinematic is-${sequencePhase}`}>
        <video
          ref={introVideoRef}
          className={`casino-roulette-cinematic ${sequencePhase === "intro" ? "is-visible" : ""}`}
          src={introVideoSrc}
          playsInline
          muted
          preload="metadata"
          poster={idleImageSrc}
        />

        <div className={`casino-roulette-hero-layer ${showHero ? "is-visible" : ""}`}>
          <div className={`casino-roulette-hero-fx is-${sequencePhase}`}>
            <div className="casino-roulette-hero-fx__aura" />
            <div className="casino-roulette-hero-fx__trace" />
          </div>
        </div>

        <video
          ref={reloadVideoRef}
          className={`casino-roulette-cinematic ${sequencePhase === "reload" ? "is-visible" : ""}`}
          src={reloadVideoSrc}
          playsInline
          muted
          preload="metadata"
          poster={idleImageSrc}
        />

        <div className={`casino-roulette-static ${showHero ? "is-visible" : ""}`}>
          <img src={idleImageSrc} alt="Roulette Funesterie" />
        </div>

        <div className="casino-roulette-overlay">
          {latestResolved ? (
            <div className={`casino-roulette-result is-${latestResolved.winningColor}`}>
              <span>Dernier tir</span>
              <strong>{latestResolved.winningNumber}</strong>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
