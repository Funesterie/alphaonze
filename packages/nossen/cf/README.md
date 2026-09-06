# @nossen/cf

Tiny **Cloudflare API client** for the Funesterie AIs. One `CLOUDFLARE_API_TOKEN`, no browser, no SDK bloat.

## Install
```bash
npm install @nossen/cf
```

## Auth
Set `CLOUDFLARE_API_TOKEN` (env). Create one at https://dash.cloudflare.com/profile/api-tokens.

## API
```js
const cf = require('@nossen/cf');
await cf.verifyToken();                       // check the token
await cf.accounts();                          // list accounts
await cf.listZones();                         // list zones
await cf.getZone('funesterie.me');            // find a zone by name
await cf.listDNSRecords(zoneId);              // list DNS records
await cf.createDNSRecord(zoneId, { type:'A', name:'test', content:'1.2.3.4' });
await cf.listTunnels(accountId);             // Cloudflare Tunnels
await cf.listAccessApps(accountId);           // Zero Trust Access apps
await cf.listR2Buckets(accountId);            // R2 buckets
```

## CLI
```bash
nossen-cf whoami | accounts | zones | dns <zone> | tunnels | access | r2
```

## License
MIT.

---

Part of [`@nossen/all-in-one`](https://www.npmjs.com/package/@nossen/all-in-one) — the whole NOSSEN / Funesterie AI toolkit in one import.
