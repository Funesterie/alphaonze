const DEFAULT_SHELL_ENTRIES = [
  { example: 'git status', tool: 'git', pattern: /^git status\b/i },
  { example: 'git diff', tool: 'git', pattern: /^git diff\b/i },
  { example: 'npm test', tool: 'npm', pattern: /^npm test\b/i },
  { example: 'npm run build', tool: 'npm', pattern: /^npm run build\b/i },
  { example: 'dotnet --info', tool: 'dotnet', pattern: /^dotnet --info\b/i },
  { example: 'dotnet --version', tool: 'dotnet', pattern: /^dotnet --version\b/i },
  { example: 'dotnet build', tool: 'dotnet', pattern: /^dotnet build\b/i }
];

const DEFAULT_SHELL_WHITELIST = DEFAULT_SHELL_ENTRIES.map((entry) => entry.pattern);

function getExtraShellPrefixes() {
  return String(process.env.A11_SHELL_ALLOWLIST || '')
    .split(/[\r\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isShellAllowed(cmd) {
  if (!cmd || typeof cmd !== 'string') return false;
  const normalized = cmd.trim();
  if (!normalized) return false;

  if (DEFAULT_SHELL_WHITELIST.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const lowered = normalized.toLowerCase();
  return getExtraShellPrefixes().some((prefix) => lowered.startsWith(prefix.toLowerCase()));
}

function getShellAllowlistSummary() {
  return {
    defaultExamples: DEFAULT_SHELL_ENTRIES.map((entry) => entry.example),
    extraPrefixes: getExtraShellPrefixes()
  };
}

function getShellAllowlistEntries() {
  return DEFAULT_SHELL_ENTRIES.map((entry) => ({ ...entry }));
}

function getShellToolName(command) {
  const normalized = String(command || '').trim();
  if (!normalized) return null;
  const matched = DEFAULT_SHELL_ENTRIES.find((entry) => entry.pattern.test(normalized));
  return matched?.tool || null;
}

function assertShellAllowed(cmd, label = 'command') {
  if (isShellAllowed(cmd)) return;

  const summary = getShellAllowlistSummary();
  const allowed = [...summary.defaultExamples, ...summary.extraPrefixes];
  throw new Error(`${label} not allowed by whitelist: "${cmd}". Allowed prefixes/examples: ${allowed.join(', ')}`);
}

module.exports = {
  isShellAllowed,
  assertShellAllowed,
  getShellAllowlistSummary,
  getShellAllowlistEntries,
  getShellToolName
};
