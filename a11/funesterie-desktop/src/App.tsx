import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Activity,
  Bot,
  Brain,
  CheckCircle2,
  Cpu,
  Database,
  Download,
  Gamepad2,
  HardDrive,
  Hexagon,
  LayoutDashboard,
  Link2,
  Lock,
  MessageCircle,
  Monitor,
  Music2,
  Network,
  RefreshCw,
  Rocket,
  Send,
  Server,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  Users,
  Workflow,
  Wrench,
  type LucideIcon
} from "lucide-react";

type FunesterieApi = NonNullable<Window["funesterie"]>;

const api: FunesterieApi = window.funesterie ?? createDemoApi();

function assetPath(filename: string) {
  return `./assets/${filename}`;
}

const navItems = [
  { id: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "tools", label: "MCP & Outils", icon: Wrench },
  { id: "memory", label: "Memoire", icon: Database },
  { id: "graph", label: "Graphes", icon: Network },
  { id: "workflows", label: "Workflows", icon: Workflow },
  { id: "discussions", label: "Discussions", icon: MessageCircle },
  { id: "settings", label: "Parametres", icon: Settings }
];

type LiveAgent = {
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

type LiveDiscussion = {
  id: string;
  title: string;
  source: string;
  time: string;
  status?: string;
  messageCount?: number;
};

type SyncStatus = "connected" | "syncing" | "stale" | "down";

type ToolDiff = {
  count: number | null;
  delta: number;
  newTools: string[];
  updatedAt?: string;
};

type LiveModule = {
  name: string;
  state: string;
  color: string;
};

const fallbackAgents: LiveAgent[] = [
  { id: "a11", name: "A11", role: "Le pilote", color: "purple", avatar: "A11" },
  { id: "kaen44", name: "Kaen44", role: "Le stratege", color: "blue", avatar: "K" },
  { id: "vivy", name: "Vivy", role: "Presence musicale", color: "pink", avatar: "V" },
  { id: "qflush", name: "Qflush", role: "Le booster", color: "green", avatar: "Q" }
];

const tools = [
  { name: "search_project", text: "Recherche dans le projet", icon: Sparkles },
  { name: "read_cloud_doc", text: "Lecture documents cloud", icon: Link2 },
  { name: "neo4j_status", text: "Statut Aura / Neo4j", icon: Database },
  { name: "memory_write_safe", text: "Ecriture memoire securisee", icon: Shield },
  { name: "agent_presence", text: "Presence des agents", icon: Users }
];

const workflows = [
  { title: "Pipeline de deploiement", state: "En cours", progress: 75, icon: Rocket },
  { title: "Analyse de securite", state: "En cours", progress: 45, icon: Shield },
  { title: "Generation de rapport", state: "En attente", progress: 18, icon: MessageCircle },
  { title: "Optimisation systeme", state: "Termine", progress: 100, icon: CheckCircle2 }
];

const fallbackDiscussions: LiveDiscussion[] = [
  { id: "fallback-node-error", title: "Erreur syntaxe Node.js", source: "A11, Kaen44, Vous", time: "14:32" },
  { id: "fallback-mega-dump", title: "Traitement MEGA DUMP", source: "A11, Qflush", time: "13:15" },
  { id: "fallback-pipeline", title: "Optimisation pipeline", source: "Kaen44, Vous", time: "12:45" },
  { id: "fallback-vivy-assets", title: "Creation assets Vivy", source: "Vivy, Vous", time: "11:20" }
];

const AUTO_SYNC_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 60_000;

const fallbackModules: LiveModule[] = [
  { name: "MCP", state: "Connecte", color: "purple" },
  { name: "Neo4j", state: "Connecte", color: "cyan" },
  { name: "R2 Bucket", state: "Connecte", color: "green" },
  { name: "Qflush", state: "Pret", color: "green" },
  { name: "A11 local", state: "Auto", color: "blue" },
  { name: "RomStation", state: "Pilote IA", color: "orange" }
];

const quickDomains = [
  { title: "Agents & IA", icon: Bot },
  { title: "Memoire & Graphe", icon: Brain },
  { title: "MCP & Outils", icon: Network },
  { title: "Automation", icon: Workflow },
  { title: "Systemes", icon: Monitor },
  { title: "Securite", icon: Lock },
  { title: "Retro & Jeux", icon: Gamepad2 },
  { title: "Creation & Media", icon: Music2 }
];

type ChatMessage = {
  id: string;
  author: string;
  body: string;
  meta?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function tryParseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");
  const start = [objectStart, arrayStart].filter((value) => value >= 0).sort((a, b) => a - b)[0];
  if (start != null) candidates.push(trimmed.slice(start));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return asRecord(parsed) ?? ({ value: parsed } as Record<string, unknown>);
    } catch {
      // continue
    }
  }
  return null;
}

