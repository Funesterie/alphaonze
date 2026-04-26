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
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error(`FileReader error on ${f.name}`));
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
          reader.readAsDataURL(f);
        });
        try {
          const res = await fetch('/api/upload/image-local', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contentBase64: dataUrl, filename: f.name }),
          });
          const data = res.ok ? await res.json() : null;
          const imageUrl = data?.url || null;
          if (imageUrl) {
            onText(`[image:${imageUrl}]`);
            console.log(`[Importer] Image uploaded locally: ${f.name} -> ${imageUrl}`);
          } else {
            // Upload a répondu mais sans URL — erreur propre, pas de base64
            console.warn(`[Importer] Upload returned no URL for ${f.name} (status ${res.status})`);
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
