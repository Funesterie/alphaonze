import { useState } from 'react';

export default function Retro() {
  const [room, setRoom] = useState('');

  const code = room.trim().replace(/\s+/g, '-').toLowerCase() || 'retro-night';

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Soirée Rétro — Tekken 3</h1>
      <p className="text-sm opacity-80">
        Crée une salle POOL, invite un ami, puis lance l’émulateur externe.
      </p>

      <div className="flex items-center gap-2">
        <input
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          placeholder="Nom de la salle (ex: Tekken3 Night #Paris)"
          className="px-3 py-2 rounded w-[420px] bg-neutral-900/50 border border-neutral-700"
        />
        <button
          className="px-3 py-2 rounded bg-emerald-600/80"
          onClick={() => alert(`Salle créée: ${code}`)}
        >
          Créer la salle
        </button>
        <button
          className="px-3 py-2 rounded bg-neutral-800"
          onClick={() => navigator.clipboard.writeText(code)}
        >
          Copier le code
        </button>
      </div>

      <div className="flex items-center gap-2">
        <a
          href="https://www.emulatorjs.com/"
          target="_blank"
          className="px-3 py-2 rounded bg-indigo-600/80"
          rel="noreferrer"
        >
          ▶️ Ouvrir l’émulateur Tekken 3
        </a>
        <a
          href="https://www.youtube.com/results?search_query=tekken+3+emulator+tuto"
          target="_blank"
          rel="noreferrer"
          className="px-3 py-2 rounded bg-neutral-800"
        >
          📺 Tuto
        </a>
      </div>

      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" className="accent-emerald-500" />
        Essayer d’intégrer l’émulateur (beta)
      </label>
    </div>
  );
}