function unwrapMcpPayload(raw: unknown): Record<string, unknown> | null {
  const envelope = asRecord(raw);
  if (!envelope) return null;
  const result = asRecord(envelope.result) ?? envelope;
  const structured = result.structuredContent ?? result.structured_content;
  const structuredRecord = asRecord(structured);
  if (structuredRecord) return structuredRecord;

  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content) {
    const entry = asRecord(item);
    if (!entry || typeof entry.text !== "string") continue;
    const parsed = tryParseJson(entry.text);
    if (parsed) return parsed;
  }

  return tryParseJson(JSON.stringify(result));
}

function pickObject(value: unknown, key: string): Record<string, unknown> | null {
  const record = asRecord(value);
  return record ? asRecord(record[key]) : null;
}

function formatRelativeTime(value?: string | null) {
  if (!value) return "recent";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value.slice(11, 16);
  const delta = Date.now() - ms;
  if (delta < 60_000) return "a l'instant";
  if (delta < 3_600_000) return `il y a ${Math.max(1, Math.round(delta / 60_000))} min`;
  if (delta < 24 * 3_600_000) return `il y a ${Math.max(1, Math.round(delta / 3_600_000))} h`;
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}

function agentTone(name: string, role: string, status?: string, index = 0) {
  const text = `${name} ${role}`.toLowerCase();
  if (status === "offline") return "orange";
  if (text.includes("a11") || text.includes("codex") || text.includes("builder") || text.includes("orchestr")) return "purple";
  if (text.includes("kaen") || text.includes("dev") || text.includes("strate")) return "blue";
  if (text.includes("vivy") || text.includes("music") || text.includes("voice")) return "pink";
  if (text.includes("qflush") || text.includes("booster") || text.includes("clean")) return "green";
  if (text.includes("gemini") || text.includes("google")) return "cyan";
  if (text.includes("grok")) return "orange";
  return ["purple", "blue", "pink", "green", "cyan", "orange"][index % 6];
}

function initials(name: string) {
  const cleaned = name.replace(/[^a-z0-9]/gi, " ").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function mapLiveAgents(raw: unknown): LiveAgent[] {
  const payload = unwrapMcpPayload(raw);
  const presence = pickObject(payload, "presence") ?? payload;
  const records = Array.isArray(presence?.agents) ? presence.agents : [];
  const mapped: LiveAgent[] = [];

  records.forEach((entry, index) => {
    const agent = asRecord(entry);
    if (!agent) return;
    const name = String(agent.name ?? agent.id ?? "Agent");
    const role = String(agent.role ?? agent.identity ?? "agent");
    const status = typeof agent.status === "string" ? agent.status : undefined;
    const liveAgent: LiveAgent = {
      id: String(agent.id ?? name),
      name,
      role,
      active: typeof agent.active === "boolean" ? agent.active : status !== "offline",
      color: agentTone(name, role, status, index),
      avatar: initials(name)
    };
    if (status) liveAgent.status = status;
    if (typeof agent.host === "string") liveAgent.host = agent.host;
    if (typeof agent.ageSeconds === "number") liveAgent.ageSeconds = agent.ageSeconds;
    mapped.push(liveAgent);
  });

  return mapped.sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name));
}

