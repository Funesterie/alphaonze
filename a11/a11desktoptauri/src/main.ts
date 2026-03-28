import { invoke } from "@tauri-apps/api/core";

type ServiceSnapshot = {
  key: string;
  label: string;
  port: number;
  enabled: boolean;
  ready: boolean;
  required: boolean;
  state: string;
};

type ModelSetupSnapshot = {
  installerLite: boolean;
  modelRequired: boolean;
  modelExists: boolean;
  modelEnabled: boolean;
  selectedModelId: string;
  modelPath: string;
  modelFileName: string;
  modelsDirectory: string;
  downloadConfigured: boolean;
  defaultModelUrl?: string | null;
};

type LocalModelSnapshot = {
  id: string;
  label: string;
  fileName: string;
  downloadConfigured: boolean;
  sizeHint?: string | null;
  description?: string | null;
  recommended: boolean;
};

type RemoteProviderSnapshot = {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  description?: string | null;
};

type RemoteSetupSnapshot = {
  mode: string;
  providerId: string;
  providerLabel: string;
  baseUrl: string;
  model: string;
  apiKeyPresent: boolean;
  configured: boolean;
};

type RuntimeOperationSnapshot = {
  active: boolean;
  command: string;
  pid?: number | null;
  startedAt?: string | null;
};

type RuntimeProgressSnapshot = {
  active: boolean;
  phase: string;
  message: string;
  serviceKey?: string | null;
  serviceLabel?: string | null;
  updatedAt?: string | null;
  pid?: number | null;
};

type RuntimeSnapshot = {
  appName: string;
  launcherMode: string;
  ready: boolean;
  uiUrl: string;
  logsDir: string;
  services: ServiceSnapshot[];
  modelSetup: ModelSetupSnapshot;
  localModels: LocalModelSnapshot[];
  remoteProviders: RemoteProviderSnapshot[];
  remoteSetup: RemoteSetupSnapshot;
  operation?: RuntimeOperationSnapshot | null;
  progress?: RuntimeProgressSnapshot | null;
  message?: string | null;
};

const state = {
  busy: false,
  snapshot: null as RuntimeSnapshot | null,
  error: "",
};
let startupMonitorActive = false;
const STARTUP_POLL_MS = 2000;
const STARTUP_TIMEOUT_MS = 8 * 60 * 1000;
const SNAPSHOT_TIMEOUT_MS = 5000;

const phasePill = document.querySelector<HTMLElement>("#phase-pill");
const summaryEl = document.querySelector<HTMLElement>("#summary");
const errorEl = document.querySelector<HTMLElement>("#error-msg");
const noticeEl = document.querySelector<HTMLElement>("#notice-msg");
const servicesEl = document.querySelector<HTMLElement>("#services");
const logsPathEl = document.querySelector<HTMLElement>("#logs-path");
const launchBtn = document.querySelector<HTMLButtonElement>("#launch-btn");
const retryBtn = document.querySelector<HTMLButtonElement>("#retry-btn");
const openBtn = document.querySelector<HTMLButtonElement>("#open-btn");
const refreshBtn = document.querySelector<HTMLButtonElement>("#refresh-btn");
const stopBtn = document.querySelector<HTMLButtonElement>("#stop-btn");
const logsBtn = document.querySelector<HTMLButtonElement>("#logs-btn");
const quitBtn = document.querySelector<HTMLButtonElement>("#quit-btn");
const modelCard = document.querySelector<HTMLElement>("#model-card");
const modelSummaryEl = document.querySelector<HTMLElement>("#model-summary");
const modelPathEl = document.querySelector<HTMLElement>("#model-path");
const modelImportBtn = document.querySelector<HTMLButtonElement>("#model-import-btn");
const modelDownloadBtn = document.querySelector<HTMLButtonElement>("#model-download-btn");
const modelFolderBtn = document.querySelector<HTMLButtonElement>("#model-folder-btn");
const localModelSelect = document.querySelector<HTMLSelectElement>("#local-model-select");
const remoteProviderSelect = document.querySelector<HTMLSelectElement>("#remote-provider-select");
const remoteBaseUrlInput = document.querySelector<HTMLInputElement>("#remote-base-url");
const remoteModelInput = document.querySelector<HTMLInputElement>("#remote-model");
const remoteApiKeyInput = document.querySelector<HTMLInputElement>("#remote-api-key");
const remoteSummaryEl = document.querySelector<HTMLElement>("#remote-summary");
const remoteSaveBtn = document.querySelector<HTMLButtonElement>("#remote-save-btn");
const remoteLocalBtn = document.querySelector<HTMLButtonElement>("#remote-local-btn");

