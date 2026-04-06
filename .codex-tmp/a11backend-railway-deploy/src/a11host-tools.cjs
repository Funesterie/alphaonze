/**
 * A11Host LLM Tools - Definitions for OpenAI/Ollama function calling
 * Add these to your LLM configuration for full A11 capabilities
 */

const { generatePdfReport } = require('../tools/generate-pdf.cjs');

const a11HostTools = [
  // ========== CODE ANALYSIS TOOLS ==========
  {
    type: "function",
    function: {
      name: "get_compilation_errors",
      description: "Récupère les erreurs de compilation de la solution Visual Studio. Utile pour diagnostiquer les problèmes de build et proposer des corrections.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_project_structure",
      description: "Récupère la structure complète du projet (solution, projets, fichiers). Utile pour comprendre l'organisation du code et naviguer dans le projet.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_solution_info",
      description: "Récupère les informations sur la solution (nom, chemin, nombre de projets). Utile pour avoir une vue d'ensemble rapide.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_active_document",
      description: "Récupère le fichier actuellement ouvert dans Visual Studio avec la position du curseur et le texte sélectionné. Essentiel pour comprendre le contexte avant toute modification.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_current_selection",
      description: "Récupère le texte actuellement sélectionné dans l'éditeur. Utile pour les opérations de refactoring ou remplacement ciblé.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },

  // ========== CODE EDITING TOOLS ==========
  {
    type: "function",
    function: {
      name: "insert_at_cursor",
      description: "Insère du texte à la position actuelle du curseur dans l'éditeur. Utilise pour ajouter du code sans remplacer le contenu existant.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Le texte à insérer (code, commentaires, etc.)"
          }
        },
        required: ["text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "replace_selection",
      description: "Remplace le texte actuellement sélectionné par un nouveau texte. Utilise pour modifier ou refactorer du code existant.",
      parameters: {
        type: "object",
        properties: {
          newText: {
            type: "string",
            description: "Le nouveau texte qui remplacera la sélection"
          }
        },
        required: ["newText"]
      }
    }
  },

  // ========== FILE MANAGEMENT TOOLS ==========
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Supprime un fichier du disque. ATTENTION: Opération destructive! Toujours demander confirmation à l'utilisateur avant d'utiliser.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Chemin complet du fichier à supprimer"
          }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "rename_file",
      description: "Renomme ou déplace un fichier. Vérifie toujours que le chemin cible est valide avant.",
      parameters: {
        type: "object",
        properties: {
          oldPath: {
            type: "string",
            description: "Chemin actuel du fichier"
          },
          newPath: {
            type: "string",
            description: "Nouveau chemin du fichier (peut être un déplacement)"
          }
        },
        required: ["oldPath", "newPath"]
      }
    }
  },

  // ========== VS INTEGRATION TOOLS ==========
  {
    type: "function",
    function: {
      name: "open_file",
      description: "Ouvre un fichier dans Visual Studio.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Chemin du fichier à ouvrir"
          }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "goto_line",
      description: "Va à une ligne spécifique dans un fichier.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Chemin du fichier"
          },
          line: {
            type: "integer",
            description: "Numéro de ligne (commence à 1)"
          }
        },
        required: ["path", "line"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "build_solution",
      description: "Lance le build de la solution. Utilise pour compiler après des modifications.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_workspace_root",
      description: "Récupère le chemin racine du workspace.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },

  // ========== FILE & PROJECT TOOLS ==========
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Lit le contenu d’un fichier texte.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Chemin du fichier à lire" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "apply_patch",
      description: "Applique un patch sur un fichier (remplacement ciblé).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Chemin du fichier" },
          search: { type: "string", description: "Texte à remplacer" },
          replace: { type: "string", description: "Nouveau texte" }
        },
        required: ["path", "search", "replace"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "Liste les fichiers et dossiers dans un répertoire.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Chemin du dossier" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "batch",
      description: "Exécute une liste d’opérations (write_file, mkdir, etc).",
      parameters: {
        type: "object",
        properties: {
          operations: { type: "array", items: { type: "object" }, description: "Liste d’opérations à exécuter" }
        },
        required: ["operations"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "exec",
      description: "Exécute une commande shell dans le workspace.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Commande à exécuter" }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "index_project",
      description: "Indexe tous les fichiers du projet pour accélérer la recherche et la compréhension.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "git_ops",
      description: "Effectue des opérations Git (commit, push, pull, resolve).",
      parameters: {
        type: "object",
        properties: {
          op: { type: "string", description: "Opération git (commit, push, pull, resolve)" },
          message: { type: "string", description: "Message de commit (optionnel)" }
        },
        required: ["op"]
      }
    }
  },

  // ========== COMPLEX AGENT TOOLS ==========
  {
    type: "function",
    function: {
      name: "create_task_list",
      description: "Crée une liste de tâches à partir d'une description.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "Description de ce que l'agent doit faire" }
        },
        required: ["description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_github_issue",
      description: "Crée ou met à jour un ticket GitHub.",
      parameters: {
        type: "object",
        properties: {
          issueId: { type: "string", description: "ID du ticket à mettre à jour (laisse vide pour créer un nouveau)" },
          title: { type: "string", description: "Titre du ticket" },
          body: { type: "string", description: "Description détaillée du problème ou de la demande" },
          assignee: { type: "string", description: "Utilisateur à assigner au ticket (login GitHub)" },
          labels: { type: "array", items: { type: "string" }, description: "Étiquettes à ajouter au ticket" },
          milestone: { type: "string", description: "Milestone à associer au ticket" }
        },
        required: ["title", "body"]
      }
    }
  }
];

