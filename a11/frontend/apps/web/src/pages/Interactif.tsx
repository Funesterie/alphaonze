import { useCallback, useEffect, useMemo, useState } from "react";
import { getAuthToken, getCurrentApiBase, buildApiUrlFromBase } from "../lib/api";

/**
 * Funesterie Interactif — la vitrine de l'auto-DJ.
 *
 * Quatre entrees, mais une seule est branchee sur du calcul reel aujourd'hui :
 * le casting et le plan de voix. Les trois autres pointent vers ce qui existe
 * deja plutot que de simuler un parcours. Un bouton d'achat qui ne debite rien
 * est pire qu'un bouton absent : il apprend au visiteur a ne pas croire la page.
 */

type Profil = {
  brillance: number;
  corps: number;
  fond: number;
  densite: number;
} | null;

type VoixCasting = {
  name: string;
  label: string;
  owner: string;
  gender: string;
  consentBy: string;
  eligible: boolean;
  raison: string;
  aEchantillon: boolean;
  profil: Profil;
};

type ChoixSection = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  label: string;
  voix: string;
  libelle: string;
  ecart: number;
  faim: number;
  absente: boolean;
  marge: number | null;
};

type Onglet = "dj" | "personas" | "clip" | "zen";

const ONGLETS: Array<{ id: Onglet; titre: string }> = [
  { id: "dj", titre: "Le DJ choisit" },
  { id: "personas", titre: "Parler aux personas" },
  { id: "clip", titre: "Composer un clip" },
  { id: "zen", titre: "Le catalogue .zen" },
];

