import * as React from "react";
import failSound from "./audio/fail.mp3";
import moneySound from "./audio/money.mp3";
import { useState } from "react";
import { ROOM_DEFINITIONS } from "./features/casino/catalog";
import carteImg from "./images/carte.png";
import coffreImg from "./images/coffre.png";
import perroImg from "./images/perro.png";
import SceneHost from "./features/casino/components/SceneHost";
import { type CasinoProfile, playTreasureMap } from "./lib/casinoApi";
import { formatCredits } from "./lib/casinoRoomState";

const MAP_ROOM_COST = 90;
const MAP_REWARD = 340;
const TREASURE_POINTS = [
  { id: "west", left: "26.3%", top: "36.1%", label: "Recif ouest" },
  { id: "south", left: "36.7%", top: "64%", label: "Maree du sud" },
  { id: "east", left: "69.9%", top: "49.6%", label: "Crique est" },
] as const;

type CarteMiniGameProps = {
  profile: CasinoProfile;
  mediaReady?: boolean;
  onProfileChange: (profile: CasinoProfile, message?: string) => void;
  onError: (message: string) => void;
};

export default function CarteMiniGame({
  profile,
  mediaReady = false,
  onProfileChange,
  onError,
}: CarteMiniGameProps) {
  const mapRoomMeta = ROOM_DEFINITIONS.find((roomEntry) => roomEntry.id === "treasure-map");
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [winningPoint, setWinningPoint] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "playing" | "resolved">("idle");
  const [status, setStatus] = useState("Etudie la carte et choisis la bonne croix.");
  const [working, setWorking] = useState(false);
  const [showRoomInfo, setShowRoomInfo] = useState(false);
  const [activeInfoSection, setActiveInfoSection] = useState<"apercu" | "butin" | "lecture">("apercu");
  const moneyAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const failAudioRef = React.useRef<HTMLAudioElement | null>(null);

  const canPlay = profile.wallet.balance >= MAP_ROOM_COST;
  const isWin = phase === "resolved" && selectedPoint && selectedPoint === winningPoint;

  function playCue(ref: React.MutableRefObject<HTMLAudioElement | null>, src: string, volume: number) {
    if (!mediaReady) return;
    if (!ref.current) {
      ref.current = new Audio(src);
      ref.current.preload = "auto";
    }
    ref.current.pause();
    try {
      ref.current.currentTime = 0;
    } catch {
      // ignore
    }
    ref.current.volume = volume;
    void ref.current.play().catch(() => undefined);
  }

  React.useEffect(() => {
    return () => {
      moneyAudioRef.current?.pause();
      failAudioRef.current?.pause();
    };
  }, []);

  function startSearch() {
    onError("");
    if (!canPlay) {
      setStatus("Il te manque des credits serveur pour ouvrir une nouvelle carte.");
      return;
    }
    setPhase("playing");
    setSelectedPoint(null);
    setWinningPoint(null);
    setStatus("Une seule tentative. Choisis la croix qui te semble la plus juste.");
  }

  async function choosePoint(pointId: string) {
    if (phase !== "playing" || working) return;
    onError("");
    setWorking(true);
    try {
      const result = await playTreasureMap(pointId);
      setSelectedPoint(result.result.selectedPoint);
      setWinningPoint(result.result.winningPoint);
      setPhase("resolved");
      setStatus(
        result.result.reward > 0
          ? `Trouve. Le coffre rapporte ${formatCredits(result.result.reward)} credits.`
          : "Mauvaise crique. La carte se referme sans recompense."
      );
      if (result.result.reward > 0) {
        playCue(moneyAudioRef, moneySound, 0.8);
      } else {
        playCue(failAudioRef, failSound, 0.72);
      }
      onProfileChange(result.profile);
    } catch (error_) {
      onError(error_ instanceof Error ? error_.message : "La carte n'a pas pu etre jouee.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <SceneHost
      template="template-a"
      className="casino-table-layout casino-table-layout--map-compact"
      main={(
        <div className="casino-stage">
          <div
            className="casino-adventure-fused-stage casino-adventure-fused-stage--map"
            style={{ ["--room-art" as string]: `url("${carteImg}")` }}
          >
            <div className="casino-room-hud casino-room-hud--adventure">
              <div className="casino-room-hud__lead">
                <img className="casino-room-hud__portrait" src={perroImg} alt="" aria-hidden="true" />
                <div className="casino-room-hud__identity">
                  <div className="casino-topdeck__chip-row">
                    <span className="casino-chip">{mapRoomMeta?.chip || "Carte au tresor"}</span>
                    <button
                      type="button"
                      className={`casino-ghost-button casino-topdeck__info-toggle ${showRoomInfo ? "is-open" : ""}`}
                      onClick={() => setShowRoomInfo((value) => !value)}
                      aria-label="Informations carte au tresor"
                      aria-expanded={showRoomInfo}
                    >
                      <span className="casino-button-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <path d="M4 7h16" />
                          <path d="M4 12h16" />
                          <path d="M4 17h16" />
                        </svg>
                      </span>
                    </button>
                  </div>
                  <strong>{mapRoomMeta?.title || "Archiviste des criques"}</strong>
                  <p>{status}</p>
                </div>
              </div>

              {showRoomInfo ? (
                <article className="casino-topdeck__info-panel" aria-label="Informations carte au tresor">
                  <div className="casino-topdeck__info-buttons" role="tablist" aria-label="Sections carte au tresor">
                    <button
                      type="button"
                      role="tab"
                      className={`casino-topdeck__info-button ${activeInfoSection === "apercu" ? "is-active" : ""}`}
                      aria-selected={activeInfoSection === "apercu"}
                      onClick={() => setActiveInfoSection("apercu")}
                    >
                      Apercu
                    </button>
                    <button
                      type="button"
                      role="tab"
                      className={`casino-topdeck__info-button ${activeInfoSection === "butin" ? "is-active" : ""}`}
                      aria-selected={activeInfoSection === "butin"}
                      onClick={() => setActiveInfoSection("butin")}
                    >
                      Butin
                    </button>
                    <button
                      type="button"
                      role="tab"
                      className={`casino-topdeck__info-button ${activeInfoSection === "lecture" ? "is-active" : ""}`}
                      aria-selected={activeInfoSection === "lecture"}
                      onClick={() => setActiveInfoSection("lecture")}
                    >
                      Lecture
                    </button>
                  </div>
                  <div className="casino-topdeck__info-body" role="tabpanel">
                    {activeInfoSection === "apercu" ? (
                      <div className="casino-topdeck__info-stack">
                        <div className="casino-topdeck__info-meta">
                          <span>{mapRoomMeta?.label || "Carte"}</span>
                          <span>Cout: {formatCredits(MAP_ROOM_COST)}</span>
                          <span>Wallet: backend A11</span>
                        </div>
                        <p className="casino-topdeck__info-copy">
                          Une seule tentative par carte. Le coffre principal rapporte {formatCredits(MAP_REWARD)} credits si la bonne croix est choisie.
                        </p>
                      </div>
                    ) : null}
                    {activeInfoSection === "butin" ? (
                      <div className="casino-prize-card casino-prize-card--single">
                        <img src={coffreImg} alt="Coffre pirate" />
                        <div>
                          <strong>Cache principale</strong>
                          <span>+{formatCredits(MAP_REWARD)} credits si la croix est juste</span>
                        </div>
                      </div>
                    ) : null}
                    {activeInfoSection === "lecture" ? (
                      <div className="casino-rule-list">
                        <p>Les marqueurs restent centres sur les croix, meme sur mobile.</p>
                        <p>La carte est debitée et resolue cote serveur pour coller au vrai wallet A11.</p>
                        <p>Quand le coffre apparait, la manche se ferme sans popup parasite ni solde fantome.</p>
                      </div>
                    ) : null}
                  </div>
                </article>
              ) : null}
            </div>

            <div className="casino-reel-shell casino-room-shell casino-room-shell--table-compact">
              <div className="casino-map-board">
                <div className="casino-map-board__frame">
                  <img src={carteImg} alt="Carte au tresor" className="casino-map-board__image" />
                  {TREASURE_POINTS.map((point) => {
                    const isSelected = selectedPoint === point.id;
                    const isWinner = phase === "resolved" && winningPoint === point.id;
                    const isMiss = phase === "resolved" && isSelected && !isWinner;
                    return (
                      <button
                        key={point.id}
                        type="button"
                        className={`casino-map-marker ${isSelected ? "is-selected" : ""} ${isWinner ? "is-winning" : ""} ${isMiss ? "is-miss" : ""}`}
                        style={{ left: point.left, top: point.top }}
                        onClick={() => void choosePoint(point.id)}
                        disabled={phase !== "playing" || working}
                        aria-label={point.label}
                      >
                        {isWinner ? (
                          <>
                            <img src={coffreImg} alt="" />
                            <span className="casino-map-marker__badge casino-map-marker__badge--win">+{formatCredits(MAP_REWARD)}</span>
                          </>
                        ) : (
                          <>
                            <span className="casino-map-marker__cross" aria-hidden="true" />
                            {isMiss ? <span className="casino-map-marker__badge casino-map-marker__badge--miss">Rate</span> : null}
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="casino-action-row casino-action-row--map">
                <button
                  type="button"
                  className="casino-primary-button casino-primary-button--map"
                  onClick={startSearch}
                  disabled={phase === "playing" || working}
                >
                  {phase === "playing" ? "Carte ouverte" : `Ouvrir une carte - ${formatCredits(MAP_ROOM_COST)}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    />
  );
}
