# A11 Memory Base

Local Docker memory database for A11/Codex collaboration history.

It stores imported ChatGPT exports and Codex session logs in a private local Postgres database with pgvector enabled for later embeddings. The importer redacts obvious secrets by default before writing content.

## Start

```powershell
cd D:\projets\funesterie\a11\backend\apps\memory-base
docker compose up -d
```

Default local database URL:

```env
postgres://a11:a11_memory_local_change_me@127.0.0.1:5437/a11_memory
```

## Import local Codex sessions

```powershell
node .\scripts\import-history.cjs --init --codex-local --account local-codex-djeff
```

## Import ChatGPT exports

Export your ChatGPT data from each account, then pass either the unzipped export directory, the `conversations.json` file, or the `.zip` export:

```powershell
node .\scripts\import-history.cjs --input "C:\Users\Djeff\Downloads\chatgpt-export" --provider chatgpt --account compte-perso
node .\scripts\import-history.cjs --input "C:\Users\Djeff\Downloads\chatgpt-export.zip" --provider chatgpt --account compte-pro
```

You can also drop exports into `backend/apps/memory-base/imports/`; that folder is ignored by git so private histories do not get committed.

## Import local corpus

The importer can also index local `.md`, `.txt`, and `.json` corpus files:

```powershell
node .\scripts\import-history.cjs --init --provider corpus --account funesterie-corpus --input "D:\projets\funesterie\runtime\Corpus" --input "D:\projets\funesterie\docs" --input "D:\projets\funesterie\a11\runtime\knowledge-graph"
```

This is useful while waiting for ChatGPT account exports to become available.

## Search

```powershell
node .\scripts\search-memory.cjs "docker a11 tts"
```

## Privacy model

- Imports only local files you provide or the current local Codex session folder when `--codex-local` is used.
- Does not log message contents during import.
- Redacts common API keys, bearer tokens, passwords, private keys and JWT-like blobs before storage.
- Keeps source file paths and hashes for traceability.
