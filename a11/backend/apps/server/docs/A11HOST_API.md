# A11Host API - Tests et Documentation

## ✅ Endpoints disponibles

### 📊 Analyse de code

#### GET `/api/v1/vs/compilation-errors`
Récupère les erreurs de compilation de la solution.

**Response:**
```json
{
  "ok": true,
  "errors": [
    { "rawLine": "path(10,5): error CS0000: message" }
  ]
}
```

**Test:**
```sh
curl http://localhost:3000/api/v1/vs/compilation-errors
```

---

#### GET `/api/v1/vs/project-structure`
Récupère la structure complète du projet.

**Response:**
```json
{
  "ok": true,
  "solution": "MySolution",
  "solutionPath": "C:\\path\\MySolution.sln",
  "projectCount": 3,
  "projects": [
    {
      "name": "MyProject",
      "path": "C:\\path\\MyProject.csproj",
      "kind": "{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}",
      "files": ["C:\\path\\File1.cs"]
    }
  ]
}
```

**Test:**
```sh
curl http://localhost:3000/api/v1/vs/project-structure
```

---

#### GET `/api/v1/vs/solution-info`
Récupère les informations sur la solution.

**Response:**
```json
{
  "ok": true,
  "name": "MySolution",
  "path": "C:\\path\\MySolution.sln",
  "projectCount": 3,
  "isOpen": true
}
```

**Test:**
```sh
curl http://localhost:3000/api/v1/vs/solution-info
```

---

#### GET `/api/v1/vs/active-document`
Récupère le document actif avec position du curseur.

**Response:**
```json
{
  "ok": true,
  "path": "C:\\path\\File.cs",
  "name": "File.cs",
  "line": 42,
  "column": 12,
  "selectedText": "public void Method()"
}
```

**Test:**
```sh
curl http://localhost:3000/api/v1/vs/active-document
```

---

#### GET `/api/v1/vs/current-selection`
Récupère le texte actuellement sélectionné.

**Response:**
```json
{
  "ok": true,
  "text": "public void Method() { }"
}
```

**Test:**
```sh
curl http://localhost:3000/api/v1/vs/current-selection
```

---

### ✏️ Édition de code

#### POST `/api/v1/vs/insert-at-cursor`
Insère du texte à la position du curseur.

**Request:**
```json
{
  "text": "// TODO: implement this"
}
```

**Response:**
```json
{
  "ok": true,
  "success": true
}
```

**Test:**
```sh
curl -X POST http://localhost:3000/api/v1/vs/insert-at-cursor \
  -H "Content-Type: application/json" \
  -d '{"text":"// TODO: implement this"}'
```

---

#### POST `/api/v1/vs/replace-selection`
Remplace le texte sélectionné.

**Request:**
```json
{
  "newText": "public void NewMethod() { }"
}
```

**Response:**
```json
{
  "ok": true,
  "success": true
}
```

**Test:**
```sh
curl -X POST http://localhost:3000/api/v1/vs/replace-selection \
  -H "Content-Type: application/json" \
  -d '{"newText":"public void NewMethod() { }"}'
```

---

### 📁 Gestion de fichiers

#### DELETE `/api/v1/vs/file`
Supprime un fichier (avec validation workspace).

**Request:**
```json
{
  "path": "C:\\workspace\\temp\\test.cs"
}
```

**Response:**
```json
{
  "ok": true,
  "success": true,
  "path": "C:\\workspace\\temp\\test.cs"
}
```

**Test:**
```sh
curl -X DELETE http://localhost:3000/api/v1/vs/file \
  -H "Content-Type: application/json" \
  -d '{"path":"C:\\workspace\\temp\\test.cs"}'
```

---

#### PUT `/api/v1/vs/file/rename`
Renomme/déplace un fichier (avec validation workspace).

**Request:**
```json
{
  "oldPath": "C:\\workspace\\old.cs",
  "newPath": "C:\\workspace\\new.cs"
}
```

**Response:**
```json
{
  "ok": true,
  "success": true,
  "oldPath": "C:\\workspace\\old.cs",
  "newPath": "C:\\workspace\\new.cs"
}
```

**Test:**
```sh
curl -X PUT http://localhost:3000/api/v1/vs/file/rename \
  -H "Content-Type: application/json" \
  -d '{"oldPath":"C:\\workspace\\old.cs","newPath":"C:\\workspace\\new.cs"}'
```

---

### 🔧 Méthodes existantes

#### GET `/api/v1/vs/workspace-root`
Récupère la racine du workspace.

**Test:**
```sh
curl http://localhost:3000/api/v1/vs/workspace-root
```

---

#### POST `/api/v1/vs/open-file`
Ouvre un fichier dans Visual Studio.

**Request:**
```json
{
  "path": "C:\\workspace\\File.cs"
}
```

