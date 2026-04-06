const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const QFLUSH_DIR = path.join(ROOT, ".qflush");
const TASK_FILE = path.join(QFLUSH_DIR, "a11d-tasks.json");

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // ignore
  }
}

function loadTasks() {
  try {
    if (!fs.existsSync(TASK_FILE)) return [];
    const raw = fs.readFileSync(TASK_FILE, "utf8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("[A11][DROID] loadTasks error:", e && e.message);
    return [];
  }
}

function saveTasks(tasks) {
  try {
    ensureDir(QFLUSH_DIR);
    fs.writeFileSync(TASK_FILE, JSON.stringify(tasks, null, 2), "utf8");
  } catch (e) {
    console.warn("[A11][DROID] saveTasks error:", e && e.message);
  }
}

let loopRunning = false;
let lastRun = null;
let processedCount = 0;

async function processNextTask() {
  const tasks = loadTasks();
  const next = tasks.find((t) => t.status === "pending");

  if (!next) {
    return; // rien à faire
  }

  next.status = "running";
  next.updatedAt = new Date().toISOString();
  saveTasks(tasks);

  try {
    // TODO plus tard: appeller Qflush/HORN ici
    console.log("[A11][DROID] processing task:", next.id, "-", next.goal);

    // Simule un traitement
    await new Promise((r) => setTimeout(r, 500));

    next.status = "done";
    next.result = { ok: true, note: "Traitement stub (à brancher sur Qflush)." };
    next.updatedAt = new Date().toISOString();
    processedCount++;
    lastRun = new Date().toISOString();

    saveTasks(tasks);
  } catch (e) {
    console.error("[A11][DROID] task error:", e && e.message);
    next.status = "error";
    next.error = String(e && e.message) || String(e);
    next.updatedAt = new Date().toISOString();
    saveTasks(tasks);
  }
}

/**
 * Lance la boucle Droid (si pas déjà lancée)
 * @param {number} intervalMs
 */
function startDroidLoop(intervalMs = 15000) {
  if (loopRunning) {
    console.log("[A11][DROID] loop already running");
    return;
  }
  loopRunning = true;
  console.log("[A11][DROID] loop started, interval =", intervalMs, "ms");

  setInterval(() => {
    processNextTask().catch((e) =>
      console.error("[A11][DROID] loop error:", e && e.message)
    );
  }, intervalMs);
}

/**
 * Ajoute une tâche dans la queue
 * @param {{ goal: string, meta?: any }} taskData
 */
async function addDroidTask(taskData) {
  const tasks = loadTasks();
  const id = `task_${tasks.length + 1}_${Date.now()}`;
  const now = new Date().toISOString();

  const task = {
    id,
    goal: String(taskData.goal || "").trim(),
    meta: taskData.meta || {},
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  tasks.push(task);
  saveTasks(tasks);
  console.log("[A11][DROID] task added:", id, "-", task.goal);

  return task;
}

/**
 * Renvoie un petit état du Droid
 */
async function getDroidStatus() {
  const tasks = loadTasks();
  const pending = tasks.filter((t) => t.status === "pending").length;
  const running = tasks.filter((t) => t.status === "running").length;
  const done = tasks.filter((t) => t.status === "done").length;
  const errored = tasks.filter((t) => t.status === "error").length;

  return {
    loopRunning,
    lastRun,
    processedCount,
    totals: {
      all: tasks.length,
      pending,
      running,
      done,
      errored,
    },
  };
}

module.exports = {
  startDroidLoop,
  addDroidTask,
  getDroidStatus,
};