function needsModelSetup(snapshot: RuntimeSnapshot | null) {
  return !!snapshot?.modelSetup?.installerLite && !!snapshot?.modelSetup?.modelRequired;
}

function getService(snapshot: RuntimeSnapshot | null, key: string) {
  return snapshot?.services?.find((service) => service.key === key) || null;
}

function isServiceReady(snapshot: RuntimeSnapshot | null, key: string) {
  return !!getService(snapshot, key)?.ready;
}

function hasManagedOrExternalStack(snapshot: RuntimeSnapshot | null) {
  return !!snapshot?.services?.some((service) =>
    service.state.startsWith("running") || service.state.startsWith("degraded")
  );
}

function isLauncherBusy(snapshot: RuntimeSnapshot | null) {
  return !!snapshot?.operation?.active || !!snapshot?.progress?.active;
}

function getSelectedRemoteProvider(snapshot: RuntimeSnapshot | null, providerId?: string | null) {
  const selectedId = String(
    providerId ||
    snapshot?.remoteSetup?.providerId ||
    snapshot?.remoteProviders?.[0]?.id ||
    ""
  ).trim();
  return snapshot?.remoteProviders?.find((entry) => entry.id === selectedId) || null;
}

function setBusy(busy: boolean, label = "Initialisation") {
  state.busy = busy;

  const modelGate = needsModelSetup(state.snapshot);
  const remoteNeedsConfig =
    state.snapshot?.remoteSetup?.mode === "remote" &&
    !state.snapshot?.remoteSetup?.configured;

  if (phasePill) {
    phasePill.textContent = busy
      ? `${label}...`
      : state.snapshot?.ready
        ? "Pret"
        : modelGate
          ? "Modele requis"
          : remoteNeedsConfig
            ? "IA distante"
            : "En attente";
    phasePill.dataset.state = busy
      ? "busy"
      : state.snapshot?.ready
        ? "ready"
        : modelGate || remoteNeedsConfig
          ? "warning"
          : "idle";
  }

  [
    launchBtn,
    retryBtn,
    openBtn,
    refreshBtn,
    stopBtn,
    modelImportBtn,
    modelDownloadBtn,
    modelFolderBtn,
    localModelSelect,
    remoteProviderSelect,
    remoteBaseUrlInput,
    remoteModelInput,
    remoteApiKeyInput,
    remoteSaveBtn,
    remoteLocalBtn,
  ].forEach((element) => {
    if (!element) return;
    element.disabled = busy;
  });

  if (logsBtn) {
    logsBtn.disabled = false;
  }

  if (stopBtn) {
    stopBtn.disabled = false;
  }

  if (quitBtn) {
    quitBtn.disabled = false;
  }
}

function renderServices(services: ServiceSnapshot[]) {
  if (!servicesEl) return;

  servicesEl.innerHTML = services
    .map((service) => {
      const tone = service.ready
        ? "ready"
        : service.enabled
          ? "offline"
          : "disabled";
      const meta = service.enabled ? `port ${service.port}` : "desactive";
      return `
        <article class="service service--${tone}">
          <div>
            <p class="service__label">${service.label}</p>
            <p class="service__meta">${meta}</p>
          </div>
          <span class="service__state">${service.state}</span>
        </article>
      `;
    })
    .join("");
}

function renderLocalModelOptions(snapshot: RuntimeSnapshot | null) {
  if (!localModelSelect) return;

  const options = snapshot?.localModels || [];
  const currentId =
    snapshot?.modelSetup?.selectedModelId ||
    options.find((entry) => entry.recommended)?.id ||
    options[0]?.id ||
    "";

  localModelSelect.innerHTML = options
    .map((entry) => {
      const suffix = entry.sizeHint ? ` · ${entry.sizeHint}` : "";
      return `<option value="${entry.id}">${entry.label}${suffix}</option>`;
    })
    .join("");

  if (currentId) {
    localModelSelect.value = currentId;
  }
}

