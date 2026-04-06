// ROME-TAG: 0xFC1834

import * as fs from 'fs';

export type LogicRule = {
  name: string;
  when: string; // original expression
  do: string;
  version?: number;
  priority?: number;
  schedule?: string;
};

export function parseLogicFile(filePath: string): LogicRule[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith('#'));
  const rules: LogicRule[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('rule ')) {
      const m = /^rule\s+(\w+)\s*\{/.exec(l);
      if (!m) { i++; continue; }
      const name = m[1];
      i++;
      let when = '';
      let action = '';
      let version: number | undefined = undefined;
      let priority: number | undefined = undefined;
      let schedule: string | undefined = undefined;
      while (i < lines.length && !lines[i].startsWith('}')) {
        const ln = lines[i];
        if (ln.startsWith('when ')) when = ln.slice('when '.length).trim();
        if (ln.startsWith('do ')) action = ln.slice('do '.length).trim();
        if (ln.startsWith('version ')) {
          const v = Number(ln.slice('version '.length).trim());
          if (!isNaN(v)) version = v;
        }
        if (ln.startsWith('priority ')) {
          const p = Number(ln.slice('priority '.length).trim());
          if (!isNaN(p)) priority = p;
        }
        if (ln.startsWith('schedule ')) {
          schedule = ln.slice('schedule '.length).trim();
        }
        i++;
      }
      i++;
      rules.push({ name, when, do: action, version, priority, schedule });
    } else {
      i++;
    }
  }
  return rules;
}

// AST node types for condition expressions
type ASTCmp = { type: 'cmp'; left: string; op: '=='; right: string };
type ASTId = { type: 'id'; name: string };
type ASTNot = { type: 'not'; expr: ASTNode };
type ASTAnd = { type: 'and'; left: ASTNode; right: ASTNode };
type ASTOr = { type: 'or'; left: ASTNode; right: ASTNode };
export type ASTNode = ASTCmp | ASTId | ASTNot | ASTAnd | ASTOr;

// Very small expression parser for when expressions supporting variables and precedence
// grammar: expr := orExpr
// orExpr := andExpr ('or' andExpr)*
// andExpr := notExpr ('and' notExpr)*
// notExpr := 'not' notExpr | primary
// primary := '(' expr ')' | comparison
// comparison := identifier '==' string | identifier

function tokenize(s: string) {
  const tokens: string[] = [];
  const re = /\s*(=>|==|\(|\)|\band\b|\bor\b|\bnot\b|[\w.]+|"[^"]*")\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) tokens.push(m[1]);
  return tokens;
}

function parseExpr(tokens: string[]): ASTNode {
  let i = 0;
  function peek() { return tokens[i]; }
  function consume() { return tokens[i++]; }

  function parsePrimary(): ASTNode {
    const t = peek();
    if (t === '(') { consume(); const node = parseOr(); if (peek() === ')') consume(); return node; }
    const id = consume();
    if (peek() === '==') {
      consume();
      const val = consume();
      return { type: 'cmp', left: id, op: '==', right: val.replace(/^"|"$/g, '') } as ASTCmp;
    }
    return { type: 'id', name: id } as ASTId;
  }

  function parseNot(): ASTNode {
    if (peek() === 'not') { consume(); return { type: 'not', expr: parseNot() } as ASTNot; }
    return parsePrimary();
  }

  function parseAnd(): ASTNode {
    let left: ASTNode = parseNot();
    while (peek() === 'and') {
      consume(); const right = parseNot(); left = { type: 'and', left, right } as ASTAnd; }
    return left;
  }

  function parseOr(): ASTNode {
    let left: ASTNode = parseAnd();
    while (peek() === 'or') { consume(); const right = parseAnd(); left = { type: 'or', left, right } as ASTOr; }
    return left;
  }

  const ast = parseOr();
  return ast;
}

export function evaluateConditionExprAST(ast: ASTNode, ctx: any): boolean {
  if (!ast) return false;
  switch (ast.type) {
    case 'cmp': {
      const left = ast.left; const right = ast.right;
      const val = resolveIdentifier(left, ctx);
      return String(val) === right;
    }
    case 'id': return !!resolveIdentifier(ast.name, ctx);
    case 'not': return !evaluateConditionExprAST(ast.expr, ctx);
    case 'and': return evaluateConditionExprAST(ast.left, ctx) && evaluateConditionExprAST(ast.right, ctx);
    case 'or': return evaluateConditionExprAST(ast.left, ctx) || evaluateConditionExprAST(ast.right, ctx);
    default: return false;
  }
}

function resolveIdentifier(id: string, ctx: any) {
  // support file.type, file.tagChanged, rome.index.updated
  if (id.startsWith('file.')) {
    const k = id.slice('file.'.length);
    return ctx.file ? (ctx.file as any)[k] : undefined;
  }
  if (id === 'rome.index.updated') return ctx.romeIndexUpdated;
  return undefined;
}

export function buildConditionAst(expr: string): ASTNode {
  const tokens = tokenize(expr);
  return parseExpr(tokens);
}

export function evaluateConditionExpr(expr: string, ctx: any): boolean {
  try {
    const ast = buildConditionAst(expr);
    return evaluateConditionExprAST(ast, ctx);
  } catch (e) { return false; }
}
