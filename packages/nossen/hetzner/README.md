# @nossen/hetzner

**Hetzner Robot API client** for the Funesterie AIs — manage dedicated servers (like EX44 / Kaen44) over **443, no SSH**.

## Install
```bash
npm install @nossen/hetzner
```

## Auth
Set `HETZNER_ROBOT_USER` (your Robot username, e.g. `K0511689026`) + `HETZNER_ROBOT_PASS` (your Robot password or API token) as env vars.

## API
```js
const h = require('@nossen/hetzner');
await h.listServers();                  // list dedicated servers (EX44 shows up here)
await h.getServer('2956114');           // one server
await h.reboot('2956114');              // reboot
await h.getRescue('2956114');           // rescue boot status
await h.enableRescue('2956114','linux');// enable rescue
await h.setReverseDns('37.27.63.109','kaen44.funesterie.me');
```

## CLI
```bash
nossen-hetzner servers | server <id> | reboot <id> | rescue <id>
```

## License
MIT.

---

Part of [`@nossen/all-in-one`](https://www.npmjs.com/package/@nossen/all-in-one) — the whole NOSSEN / Funesterie AI toolkit in one import.
