import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Activity,
  Bell,
  Bot,
  Brain,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Cpu,
  Database,
  Download,
  FileText,
  Gamepad2,
  Gauge,
  HardDrive,
  Headphones,
  Hexagon,
  History,
  Image,
  Layers3,
  Link2,
  Lock,
  MessageCircle,
  Mic2,
  Monitor,
  Music2,
  Network,
  Orbit,
  Play,
  RefreshCw,
  Rocket,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  UserRound,
  Users,
  WandSparkles,
  Workflow,
  Wrench,
  type LucideIcon
} from "lucide-react";
import { AgentsView, MediaView, MemoryView, SettingsView, TerminalView } from "./views";

type FunesterieApi = NonNullable<Window["funesterie"]>;

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
  icon: LucideIcon;
};

type ChatMessage = {
  id: string;
  author: string;
  body: string;
  meta?: string;
};

const api: FunesterieApi = window.funesterie ?? createDemoApi();

const AUTO_SYNC_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 60_000;

const founderProfiles = new Set(["pc1-djeff"]);

const sectionTabs = [
  { id: "cockpit", label: "Cockpit", icon: Gauge },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "memory", label: "Memoire", icon: Brain },
  { id: "media", label: "Media", icon: Image },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "settings", label: "Systeme", icon: Settings }
];

const fallbackAgents: LiveAgent[] = [
  { id: "kaen44", name: "Kaen44", role: "Copilote quotidien", color: "violet", avatar: "K", status: "active", active: true },
  { id: "a11", name: "A11", role: "Agent media et memoire", color: "cyan", avatar: "A11", status: "ready", active: true },
  { id: "vivy", name: "Vivy", role: "Presence musicale", color: "pink", avatar: "V", status: "standby", active: true },
  { id: "codex", name: "Codex", role: "Developpement et coordination", color: "blue", avatar: "CD", status: "ready", active: true },
  { id: "kiro", name: "Kiro", role: "Execution locale", color: "green", avatar: "KI", status: "ready", active: true },
  { id: "claude", name: "Claude", role: "Audit et lecture", color: "gold", avatar: "CL", status: "standby", active: true }
];

const fallbackDiscussions: LiveDiscussion[] = [
  { id: "founder-ui", title: "Cockpit fondateur", source: "Codex, K44, A11", time: "recent" },
  { id: "runtime-repair", title: "Runtime et presence markers", source: "A11, Doctor", time: "recent" },
  { id: "semantic", title: "Roulette media semantique", source: "A11, Vivy", time: "recent" },
  { id: "desktop-update", title: "Funesterie Desktop 1.0.4", source: "PC1, PC2", time: "recent" }
];

const workflows = [
  { title: "MCP public", state: "surveille", progress: 82, icon: Network, tone: "green" },
  { title: "Neo4j memoire", state: "synchro", progress: 76, icon: Database, tone: "cyan" },
  { title: "Agents prod", state: "presence", progress: 68, icon: Users, tone: "violet" },
  { title: "Media Vivy", state: "atelier", progress: 44, icon: Music2, tone: "pink" },
  { title: "Desktop update", state: "draft", progress: 61, icon: Download, tone: "blue" }
];

const semanticWheel = [
  { word: "sapin", tone: "green", facets: ["foret", "hiver", "Noel", "humour noir", "odeur", "argot"] },
  { word: "Black Pearl", tone: "gold", facets: ["liberte", "equipage", "chaos", "aventure", "style"] },
  { word: "Vivy", tone: "pink", facets: ["voix", "scene", "emotion", "memoire sonore"] },
  { word: "Nossen", tone: "violet", facets: ["mains libres", "pacte", "creation", "porte ouverte"] },
  { word: "A11", tone: "cyan", facets: ["capture", "graphe", "media", "contexte"] },
  { word: "K44", tone: "blue", facets: ["copilote", "quotidien", "route", "coordination"] }
];

const quickActions = [
  { id: "presence", label: "Presence", icon: Users, tool: "agent_presence" },
  { id: "neo4j", label: "Neo4j", icon: Database, tool: "neo4j_status" },
  { id: "qflush", label: "Toolbox", icon: Wrench, tool: "qflush_status" },
  { id: "doctor", label: "Doctor", icon: Shield, tool: "a11_runtime_hooks_status" },
  { id: "memory", label: "Memoire", icon: Brain, tool: "memory_governance_schema" },
  { id: "jobs", label: "Jobs", icon: Workflow, tool: "job_board_status" }
];