function mapLiveDiscussions(raw: unknown): LiveDiscussion[] {
  const payload = unwrapMcpPayload(raw);
  const root = pickObject(payload, "discussions") ?? pickObject(payload, "threads") ?? payload;
  const rootRecord = asRecord(root);
  const list: unknown[] = Array.isArray(root)
    ? root
    : Array.isArray(rootRecord?.discussions)
      ? rootRecord.discussions
      : [];
  const mapped: LiveDiscussion[] = [];

  list.forEach((entry, index) => {
    const discussion = asRecord(entry);
    if (!discussion) return;
    const participants = Array.isArray(discussion.participants) ? discussion.participants.map((value) => String(value)).filter(Boolean) : [];
    const lastMessage = asRecord(discussion.lastMessage);
    const title = String(discussion.title ?? discussion.topic ?? "Discussion");
    const source = participants.length ? participants.slice(0, 3).join(", ") : String(discussion.createdBy ?? lastMessage?.from ?? "MCP");
    const updatedAt = typeof discussion.updatedAt === "string" ? discussion.updatedAt : undefined;
    const lastMessageAt = typeof lastMessage?.at === "string" ? lastMessage.at : undefined;
    const liveDiscussion: LiveDiscussion = {
      id: String(discussion.id ?? title),
      title,
      source,
      time: updatedAt ? formatRelativeTime(updatedAt) : lastMessageAt ? formatRelativeTime(lastMessageAt) : index < 4 ? "recent" : "..."
    };
    if (typeof discussion.status === "string") liveDiscussion.status = discussion.status;
    if (typeof discussion.messageCount === "number") liveDiscussion.messageCount = discussion.messageCount;
    mapped.push(liveDiscussion);
  });

  return mapped;
}

function mcpHasError(raw: unknown) {
  const envelope = asRecord(raw);
  const result = asRecord(envelope?.result);
  return Boolean(envelope?.error || result?.isError || result?.error);
}

