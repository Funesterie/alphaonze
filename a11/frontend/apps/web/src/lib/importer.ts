export default async function handleImportFiles(list: FileList | null, onText: (t: string) => void) {
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
      } else {
        // For other file types, try to extract name and a placeholder
        onText(`[Fichier importé: ${f.name}]`);
      }
    } catch (e) {
      console.warn('handleImportFiles error', e);
    }
  }
}
