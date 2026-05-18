# A11 — AI Coding Agent

**The best AI coding agent for VS Code. Powered by A11/funesterie.**

> Du chaos de l'information à la clarté du sens.

## Features

- 🤖 **Chat AI** — Conversational AI assistant directly in VS Code
- 🔍 **Explain Code** — Understand any code snippet instantly
- 🐛 **Fix Errors** — Automatically diagnose and fix bugs
- ♻️ **Refactor** — Clean and modernize your code
- ✨ **Generate Code** — Create code from natural language descriptions
- 🧪 **Generate Tests** — Auto-generate unit and integration tests
- 👁️ **Code Review** — Get expert feedback on your code
- 📝 **Commit Messages** — Generate meaningful git commit messages
- 📚 **Documentation** — Auto-generate JSDoc/TSDoc/docstrings
- ⚡ **Optimize** — Performance analysis and improvements
- 🔒 **Security Audit** — Detect vulnerabilities and security issues
- 💬 **Inline Chat** — Chat directly in the editor (Ctrl+I)

## Getting Started

### Trial Mode

Use A11 for free with **50 requests** — no account required.

### Full Access

Sign in with Google or create an account for unlimited access.

- **Free**: 50 requests
- **Premium**: 149 EUR/month — creation tokens

## Commands

| Command                   | Shortcut       | Description                |
| ------------------------- | -------------- | -------------------------- |
| A11: Chat                 | `Ctrl+Shift+A` | Open chat panel            |
| A11: Expliquer le code    | `Ctrl+Shift+E` | Explain selected code      |
| A11: Corriger les erreurs | `Ctrl+Shift+F` | Fix errors in current file |
| A11: Chat inline          | `Ctrl+I`       | Inline chat in editor      |

## Context Menu

Right-click in the editor to access A11 commands:

- Explain, Fix, Refactor, Generate, Test, Review, Docs, Optimize, Security

## Configuration

```json
{
  "a11.serverUrl": "https://a11.funesterie.me",
  "a11.model": "gpt-4o-mini",
  "a11.autoSuggest": true,
  "a11.theme": "auto"
}
```

## Requirements

- VS Code 1.85.0 or higher
- Internet connection (for cloud LLM)

## Privacy

Your code is sent to the A11 backend for processing. The chat web surface lives at [a11.funesterie.me](https://a11.funesterie.me); the production VSIX endpoint is [a11.funesterie.me](https://a11.funesterie.me).

---

Made with ❤️ by [funesterie](https://funesterie.me)