const assistantQuickTasks = [
  {
    id: "document",
    label: "Document",
    detail: "Ecrire, corriger ou resumer",
    icon: FileText,
    prompt: "Aide-moi avec un document. Demande-moi ce qu'il manque, puis prepare une version claire."
  },
  {
    id: "facture",
    label: "Facture",
    detail: "Comprendre ou ranger",
    icon: Database,
    prompt: "Aide-moi avec une facture ou un justificatif. Dis-moi quoi importer et ce que tu peux en extraire."
  },
  {
    id: "recherche",
    label: "Recherche",
    detail: "Trouver et expliquer",
    icon: Search,
    prompt: "Fais une recherche simple et explique-moi le resultat avec les prochaines etapes."
  },
  {
    id: "image",
    label: "Image",
    detail: "Analyser ou preparer",
    icon: Image,
    prompt: "Aide-moi avec une image. Dis-moi ce que tu peux analyser, corriger ou preparer."
  },
  {
    id: "voix",
    label: "Voix",
    detail: "Audio, micro, texte",
    icon: Mic2,
    prompt: "Aide-moi avec la voix ou l'audio. Prepare un plan simple et les fichiers necessaires."
  },
  {
    id: "depanner",
    label: "Depanner",
    detail: "Probleme PC ou appli",
    icon: Wrench,
    prompt: "Aide-moi a depanner un probleme. Pose-moi les questions utiles, puis donne-moi des actions simples."
  }
];

const agentArtwork: Record<string, string> = {
  kaen44: "founder-k44-cockpit.png",
  a11: "founder-a11-media.png",
  vivy: "founder-vivy-studio.png",
  codex: "founder-nossen-hub.png",
  kiro: "founder-k44-cockpit.png",
  claude: "founder-a11-media-alt.png"
};

function assetPath(filename: string) {
  return `./assets/${filename}`;
}

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
      // keep trying MCP text envelopes
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

