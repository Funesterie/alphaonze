import { scream } from "@funeste38/qflush/dist/core/horn.js";
import { writeLog } from "./a11-droid-log.cjs";

export async function executePlan(task, plan) {
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  await writeLog(`PLAN START for goal=\"${task.goal}\" steps=${steps.length}`);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const label = `${step.skill || "unknown"}#${i}`;
    try {
      if (!step.skill || typeof step.skill !== "string") {
        await writeLog(`STEP ${label} SKIPPED: invalid skill`);
        continue;
      }
      if (!isSkillAllowed(step.skill)) {
        await writeLog(`STEP ${label} BLOCKED: skill not allowed (${step.skill})`);
        continue;
      }
      await writeLog(`STEP ${label} START payload=${JSON.stringify(step.payload || {})}`);
      const result = await scream(step.skill, step.payload || {});
      await writeLog(`STEP ${label} OK result=${JSON.stringify(result).slice(0, 500)}`);
    } catch (e) {
      await writeLog(`STEP ${label} ERROR: ${String(e)}`);
    }
  }
  await writeLog(`PLAN END for goal=\"${task.goal}\"`);
}

function isSkillAllowed(skill) {
  const allowedPrefixes = [
    "a11d.fs.",
    "a11d.shell.",
    "a11d.git.",
    "a11d.tests.",
    "a11d.vs.",
    "a11d.qf.",
    "a11d.ui."
  ];
  return allowedPrefixes.some(prefix => skill.startsWith(prefix));
}
