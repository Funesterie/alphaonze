      try {
        const fd = new FormData();
        pendingFiles.forEach((f) => fd.append('files', f));
        const up = await fetch('/api/upload', { method: 'POST', body: fd });
        const json = await up.json();
        if (json && json.success && Array.isArray(json.files) && json.files.length) {
          // Build inline markdown for images and audio; fallback to links for others
          const lines = [];
          json.files.forEach((f) => {
            const url = `${location.origin}${f.url}`;
            const mt = String(f.mimetype || '').toLowerCase();
            if (mt.startsWith('image/')) {
              lines.push(`![${f.name}](${url})`);
            } else if (mt.startsWith('audio/')) {
              lines.push(`[audio](${url})`);
            } else {
              lines.push(`- ${f.name} (${f.mimetype || f.ext || 'fichier'}) → ${url}`);
            }
          });
          if (lines.length) {
            content += `\n\n[Pièces jointes]\n${lines.join('\n')}`;
          }
          const previews = json.files.filter((f) => f.textPreview);
          if (previews.length) {
            content += `\n\n${previews.map((p) => `### Extrait de ${p.name}\n\n${p.textPreview}`).join('\n\n')}`;
          }
        }
      } catch (err) {
        console.error('Upload error:', err);
      } finally {
        // reset UI state regardless of success
        pendingFiles = [];
        if ($fileInput) $fileInput.value = '';
        renderAttachments();
      }
    }

    chat.messages.push({ role: "user", content });
    saveChats();

    renderMessages();
    setBusy(true);
    try {
      await sendAndStream(chat);
    } catch (err) {
      let msg = String(err?.message || err || 'Erreur inconnue');
      if (/context size|available context|prompt is too long/i.test(msg)) {
        msg += `\n\n➡️ Astuce: augmente le contexte (ex. 8192 ou 16384). Essaie: /set-ctx 8192`;
      }
      appendAssistant(`Erreur: ${msg}`);
    } finally {
      setBusy(false);
      $input.focus();
    }
  });

  // Detect manga/anime topic and fetch Japanese context to prepend as a system message
  async function maybeInjectMangaContext(userText, chat) {
    try {
      const txt = (userText || "").toLowerCase();
      const hasJa = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(userText || "");
      const looksManga = hasJa || /(manga|anime|ジャンプ|漫画|アニメ)/i.test(userText || "");
      if (!looksManga) return;
      const q = encodeURIComponent(userText.slice(0, 120));
      const r = await fetch(`/api/manga/search?query=${q}&limit=3`).catch(() => null);
      if (!r || !r.ok) return;
      const data = await r.json().catch(() => null);
      const ctx = data && data.context_ja ? String(data.context_ja).trim() : "";
      if (!ctx) return;
      const sysCtx = `Contexte manga (ja-JP):\n${ctx}`;
      chat.messages.push({ role: "system", content: sysCtx });
      saveChats();
    } catch {}
  }

  // Helpers
  function loadCfg() {
    try {
      return Object.assign(
        {},
        defaultCfg,
        JSON.parse(localStorage.getItem(LS_CFG) || "{}"),
      );
    } catch {
      return { ...defaultCfg };
    }
  }
  function saveCfg() {
    localStorage.setItem(LS_CFG, JSON.stringify(cfg));
  }

  // One-time data migration: clear old chat history and mark current data version
  function maybeMigrateData() {
    try {
      const ver = parseInt(localStorage.getItem(LS_VER) || "0", 10);
      if (ver < DATA_VERSION) {
        // Wipe chat history only; keep user settings (cfg)
        localStorage.removeItem(LS_KEY);
        localStorage.setItem(LS_VER, String(DATA_VERSION));
      }
    } catch (e) {
      // Best-effort wipe on any error
      try { localStorage.removeItem(LS_KEY); } catch {}
      try { localStorage.setItem(LS_VER, String(DATA_VERSION)); } catch {}
    }
  }

  function loadChats() {
    try {
      const arr = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
      if (Array.isArray(arr)) return arr;
    } catch {}
    return [];
  }
  function saveChats() {
    localStorage.setItem(LS_KEY, JSON.stringify(chats));
  }

  function createChat() {
    const id = `c_${Date.now()}`;
    const chat = {
      id,
      name: "Nouvelle conversation",
      ts: Date.now(),
      messages: [{ role: "system", content: cfg.system }],
    };
    chats.unshift(chat);
    saveChats();
    return chat;
  }
  function getChat(id) {
    return chats.find((c) => c.id === id);
  }
  function selectChat(id) {
    currentId = id;
    renderChatsList();
    renderMessages();
  }

  function renderChatsList() {
    $chats.innerHTML = "";
    for (const c of chats) {
      const item = document.createElement("div");
      item.className = `chat-item${c.id === currentId ? " active" : ""}`;
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = c.name;
      const time = document.createElement("div");
      time.className = "time";
      time.textContent = new Date(c.ts).toLocaleString();
      item.appendChild(name);
      item.appendChild(time);
      item.addEventListener("click", () => selectChat(c.id));
      $chats.appendChild(item);
    }
  }

  function renderMessages() {
    $log.innerHTML = "";
    const chat = getChat(currentId);
    for (const m of chat.messages) {
      appendMessage(m.role, m.content);
    }
    $log.scrollTop = $log.scrollHeight;
  }

  function appendMessage(role, content) {
    const div = document.createElement("div");
    div.className = `message ${role}`;
    const title = document.createElement("div");
    title.className = "role";
    title.textContent =
      role === "user" ? "Moi" : role === "assistant" ? "Alpha Onze" : "Système";
    const body = document.createElement("div");
    body.className = "body";
    body.innerHTML = renderMarkdown(content);
    div.appendChild(title);
    div.appendChild(body);
    $log.appendChild(div);
  }

  // Generic addMessage helper used by media/voice features
  function addMessage(role, content) {
    const chat = getChat(currentId);
    chat.messages.push({ role, content });
    saveChats();
    appendMessage(role, content);
    $log.scrollTop = $log.scrollHeight;
  }

  function appendAssistant(content) {
    const chat = getChat(currentId);
    chat.messages.push({ role: "assistant", content });
    saveChats();
    appendMessage("assistant", content);
    $log.scrollTop = $log.scrollHeight;
  }

  function replaceLastAssistant(content) {
    const chat = getChat(currentId);
    let last = chat.messages[chat.messages.length - 1];
    if (last && last.role === "assistant") {
      last.content = content;
    } else {
      chat.messages.push({ role: "assistant", content });
    }
    saveChats();
    // Update DOM
    const nodes = $log.querySelectorAll(".message.assistant .body");
    const body = nodes[nodes.length - 1];
    if (body) {
      body.innerHTML = marked.parse(content);
    } else {
      appendMessage("assistant", content);
    }
    $log.scrollTop = $log.scrollHeight;
  }

  function updateLastAssistantDelta(delta) {
    const chat = getChat(currentId);
    let last = chat.messages[chat.messages.length - 1];
    if (!last || last.role !== "assistant") {
      last = { role: "assistant", content: "" };
      chat.messages.push(last);
    }
    last.content += delta;
    saveChats();
    // update DOM last assistant
    const nodes = $log.querySelectorAll(".message.assistant .body");
    const body = nodes[nodes.length - 1];
    if (body) {
      body.innerHTML = renderMarkdown(last.content);
      $log.scrollTop = $log.scrollHeight;
    }
  }

  function renderMarkdown(txt) {
    // Minimal markdown: code fences, inline code, images, links, audio; escape HTML
    const esc = (s) =>
      s.replace(
        /[&<>]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
      );

    // Auto-repair: strip ChatML artifacts
    let cleaned = txt
      .replace(/<\|im_start\|>/gi, "")
      .replace(/<\|im_end\|>/gi, "")
      .replace(/\|im_start\|>/gi, "")
      .replace(/\|im_end\|>/gi, "")
      .replace(/jim_start>/gi, "")
      .replace(/jim_end>/gi, "")
      .trim();

    // Escape everything first
    let out = esc(cleaned);

    // code fences ```
    out = out.replace(
      /```([\s\S]*?)```/g,
      (m, code) => `<pre><code>${esc(code.trim())}</code></pre>`,
    );

    // inline code `code`
    out = out.replace(/`([^`]+)`/g, (m, code) => `<code>${esc(code)}</code>`);

    // Images: ![alt](url)
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, url) => {
      return `<img src="${url}" alt="${alt}" style="max-width:100%;height:auto;border-radius:8px" />`;
    });

    // Audio: [audio](url)
    out = out.replace(/\[audio\]\(([^)]+)\)/gi, (m, url) => {
      return `<audio controls preload="none" src="${url}"></audio>`;
    });

    // Links: [text](url)
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });

    // Paragraphs
    out = out
      .replace(/\n\n+/g, "</p><p>")
      .replace(/^/, "<p>")
      .replace(/$/, "</p>")
      .replace(/\n/g, "<br>");
    return out;
  }

  // Sync settings panel with current cfg
  function updateSettingsUI() {
    try {
      if ($setTopP) $setTopP.value = String(cfg.top_p ?? 0.9);
      if ($setNindo) {
        $setNindo.value = cfg.nindo || defaultCfg.nindo;
        $setNindo.setAttribute("disabled", "true");
        $setNindo.title = "Géré par A11 (self-control)";
      }
      if ($setSystem) $setSystem.value = cfg.system || defaultCfg.system;
      if (document.getElementById('setProvider')) document.getElementById('setProvider').value = cfg.provider || 'local';
    } catch {}
  }

  function setBusy(b) {
    $send.disabled = b;
    $input.readOnly = b;
  }

  async function health() {
    try {
      const r = await fetch("/health");
      const ok = r.ok && (await r.clone().json().catch(() => ({ ok: r.ok }))).ok;
      $status.textContent = ok ? "API OK" : "API down";
      $status.className = `status ${ok ? "ok" : "bad"}`;
    } catch {
      $status.textContent = "API down";
      $status.className = "status bad";
    }
  }

  function clampNum(v, min, max, fallback) {
    if (Number.isFinite(v)) return Math.max(min, Math.min(max, v));
    return fallback;
  }

  async function sendAndStream(chat) {
    // add a placeholder assistant message
    updateLastAssistantDelta("");
    let toolHandled = false;
    let toolBuffer = "";
    const controller = new AbortController();
    const payload = {
      model: "local-model",
      messages: chat.messages,
      temperature: 0.7, // fixed temperature (removed UI control)
      top_p: cfg.top_p,
      stream: true,
      n: 1,
      provider: cfg.provider || 'local'
    };

    const res = await fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} ${txt}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let done;
    let buffer = "";
    while (true) {
      ({ done, value } = await reader.read());
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop();
      for (const chunk of parts) {
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") break;
          try {
            const json = JSON.parse(data);
            const delta = json?.choices?.[0]?.delta?.content || "";
            if (delta) {
              updateLastAssistantDelta(delta);
              // Accumulate small buffer to detect a potential tool call JSON
              if (!toolHandled && toolBuffer.length < 2000) {
                toolBuffer += delta;
                const tool = tryParseToolCall(toolBuffer);
                if (tool && tool.tool === 'web.search' && tool.query) {
                  toolHandled = true;
                  // Stop current stream and handle tool
                  try { controller.abort(); } catch {}
                  await handleWebSearchTool(tool, chat);
                  return; // exit streaming early; follow-up handled inside
                }
              }
            }
          } catch {}
        }
      }
    }

    // After streaming completes, allow A11 to self-update its 忍道 if conditions are met
    try {
      const last = chat.messages[chat.messages.length - 1];
      const content = String(last?.content || "");
      maybeSelfUpdateNindoFromAssistant(content);
    } catch {}
  }

  function tryParseToolCall(buf) {
    try {
      const cleaned = buf
        .replace(/```json[\s\S]*?```/i, (m) => m.replace(/```json|```/gi, '').trim())
        .trim();
      // Try to find a JSON object substring
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const maybe = cleaned.slice(start, end + 1);
        const obj = JSON.parse(maybe);
        if (obj && typeof obj === 'object' && obj.tool) return obj;
      }
    } catch {}
    return null;
  }

  async function handleWebSearchTool(tool, chat) {
    try {
      // Remove the incomplete assistant tool call from history if present
      const last = chat.messages[chat.messages.length - 1];
      if (last && last.role === 'assistant' && /\"tool\"\s*:\s*\"web\.search\"/.test(last.content || '')) {
        chat.messages.pop();
      }
      saveChats();

      appendAssistant('🔍 Recherche en cours…');
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: tool.query, maxResults: tool.maxResults || 5 })
      });
      const data = await response.json();
      if (!data || !data.success) {
        replaceLastAssistant(`❌ Échec de la recherche: ${data?.message || 'erreur inconnue'}`);
        return;
      }

      // Prepare a system message with web results to guide synthesis
      const sys = `Résultats de recherche (pour \"${tool.query}\").\n` +
                  `Utilise ces éléments pour répondre précisément en français et cite les sources au format [n].\n\n` +
                  data.summary;
      chat.messages.push({ role: 'system', content: sys });
      saveChats();

      replaceLastAssistant('🧠 Synthèse à partir du web…');
      await sendAndStream(chat);
    } catch (err) {
      replaceLastAssistant(`❌ Erreur pendant la recherche: ${err?.message || err}`);
    }
  }

  // Self-control: Only A11 can evolve its 忍道. Trigger word required: "consacrement".
  function maybeSelfUpdateNindoFromAssistant(assistantText) {
    if (!assistantText) return;
    // Require trigger keyword to be present
    if (!/consacrement/i.test(assistantText)) return;
    // Try to extract new nindô in Japanese
    // Patterns: <nindo>XXX</nindo> OR line starting with 忍道:
    let m = assistantText.match(/<nindo[^>]*>([\s\S]*?)<\/nindo>/i);
    let next = m ? m[1].trim() : null;
    if (!next) {
      const line = assistantText.split(/\r?\n/).find(l => /^(忍道\s*[:：])/.test(l.trim()));
      if (line) {
        next = line.replace(/^(忍道\s*[:：])\s*/, '').trim();
      }
    }
    if (!next) return;
    // Sanitize to a short line
    next = next.split(/\r?\n/)[0].trim();
    if (!next) return;

    // Apply
    cfg.nindo = next;
    cfg.system = buildSystemPrompt();
    saveCfg();

    // Update current chat system message to reflect new nindô
    const chat = getChat(currentId);
    if (chat.messages.length && chat.messages[0].role === "system") {
      chat.messages[0].content = cfg.system;
      saveChats();
    }
    // Informatively append a quiet confirmation
    appendAssistant(`🧭 忍道が更新されました: ${next}`);
  }

  // Enter to send, Shift+Enter for new line
  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $composerForm.dispatchEvent(new Event("submit"));
    }
  });

  // ===== Native TTS/STT (Web Speech API) =====
  
  // TTS natif navigateur (lire à voix haute en français)
  function speakFR(text) {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "fr-FR";
      u.rate = 1;
      u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch (err) {
      console.error("TTS native error:", err);
    }
  }

  // STT natif navigateur (dictée micro → texte en français)
  function startDictation(onText, onEnd) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("La dictée vocale n'est pas supportée par ce navigateur.");
      return;
    }
    const r = new SR();
    r.lang = "fr-FR";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => onText(e.results[0][0].transcript);
    r.onend = () => onEnd?.();
    r.onerror = (e) => {
      console.error("STT error:", e);
      alert(`Erreur de reconnaissance vocale: ${e.error}`);
    };
    r.start();
  }

  // Connecter les boutons TTS/STT natifs
  const $dictationBtn = el("#dictationBtn");
  const $speakBtn = el("#speakBtn");

  if ($dictationBtn) {
    $dictationBtn.addEventListener("click", () => {
      $dictationBtn.disabled = true;
      $dictationBtn.textContent = "🎤🔴";
      
      startDictation(
        (transcript) => {
          // Ajouter le texte dicté dans le champ de saisie
          const current = $input.value.trim();
          $input.value = current ? `${current} ${transcript}` : transcript;
        },
        () => {
          $dictationBtn.disabled = false;
          $dictationBtn.textContent = "🎤";
          $input.focus();
        }
      );
    });
  }

  if ($speakBtn) {
    $speakBtn.addEventListener("click", () => {
      const chat = getChat(currentId);
      if (!chat || !chat.messages.length) return;
      
      // Trouver le dernier message assistant
      const lastAssistant = [...chat.messages].reverse().find(m => m.role === "assistant");
      if (!lastAssistant || !lastAssistant.content) {
        alert("Aucun message d'A11 à lire.");
        return;
      }
      
      // Nettoyer le markdown pour avoir du texte pur
      const plainText = lastAssistant.content
        .replace(/```[\s\S]*?```/g, "") // code blocks
        .replace(/`[^`]+`/g, "") // inline code
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1") // images
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
        .replace(/[#*_]/g, "") // markdown chars
        .trim();
      
      if (plainText) {
        speakFR(plainText);
      }
    });
  }

  // Media Panel
  const $mediaBtn = el("#mediaBtn");
  const $mediaPanel = el("#mediaPanel");
  const $closeMedia = el("#closeMedia");
  const $generateImage = el("#generateImage");
  const $createA11Anim = el("#createA11Anim");
  const $listAnimations = el("#listAnimations");
  const $imagePreview = el("#imagePreview");
  const $animationPreview = el("#animationPreview");

  $mediaBtn.addEventListener("click", () => {
    $mediaPanel.style.display = "flex";
  });
  
  $closeMedia.addEventListener("click", () => {
    $mediaPanel.style.display = "none";
  });

  // Tab switching
  elAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      elAll(".tab").forEach(t => t.classList.remove("active"));
      elAll(".tab-content").forEach(c => c.classList.remove("active"));
      tab.classList.add("active");
      el(`#${target}Tab`).classList.add("active");
    });
  });

  // Generate Image
  $generateImage.addEventListener("click", async () => {
    const prompt = el("#imagePrompt").value.trim();
    if (!prompt) {
      alert("Entrez un prompt pour générer une image");
      return;
    }

    const width = parseInt(el("#imageWidth").value);
    const height = parseInt(el("#imageHeight").value);
    const style = el("#imageStyle").value;
    const backend = el("#imageBackend").value;

    $imagePreview.classList.add("loading");
    $imagePreview.innerHTML = "";
    $generateImage.disabled = true;

    try {
      const res = await fetch("/api/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, width, height, style, backend })
      });

      const data = await res.json();
      if (data.success) {
        $imagePreview.classList.remove("loading");
        $imagePreview.innerHTML = `<img src="${data.imagePath}" alt="Generated image" />`;
        
        // Add to chat
        addMessage("assistant", `🎨 Image générée avec succès!\n\n![Generated Image](${data.imagePath})`);
      } else {
        throw new Error(data.error || "Échec de génération");
      }
    } catch (error) {
      $imagePreview.classList.remove("loading");
      $imagePreview.innerHTML = `<span style="color:var(--bad)">Erreur: ${error.message}</span>`;
    } finally {
      $generateImage.disabled = false;
    }
  });

  // Create A11 Animation from 3 provided images
  $createA11Anim.addEventListener("click", async () => {
    const type = el("#animationType").value;
    const duration = parseInt(el("#animDuration").value);
    const fps = parseInt(el("#animFPS").value);

    // Les 3 images d'A11 (à sauvegarder d'abord)
    const imagePaths = [
      "/assets/images/a11-hoodie.png",
      "/assets/images/a11-cartoon.png",
      "/assets/images/a11-armor.png"
    ];

    $animationPreview.classList.add("loading");
    $animationPreview.innerHTML = "";
    $createA11Anim.disabled = true;

    try {
      const res = await fetch("/api/animation/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          imagePaths,
          options: { duration, fps, width: 512, height: 512 }
        })
      });

      const data = await res.json();
      if (data.success) {
        $animationPreview.classList.remove("loading");
        
        if (type === 'gif') {
          $animationPreview.innerHTML = `<img src="${data.animationPath}" alt="A11 Animation" />`;
        } else {
          $animationPreview.innerHTML = `<video src="${data.animationPath}" controls autoplay loop></video>`;
        }
        
        // Add to chat
        addMessage("assistant", `✨ Animation A11 créée avec succès (${type})!\n\n[Voir l'animation](${data.animationPath})`);
      } else {
        throw new Error(data.error || "Échec de création d'animation");
      }
    } catch (error) {
      $animationPreview.classList.remove("loading");
      $animationPreview.innerHTML = `<span style="color:var(--bad)">Erreur: ${error.message}. Vérifiez que ffmpeg est installé.</span>`;
    } finally {
      $createA11Anim.disabled = false;
    }
  });

  // List Animations
  $listAnimations.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/animation/list");
      const data = await res.json();
      
      if (data.animations && data.animations.length > 0) {
        const list = data.animations.map(a => 
          `- [${a.name}](${a.path}) (${(a.size / 1024 / 1024).toFixed(2)} MB)`
        ).join("\n");
        
        addMessage("assistant", `📂 **Animations disponibles:**\n\n${list}`);
      } else {
        addMessage("assistant", "Aucune animation disponible pour le moment.");
      }
    } catch (error) {
      addMessage("assistant", `Erreur: ${error.message}`);
    }
  });

  // Voice Panel
  const $voiceBtn = el("#voiceBtn");
  const $voicePanel = el("#voicePanel");
  const $closeVoice = el("#closeVoice");
  const $testVoice = el("#testVoice");
  const $voiceSpeed = el("#voiceSpeed");
  const $speedValue = el("#speedValue");
  const $voiceIndicator = el("#voiceIndicator");
  const $voiceStatus = el("#voiceStatus");
  const $audioPlayer = el("#audioPlayer");
  const $audioElement = el("#audioElement");
  const $autoSpeak = el("#autoSpeak");

  let autoSpeakEnabled = false;

  $voiceBtn.addEventListener("click", () => {
    $voicePanel.style.display = "flex";
  });
  
  $closeVoice.addEventListener("click", () => {
    $voicePanel.style.display = "none";
  });

  $voiceSpeed.addEventListener("input", () => {
    $speedValue.textContent = `${$voiceSpeed.value}x`;
  });

  $autoSpeak.addEventListener("change", () => {
    autoSpeakEnabled = $autoSpeak.checked;
  });

  // Test Voice
  $testVoice.addEventListener("click", async () => {
    const voice = el("#voiceSelect").value;
    const speed = parseFloat($voiceSpeed.value);
    const backend = el("#voiceBackend").value;
    const testText = "Bonjour, je suis A11, créé pour apprendre, aider et évoluer. Comment puis-je t'assister aujourd'hui?";

    $voiceIndicator.classList.add("active");
    $voiceStatus.textContent = "Génération audio...";
    $testVoice.disabled = true;

    try {
      const res = await fetch("/api/tts/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: testText, voice, speed, backend })
      });

      const data = await res.json();
      if (data.success) {
        $audioElement.src = data.audioPath;
        $audioPlayer.style.display = "block";
        $audioElement.play();
        $voiceStatus.textContent = "Lecture audio...";
        
        $audioElement.onended = () => {
          $voiceIndicator.classList.remove("active");
          $voiceStatus.textContent = "Prêt";
        };
      } else {
        throw new Error(data.error || "Échec de génération audio");
      }
    } catch (error) {
      $voiceStatus.textContent = `Erreur: ${error.message}`;
      $voiceIndicator.classList.remove("active");
    } finally {
      $testVoice.disabled = false;
    }
  });

  // Auto-speak A11 responses
  async function speakText(text) {
    if (!autoSpeakEnabled) return;

    const voice = el("#voiceSelect").value;
    const speed = parseFloat($voiceSpeed.value);
    const backend = el("#voiceBackend").value;

    try {
      const res = await fetch("/api/tts/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, speed, backend })
      });

      const data = await res.json();
      if (data.success) {
        const audio = new Audio(data.audioPath);
        audio.play().catch(e => console.error("Audio playback failed:", e));
      }
    } catch (error) {
      console.error("TTS error:", error);
    }
  }

  // Hook into message rendering to auto-speak
  const originalAddMessage = addMessage;
  addMessage = function(role, content) {
    originalAddMessage(role, content);
    if (role === "assistant" && autoSpeakEnabled) {
      // Extract text without markdown
      const plainText = content.replace(/[#*_`\[\]()]/g, "").substring(0, 500);
      speakText(plainText);
    }
  };
})();
