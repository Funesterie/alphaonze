import fetch from "node-fetch";

const CERBERE_URL = process.env.CERBERE_PLANNER_URL || "http://127.0.0.1:4545/api/v1/plan";

export async function getPlanFromLlm(task, worldContext) {
  const systemPrompt = `
Tu es A-11, un agent PLANNER. 
Tu ne modifies pas les fichiers toi-même.
Tu dois retourner UNIQUEMENT un JSON valide avec des 'steps',
où chaque 'step' contient :
- "skill": nom d'une compétence (a11d.fs.read, a11d.fs.write, a11d.shell.run, a11d.vs.openFile, etc.)
- "payload": un objet avec les paramètres nécessaires.
Ne réponds AUCUN texte en dehors de ce JSON.
`;

  const userPrompt = `
Objectif: ${task.goal}
Contexte:
${JSON.stringify(worldContext, null, 2)}
Donne-moi un plan d'actions minimal et sûr pour atteindre cet objectif.
`;

  const body = {
    model: "planner-a11",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };

  const res = await fetch(CERBERE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Planner HTTP ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";
  let plan;
  try {
    plan = JSON.parse(content);
  } catch (e) {
    throw new Error("Planner a renvoyé du JSON invalide: " + e.message);
  }
  return plan; // { steps: [...] }
}
