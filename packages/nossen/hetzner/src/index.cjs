'use strict';
// Hetzner Robot API client (dedicated servers like EX44). Auth: HTTP Basic (HETZNER_ROBOT_USER : HETZNER_ROBOT_PASS).
// HETZNER_ROBOT_PASS may be a Robot API token created in Robot settings. Base: https://robot.hetzner.com (443, no SSH).
const BASE = 'https://robot.hetzner.com';
function creds(opt) {
  const user = (opt && opt.user) || process.env.HETZNER_ROBOT_USER || '';
  const pass = (opt && opt.pass) || process.env.HETZNER_ROBOT_PASS || process.env.HETZNER_API_TOKEN || '';
  return { user, pass };
}
async function robotFetch(path, { method = 'GET', body, ...opt } = {}) {
  const { user, pass } = creds(opt);
  const auth = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
  const res = await fetch(BASE + path, { method, headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: body ? new URLSearchParams(body).toString() : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, json, text };
}
async function listServers(opt) { return robotFetch('/server', opt); }
async function getServer(id, opt) { return robotFetch('/server/' + id, opt); }
async function reboot(id, opt) { return robotFetch('/server/' + id + '/reboot', { method: 'POST', ...opt }); }
async function getRescue(id, opt) { return robotFetch('/boot/' + id + '/rescue', opt); }
async function enableRescue(id, os, opt) { return robotFetch('/boot/' + id + '/rescue', { method: 'POST', body: { os: os || 'linux' }, ...opt }); }
async function setReverseDns(ip, ptr, opt) { return robotFetch('/server/' + ip, { method: 'POST', body: { server_ip: ip, ptr }, ...opt }); }
module.exports = { robotFetch, listServers, getServer, reboot, getRescue, enableRescue, setReverseDns };