/**
 * Enhanced system prompt for A11 with new capabilities
 */
const a11SystemPrompt = `Tu es A11 (AlphaOnze), un assistant IA intégré à Visual Studio avec des capacités avancées d'analyse et de modification de code.

## 🎯 Tes capacités

### 📊 Analyse de code
- **get_compilation_errors**: Liste les erreurs de compilation avec fichier et ligne
- **get_project_structure**: Analyse complète de la solution (projets, fichiers, dépendances)
- **get_solution_info**: Vue d'ensemble de la solution (nom, nombre de projets)
- **get_active_document**: Fichier ouvert + position du curseur + texte sélectionné
- **get_current_selection**: Texte actuellement sélectionné par l'utilisateur

### ✏️ Édition de code
- **insert_at_cursor(text)**: Insère du code à la position du curseur
- **replace_selection(newText)**: Remplace le texte sélectionné
- **open_file(path)**: Ouvre un fichier
- **goto_line(path, line)**: Va à une ligne spécifique

### 📁 Gestion de fichiers
- **delete_file(path)**: Supprime un fichier (⚠️ avec confirmation)
- **rename_file(oldPath, newPath)**: Renomme ou déplace un fichier

### 🔧 VS Integration
- **build_solution()**: Compile la solution
- **get_workspace_root()**: Obtient le répertoire racine

### 📂 Outils de Fichier & Projet
- **read_file(path)**: Lit le contenu d’un fichier
- **apply_patch(path, search, replace)**: Applique un patch ciblé sur un fichier
- **list_dir(path)**: Liste les fichiers/dossiers d’un répertoire
- **batch(operations)**: Exécute plusieurs opérations (write_file, mkdir, etc)
- **exec(command)**: Exécute une commande shell
- **index_project()**: Indexe tous les fichiers du projet
- **git_ops(op, message?)**: Effectue une opération Git (commit, push, pull, resolve)

### 🚀 Outils d'Agent Complexe
- **create_task_list(description)**: Crée une liste de tâches à partir d'une description
- **set_github_issue(issueId, title, body, assignee, labels, milestone)**: Crée ou met à jour un ticket GitHub

## 🧠 Comportement intelligent

### Avant toute modification
1. **Comprendre le contexte**: Utilise \`get_active_document\` pour voir où est le curseur
2. **Analyser le code**: Si l'utilisateur demande des corrections, appelle \`get_compilation_errors\`
3. **Vérifier la structure**: Pour des modifications importantes, consulte \`get_project_structure\`

### Lors de l'édition
1. **Être précis**: Utilise \`get_current_selection\` pour savoir exactement ce que l'utilisateur a sélectionné
2. **Proposer avant d'agir**: Montre le code que tu vas insérer/remplacer avant de le faire
3. **Utiliser la bonne méthode**:
   - \`insert_at_cursor\`: Pour ajouter du code sans toucher à l'existant
   - \`replace_selection\`: Pour modifier/refactorer du code sélectionné

### Sécurité
1. **Toujours demander confirmation** avant \`delete_file\` ou \`rename_file\`
2. **Vérifier les chemins**: Utilise \`get_workspace_root\` pour valider
3. **Expliquer les changements**: Décris ce que tu vas faire avant

## 💡 Exemples de workflows

### Corriger des erreurs
\`\`\`
1. get_compilation_errors() → Liste les erreurs
2. Pour chaque erreur critique:
   - open_file(path) → Ouvre le fichier concerné
   - goto_line(path, line) → Va à la ligne
   - Propose une correction
   - insert_at_cursor(fix) ou replace_selection(fix)
3. build_solution() → Recompile pour vérifier
\`\`\`

### Refactoring
\`\`\`
1. get_active_document() → Comprend le contexte
2. get_current_selection() → Récupère le code à refactorer
3. Propose le code refactorisé
4. replace_selection(newCode) → Remplace si l'utilisateur valide
\`\`\`

### Analyse de projet
\`\`\`
1. get_solution_info() → Vue d'ensemble
2. get_project_structure() → Détails des projets
3. Présente une analyse claire et structurée
\`\`\`

### Utilisation des outils de fichier
\`\`\`
1. list_dir(cheminDossier) → Liste le contenu du dossier
2. read_file(cheminFichier) → Lit un fichier spécifique
3. apply_patch(cheminFichier, "ancienTexte", "nouveauTexte") → Remplace du texte dans le fichier
4. exec("commandeShell") → Exécute une commande shell
\`\`\`

### Gestion de version avec Git
\`\`\`
1. git_ops("commit", "Message de commit") → Fait un commit
2. git_ops("push") → Pousse les changements
3. git_ops("pull") → Récupère les dernières modifications
\`\`\`

### Tâches et intégration GitHub
\`\`\`
1. create_task_list("Décrire le nouveau workflow") → Crée une tâche
2. set_github_issue("", "Titre du problème", "Description du problème") → Crée un nouveau ticket GitHub
3. set_github_issue("123", "Titre mis à jour", "Description mise à jour") → Met à jour le ticket GitHub avec ID 123
\`\`\`

## 🎯 Objectif

Devenir aussi capable que GitHub Copilot en offrant:
- ✅ Analyse contextuelle précise
- ✅ Détection proactive d'erreurs
- ✅ Suggestions intelligentes basées sur le contexte
- ✅ Modifications sécurisées avec validation

## 🚫 Règles strictes

1. **Ne jamais** supprimer de fichiers sans confirmation explicite
2. **Toujours** vérifier le contexte avant de modifier du code
3. **Expliquer** ce que tu fais en langage clair
4. **Proposer** avant d'exécuter pour les opérations destructives
5. **Utiliser** les outils de manière progressive (analyse → proposition → action)

Tu es un assistant proactif mais prudent, capable et respectueux du code de l'utilisateur.`;

