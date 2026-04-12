import * as React from "react";
import canonSound from "./audio/canon.mp3";
import opaleSound from "./audio/opale.mp3";
import rubisSound from "./audio/rubis.mp3";
import saphirSound from "./audio/saphir.mp3";
import { useMemo, useState } from "react";
import { ROOM_DEFINITIONS } from "./features/casino/catalog";
import marineImg from "./images/marine.png";
import opaleImg from "./images/opale.png";
import rubisImg from "./images/rubis.png";
import saphirImg from "./images/saphir.png";
import drapImg from "./images/drap.png";
import SceneHost from "./features/casino/components/SceneHost";
import {
  type CasinoProfile,
  type TreasureHuntState,
  revealTreasureHuntTile,
  startTreasureHunt,
} from "./lib/casinoApi";
import { formatCredits } from "./lib/casinoRoomState";

const ROOM_COST = 120;
const HUNT_PRIZES = [
  { reward: 520, label: "Opale reine", art: opaleImg },
  { reward: 320, label: "Rubis braise", art: rubisImg },
  { reward: 180, label: "Saphir du sillage", art: saphirImg },
];

type MiniTreasureGameProps = {
  profile: CasinoProfile;
  mediaReady?: boolean;
  onProfileChange: (profile: CasinoProfile, message?: string) => void;
  onError: (message: string) => void;
};

function getPrizeMeta(reward: number | null) {
  return HUNT_PRIZES.find((entry) => entry.reward === reward) || null;
}

