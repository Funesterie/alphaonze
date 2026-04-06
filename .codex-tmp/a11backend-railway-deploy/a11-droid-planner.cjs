import fetch from "node-fetch";

const LLM_ENDPOINT = process.env.A11_LLM_PLANNER_URL
  || "http://127.0.0.1:4545/api/plan"; // URL Cerbère

export async function callLlmPlanner(world) {
  const body = { world };
  const res = await fetch(LLM_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Planner HTTP ${res.status}`);
  return await res.json(); // doit retourner { steps: [...] }
}
