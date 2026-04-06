import React, { useEffect, useMemo, useState } from "react";
import {
  A11_API_PROFILE_BASES,
  fetchControlStatus,
  getCurrentApiMode,
  isPublicOnlineModeLocked,
  runControlAction,
  setCurrentApiMode,
  type A11ApiMode,
  type ControlActionCommand,
  type ControlStatusResponse,
  type ControlServiceStatus,
} from "../lib/api";

type ProfileKey = "online" | "local";

type ProfileState = {
  status: ControlStatusResponse | null;
  error: string;
};

const PROFILE_META: Array<{ key: ProfileKey; label: string; apiBase: string; hint: string }> = [
  {
    key: "online",
    label: "Lancement en ligne",
    apiBase: A11_API_PROFILE_BASES.online,
    hint: "Utilise la stack publique Railway/Netlify, avec le minimum de local.",
  },
  {
    key: "local",
    label: "Lancement local",
    apiBase: A11_API_PROFILE_BASES.local,
    hint: "Utilise ton backend tunnelé et les services locaux déjà démarrés chez toi.",
  },
];

function cardStyle(): React.CSSProperties {
  return {
    border: "1px solid #1f2937",
    borderRadius: 14,
    background: "#0b1220",
    padding: 16,
  };
}

function statePalette(state: string | undefined) {
  switch (state) {
    case "online":
      return { border: "#14532d", bg: "#052e1b", text: "#bbf7d0" };
    case "starting":
      return { border: "#7c2d12", bg: "#2a1506", text: "#fdba74" };
    case "offline":
      return { border: "#7f1d1d", bg: "#2a0f0f", text: "#fecaca" };
    default:
      return { border: "#334155", bg: "#111827", text: "#cbd5e1" };
  }
}

function renderServiceBadge(service: ControlServiceStatus) {
  const palette = statePalette(service.state);
  return (
    <span
      key={service.id}
      style={{
        borderRadius: 999,
        padding: "5px 10px",
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.text,
        fontSize: 12,
      }}
    >
      {service.label}: {service.state}
    </span>
  );
}

