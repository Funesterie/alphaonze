import React from "react";
import ReactDOM from "react-dom/client";
import { App, isKaen44Experience } from "./App";
import "./index.css";
import "./mobile.css";
import { registerA11ServiceWorker } from "./pwa";

type BootErrorBoundaryState = {
  error: Error | null;
};

class BootErrorBoundary extends React.Component<{ children: React.ReactNode }, BootErrorBoundaryState> {
  state: BootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BootErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[A11][boot] React crashed", error, info);
    try {
      (window as any).__A11_BOOT_ERROR__ = error?.stack || error?.message || String(error);
    } catch {
      // ignore diagnostic storage issues
    }
  }

  private resetClientState(clearStorage: boolean) {
    const reset = (window as any).__A11_RESET_CLIENT_STATE__;
    const done = () => window.location.reload();
    if (typeof reset === "function") {
      void Promise.resolve(reset({ storage: clearStorage })).finally(done);
      return;
    }
    done();
  }

  render() {
    if (!this.state.error) return this.props.children;

    const isKaen44 = isKaen44Experience();
    const productName = isKaen44 ? "Kaen44" : "A11";

    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#071021",
          color: "#e5e7eb",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          padding: 24,
        }}
      >
        <section style={{ width: "min(100%, 420px)", display: "flex", flexDirection: "column", gap: 14 }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>{productName}</h1>
          <p style={{ margin: 0, color: "#bfdbfe", lineHeight: 1.5 }}>
            Demarrage bloque cote navigateur. Nettoie le cache local puis relance {productName}.
          </p>
          <button
            type="button"
            onClick={() => this.resetClientState(false)}
            style={{ minHeight: 44, border: 0, borderRadius: 10, background: "#2563eb", color: "white", fontWeight: 800 }}
          >
            Relancer {productName}
          </button>
          <button
            type="button"
            onClick={() => this.resetClientState(true)}
            style={{ minHeight: 44, border: "1px solid #334155", borderRadius: 10, background: "#0f172a", color: "#e5e7eb", fontWeight: 700 }}
          >
            Reset cache conversations local
          </button>
          <pre style={{ whiteSpace: "pre-wrap", color: "#94a3b8", fontSize: 12 }}>
            {this.state.error.message}
          </pre>
        </section>
      </main>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BootErrorBoundary>
      <App />
    </BootErrorBoundary>
  </React.StrictMode>
);

registerA11ServiceWorker();