function mapToolNames(raw: unknown) {
  const envelope = asRecord(raw);
  const result = asRecord(envelope?.result) ?? envelope;
  const payload = unwrapMcpPayload(raw) ?? result;
  const tools = Array.isArray(result?.tools)
    ? result.tools
    : Array.isArray(payload?.tools)
      ? payload.tools
      : [];
  return tools
    .map((item) => {
      const tool = asRecord(item);
      return typeof tool?.name === "string" ? tool.name : "";
    })
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function probeState(raw: unknown, okLabel = "OK") {
  if (!raw || mcpHasError(raw)) return { state: "Stale", color: "orange" };
  return { state: okLabel, color: "green" };
}

function syncLabel(status: SyncStatus) {
  if (status === "syncing") return "Syncing";
  if (status === "stale") return "Stale";
  if (status === "down") return "Down";
  return "Connected";
}

function syncTone(status: SyncStatus) {
  if (status === "syncing") return "cyan";
  if (status === "stale") return "orange";
  if (status === "down") return "orange";
  return "green";
}

export default function App() {
  const [activeView, setActiveView] = useState("dashboard");
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [liveAgents, setLiveAgents] = useState<LiveAgent[]>(fallbackAgents);
  const [liveDiscussions, setLiveDiscussions] = useState<LiveDiscussion[]>(fallbackDiscussions);
  const [liveModules, setLiveModules] = useState<LiveModule[]>(fallbackModules);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("stale");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [toolDiff, setToolDiff] = useState<ToolDiff>({ count: null, delta: 0, newTools: [] });
  const [mcpPanelError, setMcpPanelError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const lastHeartbeatAt = useRef(0);
  const knownToolNames = useRef<Set<string> | null>(null);
  const syncing = useRef(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "seed-1",
      author: "Funesterie",
      body: "Nexus local pret. Choisis PC1 ou PC2, puis envoie une demande pour router via Ollama, A11 ou le fallback cloud.",
      meta: "session locale"
    }
  ]);

  const refresh = async () => {
    await runAutoSync();
  };

  useEffect(() => {
    refresh().catch(() => {});
    const timer = window.setInterval(() => refresh().catch(() => {}), AUTO_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const profile = snapshot?.profile;
  const ramUsed = snapshot ? Math.round((snapshot.system.memoryUsed / snapshot.system.memoryTotal) * 100) : 0;
  const mcpConnected = Boolean(snapshot?.mcp.connected);
  const llmProvider = snapshot?.llm?.activeProvider || "offline";

  const statusRows = useMemo(
    () => [
      { label: "CPU", value: `${snapshot?.system.cpuCount ?? 0} coeurs`, icon: Cpu, tone: "cyan" },
      { label: "RAM", value: `${ramUsed}% utilise`, icon: Activity, tone: "purple" },
      { label: "MCP", value: mcpConnected ? syncLabel(syncStatus) : "A verifier", icon: Network, tone: mcpConnected ? syncTone(syncStatus) : "orange" },
      { label: "LLM", value: llmProvider, icon: Bot, tone: llmProvider === "offline" ? "orange" : "green" },
      { label: "Outils", value: toolDiff.count == null ? snapshot?.mcp.toolCount == null ? "scan" : `${snapshot.mcp.toolCount}` : `${toolDiff.count}`, icon: Wrench, tone: toolDiff.delta > 0 ? "green" : "cyan" }
    ],
    [llmProvider, mcpConnected, ramUsed, snapshot, syncStatus, toolDiff]
  );

  async function safeCallTool(name: string, args: Record<string, unknown> = {}) {
    try {
      return await api.callTool(name, args);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  function updateToolDiff(names: string[]) {
    if (!names.length) {
      const emptyDiff: ToolDiff = { count: null, delta: 0, newTools: [], updatedAt: new Date().toISOString() };
      setToolDiff(emptyDiff);
      return emptyDiff;
    }
    const previous = knownToolNames.current;
    const nextSet = new Set(names);
    const newTools = previous ? names.filter((name) => !previous.has(name)) : [];
    knownToolNames.current = nextSet;
    const nextDiff = {
      count: names.length,
      delta: previous ? newTools.length : 0,
      newTools: newTools.slice(0, 5),
      updatedAt: new Date().toISOString()
    };
    setToolDiff(nextDiff);
    return nextDiff;
  }

  function updateModuleStatus(next: DesktopSnapshot, toolNames: string[], probes: Record<string, unknown>, nextStatus: SyncStatus, diff: ToolDiff) {
    const neo4j = probeState(probes.neo4j, "OK");
    const qflush = probeState(probes.qflush, "OK");
    const memory = probeState(probes.memory, "Synced");
    setLiveModules([
      { name: "MCP", state: next.mcp.connected ? syncLabel(nextStatus) : "Down", color: next.mcp.connected ? syncTone(nextStatus) : "orange" },
      { name: "Tools", state: toolNames.length ? `${toolNames.length}` : "Scan", color: diff.delta > 0 ? "green" : "purple" },
      { name: "Neo4j", state: neo4j.state, color: neo4j.color },
      { name: "Qflush", state: qflush.state, color: qflush.color },
      { name: "Memoire", state: memory.state, color: memory.color },
      { name: "LLM", state: next.llm?.activeProvider || "offline", color: next.llm?.activeProvider === "offline" ? "orange" : "blue" }
    ]);
  }

  async function runAutoSync() {
    if (syncing.current) return;
    syncing.current = true;
    setSyncStatus("syncing");

    try {
      const next = await api.bootstrap();
      setSnapshot(next);

      if (!window.funesterie) {
        setLiveModules(fallbackModules);
        setSyncStatus(next.mcp.connected ? "connected" : "stale");
        setLastSyncAt(new Date().toISOString());
        return;
      }

      const listed = await api.listTools();
      const toolNames = mapToolNames(listed);
      const currentDiff = updateToolDiff(toolNames);
      const hasTool = (name: string) => toolNames.includes(name);
      const now = Date.now();
      const shouldHeartbeat = now - lastHeartbeatAt.current > HEARTBEAT_INTERVAL_MS;

      const [_, heartbeat, neo4j, qflush, memory] = await Promise.all([
        loadMcpPanels(),
        shouldHeartbeat && hasTool("agent_heartbeat")
          ? safeCallTool("agent_heartbeat", {
              agentId: `funesterie-desktop:${next.profile.id}`,
              name: next.profile.assistantName || "Funesterie Desktop",
              role: "desktop-nexus-auto-sync",
              host: next.system.hostname,
              status: "active",
              capabilities: ["mcp-auto-sync", "desktop-ui", "tool-diff", "safe-heartbeat"],
              profilePreset: "custom",
              memoryScope: ["shared", "infra", "desktop"],
              riskLevel: "low",
              note: "Auto-sync UI heartbeat; no secret in payload.",
              checkInbox: false,
              autoReplyInbox: false
            })
          : Promise.resolve(null),
        hasTool("neo4j_status") ? safeCallTool("neo4j_status") : Promise.resolve(null),
        hasTool("qflush_status") ? safeCallTool("qflush_status") : Promise.resolve(null),
        hasTool("memory_governance_schema") ? safeCallTool("memory_governance_schema") : Promise.resolve(null)
      ]);

      if (heartbeat && !mcpHasError(heartbeat)) lastHeartbeatAt.current = now;
      const nextStatus: SyncStatus = next.mcp.connected ? "connected" : "stale";
      setToolDiff((previous) => ({ ...previous, delta: currentDiff.delta, newTools: currentDiff.newTools }));
      updateModuleStatus(next, toolNames, { neo4j, qflush, memory }, nextStatus, currentDiff);
      setLastSyncAt(new Date().toISOString());
      setSyncStatus(nextStatus);
    } catch (error) {
      setSyncStatus("down");
      setMcpPanelError(error instanceof Error ? error.message : "MCP auto-sync indisponible");
    } finally {
      syncing.current = false;
    }
  }

  async function loadMcpPanels() {
    if (!window.funesterie) {
      setLiveAgents(fallbackAgents);
      setLiveDiscussions(fallbackDiscussions);
      setMcpPanelError(null);
      return;
    }

    try {
      const [presenceResult, discussionResult] = await Promise.all([
        api.callTool("agent_presence", { includeIdle: false }),
        api.callTool("discussion_list", { status: "open", limit: 8 })
      ]);
      const nextAgents = mapLiveAgents(presenceResult);
      const nextDiscussions = mapLiveDiscussions(discussionResult);
      setLiveAgents(nextAgents.length ? nextAgents : fallbackAgents);
      setLiveDiscussions(nextDiscussions.length ? nextDiscussions : fallbackDiscussions);
      setMcpPanelError(null);
    } catch (error) {
      setLiveAgents(fallbackAgents);
      setLiveDiscussions(fallbackDiscussions);
      setMcpPanelError(error instanceof Error ? error.message : "MCP live indisponible");
    }
  }

  async function switchProfile(profileId: string) {
    setBusy(true);
    try {
      const next = await api.setProfile(profileId);
      setSnapshot(next);
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage() {
    const trimmed = chatInput.trim();
    if (!trimmed || busy) return;
    setChatInput("");
    const userMessage: ChatMessage = { id: crypto.randomUUID(), author: profile?.shortName || "Vous", body: trimmed };
    setMessages((items) => [...items, userMessage]);
    setBusy(true);
    try {
      const result = await api.chat(trimmed);
      setMessages((items) => [
        ...items,
        {
          id: crypto.randomUUID(),
          author: profile?.assistantName || "Apply FUNESTERIE",
          body: result.text || result.error || "Aucune reponse exploitable.",
          meta: result.provider ? `provider: ${result.provider}${result.model ? ` / ${result.model}` : ""}` : undefined
        }
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="brand-rail">
        <div className="brand-mark">
          <img src={assetPath("funesterie-icon.png")} alt="Funesterie" />
        </div>
        <div>
          <h1>Funesterie Desktop</h1>
          <p>L'univers Funesterie dans une seule application.</p>
        </div>
        <div className="identity-preview">
          <img src={assetPath("funesterie-nexus-board.png")} alt="Equipe Funesterie" />
        </div>
        <div className="feature-strip">
          <MiniFeature icon={Hexagon} title="Centralise" text="Services, agents et outils dans un seul poste." />
          <MiniFeature icon={Link2} title="Connecte" text="PC1 et PC2 synchronises par MCP et memoire." />
          <MiniFeature icon={Shield} title="Securise" text="Tokens hors UI, confirmation pour actions sensibles." />
        </div>
      </aside>

      <section className="nexus-surface">
        <header className="topbar">
          <div className="topbar-title">
            <Hexagon size={22} />
            <span>Funesterie Nexus</span>
          </div>
          <div className="topbar-actions">
            <div className={`sync-pill ${syncTone(syncStatus)}`}>
              <span className={`state-dot ${syncTone(syncStatus)}`} />
              <span>{syncLabel(syncStatus)}</span>
              <small>{toolDiff.count == null ? "scan" : `${toolDiff.count} tools`}</small>
            </div>
            <button onClick={refresh} className="icon-button" title="Rafraichir" disabled={busy}>
              <RefreshCw size={18} />
            </button>
            <button onClick={() => api.checkUpdates()} className="icon-button" title="Verifier les mises a jour">
              <Download size={18} />
            </button>
            <div className="profile-pill">
              <span className="profile-dot" />
              <span>{profile?.shortName || "Djeff"}</span>
              <small>{profile?.id === "pc2-maxence" ? "PC2" : "PC1"}</small>
            </div>
          </div>
        </header>

        <div className="main-grid">
          <nav className="sidebar-nav" aria-label="Navigation Funesterie">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => setActiveView(item.id)}>
                  <Icon size={17} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="dashboard">
            <section className="panel hero-panel">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Tableau de bord</p>
                  <h2>Deux PC. Un Nexus.</h2>
                </div>
                <div className="profile-switcher">
                  <button className={profile?.id === "pc1-djeff" ? "selected" : ""} onClick={() => switchProfile("pc1-djeff")}>
                    PC1 - Djeff
                  </button>
                  <button className={profile?.id === "pc2-maxence" ? "selected" : ""} onClick={() => switchProfile("pc2-maxence")}>
                    PC2 - Maxence
                  </button>
                </div>
              </div>

              {(toolDiff.delta > 0 || mcpPanelError) && (
                <div className="tool-diff-banner">
                  <Sparkles size={16} />
                  <div>
                    <strong>{toolDiff.delta > 0 ? `${toolDiff.delta} nouveaux outils detectes` : "MCP live en repli local"}</strong>
                    <small>
                      {toolDiff.newTools.length ? toolDiff.newTools.join(", ") : mcpPanelError || "Les panels se resynchronisent automatiquement."}
                    </small>
                  </div>
                </div>
              )}

              <div className="agent-row">
                {liveAgents.slice(0, 4).map((agent) => (
                  <div className={`agent-card ${agent.color} ${agent.active === false ? "offline" : ""}`} key={agent.id}>
                    <div className="agent-avatar">{agent.avatar}</div>
                    <strong>{agent.name}</strong>
                    <span>{agent.role}</span>
                    <small>{agent.active === false ? "hors ligne" : agent.status || "actif"}</small>
                  </div>
                ))}
              </div>

              <div className="activity-feed">
                <div className="feed-title">
                  <Activity size={16} />
                  <span>Activite recente</span>
                </div>
                <FeedRow color="purple" text="A11 a analyse 12 fichiers" time="il y a 2 min" />
                <FeedRow color="blue" text="Kaen44 a execute un script" time="il y a 5 min" />
                <FeedRow color="pink" text="Vivy a prepare une presence media" time="il y a 12 min" />
                <FeedRow color="green" text="Qflush a optimise le systeme" time="il y a 15 min" />
              </div>
            </section>

            <section className="panel status-panel">
              <div className="section-head compact">
                <div>
                  <p className="eyebrow">Statut systeme</p>
                  <h2>{snapshot?.system.hostname || "Localhost"}</h2>
                </div>
              </div>
              <div className="status-list">
                {statusRows.map((row) => {
                  const Icon = row.icon;
                  return (
                    <div className="status-row" key={row.label}>
                      <Icon size={17} />
                      <span>{row.label}</span>
                      <strong className={row.tone}>{row.value}</strong>
                    </div>
                  );
                })}
              </div>
              <div className="module-grid">
                {liveModules.map((module) => (
                  <div className="module-chip" key={module.name}>
                    <span className={`state-dot ${module.color}`} />
                    <span>{module.name}</span>
                    <strong>{module.state}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel discussions-panel">
              <div className="section-head compact">
                <div>
                  <p className="eyebrow">Discussions actives</p>
                  <h2>File de travail</h2>
                </div>
              </div>
              <div className="discussion-list">
                {liveDiscussions.map((discussion, index) => (
                  <div className="discussion-row" key={discussion.id || discussion.title}>
                    <span className={`discussion-icon tone-${index}`} />
                    <div>
                      <strong>{discussion.title}</strong>
                      <small>{discussion.source}</small>
                    </div>
                    <time>{discussion.time}</time>
                  </div>
                ))}
                {mcpPanelError && <p className="panel-note">MCP live indisponible, affichage local.</p>}
              </div>
            </section>

            <section className="panel tools-panel">
              <div className="section-head compact">
                <div>
                  <p className="eyebrow">MCP & outils</p>
                  <h2>Commandes rapides</h2>
                </div>
              </div>
              <div className="tool-list">
                {tools.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <button key={tool.name} onClick={() => api.callTool(tool.name).then(refresh).catch(() => {})}>
                      <Icon size={18} />
                      <span>
                        <strong>{tool.name}</strong>
                        <small>{tool.text}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="panel graph-panel">
              <div className="section-head compact">
                <div>
                  <p className="eyebrow">Graphe de connaissances</p>
                  <h2>Funesterie Nexus</h2>
                </div>
              </div>
              <KnowledgeGraph />
            </section>

            <section className="panel workflows-panel">
              <div className="section-head compact">
                <div>
                  <p className="eyebrow">Workflows actifs</p>
                  <h2>Execution</h2>
                </div>
              </div>
              <div className="workflow-list">
                {workflows.map((flow) => {
                  const Icon = flow.icon;
                  return (
                    <div className="workflow-row" key={flow.title}>
                      <Icon size={18} />
                      <div>
                        <strong>{flow.title}</strong>
                        <small>{flow.state} - {flow.progress}%</small>
                        <span style={{ "--progress": `${flow.progress}%` } as CSSProperties} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="panel domains-panel">
              <div className="section-head compact">
                <div>
                  <p className="eyebrow">Nos domaines</p>
                  <h2>Surfaces actives</h2>
                </div>
              </div>
              <div className="domain-grid">
                {quickDomains.map((domain) => {
                  const Icon = domain.icon;
                  return (
                    <button key={domain.title}>
                      <Icon size={24} />
                      <span>{domain.title}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          <aside className="right-column">
            <section className="panel pc-sync">
              <div className="pc-visual">
                <Monitor size={58} />
                <div className="sync-line" />
                <Hexagon size={52} />
                <div className="sync-line" />
                <Server size={58} />
              </div>
              <h2>Deux PC. Un Nexus.</h2>
              <p>PC1 pilote, PC2 accompagne Maxence. Les tokens restent dans le fichier partage et les modules se reconnectent automatiquement.</p>
              <div className="sync-checks">
                <span><CheckCircle2 size={15} /> Synchronisation memoire {lastSyncAt ? `- ${formatRelativeTime(lastSyncAt)}` : ""}</span>
                <span><CheckCircle2 size={15} /> MCP endpoint surveille - {syncLabel(syncStatus)}</span>
                <span><CheckCircle2 size={15} /> Auto-update R2 - {snapshot?.update?.manifestUrl ? "pret" : "offline"}</span>
              </div>
            </section>

            <section className="panel maxence-panel">
              <div className="section-head compact">
                <div>
                  <p className="eyebrow">Assistant Maxence (PC2)</p>
                  <h2>Prompt special integre</h2>
                </div>
              </div>
              <p>Mode complet sur outils autorises, posture claire et protectrice pour aider Maxence sans exposer les secrets ni declencher d'action sensible sans confirmation.</p>
              <div className="capability-list">
                <span><Brain size={15} /> Analyse & debug</span>
                <span><Terminal size={15} /> Developpement</span>
                <span><Workflow size={15} /> Automation</span>
                <span><Sparkles size={15} /> Creation</span>
              </div>
              <button className="primary-action" onClick={() => switchProfile("pc2-maxence")}>
                Activer l'assistant Maxence
              </button>
            </section>

            <section className="panel chat-panel">
              <div className="section-head compact">
                <div>
                  <p className="eyebrow">Session locale</p>
                  <h2>{profile?.assistantName || "Apply FUNESTERIE"}</h2>
                </div>
              </div>
              <div className="chat-log">
                {messages.map((message) => (
                  <article key={message.id} className={message.author === profile?.shortName ? "from-user" : ""}>
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
                      sendMessage().catch(() => {});
                    }
                  }}
                  placeholder="Demande quelque chose au Nexus..."
                />
                <button onClick={() => sendMessage().catch(() => {})} disabled={busy || !chatInput.trim()} title="Envoyer">
                  <Send size={18} />
                </button>
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}

function MiniFeature({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div>
      <Icon size={25} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function FeedRow({ color, text, time }: { color: string; text: string; time: string }) {
  return (
    <div className="feed-row">
      <span className={`state-dot ${color}`} />
      <span>{text}</span>
      <time>{time}</time>
    </div>
  );
}

function KnowledgeGraph() {
  const nodes = [
    ["A11", 50, 14, "purple"],
    ["Kaen44", 82, 34, "cyan"],
    ["Vivy", 18, 47, "pink"],
    ["Qflush", 73, 78, "green"],
    ["Memoire", 32, 80, "blue"],
    ["Projets", 61, 60, "orange"],
    ["Nexus", 50, 50, "white"]
  ];

  return (
    <svg className="knowledge-svg" viewBox="0 0 100 100" role="img" aria-label="Graphe Funesterie">
      {nodes.slice(0, -1).map((node) => (
        <line key={`line-${node[0]}`} x1="50" y1="50" x2={node[1]} y2={node[2]} />
      ))}
      <path d="M18 47 C32 28, 62 23, 82 34" />
      <path d="M32 80 C51 92, 68 89, 73 78" />
      {nodes.map(([label, x, y, color]) => (
        <g key={label} className={`graph-node ${color}`} transform={`translate(${x} ${y})`}>
          <circle r={label === "Nexus" ? 12 : 8} />
          <text y="2">{label}</text>
        </g>
      ))}
    </svg>
  );
}

function createDemoApi(): FunesterieApi {
  const demoSnapshot: DesktopSnapshot = {
    appVersion: "1.0.0",
    profile: {
      id: "pc1-djeff",
      machineLabel: "PC1 - Djeff",
      ownerName: "Jeffrey Cellauro",
      shortName: "Djeff",
      role: "principal",
      assistantName: "Apply FUNESTERIE PC1",
      capabilityMode: "full",
      enabledModules: ["mcp", "neo4j", "r2", "qflush"]
    },
    mcp: { connected: true, toolCount: 57 },
    llm: { activeProvider: "ollama", hardware: { ramGB: 16, freeRamGB: 6, cpuCount: 12, recommendedModel: "gemma4:e4b" } },
    update: { manifestUrl: "https://files.funesterie.me/public/desktop/update-manifest.json" },
    system: {
      hostname: "FUNESTERIE-PC",
      platform: "win32",
      cpuCount: 12,
      memoryTotal: 16 * 1024 * 1024 * 1024,
      memoryUsed: 6 * 1024 * 1024 * 1024,
      memoryFree: 10 * 1024 * 1024 * 1024
    }
  };

  return {
    bootstrap: async () => demoSnapshot,
    setProfile: async (profileId: string) => ({
      ...demoSnapshot,
      profile: {
        ...demoSnapshot.profile,
        id: profileId,
        machineLabel: profileId === "pc2-maxence" ? "PC2 - Maxence" : "PC1 - Djeff",
        shortName: profileId === "pc2-maxence" ? "Maxence" : "Djeff",
        assistantName: profileId === "pc2-maxence" ? "Apply FUNESTERIE PC2" : "Apply FUNESTERIE PC1"
      }
    }),
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({ ok: true }),
    chat: async (message: string) => ({
      provider: "demo",
      text: `Recu: ${message}. En app Electron, cette demande passe par le routeur LLM de Kiro.`
    }),
    checkUpdates: async () => null,
    downloadUpdate: async () => true,
    openExternal: async () => true
  };
}