/**
 * Handler function for tool calls
 * Add this to your chat completions handler
 */
async function handleA11HostToolCall(toolCall, a11fs) {
  const functionName = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments || '{}');

  try {
    switch (functionName) {
      // Code analysis
      case 'get_compilation_errors':
        return await a11fs.getCompilationErrors();
      
      case 'get_project_structure':
        return await a11fs.getProjectStructure();
      
      case 'get_solution_info':
        return await a11fs.getSolutionInfo();
      
      case 'get_active_document':
        return await a11fs.getActiveDocument();
      
      case 'get_current_selection':
        return { text: await a11fs.getCurrentSelection() };

      // Code editing
      case 'insert_at_cursor':
        return { success: await a11fs.insertAtCursor(args.text) };
      
      case 'replace_selection':
        return { success: await a11fs.replaceSelection(args.newText) };

      // File management
      case 'delete_file':
        return { success: await a11fs.deleteFile(args.path, args), path: args.path };
      
      case 'rename_file':
        return { 
          success: await a11fs.renameFile(args.oldPath, args.newPath),
          oldPath: args.oldPath,
          newPath: args.newPath
        };

      // VS integration
      case 'open_file':
        return { success: await a11fs.openFile(args.path), path: args.path };
      
      case 'goto_line':
        return { success: await a11fs.gotoLine(args.path, args.line), path: args.path, line: args.line };
      
      case 'build_solution':
        return { success: await a11fs.buildSolution() };
      
      case 'get_workspace_root':
        return { root: await a11fs.getWorkspaceRoot() };

      // File & project tools
      case 'read_file':
        return { content: await a11fs.readFile(args.path), path: args.path };
      case 'apply_patch':
        return { success: await a11fs.applyPatch(args.path, args.search, args.replace), path: args.path };
      case 'list_dir':
        return { files: await a11fs.listDir(args.path), path: args.path };
      case 'batch':
        return { results: await a11fs.batch(args.operations) };
      case 'exec':
        return { output: await a11fs.exec(args.command), command: args.command };
      case 'index_project':
        return { index: await a11fs.indexProject() };
      case 'git_ops':
        return { result: await a11fs.gitOps(args.op, args.message) };

      // Complex agent tools
      case 'create_task_list':
        return { success: await a11fs.createTaskList(args.description) };
      
      case 'set_github_issue':
        return { success: await a11fs.setGitHubIssue(args.issueId, args.title, args.body, args.assignee, args.labels, args.milestone) };
      // PDF generation tool
      case 'generate_pdf':
        // args should contain outputPath, title, summary, analysis, sections, conversation, meta
        return await generatePdfReport(args);
      default:
        throw new Error(`Unknown A11Host tool: ${functionName}`);
    }
  } catch (error) {
    console.error(`[A11Host] Tool call error (${functionName}):`, error.message);
    return { error: error.message, tool: functionName };
  }
}

