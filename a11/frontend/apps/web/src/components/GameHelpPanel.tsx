import React, { useCallback, useEffect, useRef, useState } from "react";
import { commentOnGameFrame } from "../lib/api";
import { speak, cancelSpeech } from "../lib/speech";
import "./GameHelpPanel.css";

type GameComment = { id: string; at: number; text: string; highlight: boolean };
type ObsPendingRequest = { resolve: (value: any) => void; reject: (error: Error) => void; timeout: number };

function obsHash(value: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)).then((digest) => {
    const bytes = new Uint8Array(digest);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  });
}

export function GameHelpPanel({ isCompactLayout = false, onBack }: { isCompactLayout?: boolean; onBack?: () => void }) {
  const [gameName, setGameName] = useState("Aion 2");
  const [obsUrl, setObsUrl] = useState("ws://127.0.0.1:4455");
  const [obsPassword, setObsPassword] = useState("");
  const [obsConnected, setObsConnected] = useState(false);
  const [replayActive, setReplayActive] = useState(false);
  const [lastReplayPath, setLastReplayPath] = useState("");
  const [captureActive, setCaptureActive] = useState(false);
  const [autoComment, setAutoComment] = useState(true);
  const [speakComments, setSpeakComments] = useState(false);
  const [saveHighlights, setSaveHighlights] = useState(true);
  const [commentEvery, setCommentEvery] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [comments, setComments] = useState<GameComment[]>([]);
  const [latestComment, setLatestComment] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const obsSocketRef = useRef<WebSocket | null>(null);
  const pendingObsRef = useRef(new Map<string, ObsPendingRequest>());
  const obsRequestRef = useRef<((name: string, data?: Record<string, unknown>) => Promise<any>) | null>(null);
  const analysingRef = useRef(false);
  const replayActiveRef = useRef(false);

  const sendObsRequest = useCallback((requestType: string, requestData?: Record<string, unknown>) => {
    return new Promise<any>((resolve, reject) => {
      const socket = obsSocketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reject(new Error("OBS n'est pas connecté."));
        return;
      }
      const requestId = crypto.randomUUID();
      const timeout = window.setTimeout(() => {
        pendingObsRef.current.delete(requestId);
        reject(new Error(`OBS n'a pas répondu à ${requestType}.`));
      }, 8000);
      pendingObsRef.current.set(requestId, { resolve, reject, timeout });
      socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, ...(requestData ? { requestData } : {}) } }));
    });
  }, []);

  const disconnectObs = useCallback(() => {
    obsRequestRef.current = null;
    pendingObsRef.current.forEach((pending) => {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error("Connexion OBS fermée."));
    });
    pendingObsRef.current.clear();
    const socket = obsSocketRef.current;
    obsSocketRef.current = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    setObsConnected(false);
    setReplayActive(false);
    replayActiveRef.current = false;
  }, []);

  const connectObs = useCallback(async () => {
    setError("");
    setBusy(true);
    try {
      if (!/^wss?:\/\//i.test(obsUrl.trim())) throw new Error("Adresse OBS invalide. Exemple : ws://127.0.0.1:4455");
      disconnectObs();
      const socket = new WebSocket(obsUrl.trim());
      obsSocketRef.current = socket;
      const ready = new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("OBS ne répond pas. Vérifie que son serveur WebSocket est activé sur le port 4455.")), 12000);
        socket.onmessage = async (event) => {
          let message: any;
          try { message = JSON.parse(String(event.data)); } catch { return; }
          if (message?.op === 0) {
            window.clearTimeout(timeout);
            const hello = message?.d || {};
            const authInfo = hello.authentication;
            let authentication: string | undefined;
            if (authInfo) {
              if (!obsPassword) {
                reject(new Error("OBS demande un mot de passe. Saisis-le pour cette session."));
                socket.close();
                return;
              }
              const secret = await obsHash(obsPassword + String(authInfo.salt || ""));
              authentication = await obsHash(secret + String(authInfo.challenge || ""));
            }
            socket.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 0, ...(authentication ? { authentication } : {}) } }));
            return;
          }
          if (message?.op === 2) {
            setObsConnected(true);
            obsRequestRef.current = sendObsRequest;
            resolve();
            return;
          }
          if (message?.op === 7) {
            const response = message?.d || {};
            const pending = pendingObsRef.current.get(String(response.requestId || ""));
            if (!pending) return;
            window.clearTimeout(pending.timeout);
            pendingObsRef.current.delete(String(response.requestId));
            if (response.requestStatus?.result === false) {
              pending.reject(new Error(response.requestStatus?.comment || "OBS a refusé la commande."));
            } else pending.resolve(response.responseData || {});
          }
        };
        socket.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error("Connexion OBS refusée. Active le serveur WebSocket dans OBS et vérifie le port."));
        };
        socket.onclose = () => {
          setObsConnected(false);
          setReplayActive(false);
          replayActiveRef.current = false;
          if (obsSocketRef.current === socket) {
            obsSocketRef.current = null;
            obsRequestRef.current = null;
          }
        };
      });
      await ready;
      const status = await sendObsRequest("GetReplayBufferStatus");
      let isActive = status?.outputActive === true;
      if (!isActive) {
        await sendObsRequest("StartReplayBuffer");
        isActive = true;
      }
      replayActiveRef.current = isActive;
      setReplayActive(isActive);
    } catch (cause) {
      disconnectObs();
      setError(cause instanceof Error ? cause.message : "Connexion OBS impossible.");
    } finally {
      setBusy(false);
    }
  }, [disconnectObs, obsPassword, obsUrl, sendObsRequest]);

  const startCapture = useCallback(async () => {
    setError("");
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Le partage d'écran n'est pas disponible dans ce navigateur.");
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 12, max: 20 } }, audio: false });
      captureStreamRef.current?.getTracks().forEach((track) => track.stop());
      captureStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        captureStreamRef.current = null;
        setCaptureActive(false);
      }, { once: true });
      setCaptureActive(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Capture du jeu impossible.");
    }
  }, []);

  const stopCapture = useCallback(() => {
    captureStreamRef.current?.getTracks().forEach((track) => track.stop());
    captureStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCaptureActive(false);
  }, []);

  const commentCurrentFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || analysingRef.current) return;
    analysingRef.current = true;
    setBusy(true);
    setError("");
    try {
      const scale = Math.min(1, 1280 / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Impossible de lire l'image partagée.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const result = await commentOnGameFrame(canvas.toDataURL("image/jpeg", 0.76), gameName);
      const text = String(result.commentary || "").trim();
      if (!text) return;
      const comment: GameComment = { id: crypto.randomUUID(), at: Date.now(), text, highlight: result.highlight };
      setLatestComment(text);
      setComments((current) => [comment, ...current].slice(0, 12));
      if (speakComments) speak(text, { persona: "vivy", voicePersona: "vivy", lang: "fr-FR", rate: 1.04, volume: 0.9 });
      if (result.highlight && saveHighlights && replayActiveRef.current && obsRequestRef.current) {
        await obsRequestRef.current("SaveReplayBuffer");
        const last = await obsRequestRef.current("GetLastReplayBufferReplay").catch(() => ({}));
        setLastReplayPath(String(last?.savedReplayPath || "Replay enregistré dans OBS."));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Commentaire indisponible.");
    } finally {
      analysingRef.current = false;
      setBusy(false);
    }
  }, [gameName, saveHighlights, speakComments]);

  const saveReplay = useCallback(async () => {
    if (!obsRequestRef.current || !replayActiveRef.current) {
      setError("Connecte OBS et démarre le buffer avant de sauvegarder un replay.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await obsRequestRef.current("SaveReplayBuffer");
      const last = await obsRequestRef.current("GetLastReplayBufferReplay").catch(() => ({}));
      setLastReplayPath(String(last?.savedReplayPath || "Replay enregistré dans OBS."));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sauvegarde du replay impossible.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!captureActive || !autoComment) return;
    const timer = window.setInterval(() => { void commentCurrentFrame(); }, Math.max(10, commentEvery) * 1000);
    return () => window.clearInterval(timer);
  }, [autoComment, captureActive, commentCurrentFrame, commentEvery]);

  useEffect(() => () => {
    captureStreamRef.current?.getTracks().forEach((track) => track.stop());
    cancelSpeech();
    disconnectObs();
  }, [disconnectObs]);

  const buttonStyle: React.CSSProperties = {
    border: "1px solid rgba(125,211,252,.25)", borderRadius: 12, padding: "10px 14px",
    background: "linear-gradient(135deg, #0e7490, #1d4ed8)", color: "#f0f9ff",
    fontWeight: 800, cursor: "pointer", minHeight: 42,
  };
  const secondaryButtonStyle: React.CSSProperties = {
    ...buttonStyle, background: "#121b2a", borderColor: "#293a51", color: "#d6e5f7",
  };

  return (
    <section className="game-help" style={{ padding: isCompactLayout ? 12 : 22 }}>
      <header className="game-help__header">
        <div>
          <div className="game-help__eyebrow">A11 · mode jeu</div>
          <h1>Aide au jeu en direct</h1>
          <p>Partage la fenêtre OBS ou le jeu : A11 et Vivy commentent les images, pendant qu’OBS garde son replay circulaire.</p>
        </div>
        {onBack ? <button type="button" style={secondaryButtonStyle} onClick={onBack}>← Retour au chat</button> : null}
      </header>

      <div className="game-help__grid">
        <div className="game-help__column">
          <article className="game-help__card">
            <div className="game-help__card-title"><span>01</span><div><h2>Relier OBS</h2><p>Le buffer circulaire est lancé automatiquement à la connexion.</p></div></div>
            <label className="game-help__field">Adresse WebSocket OBS
              <input value={obsUrl} onChange={(event) => setObsUrl(event.target.value)} disabled={obsConnected} placeholder="ws://127.0.0.1:4455" />
            </label>
            <label className="game-help__field">Mot de passe OBS <small>(facultatif, gardé en mémoire le temps de la session)</small>
              <input type="password" value={obsPassword} onChange={(event) => setObsPassword(event.target.value)} disabled={obsConnected} autoComplete="off" placeholder="Mot de passe du serveur OBS" />
            </label>
            <div className="game-help__actions">
              {obsConnected
                ? <button type="button" style={secondaryButtonStyle} onClick={disconnectObs}>Déconnecter OBS</button>
                : <button type="button" style={buttonStyle} onClick={() => void connectObs()} disabled={busy}>{busy ? "Connexion…" : "Connecter et démarrer le buffer"}</button>}
              <button type="button" style={secondaryButtonStyle} onClick={() => void saveReplay()} disabled={!obsConnected || !replayActive || busy}>Sauver le replay maintenant</button>
            </div>
            <div className="game-help__status-row">
              <span className={`game-help__pill ${obsConnected ? "is-on" : ""}`}>{obsConnected ? "OBS connecté" : "OBS déconnecté"}</span>
              <span className={`game-help__pill ${replayActive ? "is-on" : ""}`}>{replayActive ? "Replay circulaire actif" : "Buffer à l’arrêt"}</span>
            </div>
            {lastReplayPath ? <p className="game-help__success">Replay enregistré : <code>{lastReplayPath}</code></p> : null}
            <details className="game-help__details"><summary>Première connexion OBS</summary><p>Dans OBS : <b>Outils → Paramètres du serveur WebSocket</b>, active le serveur et garde le port 4455. Le dossier et la durée du replay se règlent dans <b>Paramètres → Sortie → Replay Buffer</b>. Le mot de passe reste dans cette page et n’est pas enregistré.</p></details>
          </article>

          <article className="game-help__card">
            <div className="game-help__card-title"><span>02</span><div><h2>Commentaire radio</h2><p>Le partage d’écran demande ton accord dans le navigateur.</p></div></div>
            <label className="game-help__field">Jeu en cours
              <input value={gameName} onChange={(event) => setGameName(event.target.value)} placeholder="Ex. Aion 2" />
            </label>
            <div className="game-help__actions">
              {captureActive
                ? <button type="button" style={secondaryButtonStyle} onClick={stopCapture}>Arrêter le partage</button>
                : <button type="button" style={buttonStyle} onClick={() => void startCapture()}>Choisir la fenêtre du jeu ou d’OBS</button>}
              <button type="button" style={secondaryButtonStyle} onClick={() => void commentCurrentFrame()} disabled={!captureActive || busy}>Commenter maintenant</button>
            </div>
            <video ref={videoRef} className="game-help__preview" autoPlay muted playsInline aria-label="Aperçu de la fenêtre partagée" />
            <div className="game-help__options">
              <label><input type="checkbox" checked={autoComment} onChange={(event) => setAutoComment(event.target.checked)} /> Commenter automatiquement</label>
              <label><input type="checkbox" checked={speakComments} onChange={(event) => setSpeakComments(event.target.checked)} /> Lire les commentaires à voix haute</label>
              <label><input type="checkbox" checked={saveHighlights} onChange={(event) => setSaveHighlights(event.target.checked)} disabled={!obsConnected} /> Sauver les moments forts dans OBS</label>
              <label className="game-help__frequency">Rythme
                <select value={commentEvery} onChange={(event) => setCommentEvery(Number(event.target.value))}>
                  <option value={10}>10 secondes</option><option value={15}>15 secondes</option><option value={30}>30 secondes</option>
                </select>
              </label>
            </div>
            <p className="game-help__privacy">Une image réduite est envoyée à A11 au rythme choisi pour être commentée. L’enregistrement vidéo reste géré par OBS sur ton PC; aucune vidéo n’est ajoutée à ta bibliothèque A11.</p>
          </article>
        </div>

        <aside className="game-help__card game-help__radio" aria-live="polite">
          <div className="game-help__radio-top"><span className={captureActive ? "game-help__live-dot is-live" : "game-help__live-dot"} /><span>{captureActive ? "À L’ANTENNE" : "RADIO EN ATTENTE"}</span></div>
          <div className="game-help__on-air">A11 <span>×</span> VIVY</div>
          <p className="game-help__current-comment">{latestComment || "Le duo est prêt. Partage ton écran pour lancer les commentaires."}</p>
          <div className="game-help__comment-list">
            {comments.length ? comments.map((comment) => (
              <div className="game-help__comment" key={comment.id}>
                <time>{new Date(comment.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                {comment.highlight ? <strong>Moment fort · replay auto</strong> : null}
                <p>{comment.text}</p>
              </div>
            )) : <div className="game-help__empty">Les observations apparaîtront ici, en direct.</div>}
          </div>
        </aside>
      </div>
      {error ? <p className="game-help__error" role="alert">{error}</p> : null}
    </section>
  );
}
