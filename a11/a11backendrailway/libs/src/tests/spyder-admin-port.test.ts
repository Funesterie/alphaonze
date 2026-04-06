import { describe, it, expect } from 'vitest';
import fs from 'fs';
import * as path from 'path';

describe('Spyder admin port config', () => {
  it('writes .qflush/spyder.config.json with adminPort', () => {
    const cfgPath = path.join(process.cwd(), '.qflush', 'spyder.config.json');
    const adminPort = '12345';
    process.env.QFLUSH_SPYDER_ADMIN_PORT = adminPort;
    fs.writeFileSync(cfgPath, JSON.stringify({ adminPort }), 'utf8');
    expect(fs.existsSync(cfgPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    expect(config.adminPort).toBe(adminPort);
  });
});