function mcpHasError(raw: unknown) {
  const envelope = asRecord(raw);
  const result = asRecord(envelope?.result);
  return Boolean(envelope?.error || result?.isError || result?.error);
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
  if (text.includes("a11") || text.includes("codex") || text.includes("media")) return "cyan";
  if (text.includes("kaen") || text.includes("k44") || text.includes("copilote")) return "violet";
  if (text.includes("vivy") || text.includes("music") || text.includes("voice")) return "pink";
  if (text.includes("qflush") || text.includes("booster")) return "green";
  if (text.includes("doctor") || text.includes("piccolo") || text.includes("diag")) return "blue";
  if (text.includes("nossen") || text.includes("story")) return "gold";
  return ["violet", "cyan", "pink", "green", "blue", "gold"][index % 6];
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
      id: String(agent.id ?? name).toLowerCase(),
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

function mapToolNames(raw: unknown) {
  const envelope = asRecord(raw);
  const result = asRecord(envelope?.result) ?? envelope;
  const payload = unwrapMcpPayload(raw) ?? result;
  const list = Array.isArray(result?.tools)
    ? result.tools
    : Array.isArray(payload?.tools)
      ? payload.tools
      : [];
  return list
    .map((item) => {
      const tool = asRecord(item);
      return typeof tool?.name === "string" ? tool.name : "";
    })
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function probeState(raw: unknown, okLabel = "OK") {
  if (!raw || mcpHasError(raw)) return { state: "stale", color: "orange" };
  return { state: okLabel, color: "green" };
}

function syncLabel(status: SyncStatus) {
  if (status === "syncing") return "sync";
  if (status === "stale") return "stale";
  if (status === "down") return "down";
  return "online";
}

function syncTone(status: SyncStatus) {
  if (status === "syncing") return "cyan";
  if (status === "stale") return "orange";
  if (status === "down") return "orange";
  return "green";
}

function toolLabel(name: string) {
  return name.replace(/_/g, " ");
}

function isDisplayAgent(agent: LiveAgent) {
  const value = `${agent.id} ${agent.name}`.toLowerCase();
  return !value.includes("qflush") && !value.includes("nossen");
}

function endpointRows(snapshot: DesktopSnapshot | null) {
  const endpoints = snapshot?.mcp.endpoints?.length
    ? snapshot.mcp.endpoints
    : snapshot?.mcp.lastHealthCheck?.endpoints || [];
  if (!endpoints.length) {
    return [
      { label: "MCP local", state: "scan", color: "orange" },
      { label: "MCP prod", state: snapshot?.mcp.connected ? "online" : "scan", color: snapshot?.mcp.connected ? "green" : "orange" }
    ];
  }
  const local = endpoints.find((endpoint) => endpoint.kind === "local");
  const prod = endpoints.find((endpoint) => endpoint.kind === "prod");
  return [
    { label: "MCP local", state: local?.ok ? "online" : "repli", color: local?.ok ? "green" : "orange" },
    { label: "MCP prod", state: prod?.ok ? "online" : "repli", color: prod?.ok ? "green" : "orange" }
  ];
}

export default function App() {
  const [activeSection, setActiveSection] = useState("cockpit");
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [liveAgents, setLiveAgents] = useState<LiveAgent[]>(fallbackAgents);
  const [selectedAgentId, setSelectedAgentId] = useState("kaen44");
  const [liveDiscussions, setLiveDiscussions] = useState<LiveDiscussion[]>(fallbackDiscussions);
  const [liveModules, setLiveModules] = useState<LiveModule[]>(fallbackModules());
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("stale");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [toolDiff, setToolDiff] = useState<ToolDiff>({ count: null, delta: 0, newTools: [] });
  const [mcpPanelError, setMcpPanelError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [commandInput, setCommandInput] = useState("");
  const [terminalLines, setTerminalLines] = useState<string[]>([
    "[presence] founder cockpit online",
    "[mcp] waiting for first sync",
    "[runtime] console kept alive by heartbeat markers"
  ]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "seed-1",
      author: "Funesterie",
      body: "Dis-moi ce que tu veux faire. Je peux aider pour un document, une facture, une recherche, une image, la voix ou un probleme PC.",
      meta: "session locale"
    }
  ]);
  const lastHeartbeatAt = useRef(0);
  const knownToolNames = useRef<Set<string> | null>(null);
  const syncing = useRef(false);

  const profile = snapshot?.profile;
  const founderMode = profile ? founderProfiles.has(profile.id) : true;
  const selectedAgent = useMemo(() => {
    return liveAgents.find((agent) => agent.id.includes(selectedAgentId) || selectedAgentId.includes(agent.id)) ?? liveAgents[0] ?? fallbackAgents[0];
  }, [liveAgents, selectedAgentId]);
  const selectedArtwork = assetPath(agentArtwork[selectedAgent?.id] ?? agentArtwork[selectedAgentId] ?? "founder-k44-cockpit.png");
  const ramUsed = snapshot ? Math.round((snapshot.system.memoryUsed / snapshot.system.memoryTotal) * 100) : 0;
  const llmProvider = snapshot?.llm?.activeProvider || "offline";
  const mcpEndpoints = useMemo(() => endpointRows(snapshot), [snapshot]);

  const statusRows = useMemo(
    () => [
      { label: "CPU", value: `${snapshot?.system.cpuCount ?? 0}`, icon: Cpu, tone: "cyan" },
      { label: "RAM", value: `${ramUsed}%`, icon: Activity, tone: "violet" },
      { label: "MCP", value: syncLabel(syncStatus), icon: Network, tone: syncTone(syncStatus) },
      { label: "Local", value: mcpEndpoints[0].state, icon: Monitor, tone: mcpEndpoints[0].color },
      { label: "Prod", value: mcpEndpoints[1].state, icon: Server, tone: mcpEndpoints[1].color },
      { label: "LLM", value: llmProvider, icon: Bot, tone: llmProvider === "offline" ? "orange" : "green" },
      { label: "Tools", value: toolDiff.count == null ? "scan" : `${toolDiff.count}`, icon: Wrench, tone: toolDiff.delta > 0 ? "green" : "cyan" }
    ],
    [llmProvider, mcpEndpoints, ramUsed, snapshot, syncStatus, toolDiff]
  );

  useEffect(() => {
    runAutoSync().catch(() => {});
    const timer = window.setInterval(() => runAutoSync().catch(() => {}), AUTO_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  async function safeCallTool(name: string, args: Record<string, unknown> = {}) {
    try {
      return await api.callTool(name, args);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  function appendTerminal(line: string) {
    setTerminalLines((items) => [`[${new Date().toLocaleTimeString("fr-FR")}] ${line}`, ...items].slice(0, 14));
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
      newTools: newTools.slice(0, 6),
      updatedAt: new Date().toISOString()
    };
    setToolDiff(nextDiff);
    return nextDiff;
  }

  function updateModuleStatus(next: DesktopSnapshot, toolNames: string[], probes: Record<string, unknown>, nextStatus: SyncStatus, diff: ToolDiff) {
    const neo4j = probeState(probes.neo4j, "OK");
    const qflush = probeState(probes.qflush, "pret");
    const memory = probeState(probes.memory, "sync");
    const endpoints = endpointRows(next);
    setLiveModules([
      { name: "MCP Gateway", state: next.mcp.connected ? syncLabel(nextStatus) : "down", color: next.mcp.connected ? syncTone(nextStatus) : "orange", icon: Network },
      { name: "MCP Local", state: endpoints[0].state, color: endpoints[0].color, icon: Monitor },
      { name: "MCP Prod", state: endpoints[1].state, color: endpoints[1].color, icon: Server },
      { name: "Tool Registry", state: toolNames.length ? `${toolNames.length}` : "scan", color: diff.delta > 0 ? "green" : "violet", icon: Wrench },
      { name: "Neo4j Aura", state: neo4j.state, color: neo4j.color, icon: Database },
      { name: "Qflush Toolbox", state: qflush.state, color: qflush.color, icon: Rocket },
      { name: "Memoire", state: memory.state, color: memory.color, icon: Brain },
      { name: "Nossen Universe", state: "contexte", color: "gold", icon: Orbit },
      { name: "Routeur LLM", state: next.llm?.activeProvider || "offline", color: next.llm?.activeProvider === "offline" ? "orange" : "blue", icon: Bot }
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
        setLiveModules(fallbackModules());
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
              role: next.profile.id === "pc1-djeff" ? "founder-desktop-nexus" : "assistant-desktop-client",
              host: next.system.hostname,
              status: "active",
              capabilities: next.profile.id === "pc1-djeff"
                ? ["mcp-auto-sync", "desktop-ui", "founder-cockpit", "presence-marker"]
                : ["mcp-auto-sync", "desktop-chat", "local-assistant", "family-helper"],
              profilePreset: next.profile.id === "pc1-djeff" ? "founder" : "assistant",
              memoryScope: ["shared", "infra", "desktop", "founders"],
              riskLevel: "low",
              note: "Desktop UI heartbeat; no secret in payload.",
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
      updateModuleStatus(next, toolNames, { neo4j, qflush, memory }, nextStatus, currentDiff);
      setLastSyncAt(new Date().toISOString());
      setSyncStatus(nextStatus);
      appendTerminal(`sync ok - ${toolNames.length || "?"} tools`);
    } catch (error) {
      setSyncStatus("down");
      setMcpPanelError(error instanceof Error ? error.message : "MCP auto-sync indisponible");
      appendTerminal("sync down - fallback local");
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
        api.callTool("agent_presence", { includeIdle: true }),
        api.callTool("discussion_list", { status: "open", limit: 8 })
      ]);
      const nextAgents = mapLiveAgents(presenceResult);
      const nextDiscussions = mapLiveDiscussions(discussionResult);
      const displayAgents = nextAgents.filter(isDisplayAgent);
      setLiveAgents(displayAgents.length ? mergePriorityAgents(displayAgents) : fallbackAgents);
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
      appendTerminal(`profile switched to ${profileId}`);
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(preset?: string) {
    const trimmed = (preset ?? chatInput).trim();
    if (!trimmed || busy) return;
    if (!preset) setChatInput("");
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
      appendTerminal(`chat routed by ${result.provider || "router"}`);
    } finally {
      setBusy(false);
    }
  }

  async function triggerQuickAction(action: (typeof quickActions)[number]) {
    appendTerminal(`tool ${action.tool} requested`);
    const result = await safeCallTool(action.tool);
    if (mcpHasError(result)) {
      appendTerminal(`tool ${action.tool} returned error`);
      return;
    }
    appendTerminal(`tool ${action.tool} ok`);
    await runAutoSync();
  }

  function submitCommand() {
    const trimmed = commandInput.trim();
    if (!trimmed) return;
    setCommandInput("");
    appendTerminal(`command queued: ${trimmed}`);
    sendMessage(trimmed).catch(() => {});
  }

  if (!founderMode) {
    const connectionLabel = syncStatus === "connected" ? "Connecte" : syncStatus === "syncing" ? "Synchronise" : "Hors ligne";
    return (
      <main className="assistant-shell">
        <div className="assistant-bg" />
        <aside className="assistant-side">
          <div className="assistant-profile">
            <img src={assetPath("founder-k44-cockpit.png")} alt="Kaen44" />
            <div>
              <span>Funesterie pour</span>
              <strong>{profile?.shortName || "Maxence"}</strong>
              <small>{profile?.machineLabel || "PC2"}</small>
            </div>
          </div>

          <div className="assistant-status-card">
            <StatusPill color={syncTone(syncStatus)} label="MCP" value={connectionLabel} />
            <StatusPill color={llmProvider === "offline" ? "orange" : "green"} label="Mode" value={llmProvider === "offline" ? "Local" : llmProvider} />
            <button onClick={() => runAutoSync().catch(() => {})} disabled={busy}>
              <RefreshCw size={17} />
              <span>Verifier</span>
            </button>
          </div>

          <div className="assistant-help">
            <strong>Ce que tu peux demander</strong>
            <p>Tu ecris normalement. L'assistant choisit les bons outils derriere.</p>
          </div>
        </aside>

        <section className="assistant-main">
          <header className="assistant-hero">
            <div>
              <p>{profile?.assistantName || "Apply FUNESTERIE PC2"}</p>
              <h1>Que veux-tu faire ?</h1>
              <span>Demande en une phrase. Je m'occupe de router vers A11, Kaen44, Vivy ou les outils MCP quand c'est autorise.</span>
            </div>
          </header>

          <section className="assistant-quick" aria-label="Demandes rapides">
            {assistantQuickTasks.map((task) => {
              const Icon = task.icon;
              return (
                <button key={task.id} onClick={() => sendMessage(task.prompt).catch(() => {})} disabled={busy}>
                  <Icon size={21} />
                  <span>{task.label}</span>
                  <small>{task.detail}</small>
                </button>
              );
            })}
          </section>

          <section className="assistant-chat-card">
            <div className="assistant-chat-log">
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
            <div className="assistant-composer">
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage().catch(() => {});
                  }
                }}
                placeholder="Ex: aide-moi a faire un CV, comprendre une facture, chercher une info..."
              />
              <button onClick={() => sendMessage().catch(() => {})} disabled={busy || !chatInput.trim()}>
                <Send size={20} />
                <span>Envoyer</span>
              </button>
            </div>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="founder-shell">
      <div className="founder-background" />
      <img className="founder-bg-image" src={assetPath("founder-nossen-hub.png")} alt="" aria-hidden="true" />
      <aside className="founder-rail">
        <div className="brand-lockup">
          <img src={assetPath("founder-funesterie-logo.png")} alt="Funesterie" />
          <div>
            <span>Founder Console</span>
            <strong>Funesterie</strong>
          </div>
        </div>

        <div className="local-profile">
          <UserRound size={17} />
          <div>
            <span>Profil local</span>
            <strong>{profile?.shortName || "Djeff"}</strong>
          </div>
          <small>{snapshot?.system.hostname || "PC"}</small>
        </div>

        <nav className="section-nav" aria-label="Navigation fondateur">
          {sectionTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} className={activeSection === tab.id ? "active" : ""} onClick={() => setActiveSection(tab.id)}>
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <section className="rail-panel">
          <PanelTitle eyebrow="Agents" title="Presence live" icon={Users} />
          <div className="agent-stack">
            {liveAgents.slice(0, 8).map((agent) => (
              <button
                key={agent.id}
                className={`agent-line ${agent.color} ${selectedAgent?.id === agent.id ? "selected" : ""}`}
                onClick={() => setSelectedAgentId(agent.id)}
              >
                <span>{agent.avatar}</span>
                <div>
                  <strong>{agent.name}</strong>
                  <small>{agent.status || (agent.active === false ? "offline" : "online")}</small>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="rail-panel compact">
          <PanelTitle eyebrow="Session" title={profile?.id === "pc2-maxence" ? "PC2 Maxence" : "PC1 Djeff"} icon={Monitor} />
          <div className="mini-meter">
            <span style={{ "--value": `${Math.max(12, ramUsed)}%` } as CSSProperties} />
          </div>
          <p>{snapshot?.system.hostname || "FUNESTERIE-PC"} - {founderMode ? "mode fondateur" : "mode limite"}</p>
        </section>
      </aside>

      <section className="command-surface">
        <header className="founder-topbar">
          <div>
            <p>16/05/2026</p>
            <strong>{new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</strong>
          </div>
          <div className="topbar-center">
            <Hexagon size={26} />
            <span>Apply Fondateur</span>
            <small>PC1 + PC2 - MCP - Neo4j - Media - Jobs</small>
          </div>
          <div className="topbar-actions">
            <StatusPill color={syncTone(syncStatus)} label="MCP" value={syncLabel(syncStatus)} />
            <StatusPill color={llmProvider === "offline" ? "orange" : "green"} label="LLM" value={llmProvider} />
            <button className="icon-button" onClick={() => runAutoSync().catch(() => {})} disabled={busy} title="Rafraichir">
              <RefreshCw size={18} />
            </button>
            <button className="icon-button" onClick={() => api.checkUpdates().then(() => appendTerminal("update manifest checked"))} title="Verifier update">
              <Download size={18} />
            </button>
          </div>
        </header>

        {activeSection === "cockpit" ? (
        <div className="cockpit-grid">
          <section className="panel hero-command">
            <img src={selectedArtwork} alt={selectedAgent?.name || "Funesterie"} />
            <div className="hero-shade" />
            <div className="hero-copy">
              <p>Copilote selectionne</p>
              <h1>{selectedAgent?.name || "Kaen44"}</h1>
              <span>{selectedAgent?.role || "Nexus fondateur"}</span>
              <div className="hero-tags">
                <b>{selectedAgent?.status || "online"}</b>
                <b>{selectedAgent?.host || "MCP"}</b>
                <b>{profile?.shortName || "Djeff"}</b>
              </div>
            </div>
            <div className="hero-command-box">
              <div className="command-input">
                <Terminal size={18} />
                <input
                  value={commandInput}
                  onChange={(event) => setCommandInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submitCommand();
                  }}
                  placeholder="Demander, router, diagnostiquer, creer..."
                />
                <button onClick={submitCommand} title="Executer">
                  <Play size={16} />
                </button>
              </div>
            </div>
          </section>

          <section className="panel status-board">
            <PanelTitle eyebrow="Modules" title="Etat global" icon={Gauge} />
            <div className="status-grid">
              {statusRows.map((row) => {
                const Icon = row.icon;
                return (
                  <div className={`status-tile ${row.tone}`} key={row.label}>
                    <Icon size={18} />
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                );
              })}
            </div>
            <div className="module-list">
              {liveModules.map((module) => {
                const Icon = module.icon;
                return (
                  <div className="module-row" key={module.name}>
                    <Icon size={17} />
                    <span>{module.name}</span>
                    <strong className={module.color}>{module.state}</strong>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel actions-board">
            <PanelTitle eyebrow="Actions" title="Tools rapides" icon={Wrench} />
            <div className="quick-grid">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button key={action.id} onClick={() => triggerQuickAction(action).catch(() => appendTerminal(`tool ${action.tool} unavailable`))}>
                    <Icon size={21} />
                    <span>{action.label}</span>
                  </button>
                );
              })}
            </div>
            {toolDiff.delta > 0 && (
              <div className="new-tools">
                <Sparkles size={16} />
                <span>{toolDiff.newTools.map(toolLabel).join(", ")}</span>
              </div>
            )}
            {mcpPanelError && (
              <div className="new-tools orange">
                <CircleDot size={16} />
                <span>{mcpPanelError}</span>
              </div>
            )}
          </section>

          <section className="panel semantic-board">
            <PanelTitle eyebrow="Roulette media" title="Pertinence creative" icon={Orbit} />
            <div className="semantic-wheel" aria-label="Roulette semantique">
              {semanticWheel.map((item, index) => (
                <button
                  key={item.word}
                  className={item.tone}
                  style={{ "--i": index } as CSSProperties}
                  onClick={() => sendMessage(`Developpe la resonance semantique de "${item.word}" pour Funesterie.`).catch(() => {})}
                >
                  <span>{item.word}</span>
                </button>
              ))}
              <div className="wheel-core">
                <WandSparkles size={25} />
                <strong>Resonance</strong>
              </div>
            </div>
            <div className="facet-strip">
              {semanticWheel[0].facets.map((facet) => (
                <span key={facet}>{facet}</span>
              ))}
            </div>
          </section>

          <section className="panel graph-board">
            <PanelTitle eyebrow="Memoire" title="Graphe vivant" icon={Network} />
            <KnowledgeGraph />
          </section>

          <section className="panel workflow-board">
            <PanelTitle eyebrow="Jobs" title="Orchestration" icon={Workflow} />
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

          <section className="panel discussions-board">
            <PanelTitle eyebrow="Messagerie" title="A chaque connexion" icon={MessageCircle} />
            <div className="discussion-list">
              {liveDiscussions.slice(0, 7).map((discussion, index) => (
                <div className="discussion-row" key={discussion.id || discussion.title}>
                  <span className={`discussion-dot tone-${index}`} />
                  <div>
                    <strong>{discussion.title}</strong>
                    <small>{discussion.source}</small>
                  </div>
                  <time>{discussion.time}</time>
                </div>
              ))}
            </div>
          </section>

          <section className="panel media-board">
            <PanelTitle eyebrow="Media" title="A11 + Vivy" icon={Headphones} />
            <div className="media-split">
              <button onClick={() => setSelectedAgentId("a11")}>
                <img src={assetPath("founder-a11-media-alt.png")} alt="A11" />
                <span>A11 capture</span>
              </button>
              <button onClick={() => setSelectedAgentId("vivy")}>
                <img src={assetPath("founder-vivy-studio.png")} alt="Vivy" />
                <span>Vivy voix</span>
              </button>
            </div>
          </section>

          <section className="panel terminal-board">
            <PanelTitle eyebrow="Terminal" title="Journal local" icon={Terminal} />
            <div className="terminal-lines">
              {terminalLines.map((line, index) => (
                <code key={`${line}-${index}`}>{line}</code>
              ))}
            </div>
          </section>

          <section className="panel chat-board">
            <PanelTitle eyebrow="Chat" title={profile?.assistantName || "Apply FUNESTERIE"} icon={MessageCircle} />
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
                placeholder="Parle au Nexus..."
              />
              <button onClick={() => sendMessage().catch(() => {})} disabled={busy || !chatInput.trim()} title="Envoyer">
                <Send size={18} />
              </button>
            </div>
          </section>
        </div>
        ) : (
          <div className="focus-view">
            {activeSection === "agents" && (
              <AgentsView
                agents={liveAgents}
                discussions={liveDiscussions}
                selectedAgent={selectedAgent}
                selectedAgentId={selectedAgentId}
                onSelectAgent={setSelectedAgentId}
                mcpPanelError={mcpPanelError}
              />
            )}
            {activeSection === "memory" && (
              <MemoryView
                modules={liveModules}
                statusRows={statusRows}
                toolDiff={toolDiff}
              />
            )}
            {activeSection === "media" && (
              <MediaView
                selectedAgent={selectedAgent}
                selectedArtwork={selectedArtwork}
                semanticWheel={semanticWheel}
                onPrompt={sendMessage}
                onSelectAgent={setSelectedAgentId}
              />
            )}
            {activeSection === "terminal" && (
              <TerminalView
                terminalLines={terminalLines}
                commandInput={commandInput}
                setCommandInput={setCommandInput}
                submitCommand={submitCommand}
                messages={messages}
                chatInput={chatInput}
                setChatInput={setChatInput}
                sendMessage={sendMessage}
                busy={busy}
                profileShortName={profile?.shortName || "Djeff"}
                assistantName={profile?.assistantName || "Apply FUNESTERIE"}
              />
            )}
            {activeSection === "settings" && (
              <SettingsView
                snapshot={snapshot}
                syncStatusLabel={syncLabel(syncStatus)}
                llmProvider={llmProvider}
                endpoints={mcpEndpoints}
                toolDiff={toolDiff}
                lastSyncAt={lastSyncAt}
                busy={busy}
                onRefresh={() => runAutoSync().catch(() => {})}
                onCheckUpdates={() => api.checkUpdates().then(() => appendTerminal("update manifest checked"))}
                onSwitchProfile={(profileId) => switchProfile(profileId).catch(() => {})}
              />
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function PanelTitle({ eyebrow, title, icon: Icon }: { eyebrow: string; title: string; icon: LucideIcon }) {
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

function StatusPill({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className={`status-pill ${color}`}>
      <span />
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function KnowledgeGraph() {
  const nodes = [
    ["Nexus", 50, 50, "white"],
    ["Djeff", 25, 20, "gold"],
    ["Max", 75, 20, "blue"],
    ["A11", 18, 62, "cyan"],
    ["K44", 37, 82, "violet"],
    ["Vivy", 63, 82, "pink"],
    ["Neo4j", 82, 62, "green"],
    ["MCP", 50, 14, "orange"]
  ];

  return (
    <svg className="knowledge-svg" viewBox="0 0 100 100" role="img" aria-label="Graphe Funesterie">
      {nodes.slice(1).map((node) => (
        <line key={`line-${node[0]}`} x1="50" y1="50" x2={node[1]} y2={node[2]} />
      ))}
      <path d="M18 62 C31 24, 67 24, 82 62" />
      <path d="M37 82 C47 92, 56 92, 63 82" />
      {nodes.map(([label, x, y, color]) => (
        <g key={label} className={`graph-node ${color}`} transform={`translate(${x} ${y})`}>
          <circle r={label === "Nexus" ? 12 : 8} />
          <text y="2">{label}</text>
        </g>
      ))}
    </svg>
  );
}

function mergePriorityAgents(agents: LiveAgent[]) {
  const byKey = new Map<string, LiveAgent>();
  [...agents, ...fallbackAgents].forEach((agent) => {
    if (!isDisplayAgent(agent)) return;
    const key = agent.id || agent.name.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, agent);
  });
  return [...byKey.values()];
}

function fallbackModules(): LiveModule[] {
  return [
    { name: "MCP Gateway", state: "online", color: "green", icon: Network },
    { name: "MCP Local", state: "auto", color: "green", icon: Monitor },
    { name: "MCP Prod", state: "auto", color: "green", icon: Server },
    { name: "Neo4j Aura", state: "online", color: "cyan", icon: Database },
    { name: "Podman", state: "pret", color: "blue", icon: Server },
    { name: "Docker", state: "pret", color: "blue", icon: Layers3 },
    { name: "Qflush Toolbox", state: "pret", color: "green", icon: Rocket },
    { name: "Nossen Universe", state: "contexte", color: "gold", icon: Orbit },
    { name: "Presence", state: "active", color: "violet", icon: Bell },
    { name: "Vivy", state: "audio", color: "pink", icon: Mic2 },
    { name: "Disque", state: "watch", color: "gold", icon: HardDrive }
  ];
}

function createDemoApi(): FunesterieApi {
  const demoProfileId = new URLSearchParams(window.location.search).get("profile") === "pc2-maxence" ? "pc2-maxence" : "pc1-djeff";
  const demoIsMax = demoProfileId === "pc2-maxence";
  const demoSnapshot: DesktopSnapshot = {
    appVersion: "1.0.3",
    profile: {
      id: demoProfileId,
      machineLabel: demoIsMax ? "PC2 - Maxence" : "PC1 - Djeff",
      ownerName: demoIsMax ? "Maxence Cellauro" : "Jeffrey Cellauro",
      shortName: demoIsMax ? "Maxence" : "Djeff",
      role: demoIsMax ? "assistant-family" : "principal",
      assistantName: demoIsMax ? "Apply FUNESTERIE PC2" : "Apply FUNESTERIE PC1",
      capabilityMode: "full",
      enabledModules: ["mcp", "neo4j", "r2", "qflush-toolbox", "a11", "kaen44", "vivy"]
    },
    mcp: {
      connected: true,
      toolCount: 72,
      activeUrl: "http://127.0.0.1:8788/mcp",
      endpoints: [
        { url: "http://127.0.0.1:8788/mcp", kind: "local", ok: true },
        { url: "https://mcp.funesterie.me/mcp", kind: "prod", ok: true }
      ],
      lastHealthCheck: {
        ok: true,
        activeUrl: "http://127.0.0.1:8788/mcp",
        endpoints: [
          { url: "http://127.0.0.1:8788/mcp", kind: "local", ok: true },
          { url: "https://mcp.funesterie.me/mcp", kind: "prod", ok: true }
        ]
      }
    },
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
      text: `Recu: ${message}. En app Electron, cette demande passe par le routeur LLM local et le MCP Funesterie.`
    }),
    checkUpdates: async () => null,
    downloadUpdate: async () => true,
    openExternal: async () => true
  };
}
