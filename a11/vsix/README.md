# A11 Coder

A11 Coder is the NOSSEN coding assistant for VS Code-compatible editors, including Kiro.

It connects the editor to the A11 backend at `https://a11.funesterie.me` and keeps the day-to-day coding loop close to the workspace: chat, explain, fix, refactor, review, tests, docs, and security checks.

> Du chaos de l'information a la clarte du sens.

## Install

```sh
npm i a11-coder
```

For local VSIX development:

```sh
npm install
npm run compile
npm run package
```

## Kiro and VS Code

A11 Coder is built for VS Code-compatible extension hosts. In Kiro, install or package the extension the same way you would a VS Code VSIX, then point the `a11.serverUrl` setting at the production backend or at a local A11 server while developing.

Recommended production setting:

```json
{
  "a11.serverUrl": "https://a11.funesterie.me",
  "a11.model": "gpt-4o-mini",
  "a11.autoSuggest": true,
  "a11.theme": "auto"
}
```

## What It Does

- Chat with A11 from the editor sidebar.
- Explain selected code and unfamiliar files.
- Fix errors, refactor, and generate code from natural language.
- Generate tests, docs, and commit messages.
- Review code for quality, performance, and security risks.
- Use inline chat with `Ctrl+I` when the editor has focus.

## Commands

| Command | Shortcut | Description |
| --- | --- | --- |
| `A11: Chat` | `Ctrl+Shift+A` | Open the A11 chat panel |
| `A11: Expliquer le code` | `Ctrl+Shift+E` | Explain selected code |
| `A11: Corriger les erreurs` | `Ctrl+Shift+F` | Diagnose and fix the current file |
| `A11: Chat inline` | `Ctrl+I` | Ask A11 in place from the editor |

## NOSSEN Modules

The maintained module namespace is `@nossen/*`.

Use that scope for current packages, docs, examples, and future integrations. Older public names are not the canonical path anymore.

## Access and Privacy

Cloud features send the selected prompt, file context, and editor request to the configured A11 backend for processing. Do not send secrets, private keys, recovery codes, or production credentials through chat prompts.

Private/admin capabilities are expected to sit behind account login and scoped access. Public docs should only reference public endpoints.

## Support and Donations

A11 Coder is part of the Funesterie/NOSSEN project. If it saves you time or helps your work, choose any support amount that fits your situation. Contributions support infrastructure, releases, and maintenance:

- Contact, invoice, sponsorship or urgent support: https://funesterie.me/contact/
- Email: funeste38@gmail.com
- Wero: `+33 7 83 46 37 61`
- PayPal: https://paypal.me/funeste38
- Stripe/card support: https://buy.stripe.com/7sYfZhfKW2DSffZgWU7Re01

Support is voluntary; there is no fixed package price.

## Links

- Site: https://funesterie.me
- A11: https://a11.funesterie.me
- Contact: https://funesterie.me/contact/
