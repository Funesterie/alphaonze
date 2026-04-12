import * as React from "react";
import { SLOT_AMBIENT_MEDIA } from "../../casino/catalog";
import { ROOM_DEFINITIONS, type RoomId } from "../../casino/catalog";
import type { MutableRefObject, ReactNode } from "react";
import icoSlotsImg from "../../../images/icomachine.png";
import icoMapImg from "../../../images/icochassetresor.png";
import icoHuntImg from "../../../images/icochassenaval.png";
import icoBlackjackImg from "../../../images/icoblackjack.png";
import icoPokerImg from "../../../images/icopoker.png";
import icoRouletteImg from "../../../images/icoroulette.png";
import type { CasinoProfile } from "../../../lib/casinoApi";
import { formatCredits } from "../../../lib/casinoRoomState";
import LoadingPanel from "./LoadingPanel";

const HAMBURGER_ROOM_ICONS: Record<RoomId, string> = {
  slots: icoSlotsImg,
  "treasure-map": icoMapImg,
  "treasure-hunt": icoHuntImg,
  blackjack: icoBlackjackImg,
  poker: icoPokerImg,
  roulette: icoRouletteImg,
};

type MenuIconKind = "bonus" | "sync" | "logout";

function HeaderActionIcon({ kind }: { kind: MenuIconKind }) {
  switch (kind) {
    case "bonus":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 7.5C6 6.12 8.02 5 10.5 5S15 6.12 15 7.5 12.98 10 10.5 10 6 8.88 6 7.5Z" />
          <path d="M6 12c0 1.38 2.02 2.5 4.5 2.5S15 13.38 15 12" />
          <path d="M6 16.5c0 1.38 2.02 2.5 4.5 2.5S15 17.88 15 16.5" />
          <path d="M6 7.5v9" />
          <path d="M15 7.5v9" />
          <path d="M17.5 8.5h3" />
          <path d="M19 7v3" />
        </svg>
      );
    case "sync":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 6v5h-5" />
          <path d="M4 18v-5h5" />
          <path d="M7.5 9A6.5 6.5 0 0 1 20 11" />
          <path d="M16.5 15A6.5 6.5 0 0 1 4 13" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
          <path d="M10 16l4-4-4-4" />
          <path d="M14 12H4" />
        </svg>
      );
  }
}

function HeaderWidgetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="6.3" />
      <circle cx="12" cy="12" r="2.1" />
      <path d="M12 2.6v3.2" />
      <path d="M12 18.2v3.2" />
      <path d="M2.6 12h3.2" />
      <path d="M18.2 12h3.2" />
      <path d="M5.35 5.35l2.26 2.26" />
      <path d="M16.39 16.39l2.26 2.26" />
      <path d="M18.65 5.35l-2.26 2.26" />
      <path d="M7.61 16.39l-2.26 2.26" />
    </svg>
  );
}

type CasinoGameScreenProps = {
  profile: CasinoProfile;
  busy: boolean;
  error: string;
  notice: string;
  displayName: string;
  activeCasinoRoom: RoomId;
  showImmersion: boolean;
  immersionLine: string;
  mediaReady: boolean;
  ambientVideoAudible: boolean;
  ambientVideoRef: MutableRefObject<HTMLVideoElement | null>;
  ambientPanel?: ReactNode;
  freshVideo: string;
  districtArtwork: string;
  cardArtwork: string;
  onClaimBonus: () => void;
  onRefreshProfile: () => void;
  onLogout: () => void;
  onRoomChange: (roomId: RoomId) => void;
  gameTable: ReactNode;
};

