# @funeste/mcp-security-preflight-nossen

Private Funeste/NOSSEN wrapper for `@nossen/mcp-security-preflight@0.1.1`.

This restricted package provides workspace presets for the Funeste MCP endpoints. It does not contain tokens, passwords, private keys, webhook secrets, or operator credentials. Runtime authentication must come from environment variables, local vaults, npm auth, or provider dashboards.

## Install

```bash
npm install @funeste/mcp-security-preflight-nossen
```

## Usage

```js
const mcp = require("@funeste/mcp-security-preflight-nossen");
const client = mcp.createFunesteClient({ tokenProvider: () => process.env.MCP_AUTH_TOKEN });
```

## Support NOSSEN

Support is voluntary. Choose the amount that fits your situation.

- Email: funeste38@gmail.com
- Wero: +33 7 83 46 37 61
- PayPal: https://paypal.me/funeste38
- Card / Stripe: https://funesterie.me/subscription
- Contact: https://funesterie.me/contact/
