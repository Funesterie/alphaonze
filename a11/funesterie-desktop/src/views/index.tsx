import type { CSSProperties, Dispatch, SetStateAction } from "react";
import {
  Activity,
  Bot,
  Brain,
  CheckCircle2,
  CircleDot,
  Database,
  Download,
  Gauge,
  Headphones,
  Image,
  MessageCircle,
  Monitor,
  Network,
  Play,
  RefreshCw,
  Send,
  Server,
  Settings,
  Sparkles,
  Terminal,
  UserRound,
  Users,
  Wrench,
  type LucideIcon
} from "lucide-react";

type ViewAgent = {
  id: string;
  name: string;
  role: string;
  color: string;
  avatar: string;
  status?: string;
  active?: boolean;
  host?: string;
  ageSeconds?: number | null;
};

type ViewDiscussion = {
  id: string;
  title: string;
  source: string;
  time: string;
  status?: string;
  messageCount?: number;
};

type ViewModule = {
  name: string;
  state: string;
  color: string;
  icon: LucideIcon;
};

type ViewStatusRow = {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: string;
};

type ViewToolDiff = {
  count: number | null;
  delta: number;
  newTools: string[];
  updatedAt?: string;
};

type ViewEndpoint = {
  label: string;
  state: string;
  color: string;
};

type ViewChatMessage = {
  id: string;
  author: string;
  body: string;
  meta?: string;
};

type SemanticItem = {
  word: string;
  tone: string;
  facets: string[];
};

function toolLabel(name: string) {
  return name.replace(/_/g, " ");
}