async function appelApi(chemin: string, init?: RequestInit) {
  const token = getAuthToken();
  const res = await fetch(buildApiUrlFromBase(getCurrentApiBase(), chemin), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function secondes(v: number) {
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Les quatre axes mesures, en barres. Une voix sans echantillon n'a rien a montrer. */
function BarresProfil({ profil }: { profil: Profil }) {
  if (!profil) {
    return <span className="opacity-60 text-xs">pas encore d’échantillon mesuré</span>;
  }
  // Les axes sont des dB relatifs, entre -25 et 0. On les ramene en largeur.
  const axes: Array<[string, number]> = [
    ["brillance", profil.brillance],
    ["corps", profil.corps],
    ["fond", profil.fond],
    ["densité", profil.densite],
  ];
  return (
    <div className="flex flex-col gap-1 w-full max-w-[260px]">
      {axes.map(([nom, valeur]) => {
        const largeur = Math.max(0, Math.min(100, ((valeur + 25) / 25) * 100));
        return (
          <div key={nom} className="flex items-center gap-2 text-xs">
            <span className="w-16 opacity-70">{nom}</span>
            <div className="flex-1 h-1.5 rounded bg-neutral-800">
              <div className="h-1.5 rounded bg-emerald-500/70" style={{ width: `${largeur}%` }} />
            </div>
            <span className="w-12 text-right tabular-nums opacity-60">{valeur} dB</span>
          </div>
        );
      })}
    </div>
  );
}

function OngletDj() {
  const [casting, setCasting] = useState<VoixCasting[] | null>(null);
  const [presents, setPresents] = useState<string[]>([]);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  const [morceau, setMorceau] = useState("");
  const [choix, setChoix] = useState<ChoixSection[] | null>(null);
  const [planEnCours, setPlanEnCours] = useState(false);

  const chargerCasting = useCallback(async () => {
    setChargement(true);
    setErreur("");
    try {
      const data = await appelApi("/api/vivy/auto-dj/casting");
      setCasting(data.casting || []);
      setPresents(data.presents || []);
    } catch (e) {
      setErreur(String((e as Error).message || e));
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { void chargerCasting(); }, [chargerCasting]);

  const lancerPlan = useCallback(async () => {
    if (!morceau.trim()) return;
    setPlanEnCours(true);
    setErreur("");
    try {
      const data = await appelApi("/api/vivy/auto-dj/plan", {
        method: "POST",
        body: JSON.stringify({ audioPath: morceau.trim() }),
      });
      setChoix(data.plan?.choix || []);
    } catch (e) {
      setErreur(String((e as Error).message || e));
      setChoix(null);
    } finally {
      setPlanEnCours(false);
    }
  }, [morceau]);

  const eligibles = useMemo(() => (casting || []).filter((v) => v.eligible), [casting]);
  const ecartees = useMemo(() => (casting || []).filter((v) => !v.eligible), [casting]);

  return (
    <div className="space-y-6">
      <p className="text-sm opacity-80 max-w-2xl">
        Le DJ compare deux mesures : la structure du morceau, relevée bande par bande sur le
        fichier audio, et le timbre de chaque voix, relevé sur son échantillon. Il n’y a pas
        de préférence écrite quelque part — le choix sort du calcul.
      </p>

      {erreur && (
        <div className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-sm">{erreur}</div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Casting {casting ? `— ${eligibles.length} voix peuvent chanter` : ""}
        </h2>

        {chargement && <p className="text-sm opacity-70">mesure des échantillons…</p>}

        {casting && eligibles.length === 0 && (
          <p className="text-sm opacity-80">
            Aucune voix n’a encore d’identifiant Suno. Le catalogue distingue l’intention du
            fait : tant qu’une voix n’a pas été générée, elle ne peut pas chanter.
          </p>
        )}

        <ul className="space-y-3">
          {eligibles.map((v) => (
            <li key={v.name} className="flex flex-wrap items-center gap-4 rounded border border-neutral-800 px-3 py-2">
              <span className="w-28 font-medium">{v.label}</span>
              <span className="text-xs opacity-60 w-40">
                {presents.includes(v.name) ? "présent sur le bus" : "endormi — retrogradé, pas exclu"}
              </span>
              <BarresProfil profil={v.profil} />
            </li>
          ))}
        </ul>

        {ecartees.length > 0 && (
          <details className="text-sm opacity-70">
            <summary className="cursor-pointer">{ecartees.length} voix écartées</summary>
            <ul className="mt-2 space-y-1">
              {ecartees.map((v) => (
                <li key={v.name}>{v.label} — {v.raison}</li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Distribuer un morceau</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={morceau}
            onChange={(e) => setMorceau(e.target.value)}
            placeholder="chemin du morceau sous la racine runtime"
            className="px-3 py-2 rounded w-[420px] bg-neutral-900/50 border border-neutral-700"
          />
          <button
            type="button"
            onClick={() => void lancerPlan()}
            disabled={planEnCours || !morceau.trim()}
            className="px-3 py-2 rounded bg-emerald-600/80 disabled:opacity-40"
          >
            {planEnCours ? "analyse…" : "Distribuer"}
          </button>
        </div>
        <p className="text-xs opacity-60 max-w-2xl">
          La première analyse d’un titre prend quelques secondes : ffmpeg relève l’enveloppe
          des trois bandes sur toute la durée. Le résultat est ensuite gardé en cache.
        </p>

        {choix && choix.length > 0 && (
          <table className="w-full text-sm">
            <thead className="opacity-60 text-left">
              <tr>
                <th className="py-1">section</th>
                <th>voix</th>
                <th>écart</th>
                <th>faim</th>
                <th>marge</th>
              </tr>
            </thead>
            <tbody>
              {choix.map((c) => (
                <tr key={c.index} className="border-t border-neutral-800">
                  <td className="py-1">
                    {secondes(c.startSeconds)} → {secondes(c.endSeconds)}
                    {c.label ? <span className="opacity-60"> · {c.label}</span> : null}
                  </td>
                  <td className="font-medium">
                    {c.libelle}
                    {c.absente && <span className="opacity-50 text-xs"> (endormi)</span>}
                  </td>
                  <td className="tabular-nums opacity-70">{c.ecart}</td>
                  <td className="tabular-nums opacity-70">{c.faim}</td>
                  <td className="tabular-nums opacity-70">{c.marge ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {choix && choix.length > 0 && (
          <p className="text-xs opacity-60 max-w-2xl">
            Une marge minuscule veut dire que le choix s’est joué sur la faim et non sur le
            timbre : c’est exactement ce qu’il faut pouvoir relire quand une attribution surprend.
          </p>
        )}
      </section>
    </div>
  );
}

/** Entrée honnête : on renvoie vers ce qui marche, on ne rejoue pas une façade. */
function Renvoi({ titre, corps, lien, libelleLien }: {
  titre: string; corps: string; lien?: string; libelleLien?: string;
}) {
  return (
    <div className="space-y-3 max-w-2xl">
      <h2 className="text-lg font-semibold">{titre}</h2>
      <p className="text-sm opacity-80">{corps}</p>
      {lien && (
        <a href={lien} className="inline-block px-3 py-2 rounded bg-emerald-600/80 text-sm">
          {libelleLien}
        </a>
      )}
    </div>
  );
}

export default function Interactif() {
  const [onglet, setOnglet] = useState<Onglet>("dj");

  return (
    <main className="p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Funesterie Interactif</h1>
        <p className="text-sm opacity-70">
          Le catalogue de voix, et qui chante quoi — décidé par la mesure, pas par un réglage.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2">
        {ONGLETS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setOnglet(o.id)}
            className={`px-3 py-2 rounded text-sm ${
              onglet === o.id ? "bg-emerald-600/80" : "bg-neutral-900/50 border border-neutral-800"
            }`}
          >
            {o.titre}
          </button>
        ))}
      </nav>

      {onglet === "dj" && <OngletDj />}

      {onglet === "personas" && (
        <Renvoi
          titre="Parler aux personas"
          corps="Chaque persona a déjà sa couleur, son registre et sa description vocale. Le chat existe dans Vivy ; cette page ne le duplique pas."
          lien="/"
          libelleLien="Ouvrir le chat Vivy"
        />
      )}

      {onglet === "clip" && (
        <Renvoi
          titre="Composer un clip"
          corps="La chaîne complète est en place : Sol séquence, A11 monte, Grok tient l’ambiance, K44 vérifie la cohérence. Les deux offres Stripe existent (4,99 € et 29,99 €), mais leurs identifiants de prix ne sont pas encore renseignés côté serveur — le tunnel de paiement reste donc fermé."
        />
      )}

      {onglet === "zen" && (
        <Renvoi
          titre="Le catalogue .zen"
          corps="Les 120 morceaux sont archivés en .zen sur la Storage Box, masters V11 pan inclus. Il manque deux choses avant de pouvoir les vendre : un produit Stripe à 0,99 € et une route qui serve les fichiers depuis l’archive. Tant qu’elles manquent, il n’y a pas de bouton d’achat ici."
        />
      )}
    </main>
  );
}