function fillRemoteProviderForm(snapshot: RuntimeSnapshot | null, force = false) {
  if (!remoteProviderSelect || !remoteBaseUrlInput || !remoteModelInput) return;

  const options = snapshot?.remoteProviders || [];
  const configuredId = snapshot?.remoteSetup?.providerId || options[0]?.id || "";

  remoteProviderSelect.innerHTML = options
    .map((entry) => `<option value="${entry.id}">${entry.label}</option>`)
    .join("");

  if (configuredId) {
    remoteProviderSelect.value = configuredId;
  }

  const selected = getSelectedRemoteProvider(snapshot, remoteProviderSelect.value);
  const remoteSetup = snapshot?.remoteSetup;

  const shouldUseConfiguredValues =
    !!remoteSetup &&
    remoteSetup.mode === "remote" &&
    !!remoteSetup.providerId &&
    remoteSetup.providerId === remoteProviderSelect.value;

  if (force || !remoteBaseUrlInput.value || shouldUseConfiguredValues) {
    remoteBaseUrlInput.value = shouldUseConfiguredValues
      ? remoteSetup?.baseUrl || ""
      : selected?.baseUrl || "";
  }

  if (force || !remoteModelInput.value || shouldUseConfiguredValues) {
    remoteModelInput.value = shouldUseConfiguredValues
      ? remoteSetup?.model || ""
      : selected?.defaultModel || "";
  }
}

function renderEngine(snapshot: RuntimeSnapshot | null) {
  if (!modelCard || !modelSummaryEl || !modelPathEl || !modelDownloadBtn || !remoteSummaryEl) {
    return;
  }

  modelCard.hidden = false;
  renderLocalModelOptions(snapshot);
  fillRemoteProviderForm(snapshot);

  if (!snapshot) {
    modelSummaryEl.textContent = "Choisis un profil local ou relie une IA distante.";
    modelPathEl.textContent = "";
    remoteSummaryEl.textContent =
      "OpenAI, Grok et tout endpoint compatible OpenAI peuvent etre relies ici.";
    modelDownloadBtn.hidden = false;
    return;
  }

  const localProfile =
    snapshot.localModels.find((entry) => entry.id === snapshot.modelSetup.selectedModelId) || null;
  const remoteMode = snapshot.remoteSetup.mode === "remote";

  if (remoteMode && snapshot.remoteSetup.configured) {
    modelSummaryEl.textContent = localProfile
      ? `Mode local en veille. Profil memorise: ${localProfile.label}${localProfile.sizeHint ? ` (${localProfile.sizeHint})` : ""}.`
      : "Mode local en veille. Tu peux y revenir a tout moment.";
  } else if (snapshot.modelSetup.modelExists && snapshot.modelSetup.modelEnabled) {
    modelSummaryEl.textContent = localProfile
      ? `${localProfile.label} est pret pour A11 local.${localProfile.description ? ` ${localProfile.description}` : ""}`
      : `Modele pret: ${snapshot.modelSetup.modelFileName}.`;
  } else {
    modelSummaryEl.textContent = localProfile
      ? `${localProfile.label} attend son fichier GGUF.${localProfile.description ? ` ${localProfile.description}` : ""}`
      : `Le mode installer-lite attend ${snapshot.modelSetup.modelFileName}.`;
  }

  modelPathEl.textContent = `Emplacement cible: ${snapshot.modelSetup.modelPath}`;
  modelDownloadBtn.hidden = !snapshot.modelSetup.downloadConfigured;

  const remotePreset = getSelectedRemoteProvider(snapshot, snapshot.remoteSetup.providerId);
  if (snapshot.remoteSetup.configured) {
    remoteSummaryEl.textContent =
      `${snapshot.remoteSetup.providerLabel || remotePreset?.label || "IA distante"} activee sur ${snapshot.remoteSetup.baseUrl} avec le modele ${snapshot.remoteSetup.model}.` +
      (snapshot.remoteSetup.apiKeyPresent ? " Cle API enregistree." : "");
  } else {
    const selected = getSelectedRemoteProvider(snapshot, remoteProviderSelect?.value);
    remoteSummaryEl.textContent =
      selected?.description ||
      "OpenAI, Grok et tout endpoint compatible OpenAI peuvent etre relies ici.";
  }
}

