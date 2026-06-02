import { uploadConversationFile, uploadLocalImage } from './api';

const RECENT_IMAGE_IMPORT_TTL_MS = 120_000;
const recentImageImports = new Map<string, {
  at: number;
  attachment?: ImportedConversationAttachment;
}>();

export type ImportedConversationAttachment = {
  kind: 'image' | 'file';
  name: string;
  url?: string;
  resourceId?: string;
  parser?: string;
  suggestedAction?: string;
  upload: any;
};

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
  for (const [key, entry] of recentImageImports) {
    if (now - entry.at > RECENT_IMAGE_IMPORT_TTL_MS) {
      recentImageImports.delete(key);
    }
  }
}

function buildImageAttachment(file: File, upload: any): ImportedConversationAttachment | null {
  const resource = upload?.conversationResource || upload?.file || null;
  const imageUrl = String(resource?.downloadUrl || resource?.url || upload?.url || '').trim();
  if (!imageUrl) return null;
  const analysis = resource?.metadata?.analysis || upload?.analysis || {};
  const inference = analysis?.actionInference || {};
  return {
    kind: 'image',
    name: file.name,
    url: imageUrl,
    resourceId: String(resource?.id || resource?.storageKey || '').trim() || undefined,
    parser: String(analysis?.parser || '').trim() || undefined,
    suggestedAction: String(inference?.suggestedAction || '').trim() || undefined,
    upload,
  };
}

export default async function handleImportFiles(
  list: FileList | null,
  onText: (t: string) => void,
  options?: {
    uploadImages?: boolean;
    conversationId?: string;
    onAttachment?: (attachment: ImportedConversationAttachment) => void;
  }
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
          const previousImport = recentImageImports.get(importKey);
          if (previousImport && now - previousImport.at < RECENT_IMAGE_IMPORT_TTL_MS) {
            if (previousImport.attachment?.url) {
              options?.onAttachment?.(previousImport.attachment);
            }
            console.info(`[Importer] Duplicate image reused: ${f.name}`);
            continue;
          }
          recentImageImports.set(importKey, { at: now });

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
          const attachment = buildImageAttachment(f, data);
          if (attachment?.url) {
            recentImageImports.set(importKey, { at: Date.now(), attachment });
            options?.onAttachment?.(attachment);
            const loggedUrl = attachment.url || data?.conversationResource?.downloadUrl || data?.file?.downloadUrl || '';
            console.log(`[Importer] Image uploaded locally: ${f.name}${loggedUrl ? ` -> ${loggedUrl}` : ''}`);
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
