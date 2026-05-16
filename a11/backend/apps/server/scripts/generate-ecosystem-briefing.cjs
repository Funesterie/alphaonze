#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  buildEcosystemBriefing,
  summarizeBriefing,
  toArchitectureMarkdown,
  toBriefingHtml,
  toExecutiveMarkdown,
} = require('../src/knowledge/ecosystem-briefing.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..');
const A11_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..');
const RUNTIME_ROOT = path.resolve(process.env.A11_RUNTIME_ROOT || path.join(A11_ROOT, 'runtime'));
const GRAPH_DIR = path.join(RUNTIME_ROOT, 'knowledge-graph');
const args = parseArgs(process.argv.slice(2));

async function main() {
  const scopePath = path.join(GRAPH_DIR, 'funesterie-ecosystem-scope.json');
  const corpusPath = path.join(GRAPH_DIR, 'funesterie-ecosystem-corpus.json');
  const runtimeHooksPath = path.join(GRAPH_DIR, 'a11-runtime-hooks.json');
  const scope = readJson(scopePath);
  const corpus = readJson(corpusPath);
  const runtimeHooks = readJsonOptional(runtimeHooksPath);
  const briefing = buildEcosystemBriefing(scope, corpus, { runtimeHooks });

  fs.mkdirSync(GRAPH_DIR, { recursive: true });
  const jsonPath = path.join(GRAPH_DIR, 'funesterie-ecosystem-briefing.json');
  const executivePath = path.join(GRAPH_DIR, 'funesterie-executive-view.md');
  const architecturePath = path.join(GRAPH_DIR, 'funesterie-architecture-view.md');
  const htmlPath = path.join(GRAPH_DIR, 'funesterie-ecosystem-briefing.html');
  const pdfPath = path.join(GRAPH_DIR, 'funesterie-ecosystem-briefing.pdf');
  const visuals = await renderVisualAssets({ scope, briefing });

  const html = toBriefingHtml(briefing, { visuals });
  fs.writeFileSync(jsonPath, JSON.stringify(briefing, null, 2), 'utf8');
  fs.writeFileSync(executivePath, toExecutiveMarkdown(briefing, { visuals }), 'utf8');
  fs.writeFileSync(architecturePath, toArchitectureMarkdown(briefing, { visuals }), 'utf8');
  fs.writeFileSync(htmlPath, html, 'utf8');

  let pdf = null;
  if (args.pdf) {
    pdf = await writePdfWithPlaywright({ html, pdfPath });
  }

  output({
    ok: true,
    briefing: summarizeBriefing(briefing),
    files: {
      jsonPath,
      executivePath,
      architecturePath,
      htmlPath,
      visuals: visuals.map((visual) => visual.path),
      ...(pdf ? { pdfPath: pdf.ok ? pdfPath : null, pdf } : {}),
    },
  });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${filePath}: ${error.message}`);
  }
}

function readJsonOptional(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

async function renderVisualAssets({ scope, briefing }) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    return [];
  }

  const assetsDir = path.join(GRAPH_DIR, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const a11Avatar = path.join(A11_ROOT, 'frontend', 'apps', 'web', 'public', 'a11_static.png');
  const funesterieLogo = path.join(A11_ROOT, 'frontend', 'apps', 'web', 'public', 'assets', 'funesterie-logo.png');
  const visuals = [
    {
      id: 'a11-mcp-identity',
      title: 'A11 - le lien',
      path: path.join(assetsDir, 'a11-mcp-identity.png'),
      description: 'Image construite depuis l identite MCP A11 : lien entre corpus, outils, memoire, image, voix et graphe.',
      html: buildA11VisualHtml({ avatarPath: a11Avatar, briefing }),
    },
    {
      id: 'funesterie-ecosystem-identity',
      title: 'Funesterie - creer comprendre connecter',
      path: path.join(assetsDir, 'funesterie-ecosystem-identity.png'),
      description: 'Image construite depuis la definition ecosystem-scope : organisation agent-readable, corpus, boundaries, Neo4j et modules.',
      html: buildFunesterieVisualHtml({ logoPath: funesterieLogo, scope, briefing }),
    },
  ];

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const visual of visuals) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
      await page.setContent(visual.html, { waitUntil: 'load' });
      await page.screenshot({ path: visual.path, type: 'png', fullPage: false });
      await page.close();
      visual.fileUrl = fileUrl(visual.path);
      visual.markdownPath = path.relative(GRAPH_DIR, visual.path).replace(/\\/g, '/');
      delete visual.html;
    }
    return visuals;
  } catch {
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function buildA11VisualHtml({ avatarPath, briefing }) {
  const avatar = imageDataUri(avatarPath);
  return visualShell(`
    <div class="poster a11">
      <div class="grid"></div>
      <div class="orb orb-a"></div>
      <div class="orb orb-b"></div>
      <section class="left">
        <p class="eyebrow">Identite MCP</p>
        <h1>A11</h1>
        <p class="subtitle">Le lien entre corpus, outils, memoire, image, voix et graphe.</p>
        <div class="quote">"Je ne veux pas etre une immense base de connaissance. Je veux etre le lien."</div>
      </section>
      <section class="avatar-wrap">
        <img class="avatar" src="${avatar}" alt="A11">
      </section>
      <section class="right">
        <h2>Role operationnel</h2>
        <ul>
          <li>Relier les agents, les fichiers et les services.</li>
          <li>Router les demandes vers Corpus, QFlush, Neo4j et les outils.</li>
          <li>Garder une reponse precise, directe et utile.</li>
        </ul>
        <div class="chips">
          <span>Corpus</span><span>Outils</span><span>Memoire</span><span>Image</span><span>Voix</span><span>Graphe</span>
        </div>
      </section>
      <footer>${briefing.summary.sourceCards} cartes source · ${briefing.summary.corpusLinks} liens Neo4j · ${briefing.summary.totalModuleEntries} modules indexes</footer>
    </div>
  `);
}

function buildFunesterieVisualHtml({ logoPath, scope, briefing }) {
  const logo = imageDataUri(logoPath);
  return visualShell(`
    <div class="poster funesterie">
      <div class="grid"></div>
      <div class="constellation">
        ${Array.from({ length: 18 }, (_, index) => `<i style="--x:${8 + ((index * 19) % 84)}%;--y:${12 + ((index * 31) % 72)}%;--d:${2 + (index % 4)}px"></i>`).join('')}
      </div>
      <section class="brand">
        <img src="${logo}" alt="Funesterie">
      </section>
      <section class="manifest">
        <p class="eyebrow">Ecosysteme agent-readable</p>
        <h1>Funesterie</h1>
        <p class="subtitle">Creer · comprendre · connecter.</p>
        <p>Une carte vivante pour relier repos, modules, runtimes, Corpus, MCP et Neo4j sans exposer les zones sensibles.</p>
      </section>
      <section class="stats">
        <div><strong>${scope.summary?.repos || 0}</strong><span>repos</span></div>
        <div><strong>${scope.summary?.localModules || 0}</strong><span>modules locaux</span></div>
        <div><strong>${briefing.summary.totalModuleEntries}</strong><span>modules indexes</span></div>
        <div><strong>${briefing.summary.corpusLinks}</strong><span>liens corpus</span></div>
      </section>
      <footer>public-summary · private-metadata · restricted-vault</footer>
    </div>
  `);
}

function visualShell(content) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; width: 1600px; height: 900px; overflow: hidden; font-family: Inter, "Segoe UI", Arial, sans-serif; background: #030711; color: #f8fbff; }
    .poster { position: relative; width: 1600px; height: 900px; overflow: hidden; padding: 72px; background: radial-gradient(circle at 22% 22%, rgba(69, 255, 238, .16), transparent 34%), radial-gradient(circle at 80% 18%, rgba(171, 91, 255, .24), transparent 34%), linear-gradient(135deg, #030711, #071315 54%, #12051f); }
    .poster.funesterie { background: radial-gradient(circle at 24% 20%, rgba(167, 86, 255, .24), transparent 32%), radial-gradient(circle at 82% 70%, rgba(183, 131, 47, .28), transparent 30%), linear-gradient(135deg, #05040a, #11051f 55%, #030711); }
    .grid { position: absolute; inset: 0; opacity: .23; background-image: linear-gradient(rgba(117,255,239,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(117,255,239,.15) 1px, transparent 1px); background-size: 58px 58px; mask-image: radial-gradient(circle at center, black, transparent 74%); }
    .orb { position: absolute; border-radius: 999px; filter: blur(3px); opacity: .5; }
    .orb-a { width: 520px; height: 520px; left: 520px; top: 170px; border: 1px solid rgba(103, 255, 238, .45); box-shadow: 0 0 120px rgba(43, 232, 255, .25); }
    .orb-b { width: 290px; height: 290px; right: 120px; bottom: 80px; border: 1px solid rgba(178, 102, 255, .45); }
    .left, .right, .manifest, .stats, .brand { position: relative; z-index: 2; }
    .a11 { display: grid; grid-template-columns: 1fr 420px 1fr; gap: 48px; align-items: center; }
    .eyebrow { color: #6fffea; text-transform: uppercase; font-size: 18px; font-weight: 900; letter-spacing: .16em; margin: 0 0 18px; }
    h1 { font-size: 120px; line-height: .88; margin: 0 0 22px; letter-spacing: 0; }
    h2 { font-size: 34px; margin: 0 0 18px; }
    .subtitle { font-size: 31px; line-height: 1.22; margin: 0 0 28px; color: #dffdf8; }
    .quote { border-left: 4px solid #6fffea; padding: 20px 24px; font-size: 24px; line-height: 1.35; color: #f0f7ff; background: rgba(3, 11, 17, .62); }
    .avatar-wrap { position: relative; display: grid; place-items: center; width: 420px; height: 420px; border: 1px solid rgba(111,255,234,.45); background: rgba(3, 11, 17, .5); box-shadow: 0 0 80px rgba(48, 255, 235, .2); }
    .avatar { width: 320px; height: 320px; image-rendering: auto; border-radius: 28px; box-shadow: 0 0 64px rgba(111,255,234,.28); }
    ul { margin: 0 0 28px; padding-left: 24px; }
    li { font-size: 24px; line-height: 1.48; margin: 0 0 12px; color: #e8f6ff; }
    .chips { display: flex; gap: 10px; flex-wrap: wrap; }
    .chips span { border: 1px solid rgba(111,255,234,.55); color: #bafff6; padding: 10px 13px; font-size: 16px; text-transform: uppercase; font-weight: 800; background: rgba(7, 25, 28, .7); }
    footer { position: absolute; left: 72px; right: 72px; bottom: 48px; z-index: 3; border-top: 1px solid rgba(255,255,255,.18); padding-top: 18px; color: #b7c9d5; text-transform: uppercase; letter-spacing: .16em; font-size: 15px; }
    .funesterie { display: grid; grid-template-columns: 560px 1fr; grid-template-rows: 1fr auto; gap: 34px 58px; align-items: center; }
    .brand { border: 1px solid rgba(183, 131, 47, .45); background: rgba(0,0,0,.32); padding: 28px; box-shadow: 0 0 100px rgba(130, 49, 255, .18); }
    .brand img { display: block; width: 100%; }
    .manifest h1 { font-size: 104px; color: #fff3dd; text-shadow: 0 0 32px rgba(188, 97, 255, .42); }
    .manifest p:not(.eyebrow):not(.subtitle) { font-size: 27px; line-height: 1.45; color: #f3e8ff; max-width: 780px; }
    .stats { grid-column: 1 / span 2; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 76px; }
    .stats div { border: 1px solid rgba(183, 131, 47, .5); background: rgba(7, 5, 14, .7); padding: 22px 26px; }
    .stats strong { display: block; font-size: 54px; color: #ffd28a; }
    .stats span { display: block; color: #e8d6ff; text-transform: uppercase; font-size: 16px; letter-spacing: .12em; font-weight: 800; }
    .constellation i { position: absolute; left: var(--x); top: var(--y); width: var(--d); height: var(--d); border-radius: 50%; background: #d9a3ff; box-shadow: 0 0 18px #b75cff; z-index: 1; }
  </style>
</head>
<body>${content}</body>
</html>`;
}

function imageDataUri(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'png';
    const data = fs.readFileSync(filePath).toString('base64');
    return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${data}`;
  } catch {
    return '';
  }
}

function fileUrl(filePath) {
  return `file:///${path.resolve(filePath).replace(/\\/g, '/')}`;
}

async function writePdfWithPlaywright({ html, pdfPath }) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (error) {
    return { ok: false, error: 'playwright_missing', message: error.message };
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1800 } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '12mm',
        right: '10mm',
        bottom: '12mm',
        left: '10mm',
      },
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: 'pdf_generation_failed', message: String(error.message || error).slice(0, 300) };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function parseArgs(argv) {
  return {
    pdf: argv.includes('--pdf'),
  };
}

function output(value) {
  console.log(JSON.stringify(value, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
  });
}