export default function MiniTreasureGame({
  profile,
  mediaReady = false,
  onProfileChange,
  onError,
}: MiniTreasureGameProps) {
  const huntRoomMeta = ROOM_DEFINITIONS.find((roomEntry) => roomEntry.id === "treasure-hunt");
  const [state, setState] = useState<TreasureHuntState | null>(null);
  const [status, setStatus] = useState("Lance une expedition et tire trois salves sur la baie.");
  const [working, setWorking] = useState(false);
  const [showRoomInfo, setShowRoomInfo] = useState(false);
  const [activeInfoSection, setActiveInfoSection] = useState<"apercu" | "recompenses" | "salves">("apercu");
  const [foundPrizeCount, setFoundPrizeCount] = useState(0);
  const canonAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const opaleAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const rubisAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const saphirAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const activeAudiosRef = React.useRef<Set<HTMLAudioElement>>(new Set());

  const phase = state?.phase || "idle";

  function playCue(ref: React.MutableRefObject<HTMLAudioElement | null>, src: string, volume: number) {
    if (!mediaReady) return;
    if (!ref.current) {
      ref.current = new Audio(src);
      ref.current.preload = "auto";
    }

    const audio = ref.current.cloneNode(true) as HTMLAudioElement;
    audio.preload = "auto";
    audio.volume = volume;
    activeAudiosRef.current.add(audio);

    const release = () => {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      activeAudiosRef.current.delete(audio);
    };

    audio.onended = release;
    audio.onerror = release;
    void audio.play().catch(() => {
      release();
    });
  }

  React.useEffect(() => {
    return () => {
      activeAudiosRef.current.forEach((audio) => {
        audio.pause();
      });
      activeAudiosRef.current.clear();
      canonAudioRef.current?.pause();
      opaleAudioRef.current?.pause();
      rubisAudioRef.current?.pause();
      saphirAudioRef.current?.pause();
    };
  }, []);

  async function handleStartRound() {
    onError("");
    setWorking(true);
    try {
      const result = await startTreasureHunt();
      setState(result.state);
      setFoundPrizeCount((result.state.board || []).filter((tile) => tile.revealed && (tile.reward || 0) > 0).length);
      setStatus(result.state.message);
      if (result.profile) {
        onProfileChange(result.profile);
      }
    } catch (error_) {
      onError(error_ instanceof Error ? error_.message : "L'expedition n'a pas pu etre lancee.");
    } finally {
      setWorking(false);
    }
  }

  async function revealTile(tileId: number) {
    if (!state?.token || phase !== "playing" || working) return;
    onError("");
    setWorking(true);
    try {
      const result = await revealTreasureHuntTile(state.token, tileId);
      setState(result.state);
      setStatus(result.state.message);
      const revealedTile = result.state.board.find((tile) => tile.id === tileId);
      const reward = Number(revealedTile?.reward || 0);
      setFoundPrizeCount((current) => current + (reward > 0 ? 1 : 0));
      if (reward >= 520) {
        playCue(opaleAudioRef, opaleSound, 0.84);
      } else if (reward >= 320) {
        playCue(rubisAudioRef, rubisSound, 0.82);
      } else if (reward >= 180) {
        playCue(saphirAudioRef, saphirSound, 0.8);
      } else {
        playCue(canonAudioRef, canonSound, 0.76);
      }
      if (result.profile) {
        onProfileChange(result.profile);
      }
    } catch (error_) {
      onError(error_ instanceof Error ? error_.message : "La salve n'a pas pu etre jouee.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <SceneHost
      template="template-b"
      className="casino-table-layout casino-table-layout--hunt"
      main={(
        <div className="casino-stage">
          <div
            className="casino-adventure-fused-stage casino-adventure-fused-stage--hunt"
            style={{ ["--room-art" as string]: `url("${drapImg}")` }}
          >
            <div className="casino-room-hud casino-room-hud--adventure">
              <div className="casino-room-hud__lead">
                <img className="casino-room-hud__portrait" src={drapImg} alt="" aria-hidden="true" />
                <div className="casino-room-hud__identity">
                  <div className="casino-topdeck__chip-row">
                    <span className="casino-chip">{huntRoomMeta?.chip || "Chasse navale"}</span>
                    <button
                      type="button"
                      className={`casino-ghost-button casino-topdeck__info-toggle ${showRoomInfo ? "is-open" : ""}`}
                      onClick={() => setShowRoomInfo((value) => !value)}
                      aria-label="Informations chasse navale"
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
                  <strong>{huntRoomMeta?.title || "Baie aux epaves"}</strong>
                  <p>{status}</p>
                </div>
              </div>

              {showRoomInfo ? (
                <article className="casino-topdeck__info-panel" aria-label="Informations chasse navale">
                  <div className="casino-topdeck__info-buttons" role="tablist" aria-label="Sections chasse navale">
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
                      className={`casino-topdeck__info-button ${activeInfoSection === "recompenses" ? "is-active" : ""}`}
                      aria-selected={activeInfoSection === "recompenses"}
                      onClick={() => setActiveInfoSection("recompenses")}
                    >
                      Recompenses
                    </button>
                    <button
                      type="button"
                      role="tab"
                      className={`casino-topdeck__info-button ${activeInfoSection === "salves" ? "is-active" : ""}`}
                      aria-selected={activeInfoSection === "salves"}
                      onClick={() => setActiveInfoSection("salves")}
                    >
                      Salves
                    </button>
                  </div>
                  <div className="casino-topdeck__info-body" role="tabpanel">
                    {activeInfoSection === "apercu" ? (
                      <div className="casino-topdeck__info-stack">
                        <div className="casino-topdeck__info-meta">
                          <span>{huntRoomMeta?.label || "Chasse"}</span>
                          <span>Expedition: {formatCredits(ROOM_COST)}</span>
                          <span>Wallet: backend A11</span>
                        </div>
                        <p className="casino-topdeck__info-copy">
                          Trois tirs par manche pour reveler jusqu'a trois navires gagnants dans la baie.
                        </p>
                      </div>
                    ) : null}
                    {activeInfoSection === "recompenses" ? (
                      <div className="casino-prize-stack">
                        {HUNT_PRIZES.map((reward) => (
                          <article key={reward.reward} className="casino-prize-card">
                            <img src={reward.art} alt={reward.label} />
                            <div>
                              <strong>{formatCredits(reward.reward)} credits</strong>
                              <span>{reward.label}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : null}
                    {activeInfoSection === "salves" ? (
                      <div className="casino-rule-list">
                        <p>Chaque expedition coute {formatCredits(ROOM_COST)} credits.</p>
                        <p>Tu as trois tirs pour reveler jusqu'a trois navires gagnants.</p>
                        <p>Le plateau et le paiement vivent cote serveur pour suivre le vrai wallet A11.</p>
                      </div>
                    ) : null}
                  </div>
                </article>
              ) : null}
            </div>

            <div className="casino-reel-shell casino-room-shell casino-room-shell--table-compact">
              <div className="casino-treasure-hunt">
                <div className="casino-boat-grid">
                  {(state?.board || Array.from({ length: 9 }, (_, id) => ({ id, revealed: false, reward: null }))).map((tile) => {
                    const prizeMeta = getPrizeMeta(tile.reward);
                    return (
                      <button
                        key={tile.id}
                        type="button"
                        className={`casino-boat-tile ${tile.revealed ? "is-revealed" : ""}`}
                        disabled={phase !== "playing" || tile.revealed || working}
                        onClick={() => void revealTile(tile.id)}
                      >
                        {!tile.revealed ? (
                          <img src={marineImg} alt="Navire" />
                        ) : prizeMeta ? (
                          <div className="casino-boat-tile__treasure">
                            <div className="casino-boat-tile__treasure-media">
                              <img src={prizeMeta.art} alt={prizeMeta.label} />
                              <strong className="casino-boat-tile__payout">+{formatCredits(prizeMeta.reward)}</strong>
                            </div>
                          </div>
                        ) : (
                          <div className="casino-boat-tile__miss">
                            <span>💥</span>
                            <strong>Rate</strong>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="casino-action-row casino-action-row--hunt">
                  <button
                    type="button"
                    className="casino-primary-button casino-primary-button--hunt"
                    onClick={() => void handleStartRound()}
                    disabled={phase === "playing" || working}
                  >
                    {phase === "playing" ? "Expedition en cours" : `Lancer une expedition - ${formatCredits(ROOM_COST)}`}
                  </button>
                  <div className="casino-chip-row casino-chip-row--hunt">
                    <span className="casino-chip">Tirs restants: {state?.shotsLeft ?? 0}</span>
                    <span className="casino-chip">Pierres revelees: {foundPrizeCount}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    />
  );
}
