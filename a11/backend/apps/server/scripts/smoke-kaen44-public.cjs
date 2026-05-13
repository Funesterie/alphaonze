#!/usr/bin/env node
'use strict';

const http = require('node:http');
const https = require('node:https');

const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 30000);

const a11Base = (process.env.A11_PUBLIC_BASE || 'https://a11.funesterie.pro').replace(/\/$/, '');
const kaen44Base = (process.env.KAEN44_PUBLIC_BASE || 'https://k44.funesterie.me').replace(/\/$/, '');
const funesterieBase = (process.env.FUNESTERIE_PUBLIC_BASE || 'https://funesterie.me').replace(/\/$/, '');
const renderBase = (process.env.KAEN44_RENDER_BASE || 'https://kaen44-api.onrender.com').replace(/\/$/, '');
const originBase = (process.env.KAEN44_ORIGIN_BASE || '').replace(/\/$/, '');

const checks = [
  {
    name: 'A11 health',
    url: `${a11Base}/health`,
    status: 200,
  },
  {
    name: 'A11 Cerbere stats',
    url: `${a11Base}/api/llm/stats`,
    status: 200,
    jsonService: 'cerbere-router',
  },
  {
    name: 'A11 public MCP manifest',
    url: `${a11Base}/mcp`,
    status: 200,
    jsonKind: 'a11_public_mcp',
  },
  {
    name: 'Kaen44 health',
    url: `${kaen44Base}/health`,
    status: 200,
    viaCaddy: true,
  },
  {
    name: 'Kaen44 root page',
    url: `${kaen44Base}/`,
    status: 200,
    contains: '<title>Kaen44 - Assistante bureau Funesterie</title>',
    viaCaddy: true,
  },
  {
    name: 'Kaen44 Cerbere stats',
    url: `${kaen44Base}/api/llm/stats`,
    status: 200,
    jsonService: 'cerbere-router',
    viaCaddy: true,
  },
  {
    name: 'Kaen44 public MCP manifest',
    url: `${kaen44Base}/mcp`,
    status: 200,
    jsonKind: 'a11_public_mcp',
    viaCaddy: true,
  },
  {
    name: 'Funesterie public API route',
    url: `${funesterieBase}/api/llm/stats`,
    status: 200,
    jsonService: 'cerbere-router',
    viaCaddy: true,
  },
  {
    name: 'Render fallback health',
    url: `${renderBase}/health`,
    status: 200,
  },
  {
    name: 'Render fallback Cerbere stats',
    url: `${renderBase}/api/llm/stats`,
    status: 200,
    jsonService: 'cerbere-router',
  },
];

if (originBase) {
  checks.push({
    name: 'Hetzner Caddy host route',
    url: `${originBase}/api/llm/stats`,
    status: 200,
    headers: { Host: 'k44.funesterie.me' },
    jsonService: 'cerbere-router',
  });
}

function get(urlString, headers = {}) {
  const url = new URL(urlString);
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(url, { method: 'GET', headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      let bytes = 0;

      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) {
          req.destroy(new Error(`response too large for smoke check: ${urlString}`));
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end();
  });
}

function assertCheck(check, response) {
  if (response.statusCode !== check.status) {
    throw new Error(`expected ${check.status}, got ${response.statusCode}`);
  }

  if (check.viaCaddy) {
    const via = String(response.headers.via || '');
    if (!via.includes('Caddy')) {
      throw new Error(`expected via header to include Caddy, got ${via || '<empty>'}`);
    }
  }

  if (check.contains && !response.body.includes(check.contains)) {
    throw new Error(`expected response body to contain ${JSON.stringify(check.contains)}`);
  }

  if (check.jsonService) {
    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch (error) {
      throw new Error(`expected JSON response: ${error.message}`);
    }

    if (parsed.service !== check.jsonService) {
      throw new Error(`expected service ${check.jsonService}, got ${parsed.service || '<missing>'}`);
    }
  }

  if (check.jsonKind) {
    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch (error) {
      throw new Error(`expected JSON response: ${error.message}`);
    }

    if (parsed.kind !== check.jsonKind) {
      throw new Error(`expected kind ${check.jsonKind}, got ${parsed.kind || '<missing>'}`);
    }
  }
}

async function main() {
  let failures = 0;

  for (const check of checks) {
    try {
      const response = await get(check.url, check.headers);
      assertCheck(check, response);
      const via = response.headers.via ? ` via=${response.headers.via}` : '';
      console.log(`ok ${check.name} ${response.statusCode}${via}`);
    } catch (error) {
      failures += 1;
      console.error(`not ok ${check.name}: ${error.message}`);
    }
  }

  if (failures) {
    console.error(`Kaen44 smoke failed: ${failures}/${checks.length} checks failed`);
    process.exitCode = 1;
    return;
  }

  console.log(`Kaen44 smoke passed: ${checks.length}/${checks.length} checks passed`);
}

main().catch((error) => {
  console.error(`Kaen44 smoke crashed: ${error.message}`);
  process.exitCode = 1;
});
