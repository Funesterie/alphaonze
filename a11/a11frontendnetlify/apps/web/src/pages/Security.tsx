import React, { useEffect, useState } from 'react';

export default function SecurityPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/nez/clients', { headers: { 'X-NEZ-ADMIN': (import.meta as any).env.VITE_A11_ADMIN_TOKEN || '' } });
        if (!res.ok) throw new Error(await res.text());
        setData(await res.json());
      } catch (e: any) {
        setError(String(e.message || e));
      }
    })();
  }, []);

  if (error) return <div style={{padding:20}}>Erreur: {error}</div>;
  if (!data) return <div style={{padding:20}}>Chargement...</div>;

  return (
    <div style={{padding:20}}>
      <h2>Nezlephant Security</h2>
      <p>Mode: <b>{data.mode}</b></p>
      <h3>Clients connus</h3>
      <ul>
        {data.tokens.map((t:string)=> <li key={t}>{t}</li>)}
      </ul>
      <h3>Accès récents</h3>
      <ul>
        {data.recentAccess.map((a:any, i:number)=> (
          <li key={i}>{new Date(a.when).toLocaleString()} - {a.clientId} - {a.path} - {a.ip}</li>
        ))}
      </ul>
      {/* Correction UI: conteneur pour les paramètres IA */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        maxWidth: 400,
        marginTop: 32,
        background: '#181818',
        padding: 16,
        borderRadius: 8,
        boxShadow: '0 2px 8px #0002'
      }}>
        <label>
          Température
          <input type="number" min="0" max="2" step="0.01" style={{marginLeft:8, width:80}} />
        </label>
        <label>
          Top P
          <input type="number" min="0" max="1" step="0.01" style={{marginLeft:8, width:80}} />
        </label>
        <label>
          Fournisseur LLM
          <select style={{marginLeft:8}}>
            <option value="local">Local (llama/ollama)</option>
            <option value="gpt">GPT (OpenAI)</option>
            <option value="autre">Autre</option>
          </select>
        </label>
        <label>
          Nindô (voie personnelle)
          <input type="text" style={{marginLeft:8, width:180}} />
        </label>
      </div>
    </div>
  );
}
