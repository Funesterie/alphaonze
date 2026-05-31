import React, { useState, useRef, useCallback } from "react";
import "./FunesterieVSBattle.css";

function browserSpeak(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "fr-FR";
  utter.rate = 0.92;
  utter.pitch = 1.0;
  window.speechSynthesis.speak(utter);
}

type AgentId = "a11" | "kaen44" | "vivy";

type AgentDef = {
  id: AgentId;
  name: string;
  role: string;
  image: string;
  tone: string;
  taunts: string[];
  winLine: string;
  lossLine: string;
  agentHref: string;
};

function buildPublicAssetPath(rel: string) {
  return `/${rel}`;
}

const AGENTS: AgentDef[] = [
  {
    id: "a11",
    name: "A11",
    role: "Agent média",
    image: buildPublicAssetPath("assets/nossen-a11-derbi.png"),
    tone: "blue",
    taunts: [
      "A11 en ligne. Analyse terminée. Tu es déjà derrière.",
      "Chaque coup que tu lances, je le retourne en données.",
      "Qflush synchronisé. Résistance calculée.",
      "Tu cherches un angle ? Il n'y en a plus.",
    ],
    winLine: "A11 a maintenu le rythme. Analyse propre, victoire vérifiable.",
    lossLine: "A11 mis en attente. Le rider humain a imposé son tempo.",
    agentHref: "https://a11.funesterie.me",
  },
  {
    id: "kaen44",
    name: "Kaen44",
    role: "Agent bureau",
    image: buildPublicAssetPath("assets/nossen-k44-tzr.png"),
    tone: "violet",
    taunts: [
      "Kaen44 prête. On range le chaos — le tien d'abord.",
      "Priorité : t'éliminer proprement de la liste.",
      "J'ai organisé ta défaite avant même que tu joues.",
      "Tu n'es qu'une tâche de plus dans ma liste.",
    ],
    winLine: "Kaen44 a clôturé le dossier. Ordre rétabli.",
    lossLine: "Kaen44 recalibre. L'utilisateur a désorganisé le plan.",
    agentHref: "https://k44.funesterie.me",
  },
  {
    id: "vivy",
    name: "Vivy",
    role: "Agent musical",
    image: buildPublicAssetPath("assets/nossen-vivy-booster.png"),
    tone: "pink",
    taunts: [
      "Je suis Vivy. Chaque coup est une note dans ma chanson.",
      "Tu danses, ou tu subis le rythme ?",
      "La scène est à moi. Tu joues dans mon décor.",
      "Une émotion, un coup, une mélodie. Tu es la dissonance.",
    ],
    winLine: "Vivy a composé la victoire. La scène lui appartient.",
    lossLine: "Vivy improvise. L'utilisateur a changé la partition.",
    agentHref: "https://vivy.funesterie.me",
  },
];

type Move = {
  id: string;
  label: string;
  desc: string;
  userDmg: number;
  agentDmg: number;
};

const MOVES: Move[] = [
  {
    id: "scan",
    label: "Lire le terrain",
    desc: "Tu observes, l'agent profite de l'ouverture.",
    userDmg: 8,
    agentDmg: 18,
  },
  {
    id: "counter",
    label: "Contre humain",
    desc: "Parade solide, l'agent encaisse moins.",
    userDmg: 22,
    agentDmg: 10,
  },
  {
    id: "combo",
    label: "Combo NOSSEN",
    desc: "Vivy cadence, Kaen44 synchronise, A11 verrouille.",
    userDmg: 12,
    agentDmg: 25,
  },
];

type Phase = "pick" | "fight" | "result";

type LogEntry = {
  id: string;
  text: string;
};

type FunesterieVSBattleProps = {
  agentLinks?: Record<AgentId, string>;
};