**Test:**
```sh
curl -X POST http://localhost:3000/api/v1/vs/open-file \
  -H "Content-Type: application/json" \
  -d '{"path":"C:\\workspace\\File.cs"}'
```

---

#### POST `/api/v1/vs/goto-line`
Va à une ligne spécifique.

**Request:**
```json
{
  "path": "C:\\workspace\\File.cs",
  "line": 42
}
```

**Test:**
```sh
curl -X POST http://localhost:3000/api/v1/vs/goto-line \
  -H "Content-Type: application/json" \
  -d '{"path":"C:\\workspace\\File.cs","line":42}'
```

---

#### POST `/api/v1/vs/build`
Lance le build de la solution.

**Test:**
```sh
curl -X POST http://localhost:3000/api/v1/vs/build
```

---

#### GET `/api/v1/vs/open-documents`
Liste les documents ouverts.

**Test:**
```sh
curl http://localhost:3000/api/v1/vs/open-documents
```

---

#### POST `/api/v1/vs/execute-shell`
Exécute une commande shell.

Cette route est protegée par une whitelist de commandes safe.

**Request:**
```json
{
  "command": "git status"
}
```

**Test:**
```sh
curl -X POST http://localhost:3000/api/v1/vs/execute-shell \
  -H "Content-Type: application/json" \
  -d '{"command":"git status"}'
```

---

#### GET `/api/v1/vs/status`
Vérifie si le pont A11Host est disponible.

**Response:**
```json
{
  "ok": true,
  "available": true,
  "methods": ["GetCompilationErrors", "GetProjectStructure", ...]
}
```

**Test:**
```sh
curl http://localhost:3000/api/v1/vs/status
```

---

## 🧪 Tests Frontend (TypeScript)

```typescript
import a11fs from '@/lib/a11fs';

// Analyse de code
const errors = await a11fs.getCompilationErrors();
const structure = await a11fs.getProjectStructure();
const solutionInfo = await a11fs.getSolutionInfo();
const activeDoc = await a11fs.getActiveDocument();
const selection = await a11fs.getCurrentSelection();

// Édition
await a11fs.insertAtCursor('// TODO: fix this');
await a11fs.replaceSelection('public void NewMethod() { }');

// Gestion de fichiers
await a11fs.deleteFile('C:\\workspace\\temp\\test.cs');
await a11fs.renameFile('C:\\workspace\\old.cs', 'C:\\workspace\\new.cs');

// VS integration
const root = await a11fs.getWorkspaceRoot();
await a11fs.openFile('C:\\workspace\\File.cs');
await a11fs.gotoLine('C:\\workspace\\File.cs', 42);
await a11fs.buildSolution();
const docs = await a11fs.getOpenDocuments();
const output = await a11fs.executeShell('dotnet --version');
```

---

## 🔐 Sécurité

### Validation des chemins
- Tous les chemins de fichiers sont validés contre `GetWorkspaceRoot()`
- Rejette les chemins hors du workspace
- Normalise les chemins pour éviter les traversées

### Exemple de validation
```javascript
// Backend (a11host.cjs)
function validatePath(targetPath, workspaceRoot) {
  const normalized = path.normalize(targetPath);
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const resolvedPath = path.resolve(normalized);
  
  if (!resolvedPath.startsWith(resolvedWorkspace)) {
    throw new Error('Path outside workspace');
  }
  
  return resolvedPath;
}
```

---

## 🚀 Initialisation du pont (VSIX)

### Côté C# (A11HostApi.cs)
```csharp
// Dans la méthode qui initialise le WebView2
await webView.CoreWebView2.ExecuteScriptAsync(@"
    if (window.setA11HostBridge) {
        window.setA11HostBridge(window.a11host);
        console.log('[A11] Bridge initialized from VSIX');
    }
");
```

### Côté JavaScript (WebView2)
```javascript
// Le pont est automatiquement exposé via window.a11host
// Les méthodes sont appelables directement:
const errors = await window.a11host.GetCompilationErrors();
```

---

## 📊 Architecture

```
Frontend (React/TypeScript)
  ↓ a11fs.ts
  ├─ window.a11host? → Direct call (VSIX context)
  └─ else → HTTP /api/v1/vs/* (standalone context)
       ↓
Backend (Node.js)
  ↓ routes/a11host.cjs
  └─ callA11Host(methodName, ...args)
       ↓
VSIX (C#)
  └─ A11HostApi.cs methods
```

---

## 🎯 Prochaines étapes

1. ✅ Endpoints créés
2. ✅ Routes enregistrées
3. ✅ Frontend client mis à jour
4. ⏳ Tester avec VSIX
5. ⏳ Ajouter LLM tools definitions
6. ⏳ Mettre à jour system prompt
7. ⏳ Tests end-to-end

---

**Version:** 1.0  
**Date:** 2024-12-04  
**Status:** ✅ Backend ready, ⏳ awaiting VSIX integration test
