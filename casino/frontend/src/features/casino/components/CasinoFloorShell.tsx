import * as React from "react";
import { PAYOUT_TABLE, ROOM_DEFINITIONS, SYMBOL_META, formatTransactionLabel, formatTransactionTime } from "../catalog";
import type { CasinoProfile, CasinoTransaction } from "../../../lib/casinoApi";
import { formatCredits } from "../../../lib/casinoRoomState";
import lingotImg from "../../../images/lingot.png";

const TREASURE_MAP_REWARD = 340;
const TREASURE_HUNT_REWARDS = [520, 320, 180] as const;

type InfoSection = {
  id: string;
  label: string;
  content: React.ReactNode;
};

type CasinoFloorShellProps = {
  currentRoom: (typeof ROOM_DEFINITIONS)[number];
  profile: CasinoProfile;
  recentTransactions: CasinoTransaction[];
  districtArtwork: string;
  currentRoomArtwork: string;
  children: React.ReactNode;
};

export default function CasinoFloorShell({
  currentRoom,
  profile,
  recentTransactions,
  districtArtwork,
  currentRoomArtwork,
  children,
}: CasinoFloorShellProps) {
  const layoutTemplateClass = `casino-floor--${currentRoom.layoutTemplate}`;
  const [showRoomInfo, setShowRoomInfo] = React.useState(false);
  const infoSections = React.useMemo<InfoSection[]>(() => {
    switch (currentRoom.id) {
      case "slots":
        return [
          {
            id: "overview",
            label: "Apercu",
            content: (
              <div className="casino-topdeck__info-stack">
                <div className="casino-topdeck__info-meta">
                  <span>{currentRoom.label}</span>
                  <span>Mode: {currentRoom.title}</span>
                  <span>Wallet: backend A11</span>
                </div>
                <div className="casino-metric-list">
                  <div>
                    <span>Spins joues</span>
                    <strong>{formatCredits(profile.wallet.gamesPlayed)}</strong>
                  </div>
                  <div>
                    <span>Total mise</span>
                    <strong>{formatCredits(profile.wallet.lifetimeWagered)}</strong>
                  </div>
                  <div>
                    <span>Total gains</span>
                    <strong>{formatCredits(profile.wallet.lifetimeWon)}</strong>
                  </div>
                  <div>
                    <span>Bonus journalier</span>
                    <strong>{profile.wallet.canClaimDailyBonus ? `Disponible (+${profile.wallet.dailyBonusAmount})` : "Deja reclame"}</strong>
                  </div>
                </div>
              </div>
            ),
          },
          {
            id: "payouts",
            label: "Paiements",
            content: (
              <div className="casino-paytable casino-paytable--combos">
                {PAYOUT_TABLE.map((entry) => {
                  const meta = SYMBOL_META[entry.symbol];
                  const comboEntries = [
                    { count: 3, payout: entry.three },
                    { count: 4, payout: entry.four },
                    { count: 5, payout: entry.five },
                  ];

                  return comboEntries.map((combo) => (
                    <article key={`${entry.symbol}-${combo.count}`} className="casino-paytable__combo-card">
                      <div className="casino-paytable__combo-strip" aria-hidden="true">
                        {Array.from({ length: combo.count }, (_, index) => (
                          <img
                            key={`${entry.symbol}-${combo.count}-${index}`}
                            className="casino-paytable__combo-art"
                            src={meta.image}
                            alt=""
                          />
                        ))}
                      </div>
                      <div className="casino-paytable__combo-copy">
                        <span>{combo.count} symboles</span>
                        <strong>{combo.payout}</strong>
                      </div>
                    </article>
                  ));
                })}
              </div>
            ),
          },
          {
            id: "history",
            label: "Historique",
            content: (
              <div className="casino-history-list">
                {recentTransactions.length ? (
                  recentTransactions.map((entry) => (
                    <article key={entry.id} className="casino-history-entry">
                      <div>
                        <span>{formatTransactionLabel(entry.kind)}</span>
                        <strong>{formatTransactionTime(entry.createdAt)}</strong>
                      </div>
                      <div className={entry.amount >= 0 ? "is-positive" : "is-negative"}>
                        {entry.amount >= 0 ? "+" : ""}
                        {formatCredits(entry.amount)}
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="casino-history-empty">Aucune operation enregistree pour le moment.</p>
                )}
              </div>
            ),
          },
        ];
      case "treasure-map":
        return [
          {
            id: "apercu",
            label: "Apercu",
            content: (
              <div className="casino-topdeck__info-stack">
                <div className="casino-topdeck__info-meta">
                  <span>{currentRoom.label}</span>
                  <span>Cout: {currentRoom.costLabel}</span>
                  <span>Wallet: backend A11</span>
                </div>
                <p className="casino-topdeck__info-copy">
                  Une seule tentative par carte. Le coffre principal rapporte {formatCredits(TREASURE_MAP_REWARD)} credits si la bonne croix est choisie.
                </p>
              </div>
            ),
          },
          {
            id: "butin",
            label: "Butin",
            content: (
              <div className="casino-prize-card casino-prize-card--single">
                <img src={lingotImg} alt="Lingot pirate" />
                <div>
                  <strong>Cache principale</strong>
                  <span>+{formatCredits(TREASURE_MAP_REWARD)} credits si la croix est juste</span>
                </div>
              </div>
            ),
          },
          {
            id: "lecture",
            label: "Lecture",
            content: (
              <div className="casino-rule-list">
                <p>Les marqueurs restent centres sur les croix, meme sur mobile.</p>
                <p>La carte est debitée et resolue cote serveur pour coller au vrai wallet A11.</p>
                <p>Quand le coffre apparait, la manche se ferme sans popup parasite ni solde fantome.</p>
              </div>
            ),
          },
        ];
      case "treasure-hunt":
        return [
          {
            id: "apercu",
            label: "Apercu",
            content: (
              <div className="casino-topdeck__info-stack">
                <div className="casino-topdeck__info-meta">
                  <span>{currentRoom.label}</span>
                  <span>Expedition: 120 credits</span>
                  <span>Wallet: backend A11</span>
                </div>
                <p className="casino-topdeck__info-copy">
                  Trois tirs par manche pour reveler jusqu'a trois navires gagnants dans la baie.
                </p>
              </div>
            ),
          },
          {
            id: "recompenses",
            label: "Recompenses",
            content: (
              <div className="casino-prize-stack">
                {TREASURE_HUNT_REWARDS.map((reward) => (
                  <article key={reward} className="casino-prize-card">
                    <div className="casino-prize-card__glyph">★</div>
                    <div>
                      <strong>{formatCredits(reward)} credits</strong>
                      <span>Butin possible sur un navire touche</span>
                    </div>
                  </article>
                ))}
              </div>
            ),
          },
          {
            id: "salves",
            label: "Salves",
            content: (
              <div className="casino-rule-list">
                <p>Chaque expedition coute {formatCredits(120)} credits.</p>
                <p>Tu as trois tirs pour reveler jusqu'a trois navires gagnants.</p>
                <p>Le plateau et le paiement vivent cote serveur pour suivre le vrai wallet A11.</p>
              </div>
            ),
          },
        ];
      case "blackjack":
        return [
          {
            id: "table",
            label: "Table",
            content: (
              <div className="casino-rule-list">
                <p>Table pirate premium avec croupier, jouable en solo ou via un salon live humain.</p>
                <p>Le blackjack naturel paie plus fort, sans jetons locaux hors wallet.</p>
                <p>Le mode solo ne rajoute pas de bots sur le tapis; le live attend 2 joueurs humains.</p>
              </div>
            ),
          },
          {
            id: "mises",
            label: "Mises",
            content: (
              <div className="casino-metric-list">
                <div>
                  <span>Presets</span>
                  <strong>50 / 100 / 200 / 400</strong>
                </div>
                <div>
                  <span>Mode</span>
                  <strong>Solo ou live humain</strong>
                </div>
                <div>
                  <span>Paiement</span>
                  <strong>Wallet A11</strong>
                </div>
                <div>
                  <span>Session</span>
                  <strong>{currentRoom.title}</strong>
                </div>
              </div>
            ),
          },
          {
            id: "live",
            label: "Live",
            content: (
              <div className="casino-rule-list">
                <p>La table reste synchronisee sur le salon courant pour tous les participants humains.</p>
                <p>En live, chaque decision laisse 90 secondes avant resolution automatique du tour.</p>
                <p>Le croupier joue apres les joueurs et la lecture de la table reste compacte sur mobile.</p>
                <p>Les participants actifs sont visibles dans le panneau de jeu a droite.</p>
              </div>
            ),
          },
        ];
      case "poker":
        return [
          {
            id: "structure",
            label: "Structure",
            content: (
              <div className="casino-rule-list">
                <p>Format Texas hold'em rapide avec preflop, flop, turn, river et showdown.</p>
                <p>Le backend gere check, call, bet, raise et fold avec sizing reel.</p>
                <p>Le salon doit compter au moins 2 joueurs humains pour distribuer une main live.</p>
              </div>
            ),
          },
          {
            id: "lecture",
            label: "Lecture",
            content: (
              <div className="casino-metric-list">
                <div>
                  <span>Ante presets</span>
                  <strong>60 / 120 / 200 / 320</strong>
                </div>
                <div>
                  <span>Table</span>
                  <strong>Live humain</strong>
                </div>
                <div>
                  <span>Paiement</span>
                  <strong>Wallet A11</strong>
                </div>
                <div>
                  <span>Mode</span>
                  <strong>Hold'em live</strong>
                </div>
              </div>
            ),
          },
          {
            id: "salon",
            label: "Salon",
            content: (
              <div className="casino-rule-list">
                <p>Les changements de table restent disponibles depuis le panneau de jeu principal.</p>
                <p>Le tour de parole reste borne a 90 secondes sur chaque salon multijoueur.</p>
                <p>Le journal de main et la lecture du spot restent accessibles sur le dock lateral.</p>
                <p>Le hamburger concentre ici les infos rapides pour le mode portrait.</p>
              </div>
            ),
          },
        ];
      default:
        return [
          {
            id: "overview",
            label: "Apercu",
            content: (
              <div className="casino-topdeck__info-meta">
                <span>{currentRoom.label}</span>
                <span>Mode: {currentRoom.title}</span>
                <span>Wallet: backend A11</span>
              </div>
            ),
          },
        ];
    }
  }, [currentRoom, profile.wallet, recentTransactions]);
  const [activeInfoSectionId, setActiveInfoSectionId] = React.useState(infoSections[0]?.id ?? "overview");
  const activeInfoSection = infoSections.find((section) => section.id === activeInfoSectionId) ?? infoSections[0];

  React.useEffect(() => {
    setShowRoomInfo(false);
    setActiveInfoSectionId(infoSections[0]?.id ?? "overview");
  }, [currentRoom.id, infoSections]);

  return (
    <section
      className={`casino-floor ${layoutTemplateClass} casino-floor--room-${currentRoom.id} casino-floor--fused-canvases`}
      data-layout-template={currentRoom.layoutTemplate}
      style={{
        ["--district-art" as string]: `url("${districtArtwork}")`,
        ["--room-art" as string]: `url("${currentRoomArtwork}")`,
      }}
    >
      <div className="casino-floor__room">
        {!["roulette", "blackjack", "poker", "treasure-map", "treasure-hunt"].includes(currentRoom.id) ? (
          <section className="casino-topdeck__summary casino-topdeck__summary--embedded-widget casino-topdeck__summary--fused">
            <div className="casino-topdeck__lead">
              <div className="casino-topdeck__copy">
                <div className="casino-topdeck__chip-row">
                  <span className="casino-chip">{currentRoom.chip}</span>
                  <button
                    type="button"
                    className={`casino-ghost-button casino-topdeck__info-toggle ${showRoomInfo ? "is-open" : ""}`}
                    onClick={() => setShowRoomInfo((value) => !value)}
                    aria-label={`Informations ${currentRoom.label}`}
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
                <strong>{currentRoom.title}</strong>
                <p>{currentRoom.body}</p>

                {showRoomInfo ? (
                  <article className="casino-topdeck__info-panel" aria-label={`Informations ${currentRoom.label}`}>
                    <div className="casino-topdeck__info-buttons" role="tablist" aria-label={`Sections ${currentRoom.label}`}>
                      {infoSections.map((section) => (
                        <button
                          key={section.id}
                          type="button"
                          role="tab"
                          className={`casino-topdeck__info-button ${activeInfoSection?.id === section.id ? "is-active" : ""}`}
                          aria-selected={activeInfoSection?.id === section.id}
                          onClick={() => setActiveInfoSectionId(section.id)}
                        >
                          {section.label}
                        </button>
                      ))}
                    </div>

                    <div className="casino-topdeck__info-body" role="tabpanel">
                      {activeInfoSection?.content}
                    </div>
                  </article>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {children}
      </div>
    </section>
  );
}