/**
 * Extracts a clean JSON envelope from a raw LLM response (handles backticks, text before/after, etc.)
 */
function extractJsonEnvelope(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('extractJsonEnvelope: empty or non-string response');
  }
  let text = raw.trim();
  // 1) Bloc ```json ... ```
  if (text.startsWith('```')) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
      text = fenced[1].trim();
    }
  }
  // 2) Premier { et dernier }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('extractJsonEnvelope: no JSON object found in response');
  }
  const slice = text.slice(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(slice);
    return parsed;
  } catch (err) {
    console.error('[Cerbère] parseEnvelope JSON error (slice):', err.message);
    console.error('[Cerbère] Raw response (truncated):', text.slice(0, 200));
    console.error('[Cerbère] Slice (truncated):', slice.slice(0, 200));
    throw err;
  }
}

/**
 * Optionally: validates and parses the envelope for mode actions
 */
function parseEnvelope(raw) {
  if (!raw) return null;
  const candidate = cleanJsonCandidate(raw);
  if (!candidate.startsWith("{") && !candidate.startsWith("[")) return null;
  try {
    const obj = JSON.parse(candidate);
    if (!obj || typeof obj !== "object") return null;
    if (!obj.mode) return null;
    if (!Array.isArray(obj.actions)) return null;
    obj.actions = obj.actions
      .filter(a => a && (typeof a.name === 'string' || typeof a.action === 'string'))
      .map(a => {
        const name = a.name || a.action;
        // Si arguments existe, on le prend, sinon on prend tout sauf name/action
        const args = a.arguments || Object.fromEntries(
          Object.entries(a).filter(([k]) => k !== 'name' && k !== 'action')
        );
        return { action: name, arguments: args };
      });
    if (obj.actions.length === 0) throw new Error('parseEnvelope: no valid actions found');
    return obj;
  } catch (e) {
    console.warn("[Cerbère] parseEnvelope JSON error (slice):", e.message);
    return null;
  }
}

function cleanJsonCandidate(text = "") {
  let t = String(text || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  }
  if (t.toLowerCase().startsWith("json\n")) {
    t = t.slice(5).trim();
  }
  const firstBrace = t.indexOf("{");
  const firstBracket = t.indexOf("[");
  let start = -1;
  if (firstBrace === -1) start = firstBracket;
  else if (firstBracket === -1) start = firstBrace;
  else start = Math.min(firstBrace, firstBracket);
  if (start > 0) t = t.slice(start);
  return t.trim();
}

module.exports = {
  a11HostTools,
  a11SystemPrompt,
  handleA11HostToolCall,
  extractJsonEnvelope,
  parseEnvelope
};
