import { uploadConversationFile, uploadLocalImage } from './api';

const RECENT_IMAGE_IMPORT_TTL_MS = 10_000;
const recentImageImports = new Map<string, number>();

async function buildImageImportKey(file: File): Promise<string> {
  const fallback = `${file.type}:${file.size}:${file.name}`;
  if (!globalThis.crypto?.subtle) return fallback;

  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return `${file.type}:${file.size}:${hash}`;
  } catch {
    return fallback;
  }
}

function pruneRecentImageImports(now: number) {
  for (const [key, at] of recentImageImports) {
    if (now - at > RECENT_IMAGE_IMPORT_TTL_MS) {
      recentImageImports.delete(key);
    }
  }
}

function buildImageResourceText(file: File, upload: any): string {
  const resource = upload?.conversationResource || upload?.file || null;
  const imageUrl = String(resource?.downloadUrl || resource?.url || upload?.url || '').trim();
  const analysis = resource?.metadata?.analysis || upload?.analysis || {};
  const inference = analysis?.actionInference || {};
  const parts = [
    imageUrl ? `[image:${imageUrl}]` : '',
    `[image-jointe:${file.name}]`,
    resource?.id ? `id=${resource.id}` : '',
    analysis?.parser ? `analyse=${analysis.parser}` : '',
    inference?.suggestedAction ? `action-probable=${inference.suggestedAction}` : '',
    'Image rattachee a la conversation; analyse-la avec la vision et decide quoi en faire avant de repondre.',
  ].filter(Boolean);
  return parts.join(' ');
}

export default async function handleImportFiles(
  list: FileList | null,
  onText: (t: string) => void,
  options?: { uploadImages?: boolean; conversationId?: string }
) {
  if (!list || list.length === 0) return;
  for (const f of Array.from(list)) {
    try {
      // Fichiers texte : lire et injecter dans le textarea
      if (f.type.startsWith('text/') || /\.(md|txt|json)$/i.test(f.name)) {
        const start = performance.now();
        const txt = await f.text();
        console.log(`[Importer] Read file '${f.name}' in ${(performance.now() - start).toFixed(2)} ms`);
        onText(txt);
      } else if (options?.uploadImages && f.type.startsWith('image/')) {
        // Upload vers le backend local — pas de fallback data-URL
        // (coller des mégaoctets de base64 dans le textarea casse tout)
        try {
          const now = Date.now();
          pruneRecentImageImports(now);
          const importKey = await buildImageImportKey(f);
          const previousImportAt = recentImageImports.get(importKey);
          if (previousImportAt && now - previousImportAt < RECENT_IMAGE_IMPORT_TTL_MS) {
            console.info(`[Importer] Duplicate image skipped: ${f.name}`);
            continue;
          }
          recentImageImports.set(importKey, now);

          let data: any = null;
          if (options?.conversationId) {
            try {
              data = await uploadConversationFile(f, { conversationId: options.conversationId });
            } catch (resourceError) {
              console.warn('[Importer] Conversation image upload failed, falling back to local upload:', resourceError);
            }
          }
          if (!data) {
            data = await uploadLocalImage(f, { conversationId: options?.conversationId });
          }
          const imageUrl = data?.url || null;
          const resourceText = buildImageResourceText(f, data);
          if (resourceText) {
            onText(resourceText);
            const loggedUrl = imageUrl || data?.conversationResource?.downloadUrl || data?.file?.downloadUrl || '';
            console.log(`[Importer] Image uploaded locally: ${f.name}${loggedUrl ? ` -> ${loggedUrl}` : ''}`);
          } else if (imageUrl) {
            onText(`[image:${imageUrl}] Image rattachee a la conversation; analyse-la avec la vision avant de repondre.`);
            console.log(`[Importer] Image uploaded locally: ${f.name} -> ${imageUrl}`);
          } else {
            // Upload a répondu mais sans URL — erreur propre, pas de base64
            console.warn(`[Importer] Upload returned no URL for ${f.name}`);
            onText(`[Erreur upload: ${f.name}]`);
          }
        } catch (error_) {
          // Réseau ou serveur indisponible — erreur propre, pas de base64
          console.warn('[Importer] Local upload failed:', error_);
          onText(`[Erreur upload: ${f.name}]`);
        }
      } else {
        onText(`[Fichier importé: ${f.name}]`);
      }
    } catch (e) {
      console.warn('handleImportFiles error', e);
      onText(`[Erreur import: ${f.name}]`);
    }
  }
}
