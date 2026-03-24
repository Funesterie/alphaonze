// @ts-nocheck

const isLocalHost =
  typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);

const PROD_API_BASE = 'https://api.funesterie.pro';

// API Base URL for production (env override > production default > local relative paths)
const API_BASE =
  (import.meta.env?.VITE_API_URL) ||
  (import.meta.env?.VITE_API_BASE_URL) ||
  (import.meta.env?.VITE_API_BASE) ||
  (!isLocalHost ? PROD_API_BASE : '');

// Nezlephant token (optionnel)
const NEZ_TOKEN = (import.meta.env?.VITE_A11_NEZ_TOKEN) || '';

export const TTS_API =
    import.meta.env.VITE_TTS_API ||
    (API_BASE ? `${API_BASE}/api/tts/piper` : '/api/tts/piper');

// export const TTS_VOICES = ['fr_FR-siwis-medium', 'fr_FR-siwis-sd', 'fr_FR-williwaw', 'fr_FR-barkly'];
export const TTS_VOICES = ['fr_FR-siwis-medium'];

export type Msg = { role: "user" | "assistant" | "system"; content: string };
export type ChatResponse = {
  choices?: { message?: { content?: string } }[];
  content?: string;
  output?: string;
};

// Appel générique POST JSON : le frontend appelle uniquement le backend /api/ai
async function apiPost(body: unknown) {
  const url = '/api/ai';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (NEZ_TOKEN) headers['X-NEZ-TOKEN'] = NEZ_TOKEN;

  const fetchOptions: any = {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  };

  // Use credentials for same-origin scenarios if API is same origin
  try {
    const apiUrlObj = new URL(url, location.origin);
    if (apiUrlObj.origin === location.origin) fetchOptions.credentials = 'include';
  } catch (e) {
    // ignore
  }

  const res = await fetch(url, fetchOptions);

  // If response is an event-stream, process incrementally
  const contentType = res.headers.get('content-type') || '';
  if (res.ok && (contentType.includes('text/event-stream') || contentType.includes('text/plain'))) {
    // Try to stream-process SSE-style responses
    try {
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let buf = '';
        let aggregated = '';

        // Helper to process a full line starting with 'data:'
        const processDataLine = (line) => {
          const payload = line.slice(5).trim(); // after 'data:'
          if (!payload) return;
          if (payload === '[DONE]') {
            try { window.dispatchEvent(new CustomEvent('a11:assistant.done')); } catch (e) {}
            return;
          }
          let parsed = null;
          try { parsed = JSON.parse(payload); } catch (e) { return; }
          const chunk = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content ?? parsed?.response ?? '';
          if (chunk) {
            aggregated += String(chunk);
            try { window.dispatchEvent(new CustomEvent('a11:assistant.delta', { detail: String(chunk) })); } catch (e) {}
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          // split on double-newline which typically separates SSE events
          let parts = buf.split(/\n\n/);
          // keep last partial in buffer
          buf = parts.pop() || '';

          for (const p of parts) {
            const lines = p.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            for (const line of lines) {
              if (line.startsWith('data:')) {
                // Log raw data for debugging
                console.log('[A11][RAW] 200 data:', line.slice(5).trim());
                processDataLine(line);
              }
            }
          }
        }

        // Final flush if buffer contains a data: line
        const finalLines = buf.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        for (const line of finalLines) {
          if (line.startsWith('data:')) {
            console.log('[A11][RAW] 200 data:', line.slice(5).trim());
            processDataLine(line);
          }
        }

        // Return OpenAI-like structure with aggregated content
        return {
          choices: [{ message: { role: 'assistant', content: aggregated } }]
        };
      }
    } catch (e) {
      console.warn('[A11][STREAM] streaming parse failed, falling back to full read', e);
      // fallthrough to full-text handling
    }
  }

  // Try streaming text if needed; for now read full text
  const text = await res.text();
  console.log('[A11][RAW]', res.status, text);

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${text}`);
  }

  let data: any;
  try {
    // Handle event-stream / SSE style responses that prefix lines with "data: {...}"
    const trimmed = text.trim();
    if (trimmed.startsWith('data:') || trimmed.includes('\ndata:')) {
      // Extract JSON blobs from lines starting with 'data: '
      const re = /data:\s*(\{[\s\S]*?\})(?:\s*\n|$)/g;
      let match: RegExpExecArray | null;
      let lastJsonStr: string | null = null;
      const parts: string[] = [];
      while ((match = re.exec(text)) !== null) {
        lastJsonStr = match[1];
        try {
          const parsed = JSON.parse(lastJsonStr);
          const chunk = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content ?? parsed?.response ?? null;
          if (chunk) parts.push(String(chunk));
        } catch (e) {
          // ignore
        }
      }
      if (parts.length) {
        data = { choices: [{ message: { role: 'assistant', content: parts.join('') } }] };
      } else if (lastJsonStr) {
        try { data = JSON.parse(lastJsonStr); } catch { data = { raw: text }; }
      } else {
        data = { raw: text };
      }
    } else {
      data = JSON.parse(text);
    }
  } catch {
    // If parsing fails, return raw text wrapped
    if (!data) data = { raw: text };
  }

  return data;
}

export async function chatCompletion(
  messages: Msg[],
  systemPromptOrOptions?: string | { systemPrompt?: string }
) {
  // Support both old signature (systemPrompt string) and options object
  let systemPrompt: string | undefined;
  if (typeof systemPromptOrOptions === 'string') {
    systemPrompt = systemPromptOrOptions;
  } else if (typeof systemPromptOrOptions === 'object' && systemPromptOrOptions !== null) {
    systemPrompt = systemPromptOrOptions.systemPrompt;
  }

  // Ajout du systemPrompt si fourni
  let msgs = messages;
  if (systemPrompt) {
    msgs = [{ role: 'system', content: systemPrompt }, ...messages.filter(m => m.role !== 'system')];
  }

  // Filtre les tokens spéciaux hérités dans tous les messages
  msgs = msgs.map(m => ({
    ...m,
    content: typeof m.content === 'string' ? m.content.replace(/<\|.*?\|>/g, '') : ''
  }));

  const payload = {
    messages: msgs,
  };

  const data = await apiPost(payload);

  // On essaie de lire réponse façon OpenAI
  const content =
    data?.choices?.[0]?.message?.content ??
    data?.reply ??
    JSON.stringify(data);

  return content as string;
}

// Chat simple avec prompt système et modèle choisis
export async function chat(message: string, history: Msg[] = [], systemPrompt?: string) {
  const messages: Msg[] = history.length ? history : [
    { role: 'system', content: systemPrompt || 'Tu es AlphaOnze (A-11), un assistant IA français unique et attachant.' },
    { role: 'user', content: message }
  ];
  try { window.dispatchEvent(new Event('conversation:start')); } catch {}
  try {
    return await chatCompletion(messages, systemPrompt);
  } finally {
    try { window.dispatchEvent(new Event('conversation:end')); } catch {}
  }
}

// Appel TTS générique
export async function ttsSpeak(text: string, voice: string = 'fr_FR-siwis-medium', provider: string = 'piper') {
  const payload = {
    text,
    voice,
    provider
  };
  // On suppose que le backend écoute sur /api/tts/speak
  const fetchOptions: any = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
  // same-origin proxy should include credentials
  fetchOptions.credentials = 'include';

  const url = API_BASE ? `${API_BASE}/api/tts/speak` : '/api/tts/speak';
  const res = await fetch(url, fetchOptions);

  // Si le backend renvoie JSON (erreur ou métadonnées)
  const contentType = res.headers.get('content-type') || '';

  if (!res.ok) {
    // essayer de parser JSON d'erreur
    if (contentType.includes('application/json')) {
      const err = await res.json();
      throw new Error(err && err.error ? String(err.error) : JSON.stringify(err));
    }
    const textErr = await res.text();
    throw new Error(textErr || `TTS request failed with status ${res.status}`);
  }

  // Si audio retourné, renvoyer une URL blob exploitable par le frontend
  if (contentType.startsWith('audio/') || contentType === 'application/octet-stream') {
    const blob = await res.blob();
    const audioUrl = URL.createObjectURL(blob);
    return { success: true, audioUrl, blob };
  }

  // Sinon on essaie le JSON (cas ElevenLabs / fallback)
  try {
    const data = await res.json();
    return data;
  } catch (e) {
    // fallback: retourner le texte brut
    const txt = await res.text();
    return { success: true, text: txt };
  }
}

export type A11ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type A11AgentResponse =
  | {
      type: "text";
      content: string;
    }
  | {
      type: "tool-result";
      tool: string;
      input: any;
      result: any;
      explanation: string;
      imageUrl?: string | null;
      actionId?: string | null;
    }
  | {
      type: "tool-error";
      tool: string;
      input: any;
      error: string;
      actionId?: string | null;
    };

export async function callA11Agent(messages: A11ChatMessage[], devMode?: boolean): Promise<A11AgentResponse> {
  const url = API_BASE ? `${API_BASE}/api/agent` : "/api/agent";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(devMode ? { messages, devMode } : { messages }),
  });
  if (!res.ok) {
    throw new Error(`A11 /api/agent error: ${res.status}`);
  }
  return res.json();
}

// Exemple d'utilisation :
// const result = await callA11Agent([{ role: 'user', content: 'Va lire https://example.com' }]);
// if (result.type === 'tool-result') { /* afficher result.result */ }
/// else if (result.type === 'text') { /* afficher result.content */ }

// quick test payload (left for dev) - POST to router
// Removed unsolicited quick test to avoid network errors in browser during module import
// fetch(`${LLM_ROUTER_URL.replace(/\/$/, '')}/v1/chat/completions`, {
//   method: 'POST',
//   headers: { 'Content-Type': 'application/json' },
//   credentials: 'include',
//   body: JSON.stringify({ messages: [{ role: 'user', content: 'salut' }] })
// });

// === A11 Conversation History (backend) ===
export async function fetchA11HistoryList() {
  // GET /api/a11/history renvoie la liste des conversations (id, name, updated...)
  const url = API_BASE ? `${API_BASE}/api/a11/history` : '/api/a11/history';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Erreur chargement historique A-11');
  return res.json();
}

export async function fetchA11Conversation(convId: string) {
  // GET /api/a11/history/:id renvoie les messages d'une conversation
  const url = API_BASE ? `${API_BASE}/api/a11/history/${encodeURIComponent(convId)}` : `/api/a11/history/${encodeURIComponent(convId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Erreur chargement conversation A-11');
  return res.json();
}

export async function callQflush(input: string): Promise<string> {
  return chatCompletion([{ role: 'user', content: input }]);
}

export async function callAI(input: string, _mode: 'qflush' | 'llm' = 'llm'): Promise<string> {
  return chatCompletion([{ role: 'user', content: input }]);
}
