export default async function handleImportFiles(
  list: FileList | null,
  onText: (t: string) => void,
  options?: { uploadImages?: boolean; conversationId?: string }
) {
  if (!list || list.length === 0) return;
  for (const f of Array.from(list)) {
    try {
      // If it's a text file, read it
      if (f.type.startsWith('text/') || /\.(md|txt|json)$/i.test(f.name)) {
        const start = performance.now();
        const txt = await f.text();
        const end = performance.now();
        console.log(`[Importer] Read file '${f.name}' in ${(end - start).toFixed(2)} ms`);
        onText(txt);
      } else if (options?.uploadImages && f.type.startsWith('image/')) {
        // Lire l'image en base64
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error);
          reader.onload = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(f);
        });
        // Tenter l'upload vers le backend local
        try {
          // Toujours utiliser une URL relative pour passer par le proxy Vite en dev
          const uploadUrl = '/api/upload/image-local';
          const res = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contentBase64: dataUrl, filename: f.name }),
          });
          const data = res.ok ? await res.json() : null;
          // L'URL retournée est relative (/files/...) - la garder relative pour le proxy
          const imageUrl = data?.url || null;
          if (imageUrl) {
            onText(`[image:${imageUrl}]`);
            console.log(`[Importer] Image uploaded locally: ${f.name} -> ${imageUrl}`);
          } else {
            // Fallback: data URL directe
            onText(`[image-data:${dataUrl}]`);
            console.log(`[Importer] Image as data URL: ${f.name}`);
          }
        } catch (uploadErr) {
          console.warn('[Importer] Local upload failed, using data URL:', uploadErr);
          onText(`[image-data:${dataUrl}]`);
        }
      } else {
        // For other file types, try to extract name and a placeholder
        onText(`[Fichier importé: ${f.name}]`);
      }
    } catch (e) {
      console.warn('handleImportFiles error', e);
      onText(`[Erreur import: ${f.name}]`);
    }
  }
}