function renderSnapshot(snapshot: RuntimeSnapshot | null) {
  if (!summaryEl || !logsPathEl) {
    return;
  }

  if (!snapshot) {
    summaryEl.textContent = "Le shell Tauri attend la stack locale A11.";
    logsPathEl.textContent = "";
    renderServices([]);
    renderEngine(null);
    return;
  }

  const requiredServices = snapshot.services.filter((service) => service.required && service.enabled);
  const readyCount = requiredServices.filter((service) => service.ready).length;
  const totalCount = requiredServices.length;
  const modelGate = needsModelSetup(snapshot);
  const remoteNeedsConfig =
    snapshot.remoteSetup.mode === "remote" &&
    !snapshot.remoteSetup.configured;
  const remoteConfiguredPending =
    snapshot.remoteSetup.mode === "remote" &&
    snapshot.remoteSetup.configured &&
    !snapshot.ready;

  summaryEl.textContent = snapshot.ready
    ? `La stack locale est prete. Le chat A11 est disponible sur ${snapshot.uiUrl}.`
    : snapshot.message
      ? snapshot.message
    : remoteConfiguredPending
      ? "IA distante configuree. Clique sur Lancer A11 pour demarrer la stack sans gel automatique."
    : remoteNeedsConfig
      ? "Le shell A11 attend la configuration d'une IA distante ou le retour au mode local."
      : modelGate
        ? `Le shell A11 est installe. Il ne manque plus que le modele local ${snapshot.modelSetup.modelFileName}.`
        : `${readyCount}/${totalCount} services critiques sont prets.`;

  logsPathEl.textContent = snapshot.logsDir ? `Logs: ${snapshot.logsDir}` : "";
  renderServices(snapshot.services);
  renderEngine(snapshot);
  openBtn?.toggleAttribute("hidden", !snapshot.ready);
  launchBtn?.toggleAttribute("disabled", modelGate || remoteNeedsConfig || state.busy || isLauncherBusy(snapshot));
  retryBtn?.toggleAttribute("disabled", !hasManagedOrExternalStack(snapshot) || state.busy || isLauncherBusy(snapshot));
}

function renderError(message: string) {
  state.error = message;
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }
}

function renderNotice(message: string) {
  if (noticeEl) {
    noticeEl.textContent = message;
    noticeEl.hidden = !message;
  }
}

async function fetchSnapshot() {
  const snapshot = await invoke<RuntimeSnapshot>("get_runtime_snapshot");
  state.snapshot = snapshot;
  renderSnapshot(snapshot);
  return snapshot;
}

async function fetchSnapshotWithTimeout(timeoutMs = SNAPSHOT_TIMEOUT_MS) {
  return await Promise.race<RuntimeSnapshot | null>([
    fetchSnapshot(),
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

async function openChatWindow() {
  await invoke("open_chat_window");
}

async function waitForReadyAfterStart(label: string) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastSnapshot = state.snapshot;

  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, STARTUP_POLL_MS));
    lastSnapshot = await fetchSnapshot();

    if (lastSnapshot?.ready) {
      return lastSnapshot;
    }

    if (needsModelSetup(lastSnapshot)) {
      return lastSnapshot;
    }

    if (
      lastSnapshot?.remoteSetup?.mode === "remote" &&
      !lastSnapshot?.remoteSetup?.configured
    ) {
      return lastSnapshot;
    }

    if (lastSnapshot?.message) {
      renderNotice(lastSnapshot.message);
    } else {
      renderNotice(`${label} en cours. A11 attend encore la fin de chargement des services...`);
    }
  }

  renderNotice("Le demarrage prend plus de temps que prevu. Tu peux patienter, actualiser, ou ouvrir les logs.");
  return lastSnapshot;
}

