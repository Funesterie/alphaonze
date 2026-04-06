import { registerHorn, scream } from "../core/horn";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Lire un fichier texte UTF-8
 */
registerHorn("a11d.fs.read", async (payload: { file: string }) => {
  const p = path.resolve(process.cwd(), payload.file);
  const content = await fs.readFile(p, "utf8");
  return { ok: true, file: p, content };
});

/**
 * Écrire un fichier texte UTF-8
 */
registerHorn("a11d.fs.write", async (payload: { file: string; content: string }) => {
  const p = path.resolve(process.cwd(), payload.file);
  await fs.writeFile(p, payload.content ?? "", "utf8");
  return { ok: true, file: p };
});

/**
 * Lancer une commande shell (git, npm, dotnet, qflush, etc.)
 */
registerHorn("a11d.shell.run", async (payload: {
  cmd: string;
  args?: string[];
  cwd?: string;
}) => {
  const cmd = payload.cmd;
  const args = payload.args || [];
  const cwd = payload.cwd || process.cwd();

  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let out = "";
    let err = "";

    child.stdout.on("data", d => (out += d.toString()));
    child.stderr.on("data", d => (err += d.toString()));

    child.on("close", code => {
      resolve({ ok: code === 0, code, out, err });
    });

    child.on("error", e => reject(e));
  });
});

/**
 * Raccourcis haut niveau
 */
registerHorn("a11d.git.status", async () => {
  return await scream("a11d.shell.run", {
    cmd: "git",
    args: ["status", "--short"],
  });
});

registerHorn("a11d.tests.run", async () => {
  return await scream("a11d.shell.run", {
    cmd: "npm",
    args: ["test"],
  });
});

registerHorn("a11d.build.run", async () => {
  return await scream("a11d.shell.run", {
    cmd: "npm",
    args: ["run", "build"],
  });
});

/**
 * Intégration runner.exe (si tu veux qu’il contrôle l’OS)
 */
registerHorn("a11d.ui.sendKeys", async (payload: { text: string }) => {
  return await scream("a11d.shell.run", {
    cmd: "a11-runner.exe",
    args: ["send-keys", payload.text],
  });
});

registerHorn("a11d.ui.click", async (payload: { x?: number; y?: number; button?: string }) => {
  const args = ["click"];
  if (payload.x != null && payload.y != null) {
    args.push(String(payload.x), String(payload.y));
  }
  if (payload.button) args.push("--button", payload.button);
  return await scream("a11d.shell.run", {
    cmd: "a11-runner.exe",
    args,
  });
});

registerHorn("a11d.tunnel.status", async () => {
  return await scream("a11d.shell.run", {
    cmd: "cloudflared.exe",
    args: ["tunnel", "list"],
  });
});

registerHorn("a11d.netlify.deploy", async () => {
  const frontendDist =
    process.env.A11_FRONTEND_DIST ||
    path.resolve(process.cwd(), "..", "a11frontendnetlify", "dist");
  return await scream("a11d.shell.run", {
    cmd: "netlify",
    args: ["deploy", "--dir", frontendDist, "--prod"],
  });
});

// Exemple de fonction exportée pour le backend
export async function readFile(file: string): Promise<any> {
  const p = path.resolve(process.cwd(), file);
  const content = await fs.readFile(p, "utf8");
  return { ok: true, file: p, content };
}

export async function writeFile(file: string, content: string): Promise<any> {
  const p = path.resolve(process.cwd(), file);
  await fs.writeFile(p, content ?? "", "utf8");
  return { ok: true, file: p };
}

export async function runShell(cmd: string, args?: string[], cwd?: string): Promise<any> {
  cwd = cwd || process.cwd();
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args || [], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", d => (out += d.toString()));
    child.stderr.on("data", d => (err += d.toString()));
    child.on("close", code => {
      resolve({ ok: code === 0, code, out, err });
    });
    child.on("error", e => reject(e));
  });
}
