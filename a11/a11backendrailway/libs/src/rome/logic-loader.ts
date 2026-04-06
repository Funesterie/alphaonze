// ROME-TAG: 0xD4EB1C

import * as path from 'path';
import * as fs from 'fs';
import { parseLogicFile, LogicRule, evaluateConditionExpr, buildConditionAst, evaluateConditionExprAST } from './logic-parser.js';
import { RomeIndex, RomeTagRecord } from './rome-tag.js';

const LOGIC_PATH = path.join(process.cwd(), '.qflush', 'logic.qfl');
const VARS_PATH = path.join(process.cwd(), '.qflush', 'logic-vars.json');

let rules: LogicRule[] = [];
let vars: Record<string,string> = {};

function loadVars() {
  try {
    if (fs.existsSync(VARS_PATH)) { vars = JSON.parse(fs.readFileSync(VARS_PATH,'utf8') || '{}'); }
  } catch (e) { vars = {}; }
}

function substitute(s: string) {
  if (!s) return s;
  // ${VAR} substitution from vars then from process.env
  return s.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, name) => {
    if (vars && typeof vars[name] !== 'undefined') return vars[name];
    if (process.env[name]) return process.env[name] as string;
    return '';
  });
}

export function loadLogicRules(): LogicRule[] {
  // prefer .qflush/logic.qfl then src/rome/logic/logic.qfl
  const alt = path.join(process.cwd(), 'src', 'rome', 'logic', 'logic.qfl');
  const p = fs.existsSync(LOGIC_PATH) ? LOGIC_PATH : alt;
  if (!fs.existsSync(p)) { rules = []; return rules; }
  try {
    loadVars();
    const parsed = parseLogicFile(p);
    // apply substitutions and keep schedule/version/priority
    rules = parsed.map(r => ({ ...r, when: substitute(r.when), do: substitute(r.do) }));
  } catch (e) { rules = []; }
  return rules;
}

export function evaluateRulesForRecord(index: RomeIndex, rec: RomeTagRecord, changedPaths: string[] = []) {
  const matched: { rule: string; actions: string[] }[] = [];
  for (const r of rules) {
    const cond = r.when || '';
    try {
      const ast = buildConditionAst(cond);
      const ctx = { file: rec, romeIndexUpdated: (changedPaths && changedPaths.length>0) };
      const ok = evaluateConditionExprAST(ast, ctx);
      if (ok) matched.push({ rule: r.name, actions: [r.do] });
    } catch (e) {
      // ignore parse/eval errors per-rule
    }
  }
  return matched;
}

export function evaluateAllRules(index: RomeIndex, changedPaths: string[] = []) {
  const actions: { path: string; actions: string[]; rule: string }[] = [];
  for (const rec of Object.values(index)) {
    const a = evaluateRulesForRecord(index, rec as any, changedPaths);
    for (const m of a) actions.push({ path: (rec as any).path, actions: m.actions, rule: m.rule });
  }
  // future: sort by priority/version
  return actions;
}

export function getRules() { return rules; }
