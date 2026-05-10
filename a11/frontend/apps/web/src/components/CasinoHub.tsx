import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeVisionImage,
  chat,
  generatePngWithPrompt,
  generateVideoWithPrompt,
  resolveApiAssetUrl,
  ttsSpeak,
  uploadConversationFile,
  uploadLocalImage,
} from "../lib/api";
import "./CasinoHub.css";

type CasinoHubProps = {
  isCompactLayout?: boolean;
  onBackToChat?: () => void;
};

type CasinoPhoto = {
  id: string;
  file: File;
  name: string;
  objectUrl: string;
  selected: boolean;
  uploadedUrl?: string | null;
  analysisText?: string | null;
  analysisPending?: boolean;
  analysisError?: string | null;
};

type CasinoActionKind = "image" | "sound" | "video";

type CasinoAction = {
  kind: CasinoActionKind;
  label: string;
  shortLabel: string;
  color: string;
  cost: number;
};

type GenerationResult = {
  kind: CasinoActionKind;
  prompt: string;
  url?: string | null;
  message: string;
};

const CASINO_ACTIONS: CasinoAction[] = [
  { kind: "image", label: "Image", shortLabel: "IMG", color: "#2dd4bf", cost: 6 },
  { kind: "sound", label: "Son", shortLabel: "SON", color: "#facc15", cost: 3 },
  { kind: "video", label: "Video", shortLabel: "VID", color: "#fb7185", cost: 18 },
];

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function resolveUploadedPhotoUrl(uploadResult: any) {
  const candidates = [
    uploadResult?.conversationResource?.url,
    uploadResult?.conversationResource?.downloadUrl,
    uploadResult?.file?.url,
    uploadResult?.file?.downloadUrl,
    uploadResult?.record?.url,
    uploadResult?.record?.downloadUrl,
  ];
  for (const candidate of candidates) {
    const resolved = resolveApiAssetUrl(candidate);
    if (resolved) return resolved;
  }
  return null;
}