function formatAge(ageSeconds?: number | null) {
  if (ageSeconds == null) return "live";
  if (ageSeconds < 60) return `${Math.max(0, Math.round(ageSeconds))}s`;
  return `${Math.round(ageSeconds / 60)}min`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "jamais";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function AgentsView({
  agents,
  discussions,
  selectedAgent,
  selectedAgentId,
  onSelectAgent,
  mcpPanelError
}: {
  agents: ViewAgent[];
  discussions: ViewDiscussion[];
  selectedAgent?: ViewAgent;
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  mcpPanelError: string | null;
}) {
  return (
    <>
      <section className="panel focus-wide">
        <ViewTitle eyebrow="Presence" title="Agents MCP" icon={Users} />
        <div className="view-agent-grid">
          {agents.map((agent) => (
            <button
              key={agent.id}
              className={`view-agent-card ${agent.color} ${selectedAgentId === agent.id || selectedAgent?.id === agent.id ? "selected" : ""}`}
              onClick={() => onSelectAgent(agent.id)}
            >
              <span>{agent.avatar}</span>
              <div>
                <strong>{agent.name}</strong>
                <small>{agent.role}</small>
              </div>
              <b>{agent.status || (agent.active === false ? "offline" : "online")}</b>
            </button>
          ))}
        </div>
      </section>

      <section className="panel focus-side">
        <ViewTitle eyebrow="Selection" title={selectedAgent?.name || "Agent"} icon={Bot} />
        <div className="view-detail-stack">
          <div className={`view-avatar ${selectedAgent?.color || "violet"}`}>{selectedAgent?.avatar || "A"}</div>
          <strong>{selectedAgent?.role || "Coordination Funesterie"}</strong>
          <span>{selectedAgent?.host || "MCP shared bus"}</span>
          <small>Dernier signal: {formatAge(selectedAgent?.ageSeconds)}</small>
        </div>
        {mcpPanelError && (
          <div className="view-alert orange">
            <CircleDot size={16} />
            <span>{mcpPanelError}</span>
          </div>
        )}
      </section>

      <section className="panel focus-full">
        <ViewTitle eyebrow="Discussions" title="Fils ouverts" icon={MessageCircle} />
        <div className="view-discussion-grid">
          {discussions.map((discussion, index) => (
            <article key={discussion.id || discussion.title}>
              <span className={`discussion-dot tone-${index % 5}`} />
              <div>
                <strong>{discussion.title}</strong>
                <small>{discussion.source}</small>
              </div>
              <time>{discussion.status || discussion.time}</time>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

export function MemoryView({
  modules,
  statusRows,
  toolDiff
}: {
  modules: ViewModule[];
  statusRows: ViewStatusRow[];
  toolDiff: ViewToolDiff;
}) {
  return (
    <>
      <section className="panel focus-wide">
        <ViewTitle eyebrow="Memoire" title="Modules vivants" icon={Brain} />
        <div className="view-module-grid">
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <article key={module.name} className={module.color}>
                <Icon size={20} />
                <div>
                  <strong>{module.name}</strong>
                  <small>{module.state}</small>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel focus-side">
        <ViewTitle eyebrow="Signals" title="Sante rapide" icon={Gauge} />
        <div className="view-status-stack">
          {statusRows.map((row) => {
            const Icon = row.icon;
            return (
              <div className={row.tone} key={row.label}>
                <Icon size={18} />
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel focus-full">
        <ViewTitle eyebrow="Registry" title="Nouveaux outils" icon={Sparkles} />
        <div className="view-tool-strip">
          <strong>{toolDiff.count == null ? "scan" : `${toolDiff.count} outils`}</strong>
          <span>{toolDiff.delta > 0 ? `${toolDiff.delta} nouveaux` : "pas de changement detecte"}</span>
          <small>{toolDiff.newTools.length ? toolDiff.newTools.map(toolLabel).join(", ") : formatDateTime(toolDiff.updatedAt)}</small>
        </div>
      </section>
    </>
  );
}

export function MediaView({
  selectedAgent,
  selectedArtwork,
  semanticWheel,
  onPrompt,
  onSelectAgent
}: {
  selectedAgent?: ViewAgent;
  selectedArtwork: string;
  semanticWheel: SemanticItem[];
  onPrompt: (message: string) => Promise<void>;
  onSelectAgent: (id: string) => void;
}) {
  return (
    <>
      <section className="panel focus-wide media-focus-hero">
        <img src={selectedArtwork} alt={selectedAgent?.name || "Funesterie"} />
        <div>
          <ViewTitle eyebrow="Media" title={selectedAgent?.name || "A11 + Vivy"} icon={Headphones} />
          <p>{selectedAgent?.role || "Capture, voix et contexte media Funesterie."}</p>
          <div className="view-command-row">
            <button onClick={() => onSelectAgent("a11")}>
              <Image size={18} />
              <span>A11</span>
            </button>
            <button onClick={() => onSelectAgent("vivy")}>
              <Headphones size={18} />
              <span>Vivy</span>
            </button>
          </div>
        </div>
      </section>

      <section className="panel focus-side">
        <ViewTitle eyebrow="Roulette" title="Resonance" icon={Sparkles} />
        <div className="view-semantic-stack">
          {semanticWheel.map((item) => (
            <button key={item.word} className={item.tone} onClick={() => void onPrompt(`Developpe la resonance semantique de "${item.word}" pour Funesterie.`)}>
              <strong>{item.word}</strong>
              <small>{item.facets.slice(0, 3).join(" / ")}</small>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

export function TerminalView({
  terminalLines,
  commandInput,
  setCommandInput,
  submitCommand,
  messages,
  chatInput,
  setChatInput,
  sendMessage,
  busy,
  profileShortName,
  assistantName
}: {
  terminalLines: string[];
  commandInput: string;
  setCommandInput: Dispatch<SetStateAction<string>>;
  submitCommand: () => void;
  messages: ViewChatMessage[];
  chatInput: string;
  setChatInput: Dispatch<SetStateAction<string>>;
  sendMessage: (message?: string) => Promise<void>;
  busy: boolean;
  profileShortName: string;
  assistantName: string;
}) {
  return (
    <>
      <section className="panel focus-wide">
        <ViewTitle eyebrow="Terminal" title="Journal local" icon={Terminal} />
        <div className="view-command-input">
          <Terminal size={18} />
          <input
            value={commandInput}
            onChange={(event) => setCommandInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitCommand();
            }}
            placeholder="Commande ou demande MCP..."
          />
          <button onClick={submitCommand} title="Executer">
            <Play size={16} />
          </button>
        </div>
        <div className="terminal-lines view-terminal-lines">
          {terminalLines.map((line, index) => (
            <code key={`${line}-${index}`}>{line}</code>
          ))}
        </div>
      </section>

      <section className="panel focus-side">
        <ViewTitle eyebrow="Chat" title={assistantName} icon={MessageCircle} />
        <div className="chat-log view-chat-log">
          {messages.map((message) => (
            <article key={message.id} className={message.author === profileShortName ? "from-user" : ""}>
              <header>
                <strong>{message.author}</strong>
                {message.meta && <small>{message.meta}</small>}
              </header>
              <p>{message.body}</p>
            </article>
          ))}
        </div>
        <div className="composer">
          <textarea
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="Parle au Nexus..."
          />
          <button onClick={() => void sendMessage()} disabled={busy || !chatInput.trim()} title="Envoyer">
            <Send size={18} />
          </button>
        </div>
      </section>
    </>
  );
}

export function SettingsView({
  snapshot,
  syncStatusLabel,
  llmProvider,
  endpoints,
  toolDiff,
  lastSyncAt,
  busy,
  onRefresh,
  onCheckUpdates,
  onSwitchProfile
}: {
  snapshot: DesktopSnapshot | null;
  syncStatusLabel: string;
  llmProvider: string;
  endpoints: ViewEndpoint[];
  toolDiff: ViewToolDiff;
  lastSyncAt: string | null;
  busy: boolean;
  onRefresh: () => void;
  onCheckUpdates: () => void;
  onSwitchProfile: (profileId: string) => void;
}) {
  return (
    <>
      <section className="panel focus-wide">
        <ViewTitle eyebrow="Systeme" title="Configuration locale" icon={Settings} />
        <div className="view-settings-grid">
          <InfoTile icon={UserRound} label="Profil" value={snapshot?.profile.machineLabel || "PC1"} tone="violet" />
          <InfoTile icon={Monitor} label="Machine" value={snapshot?.system.hostname || "FUNESTERIE-PC"} tone="cyan" />
          <InfoTile icon={Network} label="MCP" value={syncStatusLabel} tone="green" />
          <InfoTile icon={Bot} label="LLM" value={llmProvider} tone={llmProvider === "offline" ? "orange" : "green"} />
          <InfoTile icon={Wrench} label="Tools" value={toolDiff.count == null ? "scan" : String(toolDiff.count)} tone="blue" />
          <InfoTile icon={Activity} label="Derniere sync" value={formatDateTime(lastSyncAt)} tone="gold" />
        </div>
      </section>

      <section className="panel focus-side">
        <ViewTitle eyebrow="Actions" title="Maintenance" icon={Wrench} />
        <div className="view-command-row vertical">
          <button onClick={onRefresh} disabled={busy}>
            <RefreshCw size={18} />
            <span>Rafraichir</span>
          </button>
          <button onClick={onCheckUpdates}>
            <Download size={18} />
            <span>Verifier update</span>
          </button>
        </div>
        <div className="view-profile-switch">
          <button onClick={() => onSwitchProfile("pc1-djeff")} disabled={busy}>
            PC1 Djeff
          </button>
          <button onClick={() => onSwitchProfile("pc2-maxence")} disabled={busy}>
            PC2 Maxence
          </button>
        </div>
      </section>

      <section className="panel focus-full">
        <ViewTitle eyebrow="Endpoints" title="MCP routes" icon={Server} />
        <div className="view-endpoint-grid">
          {endpoints.map((endpoint) => (
            <article key={endpoint.label} className={endpoint.color}>
              <CheckCircle2 size={18} />
              <strong>{endpoint.label}</strong>
              <span>{endpoint.state}</span>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function InfoTile({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: string }) {
  return (
    <article className={tone}>
      <Icon size={19} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ViewTitle({ eyebrow, title, icon: Icon }: { eyebrow: string; title: string; icon: LucideIcon }) {
  return (
    <div className="panel-title">
      <Icon size={18} />
      <div>
        <p>{eyebrow}</p>
        <h2>{title}</h2>
      </div>
    </div>
  );
}
