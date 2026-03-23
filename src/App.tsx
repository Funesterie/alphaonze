import React, { useEffect, useState, useRef, useMemo } from "react";
import { fetchA11HistoryList, fetchA11Conversation } from "./lib/api";
import { A11HistoryPanel } from "./components/A11HistoryPanel";
import ReactMarkdown from "react-markdown";
import "./index.css";
import {
  initSpeech,
  startMic,
  stopMic,
  isSpeaking,
  speak,
  cancelSpeech,
} from "./lib/speech";
import handleImportFiles from "./lib/importer";
import { mountA11AvatarUI } from "./lib/avatar-ui";
import { chatCompletion, callA11Agent, type A11ChatMessage } from "./lib/api";

type Role = "user" | "assistant" | "system";

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  imageUrl?: string | null;
}

interface LlmStats {
  ok: boolean;
  backend?: string;
  model?: string;
  mode?: string;
  gpu?: boolean;
}

const DEFAULT_SYSTEM_NINDO =
  "Tu es A-11, assistant local NOSSEN. Reste concis, orienté action, et utilise les capacités locales (VSIX, Qflush, Cerbère) quand c’est pertinent.";

// MuteButton : icône seule, contrôle global du son
function MuteButton() {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (!muted) {
      if ((window as any).a11_speak_orig) {
        (window as any).speak = (window as any).a11_speak_orig;
      }
      return;
    }
    if (!(window as any).a11_speak_orig) (window as any).a11_speak_orig = speak;
    (window as any).speak = () => {};
    cancelSpeech();
    return () => {
      if ((window as any).a11_speak_orig) (window as any).speak = (window as any).a11_speak_orig;
    };
  }, [muted]);

  return (
    <button
      onClick={() => setMuted(m => !m)}
      title={muted ? "Rétablir la voix d'A11" : "Couper la voix d'A11"}
      style={{ fontSize: 20, padding: 6, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      className="btn ghost"
    >
      {muted ? (
        <span role="img" aria-label="Audio coupé">🔇</span>
      ) : (
        <span role="img" aria-label="Audio actif">🔊</span>
      )}
    </button>
  );
}

export function App() {
  const [showHistory, setShowHistory] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "sys-1",
      role: "system",
      content: DEFAULT_SYSTEM_NINDO,
    },
  ]);
  const [ttsFallback, setTtsFallback] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [stats, setStats] = useState<LlmStats | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [speaking, setSpeaking] = useState(false); // pour l'avatar animé
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toggleLockRef = useRef(false);
  const [model, setModel] = useState("llama3.2:latest");

  // Chats state persisted in localStorage
  const [chats, setChats] = useState<{
    id: string;
    name: string;
    updated: number;
    messages: ChatMessage[];
  }[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);

  // Historique A-11 (backend)
  const [a11History, setA11History] = useState<any[]>([]);
  const [a11ConvId, setA11ConvId] = useState<string | null>(null);
  const [a11ConvMsgs, setA11ConvMsgs] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // load chats from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem("a11:chats");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          // sanitize chats and messages to conform to expected types
          const sanitizeRole = (r: any) => (r === 'user' || r === 'assistant' || r === 'system') ? r as Role : 'assistant' as Role;
          const sanitized = parsed.map((c: any) => ({
            id: String(c.id || `chat-${Date.now()}`),
            name: String(c.name || 'Conversation'),
            updated: Number(c.updated) || Date.now(),
            messages: Array.isArray(c.messages) ? c.messages.map((m: any) => ({ id: String(m.id || (`m-${Date.now()}`)), role: sanitizeRole(m.role), content: String(m.content || '') })) : [{ id: `sys-${Date.now()}`, role: 'system' as Role, content: DEFAULT_SYSTEM_NINDO }]
          }));
          setChats(sanitized);
          setSelectedChatId(sanitized[0].id);
          setMessages(sanitized[0].messages || [{ id: `sys-${Date.now()}`, role: 'system' as Role, content: DEFAULT_SYSTEM_NINDO }]);
          return;
        }
      }
    } catch (e) {
      console.warn("[A11] failed to load chats", e);
    }
    // default chat
    const initial = [
      {
        id: "chat-1",
        name: "Session actuelle",
        updated: Date.now(),
        messages: [
          { id: `sys-${Date.now()}`, role: 'system' as Role, content: DEFAULT_SYSTEM_NINDO },
        ],
      },
    ];
    setChats(initial);
    setSelectedChatId(initial[0].id);
    setMessages(initial[0].messages);
  }, []);

  // persist chats whenever changed
  useEffect(() => {
    try {
      localStorage.setItem("a11:chats", JSON.stringify(chats));
    } catch (e) {
      console.warn("[A11] failed to save chats", e);
    }
  }, [chats]);

  // helper to update messages for selected chat
  function updateChatMessages(chatId: string | null, newMessages: ChatMessage[]) {
    if (!chatId) return;
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId ? { ...c, messages: newMessages, updated: Date.now() } : c
      )
    );
  }

  function onImportClick() {
    fileInputRef.current && fileInputRef.current.click();
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleImportFiles(e.target.files, (txt: string) => {
      setInput((prev) => (prev ? prev + "\n" + txt : txt));
    }).catch(console.error);
  }

  // New conversation handler
  function newConversation() {
    // create new chat entry and select it
    const id = `chat-${Date.now()}`;
    const newChat = {
      id,
      name: `Conversation ${chats.length + 1}`,
      updated: Date.now(),
      messages: [{ id: `sys-${Date.now()}`, role: 'system' as Role, content: DEFAULT_SYSTEM_NINDO }],
    };
    setChats((prev) => [newChat, ...prev]);
    setSelectedChatId(id);
    setMessages(newChat.messages);
    setInput("");
  }

  // Speech recognition callback
  useEffect(() => {
    initSpeech((txt: string, isFinal?: boolean) => {
      if (!isFinal) {
        setInput((_) => txt);
      } else {
        setInput(""); // vide l'input
        sendMessage(txt); // envoie direct le texte reconnu
      }
    });
  }, []);

  // Modifie la fonction sendMessage pour accepter un texte forcé
  async function sendMessage(forcedText?: string) {
    const text = (forcedText !== undefined ? forcedText : input).trim();
    if (!text || sending) return;

    // Ajout du préfixe DEV_ENGINE si mode dev
    const prefix = devMode ? "[DEV_ENGINE] " : "";
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}}`,
      role: "user",
      content: prefix + text,
    };
    setMessages((prev) => {
      const nm = [...prev, userMsg];
      updateChatMessages(selectedChatId, nm);
      return nm;
    });
    setInput("");
    setSending(true);

    try {
      // Utilisation de chatCompletion pour transmettre le prompt et le flag dev
      // On reconstruit l'historique sans les messages système (le prompt système est passé séparément)
      const history = messages.filter(m => m.role !== 'system').concat(userMsg);
      const assistantText = await chatCompletion(
        history,
        'local',
        {
          systemPrompt: systemPrompt,
          a11Dev: devMode
        }
      );

      const aiMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: String(assistantText),
      };
      setMessages((prev) => {
        const nm = [...prev, aiMsg];
        updateChatMessages(selectedChatId, nm);
        return nm;
      });

      // play TTS for every bot response unless muted
      try {
        if (typeof window !== "undefined" && typeof (window as any).speak === "function") {
          (window as any).speak(String(assistantText), { lang: "fr-FR" });
        }
      } catch {}
    } catch (err: any) {
      const errMsg: ChatMessage = {
        id: `e-${Date.now()}`,
        role: "assistant",
        content:
          "Erreur lors de l’appel à /api/llm/chat : " + (err?.message || err),
      };
      setMessages((prev) => {
        const nm = [...prev, errMsg];
        updateChatMessages(selectedChatId, nm);
        return nm;
      });
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function toggleMic() {
    console.log("[A11] toggleMic clicked, current voiceListening=", voiceListening);
    // If audio is playing, stop it immediately and do not toggle modes
    if (audioPlaying) {
      console.log("[A11] canceling audio playback via toggle");
      cancelSpeech();
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (toggleLockRef.current) {
        console.log("[A11] toggle ignored due to lock");
        return;
      }
      toggleLockRef.current = true;
      setTimeout(() => { toggleLockRef.current = false; }, 600);
      // fallback: toggle TTS-only mode
      setTtsFallback((v) => {
        const next = !v;
        // keep voiceListening false when using fallback
        if (next) {
          // enable TTS playback
          console.log("[A11] SpeechRecognition not available — enabling TTS-only mode");
        } else {
          console.log("[A11] Disabling TTS-only mode");
        }
        return next;
      });
      return;
    }

    if (voiceListening) {
      try { stopMic(); } catch {};
      setVoiceListening(false);
      cancelSpeech();
    } else {
      try { await startMic(); setVoiceListening(true); } catch (e) { console.warn('startMic failed', e); }
    }
  }

  function toggleTtsOnly() {
    if (toggleLockRef.current) {
      console.log('[A11] toggleTtsOnly ignored due to lock');
      return;
    }
    toggleLockRef.current = true;
    setTimeout(() => { toggleLockRef.current = false; }, 600);
    const next = !ttsFallback;
    setTtsFallback(next);
    console.log('[A11] toggleTtsOnly ->', next);
    try {
      if (next) localStorage.setItem('a11:tts-only', '1'); else localStorage.removeItem('a11:tts-only');
    } catch (e) {}
  }

  // Rename chat
  function renameChat(id: string) {
    const c = chats.find(x => x.id === id);
    if (!c) return;
    const name = prompt('Nouveau nom de la conversation', c.name);
    if (!name) return;
    setChats(prev => prev.map(x => x.id === id ? { ...x, name } : x));
  }

  // Delete chat
  function deleteChat(id: string) {
    if (!confirm('Supprimer cette conversation ?')) return;
    setChats(prev => {
      const next = prev.filter(x => x.id !== id);
      if (next.length === 0) {
        // recreate default
        const initial = { id: 'chat-1', name: 'Session actuelle', updated: Date.now(), messages: [{ id: `sys-${Date.now()}`, role: 'system' as Role, content: DEFAULT_SYSTEM_NINDO }] };
        setSelectedChatId(initial.id);
        setMessages(initial.messages);
        return [initial];
      }
      // select first if deleted was selected
      if (selectedChatId === id) {
        setSelectedChatId(next[0].id);
        setMessages(next[0].messages);
      }
      return next;
    });
  }

  // NINDO layers (à adapter selon ton code)
  const nindoLayers = {
    core: DEFAULT_SYSTEM_NINDO,
    dev: '',
    project: '',
    session: '',
  };

  // Prompt système pour le mode CHAT normal
  const systemPromptChat = useMemo(() => {
    const parts: string[] = [];
    parts.push(`# NINDO CORE\n${nindoLayers.core}`);
    if (nindoLayers.project.trim()) {
      parts.push(`# NINDO PROJET\n${nindoLayers.project}`);
    }
    if (nindoLayers.session.trim()) {
      parts.push(`# NINDO SESSION\n${nindoLayers.session}`);
    }
    // Règle anti-blabla
    parts.push(
      `# RÈGLES\n- Tu réponds de façon simple, concrète, sans faire de roman.\n- Si la demande n'est pas claire, tu demandes une précision.\n- Tu ne proposes pas de modifier des fichiers tant que l'utilisateur ne le demande pas.`
    );
    return parts.join("\n\n---\n\n");
  }, [nindoLayers]);

  // Prompt système pour le mode DEV (ingé / fichiers)
  const systemPromptDev = useMemo(() => {
    const parts: string[] = [];
    parts.push(`# NINDO CORE\n${nindoLayers.core}`);
    if (nindoLayers.dev.trim()) {
      parts.push(`# NINDO DEV\n${nindoLayers.dev}`);
    }
    if (nindoLayers.project.trim()) {
      parts.push(`# NINDO PROJET\n${nindoLayers.project}`);
    }
    if (nindoLayers.session.trim()) {
      parts.push(`# NINDO SESSION\n${nindoLayers.session}`);
    }
    parts.push(
      `# MODE DEV (A-11 DEVELOPER ENGINE)\n- Tu te comportes comme un ingénieur logiciel dans un vrai workspace local.\n- Tu peux proposer des actions JSON (mode \"actions\") pour Cerbère (write_file, generate_pdf, etc.).\n- Tu évites les actions destructrices.\n- Tu ne t'inventes pas de problème : si tu n'as pas assez de contexte, tu demandes des fichiers / erreurs.\n\n- Quand l'utilisateur demande un PDF explicatif (cours, fiche, dossier, etc.),\n  tu dois créer AU MOINS 4 sections détaillées, avec plusieurs paragraphes.\n- Utilise de préférence la structure :\n  sections = [\n    { "heading": "Introduction", "text": "...", "images": [...] },\n    { "heading": "Partie 1 : ...", "text": "...", "images": [...] },\n    { "heading": "Partie 2 : ...", "text": "...", "images": [...] },\n    { "heading": "Conclusion", "text": "..." }\n  ]\n- Pour inclure une image dans le PDF, elle doit déjà être présente sur le disque.\n  D'abord tu utilises l'action \"download_file\" pour télécharger l'image dans \"docs/...\",\n  ensuite tu passes ce chemin dans \"sections[].images\".\n\nEN MODE DEV (fichiers / workspace) :\n- Si l'utilisateur demande de CRÉER, LIRE, MODIFIER un fichier, un PDF, une image, etc.,\n  TU NE RÉPONDS PAS en texte.\n- Tu renvoies UNIQUEMENT un JSON valide de la forme :\n\n{ \"mode\": \"actions\", \"actions\": [ { \"action\": \"write_file\", \"path\": \"docs/test.txt\", \"content\": \"Contenu du fichier...\" } ] }\n\n- Pour CRÉER / MODIFIER un fichier texte : utilise \"write_file\" (champ \"content\" en texte).\n- Pour TÉLÉCHARGER une image ou un fichier depuis une URL : utilise \"download_file\" avec\n  { \"action\": \"download_file\", \"url\": \"https://...\", \"path\": \"docs/mon_image.png\" }.\n- Pour CRÉER un PDF structuré : utilise \"generate_pdf\" avec \"title\" et \"sections\"\n  (chaque section a \"heading\", \"text\" et éventuellement \"images\" = liste de chemins locaux).\n\nRÈGLES STRICTES :\n- Pas de triple backticks autour.\n- Pas de mot \"json\" avant.\n- Le PREMIER caractère de ta réponse doit être {.\n- Le DERNIER caractère de ta réponse doit être }.\n- Aucune explication avant ou après le JSON.`
    );
    return parts.join("\n\n---\n\n");
  }, [nindoLayers]);

  // Prompt effectivement utilisé selon le mode
  const systemPrompt = devMode ? systemPromptDev : systemPromptChat;

  // Initialisation globale de window.speak au montage pour garantir le son
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).speak = speak;
    }
  }, [devMode, stats]);

  // Chargement de l'historique backend au montage
  useEffect(() => {
    refreshA11History();
  }, []);

  // Handler pour rafraîchir la liste de l'historique
  async function refreshA11History() {
    setLoadingHistory(true);
    try {
      const list = await fetchA11HistoryList();
      setA11History(list);
    } catch (e) {
      setA11History([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  // Handler pour ouvrir/restaurer une conversation backend
  async function handleOpenA11Conversation(convId: string) {
    setA11ConvId(convId);
    setA11ConvMsgs([]);
    setLoadingHistory(true);
    try {
      const conv = await fetchA11Conversation(convId);
      setA11ConvMsgs(conv.messages || []);
    } catch (e) {
      setA11ConvMsgs([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  // HEADER avec bouton Mode DEV centré, select modèle à droite, mute à l'extrême droite
  return (
    <div className="app-container" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        className="header"
        style={{
          width: "100%",
          minHeight: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 24px",
          borderBottom: "1px solid #111827",
          background: "#0a101a",
          zIndex: 10,
        }}
      >
        {/* Avatar + nom à gauche */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 999,
              overflow: "hidden",
              boxShadow: "0 0 12px #22d3ee99",
              flexShrink: 0,
            }}
          >
            <img
              id="a11-avatar"
              src={speaking ? "/assets/A11_talking_smooth_8s.gif" : "/assets/a11_static.png"}
              alt="A-11"
              onError={(e) => {
                e.currentTarget.src = "/assets/a11_static.png";
              }}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
          <div>
            <div style={{ fontWeight: 700, color: "#e5e7eb" }}>AlphaOnze (A-11)</div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>Assistant local NOSSEN</div>
          </div>
        </div>
        {/* Mode DEV centré + badge backend */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={() => setDevMode((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 14px",
              borderRadius: 999,
              border: "1px solid " + (devMode ? "#f97316" : "#1f2937"),
              background: devMode ? "#7c2d12" : "#020617",
              color: devMode ? "#fed7aa" : "#e5e7eb",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: devMode ? "0 0 8px #f9731633" : undefined,
              letterSpacing: 1,
            }}
            title={
              devMode
                ? "Mode DEV activé : A-11 peut modifier des fichiers (via Cerbère)"
                : "Mode DEV désactivé : A-11 reste en mode chat normal"
            }
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: devMode ? "#fb923c" : "#6b7280",
                marginRight: 6,
              }}
            />
            Mode DEV
          </button>
        </div>
        {/* Select modèle + MuteButton + badge backend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              background: "#181f2a",
              color: "#e5e7eb",
              border: "1px solid #22293a",
              fontSize: 13,
              marginRight: 2
            }}
          >
            <option value="llama3.2:latest">llama3.2:latest</option>
            <option value="gpt-4o-mini">gpt-4o-mini</option>
          </select>
          <MuteButton />
          {stats && (
            <div
              style={{
                fontSize: 11,
                padding: "4px 8px",
                borderRadius: 999,
                background: "#0f172a",
                color: "#9ca3af",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: stats.gpu ? "#22c55e" : "#eab308",
                }}
              />
              <span>{stats.backend}</span>
              <span style={{ opacity: 0.7 }}>· {stats.model}</span>
            </div>
          )}
        </div>
      </header>
      {/* Grille principale : sidebar + main */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Sidebar : conversations locales + historique backend */}
        <aside className="sidebar" style={{ width: 320, borderRight: "1px solid #22293a", background: "#0a101a", display: 'flex', flexDirection: 'column' }}>
          {/* Bloc conversations locales */}
          <div style={{ borderBottom: '1px solid #22293a', padding: '8px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px 4px 16px' }}>
              <span className="text-xs uppercase tracking-wide text-slate-400">Conversations locales</span>
              <button onClick={newConversation} className="btn ghost" style={{ fontSize: 13, padding: '2px 10px' }}>+ Nouvelle</button>
            </div>
            <div>
              {chats.map(chat => (
                <div
                  key={chat.id}
                  onClick={() => {
                    setSelectedChatId(chat.id);
                    setMessages(chat.messages);
                    setA11ConvId(null);
                    setA11ConvMsgs([]);
                  }}
                  style={{
                    fontWeight: chat.id === selectedChatId ? "bold" : "normal",
                    background: chat.id === selectedChatId ? "#22293a" : "transparent",
                    cursor: "pointer",
                    padding: '6px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderRadius: 6,
                    margin: '2px 8px',
                  }}
                >
                  <span>{chat.name}</span>
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button onClick={e => { e.stopPropagation(); renameChat(chat.id); }} title="Renommer" className="btn ghost" style={{ fontSize: 13 }}>✏️</button>
                    <button onClick={e => { e.stopPropagation(); deleteChat(chat.id); }} title="Supprimer" className="btn ghost" style={{ fontSize: 13 }}>🗑️</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
          {/* Historique backend */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                Historique A-11
              </span>
              <button onClick={refreshA11History} className="text-[11px] text-slate-400 hover:text-slate-200">
                ↻
              </button>
            </div>
            {loadingHistory ? (
              <div className="p-3 text-xs text-slate-400">Chargement…</div>
            ) : (
              <A11HistoryPanel
                items={a11History}
                activeId={a11ConvId}
                onSelect={handleOpenA11Conversation}
              />
            )}
          </div>
        </aside>
        {/* ...main... */}
        <main className="main" style={{ flex: 1, minWidth: 0 }}>
          <div className="scroll-frame">
            <div className="log">
              {(a11ConvMsgs.length ? a11ConvMsgs : messages).map((m, idx) => (
                <div
                  key={m.id || idx}
                  className={
                    "message " +
                    (m.role === "user"
                      ? "user"
                      : m.role === "assistant"
                      ? "assistant"
                      : "")
                  }
                >
                  <div className="role">
                    {m.role === "user"
                      ? "Toi"
                      : m.role === "assistant"
                      ? "A-11"
                      : "Système / Nindo"}
                  </div>
                  {m.role === "assistant"
                    ? <ReactMarkdown>{m.content}</ReactMarkdown>
                    : <div>{m.content}</div>
                  }
                  {m.imageUrl && (
                    <div className="msg-image">
                      <img
                        src={m.imageUrl}
                        alt="Résultat A-11"
                        style={{ maxWidth: "320px", borderRadius: 12 }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="composer">
            <div className="row">
              <button
                type="button"
                className="btn ghost import-inline"
                onClick={onImportClick}
                title="Importer un fichier texte"
                style={{ marginRight: 8 }}
              >
                Importer
              </button>

              <textarea
                placeholder="Demande quelque chose à A-11…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
              />

              <button
                type="button"
                className="send-button"
                onClick={() => sendMessage()}
                disabled={sending || !input.trim()}
                title="Entrée pour envoyer, Shift+Entrée pour aller à la ligne"
              >
                {sending ? "…" : "➤"}
              </button>

              <button
                type="button"
                className={`nossen-mic-btn inline ${(voiceListening || ttsFallback || audioPlaying) ? 'listening' : ''}`}
                onClick={toggleMic}
                title="Toggle microphone / TTS"
                style={{ marginLeft: 8 }}
              >
                {(voiceListening || ttsFallback || audioPlaying) ? '🎙️' : '🎤'}
              </button>
            </div>
            <div className="hint">
              Entrée pour envoyer · Shift+Entrée pour aller à la ligne
            </div>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={onFileChange}
            />
          </div>
        </main>
      </div>
      <footer className="footer">
        A-11 / Qflush UI · Cerbère 4545 · LLaMA local · Funesterie
      </footer>
      {showHistory && <HistoryPanel onClose={() => setShowHistory(false)} />}
    </div>
  );
}

export default App;