async function monitorPendingStartup(label: string) {
  if (startupMonitorActive) {
    return state.snapshot;
  }

  startupMonitorActive = true;
  try {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    let lastSnapshot = state.snapshot;

    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, STARTUP_POLL_MS));
      lastSnapshot = await fetchSnapshotWithTimeout();

      if (!lastSnapshot) {
        renderNotice(
          "La detection locale reste lente, mais le shell continue de surveiller la stack. Tu peux actualiser ou ouvrir les logs."
        );
        continue;
      }

      if (lastSnapshot.ready) {
        renderNotice("A11 est pret. Ouvre le chat quand tu veux.");
        return lastSnapshot;
      }

      if (needsModelSetup(lastSnapshot)) {
        return lastSnapshot;
      }

      if (
        lastSnapshot.remoteSetup.mode === "remote" &&
        !lastSnapshot.remoteSetup.configured
      ) {
        return lastSnapshot;
      }

      if (!isLauncherBusy(lastSnapshot) && !hasManagedOrExternalStack(lastSnapshot)) {
        return lastSnapshot;
      }

      if (lastSnapshot.message) {
        renderNotice(lastSnapshot.message);
      } else {
        renderNotice(`${label} en cours. A11 continue de verifier ses services...`);
      }
    }

    renderNotice("Le demarrage local est plus long que prevu. Tu peux patienter, actualiser, ou ouvrir les logs.");
    return lastSnapshot;
  } finally {
    startupMonitorActive = false;
  }
}

async function startStack(label = "Demarrage") {
  setBusy(true, label);
  renderError("");
  renderNotice("");
  try {
    const snapshot = await invoke<RuntimeSnapshot>("start_stack");
    state.snapshot = snapshot;
    renderSnapshot(snapshot);
    if (snapshot.message) {
      renderNotice(snapshot.message);
    }

    const finalSnapshot = await waitForReadyAfterStart(label);
    if (finalSnapshot?.ready) {
      await openChatWindow();
      renderNotice("A11 est pret. Le chat est ouvert et le shell reste disponible.");
    }
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
    await fetchSnapshot().catch(() => null);
  } finally {
    setBusy(false);
  }
}

