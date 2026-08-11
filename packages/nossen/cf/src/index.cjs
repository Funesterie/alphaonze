'use strict';
// Minimal Cloudflare API client for agents. Auth: Bearer CLOUDFLARE_API_TOKEN (env or ctor).
const API = 'https://api.cloudflare.com/client/v4';
function token(opt) { return (opt && opt.token) || process.env.CLOUDFLARE_API_TOKEN || ''; }
async function cfFetch(path, { method = 'GET', body, token: t } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + token({ token: t }), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, json };
}
async function verifyToken(t) { return cfFetch('/user/tokens/verify', { token: t }); }
async function accounts(t) { return cfFetch('/accounts', { token: t }); }
async function listZones(t) { return cfFetch('/zones?per_page=50', { token: t }); }
async function getZone(name, t) { return cfFetch('/zones?name=' + encodeURIComponent(name), { token: t }); }
async function listDNSRecords(zoneId, t) { return cfFetch('/zones/' + zoneId + '/dns_records?per_page=100', { token: t }); }
async function createDNSRecord(zoneId, r, t) { return cfFetch('/zones/' + zoneId + '/dns_records', { method: 'POST', body: r, token: t }); }
async function listTunnels(accountId, t) { return cfFetch('/accounts/' + accountId + '/cfd_tunnel?per_page=50', { token: t }); }
async function listAccessApps(accountId, t) { return cfFetch('/accounts/' + accountId + '/access/apps', { token: t }); }
async function listR2Buckets(accountId, t) { return cfFetch('/accounts/' + accountId + '/r2/buckets', { token: t }); }
module.exports = { cfFetch, verifyToken, accounts, listZones, getZone, listDNSRecords, createDNSRecord, listTunnels, listAccessApps, listR2Buckets };
