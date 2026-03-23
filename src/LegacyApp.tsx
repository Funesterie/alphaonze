import { useEffect, useRef } from "react";

const legacyHtml = `
  <div id="container" class="legacy-container">
    <aside id="sidebar">
      <div id="controls">
        <button id="newChat">Nouvelle conversation</button>
        <button id="clearChat">Effacer</button>
        <button id="settingsBtn">Paramètres</button>
      </div>
      <div id="chats" class="chat-list"></div>
    </aside>

    <main id="main">
      <header id="header">
        <div id="status" class="status">Chargement...</div>
      </header>

      <section id="log-panel">
        <div id="log" class="messages"></div>
      </section>

      <section id="composer-panel">
        <form id="composerForm" class="composer-form">
          <textarea id="input" placeholder="Écrivez votre message..."></textarea>
          <div class="composer-actions">
            <button type="submit" id="send">Envoyer</button>
            <button type="button" id="attach">Joindre</button>
            <input id="fileInput" type="file" style="display:none" />
            <button type="button" id="ocrBtn">OCR</button>
            <input id="ocrFile" type="file" accept="image/*" style="display:none" />
          </div>
        </form>
        <div id="attachments" class="attachments"></div>
      </section>

      <section id="settings" style="display:none">
        <label>top_p: <input id="setTopP" type="number" step="0.1" min="0" max="1" /></label>
        <label>Nindô: <input id="setNindo" /></label>
        <label>System: <textarea id="setSystem"></textarea></label>
        <button id="saveSettings">Sauver</button>
        <button id="cancelSettings">Annuler</button>
      </section>
    </main>
  </div>
`;

export default function LegacyApp() {
  const containerRef = useRef(null);

  useEffect(() => {
    // Inject CSS if not present
    if (!document.getElementById("legacy-style")) {
      const link = document.createElement("link");
      link.id = "legacy-style";
      link.rel = "stylesheet";
      link.href = "/legacy/style.css";
      document.head.appendChild(link);
    }
    // Inject JS legacy ONLY after HTML is in the DOM
    if (!document.getElementById("legacy-script")) {
      // ensure DOM content is present before loading script
      setTimeout(() => {
        const script = document.createElement("script");
        script.id = "legacy-script";
        script.src = "/legacy/app.js";
        // load as ES module so `import.meta` is available in the legacy bundle
        script.type = "module";
        document.body.appendChild(script);
      }, 0);
    }
  }, []);

  return (
    <div ref={containerRef} dangerouslySetInnerHTML={{ __html: legacyHtml }} />
  );
}
