import * as fs from 'fs';

export type SecretMatch = {
  pattern: string;
  line: number;
  index: number;
  snippet: string;
};

function makeMatch(pattern: string, lineNum: number, index: number, snippet: string): SecretMatch {
  return { pattern, line: lineNum, index, snippet };
}

export async function scanFileForSecrets(filePath: string): Promise<SecretMatch[]> {
  try {
    const data = await fs.promises.readFile(filePath, 'utf8');
    const lines = data.split(/\r?\n/);
    const regex = /(api[_-]?key|apikey|secret|password|token|access[_-]?token|private[_-]?key)/i;
    const matches: SecretMatch[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = regex.exec(line);
      if (m) {
        matches.push(makeMatch(m[0], i + 1, m.index, line.trim()));
      }
    }
    return matches;
  } catch (e) {
    return [];
  }
}