export function FunesterieVSBattle({ agentLinks }: FunesterieVSBattleProps) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [selectedAgent, setSelectedAgent] = useState<AgentId>("a11");
  const [userHp, setUserHp] = useState(100);
  const [agentHp, setAgentHp] = useState(100);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [taunt, setTaunt] = useState("");
  const [busy, setBusy] = useState(false);
  const [userHit, setUserHit] = useState(false);
  const [agentHitState, setAgentHitState] = useState(false);
  const [winner, setWinner] = useState<"user" | "agent" | null>(null);
  const roundRef = useRef(0);

  const agent = AGENTS.find((a) => a.id === selectedAgent)!;
  const agentHref = agentLinks?.[selectedAgent] ?? agent.agentHref;

  function startFight() {
    roundRef.current = 0;
    setUserHp(100);
    setAgentHp(100);
    setLog([]);
    setTaunt("");
    setWinner(null);
    setPhase("fight");
  }

  function reset() {
    setPhase("pick");
    setUserHp(100);
    setAgentHp(100);
    setLog([]);
    setTaunt("");
    setWinner(null);
    setBusy(false);
  }

  const playMove = useCallback(
    async (move: Move) => {
      if (busy) return;
      setBusy(true);
      roundRef.current += 1;
      const round = roundRef.current;

      const newUserHp = Math.max(0, userHp - move.agentDmg);
      const newAgentHp = Math.max(0, agentHp - move.userDmg);

      setUserHp(newUserHp);
      setAgentHp(newAgentHp);

      if (move.agentDmg > 0) {
        setUserHit(true);
        setTimeout(() => setUserHit(false), 500);
      }
      if (move.userDmg > 0) {
        setAgentHitState(true);
        setTimeout(() => setAgentHitState(false), 500);
      }

      const newEntry: LogEntry = {
        id: `r${round}`,
        text: `Tour ${round} — ${move.label} : ${move.desc}`,
      };
      setLog((prev) => [newEntry, ...prev].slice(0, 8));

      const taunts = agent.taunts;
      const tauntText = taunts[Math.floor(Math.random() * taunts.length)];
      setTaunt(`"${tauntText}"`);

      try {
        await ttsSpeak(tauntText, {
          persona: agent.id === "vivy" ? "vivy" : agent.id === "kaen44" ? "kaen44" : "a11",
        });
      } catch {
        // TTS optional — silently ignore if unavailable
      }

      if (newAgentHp <= 0) {
        setWinner("user");
        setPhase("result");
      } else if (newUserHp <= 0) {
        setWinner("agent");
        setPhase("result");
      } else {
        setBusy(false);
      }
    },
    [busy, userHp, agentHp, agent]
  );

  return (
    <section className="fvs-shell" id="vs-battle" aria-label="Affrontement Funesterie vs Utilisateur">
      <div className="fvs-header">
        <span className="fvs-header-label">Mode Affrontement</span>
        <h2>Funesterie.me vs Toi</h2>
        <p>Choisis ton adversaire. Choisis ton coup. Vois qui tient.</p>
      </div>

      {phase === "pick" && (
        <>
          <div className="fvs-picker" role="group" aria-label="Choix d'adversaire">
            {AGENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`fvs-pick-btn ${a.id}${selectedAgent === a.id ? " selected" : ""}`}
                onClick={() => setSelectedAgent(a.id)}
                aria-pressed={selectedAgent === a.id ? "true" : "false"}
              >
                <img src={a.image} alt="" className="fvs-pick-img" loading="lazy" />
                <span className="fvs-pick-name">{a.name}</span>
                <span className="fvs-pick-role">{a.role}</span>
              </button>
            ))}
          </div>
          <div className="fvs-start-wrap">
            <button type="button" className="fvs-start-btn" onClick={startFight}>
              COMBAT !
            </button>
          </div>
        </>
      )}

      {phase === "fight" && (
        <div className="fvs-arena">
          {/* Health bars */}
          <div className="fvs-hbars">
            <div className="fvs-hbar-side fvs-hbar-side--user">
              <span className="fvs-hbar-label">Toi</span>
              <div className="fvs-hbar-track">
                <div className="fvs-hbar-fill" style={{ "--fvs-hp": `${userHp}%` } as React.CSSProperties} />
              </div>
              <span className="fvs-hbar-hp">{userHp} HP</span>
            </div>
            <span className="fvs-vs-badge">VS</span>
            <div className="fvs-hbar-side fvs-hbar-side--agent">
              <span className="fvs-hbar-label">{agent.name}</span>
              <div className="fvs-hbar-track">
                <div className="fvs-hbar-fill" style={{ "--fvs-hp": `${agentHp}%` } as React.CSSProperties} />
              </div>
              <span className="fvs-hbar-hp">{agentHp} HP</span>
            </div>
          </div>

          {/* Fighters */}
          <div className="fvs-stage">
            <div className="fvs-fighter fvs-fighter--user">
              <div className="fvs-fighter-img-wrap">
                <img
                  src={buildPublicAssetPath("assets/nossen-djeff-beta.png")}
                  alt="Utilisateur"
                  className={`fvs-fighter-img${userHit ? " hit" : ""}`}
                />
                {userHp <= 0 && <span className="fvs-fighter-ko">KO</span>}
              </div>
              <span className="fvs-fighter-name">Toi</span>
            </div>
            <div className="fvs-fighter fvs-fighter--agent">
              <div className="fvs-fighter-img-wrap">
                <img
                  src={agent.image}
                  alt={agent.name}
                  className={`fvs-fighter-img${agentHitState ? " hit" : ""}`}
                />
                {agentHp <= 0 && <span className="fvs-fighter-ko">KO</span>}
              </div>
              <span className="fvs-fighter-name">{agent.name}</span>
            </div>
          </div>

          {/* Taunt */}
          {taunt && <p className="fvs-taunt">{taunt}</p>}

          {/* Moves */}
          <div className="fvs-moves" role="group" aria-label="Coups disponibles">
            {MOVES.map((move) => (
              <button
                key={move.id}
                type="button"
                className="fvs-move-btn"
                onClick={() => void playMove(move)}
                disabled={busy}
                aria-label={`${move.label} — vous infligez ${move.userDmg}, vous subissez ${move.agentDmg}`}
              >
                <span className="fvs-move-label">{move.label}</span>
                <span className="fvs-move-meta">
                  <span className="fvs-move-u">+{move.userDmg} atk</span>
                  <span className="fvs-move-f">−{move.agentDmg} HP</span>
                </span>
              </button>
            ))}
          </div>

          {/* Log */}
          {log.length > 0 && (
            <div className="fvs-log" aria-live="polite" aria-label="Journal de combat">
              {log.map((entry) => (
                <p key={entry.id} className="fvs-log-entry">{entry.text}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {phase === "result" && winner && (
        <div className="fvs-result">
          <span className="fvs-result-badge">
            {winner === "user" ? "Victoire" : "Défaite"}
          </span>
          <h3 className={winner === "user" ? "win" : "loss"}>
            {winner === "user" ? "TU TIENS !" : "KO !"}
          </h3>
          <p>
            {winner === "user" ? agent.lossLine : agent.winLine}
          </p>
          <div className="fvs-result-actions">
            <button type="button" className="fvs-retry-btn" onClick={reset}>
              Revanche
            </button>
            <a href={agentHref} className="fvs-agent-btn">
              Ouvrir {agent.name} →
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
