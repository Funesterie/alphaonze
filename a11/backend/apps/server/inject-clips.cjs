'use strict';
const fs = require('fs');
const f = '/app/server.cjs';
let c = fs.readFileSync(f, 'utf8');
if (c.includes('clips-addon.cjs')) { console.log('ALREADY_PATCHED'); process.exit(0); }
const marker = '// Fallback: ensure server starts';
const i = c.indexOf(marker);
if (i === -1) { console.error('MARKER_NOT_FOUND'); process.exit(1); }
const inject = 'try{require("./clips-addon.cjs")(app)}catch(e){console.warn("[clips-addon]",e.message)}\n';
c = c.slice(0, i) + inject + c.slice(i);
fs.writeFileSync(f, c);
console.log('INJECTED');
