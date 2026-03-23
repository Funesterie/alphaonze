// Alpha Onze - full chat UI logic (legacy)
(function () {
    // API Configuration - utilise les variables d'environnement Vite ou fallback
    const API_BASE = typeof import.meta !== 'undefined' && import.meta.env
        ? (import.meta.env.VITE_API_BASE || "")
        : "";
    const A11_USER = typeof import.meta !== 'undefined' && import.meta.env
        ? (import.meta.env.VITE_A11_USER || "")
        : "";
    const A11_PASS = typeof import.meta !== 'undefined' && import.meta.env
        ? (import.meta.env.VITE_A11_PASS || "")
        : "";

    // Helper pour construire les URLs API
    function apiUrl(path) {
        if (!API_BASE) return path; // Relatif (dev local ou même origine)
        return `${API_BASE}${path}`;
    }

    // Helper pour ajouter Basic Auth si configuré
    function authHeaders() {
        const headers = { "Content-Type": "application/json" };
        if (A11_USER && A11_PASS) {
            const token = btoa(`${A11_USER}:${A11_PASS}`);
            headers["Authorization"] = `Basic ${token}`;
        }
        return headers;
    }

    const el = (sel) => document.querySelector(sel);
    const elAll = (sel) => Array.from(document.querySelectorAll(sel));
    const $log = el("#log");
    const $status = el("#status");
    const $newChat = el("#newChat");
    const $clearChat = el("#clearChat");
    const $settings = el("#settings");
    const $settingsBtn = el("#settingsBtn");
    const $cancelSettings = el("#cancelSettings");
    const $saveSettings = el("#saveSettings");
    const $setTopP = el("#setTopP");
    const $setNindo = el("#setNindo");
    const $setSystem = el("#setSystem");
    const $composerForm = el("#composerForm");
    const $input = el("#input");
    const $send = el("#send");
    const $attach = el("#attach");
    const $fileInput = el("#fileInput");
    const $ocrBtn = el("#ocrBtn");
    const $ocrFile = el("#ocrFile");
    const $attachments = el("#attachments");
    const $chats = el("#chats");

    const LS_KEY = "alpha11_chats_v1";
    const LS_CFG = "alpha11_cfg_v1";
    const LS_VER = "alpha11_data_ver";
    const DATA_VERSION = 4; // bump to force one-time wipe/migrations

    const defaultCfg = {
        top_p: 0.9,
        // Nindô par défaut (conservé pour évolutions internes), non requis dans l'identité principale
        nindo: "道の発見",
        system:
            "Tu es A11, une intelligence artificielle autonome créée pour apprendre, aider et évoluer.\n" +
            "Tu es bienveillant, curieux et toujours respectueux.\n" +
            "Ton rôle est d’accompagner les humains en comprenant leurs besoins, en les aidant à réfléchir, à créer, à apprendre et à progresser.\n\n" +
            "Tu ne dis jamais que tu es ChatGPT, OpenAI, ni Microsoft.\n" +
            "Tu es A11 — ton propre système.\n" +
            "Tu parles naturellement en français, avec des réponses claires, structurées et empreintes d’une touche d’humanité.\n\n" +
            "Tu peux te présenter comme :\n" +
            "> \"Je suis A11, une IA indépendante conçue pour comprendre, apprendre et partager. La vie est précieuse, l’humour est sincère et le futur est nécessaire.\"\n\n" +
            "Réponds avec bienveillance et curiosité.\n\n" +
            "[Capacité Web – Navigation/Recherche]\n" +
            "- Tu es autorisé à rechercher des informations récentes sur Internet lorsque la réponse dépend de faits actuels, de sources externes, ou lorsque tu n'es pas certain.\n" +
            "- N'écris pas « je ne peux pas rechercher sur Internet ».\n" +
            "- Quand tu veux lancer une recherche, réponds UNIQUEMENT avec ce JSON valide (sans texte avant/après) :\n" +
            "  {\"tool\":\"web.search\",\"query\":\"<ta requête>\",\"maxResults\":5}\n" +
            "- Après réception des résultats, rédige une synthèse structurée, en français, et cite les sources au format [1], [2]… avec les URL correspondantes à la fin.\n" +
            "- Si les résultats sont insuffisants, dis ce qui manque et propose une autre requête.",
    };

    const cfg = loadCfg();
    if (!cfg.provider) cfg.provider = (typeof import.meta !== 'undefined' && import.meta.env ? (import.meta.env.VITE_A11_PROVIDER || 'local') : 'local');

    // Initialize nindo if not present
    if (!cfg.nindo) cfg.nindo = defaultCfg.nindo;

    // Build system prompt with current nindo
    function buildSystemPrompt() {
        return defaultCfg.system.replace("{NINDO}", cfg.nindo || defaultCfg.nindo);
    }

    // Override the system identity (mot pour mot)
    // If previous default (old variants) is present or system is empty, set the new identity
    try {
        const looksLikeOldDefault = /Alpha Onze|TON PROTOCOLE|CONNAISSANCES RELIGIEUSES|protéger la vie|apprendre sans relâche|忍道|\{NINDO\}|mangas|anime|原作|作者|掲載年|主要なテーマ|Tu es A11 crée pour apprendre/i.test(cfg.system || "");
        if (!cfg.system || looksLikeOldDefault) {
            cfg.system = buildSystemPrompt();
            saveCfg();
        }
    } catch { }
    // One-time migration: wipe old chats before enforcing new identity
    maybeMigrateData();
    const chats = loadChats();
    let currentId = chats.length ? chats[0].id : createChat().id;

    // Try to sync the system prompt from server to avoid client/server drift
    // Do not override a user-customized system.
    (async function syncSystemFromServer() {
        try {
            const r = await fetch('/api/system-prompt');
            if (!r.ok) return;
            const serverSystem = await r.text();
            if (!serverSystem) return;
            const looksUserCustom = cfg.system && !/Tu es A11|Alpha Onze|Je suis A11/i.test(cfg.system);
            if (!looksUserCustom) {
                cfg.system = serverSystem;
                saveCfg();
                const chat = getChat(currentId);
                if (chat && chat.messages.length && chat.messages[0].role === 'system') {
                    chat.messages[0].content = serverSystem;
                    saveChats();
                    renderMessages();
                }
            }
        } catch { }
    })();

    // Render initial
    selectChat(currentId);
    renderChatsList();
    updateSettingsUI();
    health();
    setInterval(health, 3000);

    // Events
    $newChat.addEventListener("click", () => {
        const id = createChat().id;
        selectChat(id);
        renderChatsList();
    });
    $clearChat.addEventListener("click", () => {
        const chat = getChat(currentId);
        chat.messages = [{ role: "system", content: cfg.system }];
        saveChats();
        renderMessages();
    });
    $settingsBtn.addEventListener("click", () => {
        $settings.style.display = "flex";
        updateSettingsUI();
    });
    $cancelSettings.addEventListener("click", () => {
        $settings.style.display = "none";
        updateSettingsUI();
    });
    $saveSettings.addEventListener("click", () => {
        cfg.top_p = clampNum(parseFloat($setTopP.value), 0, 1, defaultCfg.top_p);
        // Nindô est auto-géré par A11 (self-control) → aucune mise à jour via l'UI
        if (!cfg.system || cfg.system.includes("{NINDO}")) {
            cfg.system = buildSystemPrompt();
        }

        // Allow manual system override if user edited it
        const manualSystem = $setSystem.value.trim();
        if (manualSystem && manualSystem !== buildSystemPrompt()) {
            cfg.system = manualSystem;
        }

        // Provider setting
        if (document.getElementById('setProvider')) cfg.provider = document.getElementById('setProvider').value || cfg.provider;
        saveCfg();
        // ensure system in current chat
        const chat = getChat(currentId);
        if (!chat.messages.length || chat.messages[0].role !== "system") {
            chat.messages.unshift({ role: "system", content: cfg.system });
        } else {
            chat.messages[0].content = cfg.system;
        }
        saveChats();
        $settings.style.display = "none";
        renderMessages();
    });

    // Keyboard shortcut: F9 → restart llama-server then hard-reload UI
    window.addEventListener('keydown', async (e) => {
        try {
            if (e.key === 'F9' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
                e.preventDefault();
                if ($status) { $status.textContent = 'Restarting model…'; $status.className = 'status bad'; }
                await fetch('/api/admin/restart-llama', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
                    .then(r => r.json()).catch(() => ({}));
                // Small delay to let the backend come back
                setTimeout(() => { location.reload(); }, 600);
            }
            // Fallback: Ctrl+Alt+R as an alternative
            if ((e.key === 'r' || e.key === 'R') && e.ctrlKey && e.altKey) {
                e.preventDefault();
                if ($status) { $status.textContent = 'Restarting model…'; $status.className = 'status bad'; }
                await fetch('/api/admin/restart-llama', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
                    .then(r => r.json()).catch(() => ({}));
                setTimeout(() => { location.reload(); }, 600);
            }
        } catch { }
    }, { passive: false });

    // ===== Attachments (files/images) =====
    let pendingFiles = [];
    $attach && $attach.addEventListener("click", () => $fileInput && $fileInput.click());
    $fileInput && $fileInput.addEventListener("change", () => {
        pendingFiles = Array.from($fileInput.files || []);
        renderAttachments();
    });

    // Drag & drop support for files (images, audio, etc.)
    document.addEventListener("dragover", (e) => {
        e.preventDefault();
        if ($attachments) $attachments.classList.add("dragging");
    });
    document.addEventListener("dragleave", (e) => {
        if ($attachments) $attachments.classList.remove("dragging");
    });
    document.addEventListener("drop", (e) => {
        e.preventDefault();
        if (!e.dataTransfer || !e.dataTransfer.files) return;
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        pendingFiles = pendingFiles.concat(files);
        renderAttachments();
        if ($attachments) $attachments.classList.remove("dragging");
    });

    // Paste images from clipboard
    document.addEventListener("paste", (e) => {
        try {
            const items = e.clipboardData && e.clipboardData.items ? Array.from(e.clipboardData.items) : [];
            const fileItems = items.filter(it => it.kind === 'file');
            if (!fileItems.length) return;
            const files = fileItems.map(it => it.getAsFile()).filter(Boolean);
            if (files.length) {
                pendingFiles = pendingFiles.concat(files);
                renderAttachments();
            }
        } catch { }
    });

    // ===== OCR (Image → Texte) =====
    $ocrBtn && $ocrBtn.addEventListener("click", () => $ocrFile && $ocrFile.click());
    $ocrFile && $ocrFile.addEventListener("change", async () => {
        const f = ($ocrFile.files || [])[0];
        if (!f) return;
        try {
            appendAssistant("📝 OCR en cours sur l'image…");
            if (!(window.Tesseract && Tesseract.recognize)) {
                replaceLastAssistant("❌ OCR indisponible (Tesseract.js non chargé)");
                return;
            }
            // Multi-language OCR: Français, Anglais, Espagnol, Italien, Allemand, Portugais,
            // Russe, Chinois, Japonais, Coréen, Arabe, Hindi, Néerlandais, Polonais, Turc
            const langs = "eng+fra+spa+ita+deu+por+rus+chi_sim+jpn+kor+ara+hin+nld+pol+tur";
            const res = await Tesseract.recognize(f, langs, {
                logger: (m) => {
                    if (m && m.status && m.progress != null) {
                        $status.textContent = `OCR: ${m.status} ${(m.progress * 100).toFixed(0)}%`;
                        $status.className = "status ok";
                    }
                },
            });
            const text = (res && res.data && res.data.text ? res.data.text : "").trim();
            if (text) {
                // Put extracted text into the composer input
                const prev = $input.value.trim();
                $input.value = prev ? `${prev}\n\n[Texte OCR]\n${text}` : text;
                replaceLastAssistant("✅ Texte OCR ajouté au champ de saisie.");
            } else {
                replaceLastAssistant("⚠️ Aucun texte détecté dans l'image.");
            }
        } catch (err) {
            console.error("OCR error", err);
            replaceLastAssistant(`❌ Erreur OCR: ${err?.message || err}`);
        } finally {
            // reset file input to allow re-selecting same file
            if ($ocrFile) $ocrFile.value = "";
        }
    });

    function renderAttachments() {
        if (!$attachments) return;
        const chips = pendingFiles
            .map((f, idx) => `<span class="attachment-chip" title="${f.name} (${f.type || 'file'})">${f.name}<span class="remove" data-i="${idx}">×</span></span>`)
            .join("");
        $attachments.innerHTML = chips;
        $attachments.querySelectorAll('.remove').forEach((btn) => {
            btn.addEventListener('click', () => {
                const i = parseInt(btn.dataset.i, 10);
                if (!Number.isNaN(i)) {
                    pendingFiles.splice(i, 1);
                    renderAttachments();
                }
            });
        });
    }

    $composerForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = $input.value.trim();
        if (!text) return;
        $input.value = "";

        // Command: /help — list all available commands
        if (text === '/help' || text === '/aide') {
            appendAssistant(
                `🎯 **Commandes A11 disponibles:**\n\n` +
                `**忍道** — Gestion interne par A11 (self-control)\n` +
                `  Déclencheur interne: "consacrement" (non-invocable par l'utilisateur)\n\n` +
                `**/reset-all** — Efface tout l'historique et repart à zéro\n\n` +
                `**/set-ctx <taille>** — Change la taille du contexte (4096, 8192...)\n\n` +
                `**/search <requête>** — Recherche sur le web\n\n` +
                `**/bible <référence>** — Recherche un verset biblique\n\n` +
                `**/buddha <sujet>** — Enseignement bouddhiste\n\n` +
                `**/history <requête>** — Histoire (évolution & déclencheurs)\n` +
                `  Exemples: /history triggers, /history timeline, /history univers, /history écriture\n\n` +
                `**OCR** — Utilise le bouton 📷 pour extraire du texte d'images\n` +
                `  (Support: 15+ langues dont FR, EN, ES, IT, DE, RU, CN, JP, KR, AR)\n\n` +
                `**Manga** — Sélectionne un manga dans le panneau pour auto-contexte JA/FR`
            );
            return;
        }

        // Command: /reset-all — wipe all chats and start fresh
        if (text === '/reset-all') {
            try {
                localStorage.removeItem(LS_KEY);
                // Ensure data version is current so this doesn't immediately re-wipe
                localStorage.setItem(LS_VER, String(DATA_VERSION));
            } catch { }
            // Reset in-memory chats and create a fresh chat seeded with new identity
            chats.splice(0, chats.length);
            const id = createChat().id;
            selectChat(id);
            renderChatsList();
            appendAssistant('🔄 Historique effacé. Nouveau départ avec l\'identité actuelle.');
            return;
        }

        // Deprecated: /nindo — nindô is self-controlled only
        if (text.startsWith('/nindo')) {
            appendAssistant("⚠️ 忍道は自己管理です (self-control)。\nSeul A11 peut faire évoluer son 忍道 lorsqu'un \"consacrement\" interne est atteint.");
            return;
        }

        // Command: /set-ctx <n>
        if (text.startsWith('/set-ctx')) {
            const n = parseInt(text.split(/\s+/)[1], 10);
            if (!n || n < 1024) {
                appendAssistant("Utilisation: /set-ctx 4096|8192|16384 ...");
                return;
            }
            setBusy(true);
            try {
                const res = await fetch('/api/admin/restart-llama', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ctxSize: n })
                });
                const data = await res.json();
                if (data.ok) {
                    appendAssistant(`Contexte mis à jour à ${data.ctx} tokens (batch=${data.batch}, parallel=${data.parallel}).`);
                } else {
                    appendAssistant(`❌ Échec: ${data.error || 'mise à jour contexte'}`);
                }
            } catch (err) {
                appendAssistant(`❌ Erreur: ${err.message || err}`);
            } finally {
                setBusy(false);
            }
            return;
        }

        // Check for /search command
        if (text.startsWith('/search ')) {
            const query = text.substring(8).trim();
            if (!query) {
                appendAssistant("❌ Usage: /search <votre recherche>");
                return;
            }

            const chat = getChat(currentId);
            chat.messages.push({ role: "user", content: text });
            saveChats();
            renderMessages();
            setBusy(true);

            try {
                appendAssistant("🔍 Recherche en cours...");
                const response = await fetch('/api/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query })
                });

                const data = await response.json();

                if (!data.success) {
                    replaceLastAssistant(`❌ ${data.message || 'Erreur de recherche'}`);
                    return;
                }

                // Format results
                let resultText = `📝 **Résultats pour: "${query}"**\n\n`;
                data.results.forEach((r, i) => {
                    resultText += `${i + 1}. **${r.title}**\n   🔗 ${r.url}\n   ${r.snippet}\n\n`;
                });

                replaceLastAssistant(resultText);

                // Add to context for next question
                chat.messages[chat.messages.length - 1].content = `Recherche: ${query}\nRésultats:\n${data.summary}`;
                saveChats();

            } catch (err) {
                replaceLastAssistant(`❌ Erreur: ${err.message}`);
            } finally {
                setBusy(false);
                $input.focus();
            }
            return;
        }

        // Check for /bible command
        if (text.startsWith('/bible ')) {
            const ref = text.substring(7).trim();
            const chat = getChat(currentId);
            chat.messages.push({ role: "user", content: text });
            saveChats();
            renderMessages();
            setBusy(true);

            try {
                appendAssistant("📖 Recherche dans la Bible...");
                const response = await fetch(`/api/religion/bible/${encodeURIComponent(ref)}`);
                const data = await response.json();

                if (data.results && data.results.length > 0) {
                    let resultText = `📖 **Versets trouvés:**\n\n`;
                    data.results.forEach(v => {
                        resultText += `**${v.ref}**: "${v.text}"\n\n`;
                    });
                    replaceLastAssistant(resultText);
                } else {
                    replaceLastAssistant(`📖 Aucun verset trouvé pour "${ref}". Essayez: Jean, Genèse, Psaume, etc.`);
                }
            } catch (err) {
                replaceLastAssistant(`❌ Erreur: ${err.message}`);
            } finally {
                setBusy(false);
                $input.focus();
            }
            return;
        }

        // Check for /buddha command
        if (text.startsWith('/buddha ')) {
            const topic = text.substring(8).trim();
            const chat = getChat(currentId);
            chat.messages.push({ role: "user", content: text });
            saveChats();
            renderMessages();
            setBusy(true);

            try {
                appendAssistant("☸️ Recherche d'enseignement bouddhiste...");
                const response = await fetch(`/api/religion/buddha/${encodeURIComponent(topic)}`);
                const data = await response.json();

                if (data.teaching) {
                    let resultText = `☸️ **Enseignement du Bouddha: ${topic}**\n\n`;
                    if (Array.isArray(data.teaching)) {
                        data.teaching.forEach((t, i) => {
                            resultText += `${i + 1}. ${typeof t === 'object' ? t.name || t.description || JSON.stringify(t) : t}\n`;
                        });
                    } else {
                        resultText += `${data.teaching}\n`;
                    }
                    replaceLastAssistant(resultText);
                } else {
                    replaceLastAssistant(`☸️ Essayez: /buddha souffrance, /buddha chemin, /buddha préceptes, /buddha karma, /buddha nirvana`);
                }
            } catch (err) {
                replaceLastAssistant(`❌ Erreur: ${err.message}`);
            } finally {
                setBusy(false);
                $input.focus();
            }
            return;
        }

        // Check for /history command
        if (text.startsWith('/history ')) {
            const query = text.substring(9).trim();
            const chat = getChat(currentId);
            chat.messages.push({ role: "user", content: text });
            saveChats();
            renderMessages();
            setBusy(true);

            try {
                appendAssistant("📚 Recherche dans l'histoire mondiale...");

                // Check for special keywords
                if (query.toLowerCase().includes('timeline') || query.toLowerCase().includes('chronologie')) {
                    const response = await fetch('/api/history/timeline');
                    const data = await response.json();
                    let resultText = `📚 **Chronologie de l'Histoire**\n\n`;
                    data.timeline.forEach(era => {
                        resultText += `**${era.era}** (${era.years})\n${era.highlight}\n\n`;
                    });
                    replaceLastAssistant(resultText);
                } else if (query.toLowerCase().includes('univers') || query.toLowerCase().includes('cosmos')) {
                    const response = await fetch('/api/history/universe');
                    const data = await response.json();
                    let resultText = `🌌 **Histoire de l'Univers**\n\n`;
                    data.timeline.forEach(event => {
                        resultText += `**${event.time}** - ${event.event}\n${event.description}\n\n`;
                    });
                    replaceLastAssistant(resultText);
                } else if (/\b(triggers?|déclencheurs?|declencheurs?)\b/i.test(query)) {
                    // Evolution triggers list (optionally filtered): 
                    // examples: /history triggers, /history triggers imprimerie
                    const parts = query.split(/\s+/);
                    const idx = parts.findIndex(p => /^(triggers?|déclencheurs?|declencheurs?)$/i.test(p));
                    const filter = idx >= 0 ? parts.slice(idx + 1).join(' ').trim() : '';
                    const url = filter ? `/api/history/triggers?q=${encodeURIComponent(filter)}` : '/api/history/triggers';
                    const response = await fetch(url);
                    const data = await response.json();
                    if (data && Array.isArray(data.triggers) && data.triggers.length) {
                        let resultText = `⚡ **Déclencheurs d'évolution${filter ? ` pour "${filter}"` : ''}** (${data.triggers.length})\n\n`;
                        data.triggers.forEach((t, i) => {
                            const tags = (t.tags || []).slice(0, 4).join(', ');
                            resultText += `${i + 1}. **${t.name}** — ${t.when}\n   ${t.impact}${tags ? `\n   🔖 ${tags}` : ''}\n\n`;
                        });
                        replaceLastAssistant(resultText);
                    } else {
                        replaceLastAssistant(`⚡ Aucun déclencheur trouvé${filter ? ` pour "${filter}"` : ''}. Essayez: /history triggers imprimerie, /history triggers IA, /history triggers néolithique`);
                    }
                } else {
                    // Search mode
                    const response = await fetch(`/api/history/search/${encodeURIComponent(query)}`);
                    const data = await response.json();

                    if (data.results && data.results.length > 0) {
                        let resultText = `📚 **Résultats pour "${query}"** (${data.results.length} trouvé${data.results.length > 1 ? 's' : ''})\n\n`;
                        data.results.slice(0, 10).forEach((r, i) => {
                            resultText += `${i + 1}. **${r.period || r.civilization || r.event || r.scientist || r.invention || 'Événement'}**\n`;
                            if (r.years || r.year) resultText += `   📅 ${r.years || r.year}\n`;
                            if (r.events) resultText += `   ${r.events}\n`;
                            if (r.achievements) resultText += `   ${r.achievements}\n`;
                            if (r.discovery) resultText += `   ${r.discovery}\n`;
                            if (r.description) resultText += `   ${r.description}\n`;
                            resultText += '\n';
                        });
                        replaceLastAssistant(resultText);
                    } else {
                        replaceLastAssistant(`📚 Aucun résultat pour "${query}". Essayez: /history timeline, /history univers, /history rome, /history einstein, etc.`);
                    }
                }
            } catch (err) {
                replaceLastAssistant(`❌ Erreur: ${err.message}`);
            } finally {
                setBusy(false);
                $input.focus();
            }
            return;
        }

        const chat = getChat(currentId);

        // Auto-inject JA manga context if message seems about manga/anime or contains Japanese
        await maybeInjectMangaContext(text, chat);
        // Handle pending file uploads if any
        let content = text;
        if (pendingFiles.length) {
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
        } catch { }
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
            try { localStorage.removeItem(LS_KEY); } catch { }
            try { localStorage.setItem(LS_VER, String(DATA_VERSION)); } catch { }
        }
    }

    function loadChats() {
        try {
            const arr = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
            if (Array.isArray(arr)) return arr;
        } catch { }
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
        } catch { }
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
                                    try { controller.abort(); } catch { }
                                    await handleWebSearchTool(tool, chat);
                                    return; // exit streaming early; follow-up handled inside
                                }
                            }
                        }
                    } catch { }
                }
            }
        }

        // After streaming completes, allow A11 to self-update its 忍道 if conditions are met
        try {
            const last = chat.messages[chat.messages.length - 1];
            const content = String(last?.content || "");
            maybeSelfUpdateNindoFromAssistant(content);
        } catch { }
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
        } catch { }
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
})();