function mono(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function A11ControlCenterPanel() {
  const publicOnlineLocked = isPublicOnlineModeLocked();
  const [profiles, setProfiles] = useState<Record<ProfileKey, ProfileState>>({
    online: { status: null, error: "" },
    local: { status: null, error: "" },
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [feedback, setFeedback] = useState("");
  const [currentMode, setCurrentModeState] = useState<A11ApiMode>(getCurrentApiMode());

  async function loadProfiles() {
    setRefreshing(true);
    const settled = await Promise.allSettled(
      PROFILE_META.map(async (profile) => ({
        key: profile.key,
        status: await fetchControlStatus(profile.apiBase),
      }))
    );

    const nextProfiles: Record<ProfileKey, ProfileState> = {
      online: { status: null, error: "" },
      local: { status: null, error: "" },
    };

    settled.forEach((result, index) => {
      const profile = PROFILE_META[index];
      if (!profile) return;
      if (result.status === "fulfilled") {
        nextProfiles[profile.key] = { status: result.value.status, error: "" };
      } else {
        nextProfiles[profile.key] = {
          status: null,
          error: String(result.reason?.message || result.reason || "unreachable"),
        };
      }
    });

    setProfiles(nextProfiles);
    setCurrentModeState(getCurrentApiMode());
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    loadProfiles();

    const handleModeChange = () => setCurrentModeState(getCurrentApiMode());
    globalThis.addEventListener?.("a11:api-mode-changed", handleModeChange);
    globalThis.addEventListener?.("storage", handleModeChange);
    return () => {
      globalThis.removeEventListener?.("a11:api-mode-changed", handleModeChange);
      globalThis.removeEventListener?.("storage", handleModeChange);
    };
  }, []);

  async function activateMode(mode: ProfileKey) {
    if (mode === "local" && publicOnlineLocked) {
      setFeedback("Le site public reste force en ligne. Pour utiliser le backend local, ouvre le frontend local ou un lien explicitement prevu pour le mode local.");
      return;
    }
    setCurrentApiMode(mode);
    setCurrentModeState(mode);
    setFeedback(`Mode ${mode === "local" ? "local" : "en ligne"} active. Rechargement de l'interface...`);
    globalThis.setTimeout(() => {
      globalThis.location?.reload();
    }, 180);
  }

  async function executeAction(profileKey: ProfileKey, action: ControlActionCommand, target: string) {
    const profile = PROFILE_META.find((entry) => entry.key === profileKey);
    if (!profile) return;
    setBusyKey(`${profileKey}:${action}:${target}`);
    setFeedback("");
    try {
      const result = await runControlAction(action, target, profile.apiBase);
      if (result.status) {
        setProfiles((current) => ({
          ...current,
          [profileKey]: {
            status: result.status || current[profileKey].status,
            error: "",
          },
        }));
      }
      setFeedback(
        result.ok
          ? `${action} ${target} envoye sur ${profile.label.toLowerCase()}.`
          : `Action ${action} partiellement en echec sur ${target}.`
      );
      await loadProfiles();
    } catch (error: any) {
      setFeedback(`Echec ${action} ${target}: ${String(error?.message || error)}`);
    } finally {
      setBusyKey("");
    }
  }

  const activeProfileLabel = useMemo(() => {
    if (currentMode === "local") return "Local";
    if (currentMode === "online") return "En ligne";
    return "Auto";
  }, [currentMode]);

  return (
    <div style={{ marginTop: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div>
          <h3 style={{ margin: 0, color: "#e2e8f0", fontSize: 16 }}>Control Center</h3>
          <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: 12 }}>
            Choisis le mode A11, surveille les services et pilote le runtime local sans ouvrir 15 terminaux.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ color: "#cbd5e1", fontSize: 12 }}>Mode actif: {activeProfileLabel}</span>
          <button
            type="button"
            onClick={loadProfiles}
            disabled={refreshing}
            className="btn ghost"
            style={{ fontSize: 12 }}
          >
            {refreshing ? "Actualisation..." : "Rafraichir"}
          </button>
        </div>
      </div>

      {feedback && (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 8,
            border: `1px solid ${feedback.startsWith("Echec") ? "#7f1d1d" : "#1e3a8a"}`,
            background: feedback.startsWith("Echec") ? "#2a0f0f" : "#0f172a",
            color: feedback.startsWith("Echec") ? "#fecaca" : "#bfdbfe",
            fontSize: 12,
          }}
        >
          {feedback}
        </div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {PROFILE_META.map((profile) => {
          const profileState = profiles[profile.key];
          const status = profileState.status;
          const isActive = currentMode === profile.key;
          const controlEnabled = !!status?.profile?.controlEnabled;
          const services = status?.services || [];
          const supervisorTargets = status?.profile?.availableTargets || [];

          return (
            <section
              key={profile.key}
              style={{
                ...cardStyle(),
                borderColor: isActive ? "#2563eb" : "#1f2937",
                boxShadow: isActive ? "0 0 0 1px rgba(37,99,235,0.35)" : "none",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <h4 style={{ margin: 0, color: "#e2e8f0", fontSize: 15 }}>{profile.label}</h4>
                    {isActive && (
                      <span
                        style={{
                          borderRadius: 999,
                          padding: "4px 8px",
                          background: "#1d4ed8",
                          color: "#dbeafe",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        ACTIF
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>{profile.hint}</div>
                  <div style={{ marginTop: 6, color: "#64748b", fontSize: 12 }}>
                    API: {status?.profile?.publicApiUrl || profile.apiBase}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <button
                    type="button"
                    onClick={() => activateMode(profile.key)}
                    disabled={profile.key === "local" && publicOnlineLocked}
                    className="btn ghost"
                    style={{ fontSize: 12 }}
                  >
                    {profile.key === "local" && publicOnlineLocked ? "Local verrouille" : "Utiliser ce mode"}
                  </button>
                  {profile.key === "local" && controlEnabled && (
                    <>
                      <button
                        type="button"
                        onClick={() => executeAction(profile.key, "start", "stack")}
                        disabled={!!busyKey}
                        className="btn ghost"
                        style={{ fontSize: 12 }}
                      >
                        Tout lancer
                      </button>
                      <button
                        type="button"
                        onClick={() => executeAction(profile.key, "restart", "stack")}
                        disabled={!!busyKey}
                        className="btn ghost"
                        style={{ fontSize: 12 }}
                      >
                        Tout relancer
                      </button>
                      <button
                        type="button"
                        onClick={() => executeAction(profile.key, "stop", "stack")}
                        disabled={!!busyKey}
                        className="btn ghost"
                        style={{ fontSize: 12 }}
                      >
                        Tout arreter
                      </button>
                    </>
                  )}
                </div>
              </div>

              {profileState.error ? (
                <div
                  style={{
                    marginTop: 12,
                    padding: 10,
                    borderRadius: 8,
                    border: "1px solid #7f1d1d",
                    background: "#2a0f0f",
                    color: "#fecaca",
                    fontSize: 12,
                  }}
                >
                  {profile.key === "local"
                    ? `Backend local ou tunnel indisponible: ${profileState.error}. Depuis le site public, il faut un tunnel HTTPS actif. Sinon, ouvre d'abord le raccourci local complet pour utiliser le frontend local.`
                    : profileState.error}
                </div>
              ) : null}

              {!profileState.error && loading && !status ? (
                <div style={{ marginTop: 12, color: "#94a3b8", fontSize: 12 }}>Chargement du profil…</div>
              ) : null}

              {profile.key === "local" && publicOnlineLocked ? (
                <div style={{ marginTop: 12, color: "#fcd34d", fontSize: 12 }}>
                  Depuis le site public, le mode local est volontairement desactive pour eviter les bascules accidentelles vers l'API tunnel locale.
                </div>
              ) : null}

              {!profileState.error && status ? (
                <>
                  <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {services.slice(0, 5).map(renderServiceBadge)}
                  </div>

                  <div style={{ marginTop: 12, color: "#94a3b8", fontSize: 12 }}>
                    {status.profile?.controlReason || "Aucune consigne de controle exposee."}
                  </div>
                  {profile.key === "local" && controlEnabled && supervisorTargets.length === 0 ? (
                    <div style={{ marginTop: 8, color: "#fcd34d", fontSize: 12 }}>
                      Aucun service pilotable n'est encore detecte. Pour un demarrage a froid, utilise le raccourci local complet ou laisse le backend local exposer cerbere, TTS et llama-server.
                    </div>
                  ) : null}

                  <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                    {services.map((service) => {
                      const palette = statePalette(service.state);
                      const canControlService = controlEnabled && supervisorTargets.includes(service.id);
                      return (
                        <div
                          key={`${profile.key}:${service.id}`}
                          style={{
                            borderRadius: 10,
                            border: `1px solid ${palette.border}`,
                            background: "#0a101a",
                            padding: "10px 12px",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            flexWrap: "wrap",
                          }}
                        >
                          <div style={{ minWidth: 220, flex: "1 1 220px" }}>
                            <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 700 }}>{service.label}</div>
                            <div style={{ marginTop: 4, color: palette.text, fontSize: 12 }}>
                              {service.state.toUpperCase()}
                            </div>
                            <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>
                              {service.detail || "Aucun detail"}
                            </div>
                            <div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>
                              pid {mono(service.meta?.pid)} · restarts {mono(service.meta?.restarts)} · uptime {mono(service.meta?.uptime)}
                            </div>
                          </div>

                          {canControlService ? (
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              {(["start", "restart", "stop"] as ControlActionCommand[]).map((action) => (
                                <button
                                  key={action}
                                  type="button"
                                  onClick={() => executeAction(profile.key, action, service.id)}
                                  disabled={busyKey === `${profile.key}:${action}:${service.id}` || !!busyKey}
                                  className="btn ghost"
                                  style={{ fontSize: 12 }}
                                >
                                  {busyKey === `${profile.key}:${action}:${service.id}`
                                    ? "..."
                                    : action === "start"
                                      ? "Start"
                                      : action === "stop"
                                        ? "Stop"
                                        : "Restart"}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