export default function CasinoGameScreen({
  profile,
  busy,
  error,
  notice,
  displayName,
  activeCasinoRoom,
  showImmersion,
  immersionLine,
  mediaReady,
  ambientVideoAudible,
  ambientVideoRef,
  ambientPanel,
  freshVideo,
  districtArtwork,
  cardArtwork,
  onClaimBonus,
  onRefreshProfile,
  onLogout,
  onRoomChange,
  gameTable,
}: CasinoGameScreenProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [clockLabel, setClockLabel] = React.useState(() =>
    new Date().toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  );
  const profileMenuRef = React.useRef<HTMLDivElement | null>(null);

  void mediaReady;

  const headerVideoSrc =
    activeCasinoRoom === "slots"
      ? SLOT_AMBIENT_MEDIA.video
      : freshVideo;

  React.useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  React.useEffect(() => {
    const updateClock = () => {
      setClockLabel(
        new Date().toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    };

    updateClock();
    const intervalId = window.setInterval(updateClock, 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div className={`casino-game-shell ${activeCasinoRoom !== "slots" ? "casino-game-shell--with-ambient" : ""}`}>

      {showImmersion ? (
        <div
          className="casino-immersion-overlay"
          style={{
            backgroundImage: `linear-gradient(140deg, rgba(5, 8, 12, 0.86), rgba(7, 12, 20, 0.94)), radial-gradient(circle at top left, rgba(255, 200, 87, 0.18), transparent 24%), url("${cardArtwork}")`,
          }}
        >
          <div className="casino-immersion-overlay__panel">
            <div className="casino-immersion-overlay__copy">
              <span className="casino-chip">Connexion rituelle</span>
              <h2>Cap sur le pont pirate</h2>
              <p>{immersionLine}</p>
              <div className="casino-immersion-overlay__stats">
                <span>Musique d'ouverture Funesterie</span>
                <span>Tables ATS en cours d'arrimage</span>
                <span>Canon live en veille sur la roulette</span>
              </div>
            </div>

            <div
              className="casino-immersion-overlay__video-shell"
              style={{
                backgroundImage: `linear-gradient(180deg, rgba(4, 8, 14, 0.14), rgba(4, 8, 14, 0.84)), url("${districtArtwork}")`,
              }}
            >
              <video
                className="casino-immersion-overlay__video"
                src={freshVideo}
                autoPlay
                loop
                playsInline
                muted
                preload="metadata"
              />
            </div>
          </div>
        </div>
      ) : null}

      <header className="casino-account-bar">
        <div className="casino-account-bar__identity">
          <span className="casino-eyebrow">Salle privee</span>
          <h1>{displayName}</h1>
        </div>

        <div className={`casino-account-bar__ambient ${ambientPanel ? "is-custom-ambient" : ""}`}>
          {ambientPanel ? (
            ambientPanel
          ) : (
            <video
              ref={ambientVideoRef}
              className="casino-account-bar__ambient-video"
              src={headerVideoSrc}
              autoPlay
              loop
              playsInline
              muted={!ambientVideoAudible}
              preload="metadata"
            />
          )}
        </div>

        <div
          ref={profileMenuRef}
          className={`casino-account-bar__menu ${menuOpen ? "is-open" : ""}`}
        >
          <button
            type="button"
            className="casino-ghost-button casino-account-bar__menu-toggle"
            aria-label="Ouvrir le menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span className="casino-button-icon casino-button-icon--widget" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 7h16" />
                <path d="M4 12h16" />
                <path d="M4 17h16" />
              </svg>
            </span>
          </button>

          <div className="casino-account-bar__actions">
            <div className="casino-account-bar__room-list" role="tablist" aria-label="Jeux casino">
              {ROOM_DEFINITIONS.map((room) => {
                const roomIcon = HAMBURGER_ROOM_ICONS[room.id] || room.icon;
                return (
                  <button
                    key={room.id}
                    type="button"
                    className={`casino-ghost-button casino-ghost-button--menu ${room.id === activeCasinoRoom ? "is-active" : ""}`}
                    onClick={() => {
                      onRoomChange(room.id);
                      setMenuOpen(false);
                    }}
                    role="tab"
                    aria-selected={room.id === activeCasinoRoom}
                  >
                    <span className="casino-button-icon casino-button-icon--room" aria-hidden="true">
                      <img src={roomIcon} alt="" />
                    </span>
                    <span className="casino-button-label">{room.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="casino-ghost-button casino-ghost-button--menu"
              disabled={busy || !profile.wallet.canClaimDailyBonus}
              onClick={onClaimBonus}
              title={profile.wallet.canClaimDailyBonus ? "Recuperer le bonus journalier" : "Bonus journalier deja recupere"}
            >
              <span className="casino-button-icon">
                <HeaderActionIcon kind="bonus" />
              </span>
              <span className="casino-button-label">
                {profile.wallet.canClaimDailyBonus ? `Bonus +${profile.wallet.dailyBonusAmount}` : "Bonus pris"}
              </span>
            </button>
            <button
              type="button"
              className="casino-ghost-button casino-ghost-button--menu"
              disabled={busy}
              onClick={onRefreshProfile}
              title="Synchroniser le compte"
            >
              <span className="casino-button-icon">
                <HeaderActionIcon kind="sync" />
              </span>
              <span className="casino-button-label">Sync</span>
            </button>
            <button
              type="button"
              className="casino-ghost-button casino-ghost-button--menu"
              onClick={onLogout}
              title="Fermer la session"
            >
              <span className="casino-button-icon">
                <HeaderActionIcon kind="logout" />
              </span>
              <span className="casino-button-label">Quitter</span>
            </button>
          </div>
        </div>

        <div className="casino-account-bar__clock">{clockLabel}</div>

        <div className="casino-account-bar__coins" aria-label="Solde du compte">
          {formatCredits(profile.wallet.balance)} credits
        </div>
      </header>

      {(error || notice) ? (
        <div className="casino-toast-rail" aria-live="polite">
          {error ? <div className="casino-alert casino-alert--error">{error}</div> : null}
          {notice ? <div className="casino-alert casino-alert--success">{notice}</div> : null}
        </div>
      ) : null}

      {gameTable ?? <LoadingPanel label="Chargement de la table..." />}
    </div>
  );
}