async function stopStack() {
  setBusy(true, "Arret");
  renderError("");
  renderNotice("");
  try {
    const snapshot = await invoke<RuntimeSnapshot>("stop_stack");
    state.snapshot = snapshot;
    renderSnapshot(snapshot);
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

async function restartStack() {
  setBusy(true, "Relance");
  renderError("");
  renderNotice("");
  try {
    const snapshot = await invoke<RuntimeSnapshot>("restart_stack");
    state.snapshot = snapshot;
    renderSnapshot(snapshot);
    if (snapshot.message) {
      renderNotice(snapshot.message);
    }

    const finalSnapshot = await waitForReadyAfterStart("Relance");
    if (finalSnapshot?.ready) {
      await openChatWindow();
      renderNotice("A11 est pret. Le chat est ouvert et le shell reste disponible.");
    }
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
    await fetchSnapshot().catch(() => null);
  } finally {
    setBusy(false);
  }
}

async function installExternalModel(mode: "import" | "download") {
  const label = mode === "download" ? "Telechargement du modele" : "Import du modele";
  const llmWasReady = isServiceReady(state.snapshot, "llm");
  setBusy(true, label);
  renderError("");
  renderNotice("");

  try {
    const snapshot = mode === "download"
      ? await invoke<RuntimeSnapshot>("download_default_model")
      : await invoke<RuntimeSnapshot>("import_external_model");
    state.snapshot = snapshot;
    renderSnapshot(snapshot);
    if (!needsModelSetup(snapshot)) {
      if (llmWasReady) {
        renderNotice("Modele ajoute. Clique sur Relancer pour charger ce LLM.");
      } else {
        await startStack("Demarrage");
      }
    }
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
    await fetchSnapshot().catch(() => null);
  } finally {
    setBusy(false);
  }
}

async function selectLocalModelProfile(profileId: string) {
  if (!profileId) return;
  setBusy(true, "Profil local");
  renderError("");
  renderNotice("");
  try {
    const snapshot = await invoke<RuntimeSnapshot>("select_local_model_profile", {
      modelId: profileId,
    });
    state.snapshot = snapshot;
    renderSnapshot(snapshot);
    if (needsModelSetup(snapshot)) {
      renderNotice("Profil enregistre. Importe ou telecharge maintenant le GGUF correspondant, puis relance A11.");
    } else if (isServiceReady(snapshot, "llm")) {
      renderNotice("Profil enregistre. Clique sur Relancer pour appliquer ce moteur.");
    }
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
    await fetchSnapshot().catch(() => null);
  } finally {
    setBusy(false);
  }
}

async function saveRemoteProvider() {
  if (!remoteProviderSelect || !remoteBaseUrlInput || !remoteModelInput || !remoteApiKeyInput) {
    return;
  }

  setBusy(true, "IA distante");
  renderError("");
  renderNotice("");
  try {
    const snapshot = await invoke<RuntimeSnapshot>("save_remote_provider_config", {
      input: {
        providerId: remoteProviderSelect.value,
        baseUrl: remoteBaseUrlInput.value,
        model: remoteModelInput.value,
        apiKey: remoteApiKeyInput.value,
      },
    });
    remoteApiKeyInput.value = "";
    state.snapshot = snapshot;
    renderSnapshot(snapshot);
    if (snapshot.services.some((service) => service.ready)) {
      renderNotice("Configuration enregistree. Clique sur Relancer pour l'appliquer.");
    }
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
    await fetchSnapshot().catch(() => null);
  } finally {
    setBusy(false);
  }
}

async function switchBackToLocalLlm() {
  setBusy(true, "Retour local");
  renderError("");
  renderNotice("");
  try {
    const snapshot = await invoke<RuntimeSnapshot>("switch_back_to_local_llm");
    state.snapshot = snapshot;
    renderSnapshot(snapshot);
    if (snapshot.services.some((service) => service.ready)) {
      renderNotice("Retour au local enregistre. Clique sur Relancer pour recharger le LLM.");
    }
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
    await fetchSnapshot().catch(() => null);
  } finally {
    setBusy(false);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  renderSnapshot(null);

  launchBtn?.addEventListener("click", () => {
    void startStack("Demarrage");
  });

  retryBtn?.addEventListener("click", () => {
    void restartStack();
  });

  openBtn?.addEventListener("click", () => {
    void openChatWindow().catch((error) => {
      renderError(error instanceof Error ? error.message : String(error));
    });
  });

  refreshBtn?.addEventListener("click", () => {
    setBusy(true, "Actualisation");
    renderError("");
    fetchSnapshot()
      .catch((error) => {
        renderError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBusy(false));
  });

  stopBtn?.addEventListener("click", () => {
    void stopStack();
  });

  logsBtn?.addEventListener("click", () => {
    invoke("open_logs_directory").catch((error) => {
      renderError(error instanceof Error ? error.message : String(error));
    });
  });

  quitBtn?.addEventListener("click", () => {
    renderError("");
    renderNotice("");
    invoke("quit_application").catch((error) => {
      renderError(error instanceof Error ? error.message : String(error));
    });
  });

  modelFolderBtn?.addEventListener("click", () => {
    invoke("open_model_directory").catch((error) => {
      renderError(error instanceof Error ? error.message : String(error));
    });
  });

  modelImportBtn?.addEventListener("click", () => {
    void installExternalModel("import");
  });

  modelDownloadBtn?.addEventListener("click", () => {
    void installExternalModel("download");
  });

  localModelSelect?.addEventListener("change", () => {
    void selectLocalModelProfile(localModelSelect.value);
  });

  remoteProviderSelect?.addEventListener("change", () => {
    fillRemoteProviderForm(state.snapshot, true);
    if (remoteApiKeyInput) {
      remoteApiKeyInput.value = "";
    }
  });

  remoteSaveBtn?.addEventListener("click", () => {
    void saveRemoteProvider();
  });

  remoteLocalBtn?.addEventListener("click", () => {
    void switchBackToLocalLlm();
  });

  setBusy(true, "Detection");
  try {
    const snapshot = await fetchSnapshotWithTimeout();
    if (!snapshot) {
      renderNotice("La detection locale prend trop de temps. Le shell reste utilisable: clique sur Lancer A11 ou Actualiser.");
      return;
    }
    if (snapshot.ready) {
      renderNotice("A11 est deja pret. Ouvre le chat quand tu veux.");
      return;
    }
    if (needsModelSetup(snapshot)) {
      return;
    }
    if (snapshot.remoteSetup.mode === "remote") {
      return;
    }
    if (isLauncherBusy(snapshot) || hasManagedOrExternalStack(snapshot)) {
      void monitorPendingStartup("Demarrage deja lance");
      return;
    }
    renderNotice("Clique sur Lancer A11 pour demarrer la stack locale sans bloquer le shell.");
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
});