function asBriefText(value: unknown) {
  if (!value) return "";
  if (Array.isArray(value)) {
    return value
      .map((entry) => asBriefText(entry))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${asBriefText(entry)}`)
      .filter((entry) => entry.trim().length > 2)
      .join("; ");
  }
  return String(value).trim();
}

function formatVisionEntry(entry: any) {
  const analysis = entry?.analysis || entry?.vision || entry?.memory || entry?.metadata || entry || {};
  const parts = [
    analysis?.summary,
    analysis?.caption,
    analysis?.description,
    analysis?.scene,
    analysis?.objects,
    analysis?.subjects,
    analysis?.colors,
    analysis?.mood,
    analysis?.style,
    analysis?.tags,
  ].map(asBriefText).filter(Boolean);
  const text = parts.join(" | ").replace(/\s+/g, " ").trim();
  return text.slice(0, 900);
}

function pickRelevantPhoto(photos: CasinoPhoto[], userPrompt: string) {
  const pool = photos.filter((photo) => photo.selected);
  if (!pool.length) return null;
  const words = new Set(
    userPrompt
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((word) => word.trim())
      .filter((word) => word.length >= 3)
  );
  const scored = pool.map((photo) => {
    const searchable = [
      photo.name,
      photo.analysisText || "",
      photo.uploadedUrl ? "uploaded analysed source reference" : "",
    ].join(" ").toLowerCase();
    let score = 0;
    if (photo.analysisText) score += 1.5;
    if (photo.uploadedUrl) score += 0.75;
    words.forEach((word) => {
      if (searchable.includes(word)) score += 1;
    });
    return { photo, score };
  });
  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.photo || pool[0] || null;
}

function isDirectMediaUrl(value: string) {
  return /^https?:\/\/.+\.(png|jpg|jpeg|webp|gif|mp4|webm|mov|mp3|wav|ogg)(?:[?#].*)?$/i.test(String(value || "").trim());
}

function buildFallbackPrompt(action: CasinoAction, photos: CasinoPhoto[], userPrompt: string, sharedSourceUrl = "") {
  const relevantPhoto = pickRelevantPhoto(photos, userPrompt);
  const selectedNames = photos
    .filter((photo) => photo.selected)
    .slice(0, 6)
    .map((photo) => photo.name)
    .join(", ");
  const userLine = userPrompt.trim()
    ? `Intention utilisateur: ${userPrompt.trim()}.`
    : "Intention utilisateur: A11 choisit une direction imaginative depuis les sources autorisees.";
  const photoLine = relevantPhoto
    ? `Source la plus pertinente: ${relevantPhoto.name}. Analyse A11: ${relevantPhoto.analysisText || "analyse visuelle indisponible"}. Selection autorisee: ${selectedNames}.`
    : sharedSourceUrl
      ? `Source partagee: ${sharedSourceUrl}. Lien fourni par l'utilisateur, a utiliser comme contexte semantique.`
      : "Aucune source visuelle: creer une direction originale A11 depuis l'intention.";

  if (action.kind === "sound") {
    return [
      "Cree un court paysage sonore A11 de 8 secondes a partir du sens des sources partagees.",
      userLine,
      photoLine,
      "Ambiance: matiere sensible, details sonores pertinents, rythme court, signature AlphaOnze discrete.",
    ].join(" ");
  }

  if (action.kind === "video") {
    return [
      "Cree une video courte A11, 2 secondes, montage lisible et symbolique.",
      userLine,
      photoLine,
      "Plan: lecture des sources, extraction d'un motif fort, transformation visuelle, dernier cadre poster.",
      "Style original, pas de personnage sous licence, lumiere nette, composition forte.",
    ].join(" ");
  }

  return [
    "Cree une image originale A11 en format poster a partir du sens des sources partagees.",
    userLine,
    photoLine,
    "La source sert de reference respectueuse si elle existe, sans collage grossier.",
    "Style: direction artistique pertinente, symboles A11 discrets, details imaginatifs, rendu propre.",
  ].join(" ");
}

async function buildA11Prompt(action: CasinoAction, photos: CasinoPhoto[], userPrompt: string, sharedSourceUrl = "") {
  const fallbackPrompt = buildFallbackPrompt(action, photos, userPrompt, sharedSourceUrl);
  const relevantPhoto = pickRelevantPhoto(photos, userPrompt);
  const photoNotes = photos
    .filter((photo) => photo.selected)
    .slice(0, 6)
    .map((photo) => `${photo.name}: ${photo.analysisText || "pas encore analysee"}`)
    .join("\n");
  try {
    const response = await chat(
      [
        "Je suis A11 en mode creation.",
        "Je transforme des sources Drive, locales ou partagees en brief creatif semantique.",
        "Je retourne seulement un prompt final dense et exploitable, sans explication.",
        `Sortie choisie en mode auto: ${action.label}. Cout previsionnel: ${action.cost} credits.`,
        userPrompt.trim() ? `Prompt utilisateur: ${userPrompt.trim()}` : "Prompt utilisateur absent: invente une direction forte.",
        relevantPhoto
          ? `Source pertinente: ${relevantPhoto.name}. Analyse: ${relevantPhoto.analysisText || "indisponible"}.`
          : sharedSourceUrl
            ? `Source partagee: ${sharedSourceUrl}.`
            : "Aucune source pertinente.",
        photoNotes ? `Sources autorisees analysees:\n${photoNotes}` : "Aucune source autorisee.",
        `Base a ameliorer: ${fallbackPrompt}`,
      ].join("\n")
    );
    const content = String((response as any)?.content || (response as any)?.assistant || "").trim();
    return content || fallbackPrompt;
  } catch {
    return fallbackPrompt;
  }
}

export function CasinoHub({ isCompactLayout = false, onBackToChat }: CasinoHubProps) {
  const [photos, setPhotos] = useState<CasinoPhoto[]>([]);
  const [userPrompt, setUserPrompt] = useState("");
  const [sharedSourceUrl, setSharedSourceUrl] = useState("");
  const [activeAction, setActiveAction] = useState<CasinoAction>(CASINO_ACTIONS[0]);
  const [spinning, setSpinning] = useState(false);
  const [notice, setNotice] = useState("Ajoute des sources locales, Drive exportees ou partagees, puis laisse A11 choisir image, son ou video.");
  const [result, setResult] = useState<GenerationResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photoUrlsRef = useRef<string[]>([]);

  const selectedPhotos = useMemo(() => photos.filter((photo) => photo.selected), [photos]);
  const relevantPhoto = useMemo(() => pickRelevantPhoto(photos, userPrompt), [photos, userPrompt]);

  useEffect(() => {
    return () => {
      photoUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      photoUrlsRef.current = [];
    };
  }, []);

  function addPhotos(files: FileList | null, selectAll = true) {
    if (!files?.length) return;
    const nextPhotos = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, 48)
      .map((file, index) => {
        const objectUrl = URL.createObjectURL(file);
        photoUrlsRef.current.push(objectUrl);
        return {
          id: `photo-${Date.now()}-${index}`,
          file,
          name: file.name,
          objectUrl,
          selected: selectAll,
        };
      });
    if (!nextPhotos.length) {
      setNotice("Aucune image reconnue dans cette selection.");
      return;
    }
    setPhotos((current) => [...nextPhotos, ...current].slice(0, 72));
    setNotice(`${nextPhotos.length} source(s) autorisee(s). Tu peux en decocher avant le mode auto.`);
  }

  function setAllPhotos(selected: boolean) {
    setPhotos((current) => current.map((photo) => ({ ...photo, selected })));
    setNotice(selected ? "Toutes les sources chargees sont autorisees." : "Selection vide: A11 peut aussi creer sans source.");
  }

  function clearPhotos() {
    photoUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    photoUrlsRef.current = [];
    setPhotos([]);
    setResult(null);
    setNotice("Sources locales videes. A11 repartira d'une intention pure.");
  }

  function patchPhoto(photoId: string, patch: Partial<CasinoPhoto>) {
    setPhotos((current) => current.map((photo) => (
      photo.id === photoId ? { ...photo, ...patch } : photo
    )));
  }

  async function analyzeCasinoPhoto(photo: CasinoPhoto, index: number, total: number): Promise<CasinoPhoto> {
    if (photo.uploadedUrl && photo.analysisText) return photo;
    setNotice(`Analyse A11 des sources: ${index + 1}/${total} (${photo.name}).`);
    patchPhoto(photo.id, { analysisPending: true, analysisError: null });

    let uploadedUrl = photo.uploadedUrl || null;
    try {
      if (!uploadedUrl) {
        const localUpload = await uploadLocalImage(photo.file);
        uploadedUrl = resolveApiAssetUrl(localUpload.url) || null;
      }
      if (!uploadedUrl) {
        const uploadResult = await uploadConversationFile(photo.file, { conversationId: "casino-a11" });
        uploadedUrl = resolveUploadedPhotoUrl(uploadResult);
        if (!uploadedUrl) throw new Error("URL photo introuvable apres upload");
      }
    } catch (error) {
      const analysisError = String((error as Error)?.message || error);
      const updated = { ...photo, uploadedUrl, analysisPending: false, analysisError };
      patchPhoto(photo.id, { uploadedUrl, analysisPending: false, analysisError });
      return updated;
    }

    try {
      const analysis = await analyzeVisionImage(uploadedUrl, {
        conversationId: "casino-a11",
        source: "a11-semantic-studio",
        prompt: [
          "Analyse cette source pour une creation A11.",
          "Retourne les sujets visibles, couleurs, lumiere, ambiance, details pertinents et potentiel imaginatif.",
          "Sois concis mais riche."
        ].join(" "),
      });
      const analysisText = formatVisionEntry(analysis?.entry || analysis) || "Photo analysee: sujet et ambiance disponibles.";
      const updated = {
        ...photo,
        uploadedUrl,
        analysisText,
        analysisPending: false,
        analysisError: null,
      };
      patchPhoto(photo.id, {
        uploadedUrl,
        analysisText,
        analysisPending: false,
        analysisError: null,
      });
      return updated;
    } catch (error) {
      const analysisError = String((error as Error)?.message || error);
      const updated = { ...photo, uploadedUrl, analysisPending: false, analysisError };
      patchPhoto(photo.id, { uploadedUrl, analysisPending: false, analysisError });
      return updated;
    }
  }

  async function prepareSelectedPhotos() {
    const selected = photos.filter((photo) => photo.selected).slice(0, 8);
    if (!selected.length) return photos;

    const prepared: CasinoPhoto[] = [];
    for (let index = 0; index < selected.length; index += 1) {
      prepared.push(await analyzeCasinoPhoto(selected[index], index, selected.length));
    }

    const preparedById = new Map(prepared.map((photo) => [photo.id, photo]));
    return photos.map((photo) => preparedById.get(photo.id) || photo);
  }

  async function runGeneration(action: CasinoAction, prompt: string, sourceImageUrl?: string | null) {
    if (action.kind === "image") {
      const image = await generatePngWithPrompt(prompt, { sourceImageUrl });
      return {
        kind: action.kind,
        prompt,
        url: image.url,
        message: image.url ? "Image generee." : "Image demandee, mais aucune URL retournee.",
      };
    }

    if (action.kind === "video") {
      const video = await generateVideoWithPrompt(prompt, { sourceImageUrl });
      const url = video.videoUrl || video.video_url || video.url || null;
      return {
        kind: action.kind,
        prompt,
        url,
        message: url ? "Video generee." : "Video demandee, mais aucune URL retournee.",
      };
    }

    const spoken = [
      "A11 lance le son du studio semantique.",
      userPrompt.trim() || "Une impulsion breve, brillante, presque vivante.",
    ].join(" ");
    const audio = await ttsSpeak(spoken);
    return {
      kind: action.kind,
      prompt,
      url: (audio as any)?.audioUrl || null,
      message: "Son genere par la voix locale.",
    };
  }

  async function spinRoulette() {
    if (spinning) return;
    setSpinning(true);
    setResult(null);
    setNotice("Mode auto actif. A11 compare les sorties et choisit la plus pertinente.");

    const totalTicks = 18 + Math.floor(Math.random() * 8);
    let action = CASINO_ACTIONS[0];
    for (let index = 0; index < totalTicks; index += 1) {
      action = CASINO_ACTIONS[index % CASINO_ACTIONS.length];
      setActiveAction(action);
      await sleep(58 + index * 6);
    }

    const finalAction = CASINO_ACTIONS[Math.floor(Math.random() * CASINO_ACTIONS.length)];
    setActiveAction(finalAction);
    setNotice(`A11 a choisi: ${finalAction.label}. Analyse semantique de la selection en cours.`);

    const preparedPhotos = await prepareSelectedPhotos();
    const sourcePhoto = pickRelevantPhoto(preparedPhotos, userPrompt);
    const prompt = await buildA11Prompt(finalAction, preparedPhotos, userPrompt, sharedSourceUrl);
    setResult({
      kind: finalAction.kind,
      prompt,
      message: "Prompt forge. Generation en cours...",
    });

    try {
      const generated = await runGeneration(
        finalAction,
        prompt,
        sourcePhoto?.uploadedUrl || (isDirectMediaUrl(sharedSourceUrl) ? sharedSourceUrl : null)
      );
      setResult(generated);
      setNotice(generated.message);
    } catch (error) {
      setResult({
        kind: finalAction.kind,
        prompt,
        message: `Generation indisponible: ${String((error as Error)?.message || error)}`,
      });
      setNotice("Le prompt est pret, mais le backend generation a refuse ou n'est pas disponible.");
    } finally {
      setSpinning(false);
    }
  }

  return (
    <section className="casino-hub" aria-label="Studio semantique A11">
      <div className="casino-topbar">
        <div>
          <p className="casino-kicker">A11 / studio semantique</p>
          <h1>Generateur creatif A11</h1>
        </div>
        <div className="casino-topbar-actions">
          <button type="button" className="casino-ghost-button" onClick={onBackToChat}>
            Retour A11
          </button>
          <button type="button" className="casino-ghost-button" onClick={clearPhotos} disabled={!photos.length}>
            Vider
          </button>
        </div>
      </div>

      <div className="casino-grid casino-grid-simple">
        <div className="casino-play-surface">
          <div className="casino-meter-row">
            <div>
              <span className="casino-label">Sources</span>
              <strong>{photos.length}</strong>
            </div>
            <div>
              <span className="casino-label">Autorisees</span>
              <strong>{selectedPhotos.length}</strong>
            </div>
            <div>
              <span className="casino-label">Credits</span>
              <strong>{activeAction.cost}</strong>
            </div>
          </div>

          <div className="casino-roulette" aria-live="polite">
            {CASINO_ACTIONS.map((action) => (
              <div
                key={action.kind}
                className={`casino-roulette-slot ${activeAction.kind === action.kind ? "is-active" : ""}`}
                style={{ "--symbol-color": action.color } as React.CSSProperties}
              >
                <span>{action.shortLabel}</span>
                <small>{action.label} · {action.cost} cr.</small>
              </div>
            ))}
          </div>

          <textarea
            className="casino-prompt-input"
            value={userPrompt}
            onChange={(event) => setUserPrompt(event.currentTarget.value)}
            placeholder="Intention optionnelle. Sinon A11 invente depuis les sources autorisees."
          />

          <input
            className="casino-source-input"
            value={sharedSourceUrl}
            onChange={(event) => setSharedSourceUrl(event.currentTarget.value)}
            placeholder="Lien Drive partage, image directe, video, audio ou document"
          />

          <div className="casino-actions casino-actions-simple">
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              Ajouter sources
            </button>
            <button type="button" onClick={() => setAllPhotos(true)} disabled={!photos.length}>
              Tout autoriser
            </button>
            <button type="button" onClick={() => setAllPhotos(false)} disabled={!photos.length}>
              Tout decocher
            </button>
          </div>

          <button type="button" className="casino-spin-button casino-spin-button-wide" onClick={spinRoulette} disabled={spinning}>
            {spinning ? "A11 orchestre..." : "Mode auto A11"}
          </button>

          <p className="casino-notice">{notice}</p>
          {relevantPhoto ? (
            <p className="casino-empty-text">Source pertinente actuelle: {relevantPhoto.name}</p>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="casino-file-input"
            onChange={(event) => {
              addPhotos(event.currentTarget.files, true);
              event.currentTarget.value = "";
            }}
          />
        </div>

        <div className="casino-montage-panel">
          <div className="casino-panel-heading">
            <div>
              <span className="casino-label">Sortie A11</span>
              <h2>{result ? result.kind.toUpperCase() : "En attente"}</h2>
            </div>
          </div>

          <div className={`casino-result-stage ${activeAction.kind}`}>
            {result?.url && result.kind === "image" ? (
              <img src={result.url} alt="Generation A11" />
            ) : null}
            {result?.url && result.kind === "video" ? (
              <video src={result.url} controls playsInline />
            ) : null}
            {result?.url && result.kind === "sound" ? (
              <audio src={result.url} controls />
            ) : null}
            {!result?.url ? (
              <div className="casino-result-idle">
                <span>{activeAction.shortLabel}</span>
                <small>{result?.message || "A11 decide."}</small>
              </div>
            ) : null}
          </div>

          <div className="casino-prompt-output">
            <span className="casino-label">Brief final</span>
            <p>{result?.prompt || "Le prompt apparait ici apres le tirage."}</p>
          </div>
        </div>
      </div>

      <div className="casino-lower-grid casino-lower-grid-simple">
        <div className="casino-photo-pool">
          <div className="casino-panel-heading">
            <div>
              <span className="casino-label">Drive / local / partage</span>
              <h2>Sources autorisees</h2>
            </div>
          </div>

          {photos.length ? (
            <div className="casino-photo-strip">
              {photos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  className={photo.selected ? "is-selected" : ""}
                  onClick={() => {
                    setPhotos((current) => current.map((entry) => (
                      entry.id === photo.id ? { ...entry, selected: !entry.selected } : entry
                    )));
                  }}
                  title={photo.name}
                >
                  <img src={photo.objectUrl} alt={photo.name} />
                  <span>{photo.name}</span>
                  <small>
                    {photo.analysisPending
                      ? "Analyse..."
                      : photo.analysisText
                        ? "Analyse A11 prete"
                        : photo.analysisError
                          ? "Analyse indisponible"
                          : "Locale"}
                  </small>
                </button>
              ))}
            </div>
          ) : (
            <p className="casino-empty-text">
              A11 ne voit que les fichiers explicitement choisis, exportes depuis Drive ou partages dans la conversation.
            </p>
          )}
        </div>
      </div>

      {isCompactLayout ? null : (
        <div className="casino-footer-note">
          Credits creation: image 6, son 3, video 18. Le chat court reste leger; les gros contextes passent par A11 Studio.
        </div>
      )}
    </section>
  );
}
