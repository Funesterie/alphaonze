// tools-manifest.cjs

const path = require("node:path");

const configuredWorkspaceRoot = String(process.env.A11_WORKSPACE_ROOT || process.env.WORKSPACE_ROOT || '').trim();
const defaultWorkspaceRoot = configuredWorkspaceRoot
  ? path.resolve(configuredWorkspaceRoot)
  : path.resolve(process.cwd());

const WORKSPACE_ROOTS = Array.from(new Set([
  defaultWorkspaceRoot,
  "D:\\A11",
  "D:\\A12",
]));

const DEFAULT_WORKSPACE_ROOT = WORKSPACE_ROOTS[0];

const SAFE_DATA_ROOT = path.resolve(
  process.env.A11_SAFE_DATA_ROOT || path.join(DEFAULT_WORKSPACE_ROOT, "a11_runtime")
);

const TOOL_MANIFEST = {
  fs_search: {
    description: "Recherche de fichiers par nom ou motif dans le workspace.",
    dangerLevel: "medium",
    constraints: { roots: WORKSPACE_ROOTS },
    args: { pattern: "string (motif de recherche, ex: '*.pdf', 'rapport')", path: "chemin dossier (optionnel)" }
  },
  qflush_flow: {
    description: "Exécute un flow QFLUSH sur la machine locale.",
    dangerLevel: "medium",
    args: {
      flow: "string (nom du flow, ex: 'pdf_report_basic', 'web_to_pdf_report', 'encode_oc8')",
      payload: "object (paramètres pour le flow)"
    }
  },
  qflush_memory_write: {
    description: "Ecrit une memoire ephemere dans QFLUSH avec TTL.",
    dangerLevel: "low",
    args: {
      key: "string (cle memoire)",
      value: "any (valeur JSON courte)",
      ttlSec: "number (optionnel, TTL en secondes)",
      scope: "string (optionnel, scope logique)",
      namespace: "string (optionnel, namespace logique)"
    }
  },
  qflush_memory_read: {
    description: "Lit une memoire ephemere depuis QFLUSH.",
    dangerLevel: "low",
    args: {
      key: "string (cle memoire)",
      scope: "string (optionnel)",
      namespace: "string (optionnel)"
    }
  },
  qflush_memory_list: {
    description: "Liste les memoires ephemeres QFLUSH pour un scope donne.",
    dangerLevel: "low",
    args: {
      scope: "string (optionnel)",
      namespace: "string (optionnel)",
      prefix: "string (optionnel)",
      limit: "number (optionnel)"
    }
  },
  qflush_memory_delete: {
    description: "Supprime une memoire ephemere precise dans QFLUSH.",
    dangerLevel: "low",
    args: {
      key: "string (cle memoire)",
      scope: "string (optionnel)",
      namespace: "string (optionnel)"
    }
  },
  qflush_memory_clear: {
    description: "Vide les memoires ephemeres QFLUSH pour un scope/namespace.",
    dangerLevel: "medium",
    args: {
      scope: "string (optionnel)",
      namespace: "string (optionnel)",
      prefix: "string (optionnel)"
    }
  },
  fs_read: {
    description: "Lire le contenu texte d’un fichier.",
    dangerLevel: "low",
    constraints: { roots: WORKSPACE_ROOTS },
    args: { path: "chemin absolu dans un workspace autorisé" }
  },
  fs_write: {
    description: "Écrire un fichier texte (création ou remplacement).",
    dangerLevel: "medium",
    constraints: { roots: WORKSPACE_ROOTS },
    args: { path: "chemin absolu", content: "string (contenu texte)", overwrite: "bool (par défaut false)" }
  },
  fs_list: {
    description: "Lister le contenu d’un dossier.",
    dangerLevel: "low",
    constraints: { roots: WORKSPACE_ROOTS },
    args: { path: "chemin dossier" }
  },
  fs_stat: {
    description: "Infos sur un fichier/dossier (taille, dates, type).",
    dangerLevel: "low",
    constraints: { roots: WORKSPACE_ROOTS },
    args: { path: "chemin absolu" }
  },
  fs_delete: {
    description: "Supprimer un fichier.",
    dangerLevel: "high",
    constraints: { roots: WORKSPACE_ROOTS, requireExplicitUserIntent: true },
    args: { path: "chemin absolu" }
  },
  fs_move: {
    description: "Déplacer/renommer un fichier ou dossier.",
    dangerLevel: "high",
    constraints: { roots: WORKSPACE_ROOTS },
    args: { from: "chemin source", to: "chemin destination" }
  },
  zip_create: {
    description: "Créer un .zip à partir d’un dossier ou d’une liste de fichiers.",
    dangerLevel: "medium",
    constraints: { roots: WORKSPACE_ROOTS },
    args: { inputPaths: "string[] (chemins à zipper)", outputPath: "chemin du zip" }
  },
  unzip_extract: {
    description: "Extraire un .zip.",
    dangerLevel: "medium",
    constraints: { roots: WORKSPACE_ROOTS },
    args: { zipPath: "chemin du zip", outputDir: "dossier cible" }
  },
  shell_exec: {
    description: "Exécuter une commande shell contrôlée (diagnostic / build / git safe).",
    dangerLevel: "high",
    constraints: {
      roots: WORKSPACE_ROOTS,
      allowListExamples: [
        "git status",
        "git diff",
        "npm test",
        "npm run build",
        "dotnet --info",
        "dotnet build"
      ]
    },
    args: { command: "string (doit matcher une whitelist côté backend)", cwd: "chemin de travail (optionnel, dans un workspace autorisé)" }
  },
  web_fetch: {
    description: "Fetches a web page (HTML/text) from allowed domains.",
    dangerLevel: "medium",
    constraints: {
      allowedDomainsExamples: [
        "duckduckgo.com",
        "wikipedia.org",
        "wikimedia.org",
        "unsplash.com",
        "pexels.com"
      ]
    },
    args: { url: "string" }
  },
  web_search: {
    description: "Recherche web simple (résultats texte + liens) pour l’agent A-11.",
    dangerLevel: "medium",
    args: {
      query: "string (requête de recherche)",
      limit: "number (facultatif, nombre max de résultats, ex: 5)"
    }
  },
  llm_analyze_text: {
    description: "Analyse ou résumé de texte via le backend LLM (réutilisation de Cerbère).",
    dangerLevel: "low",
    args: { text: "string", task: "string (ex: 'summary', 'bullet-points', 'explain', 'refactor')" }
  },
  vs_status: {
    description: "Vérifier si Visual Studio / A11Host est connecté, lister les méthodes dispos.",
    dangerLevel: "low",
    args: {}
  },
  vs_open_file: {
    description: "Ouvrir un fichier dans Visual Studio (si A11Host connecté).",
    dangerLevel: "medium",
    args: { path: "chemin absolu" }
  },
  vs_workspace_root: {
    description: "Retourne le workspace root vu par A11Host/Visual Studio.",
    dangerLevel: "low",
    args: {}
  },
  vs_compilation_errors: {
    description: "Retourne les erreurs de compilation remontées par A11Host/Visual Studio.",
    dangerLevel: "low",
    args: {}
  },
  vs_project_structure: {
    description: "Retourne la structure projet/solution remontée par A11Host/Visual Studio.",
    dangerLevel: "low",
    args: {}
  },
  vs_solution_info: {
    description: "Retourne les informations de solution ouvertes dans Visual Studio.",
    dangerLevel: "low",
    args: {}
  },
  vs_active_document: {
    description: "Retourne le document actif dans Visual Studio si disponible.",
    dangerLevel: "low",
    args: {}
  },
  vs_current_selection: {
    description: "Retourne la sélection courante dans Visual Studio si disponible.",
    dangerLevel: "low",
    args: {}
  },
  vs_goto_line: {
    description: "Ouvrir un fichier et aller à une ligne précise dans Visual Studio si disponible.",
    dangerLevel: "medium",
    args: { path: "chemin absolu", line: "number (ligne 1-based)" }
  },
  vs_open_documents: {
    description: "Liste les documents actuellement ouverts dans Visual Studio/A11Host.",
    dangerLevel: "low",
    args: {}
  },
  vs_execute_shell: {
    description: "Exécute une commande shell via A11Host avec la même whitelist safe que l'outil shell local.",
    dangerLevel: "high",
    args: { command: "string (doit correspondre à une commande autorisée)" }
  },
  vs_build_solution: {
    description: "Lancer un build solution dans Visual Studio.",
    dangerLevel: "medium",
    args: {}
  },
  generate_pdf: {
    description: "Génère un PDF à partir de sections/textes/images.",
    dangerLevel: "medium",
    args: { outputPath: "string", title: "string", sections: "array", author: "string", date: "string" }
  },
  generate_png: {
    description: "Génère une image PNG à partir de données ou texte.",
    dangerLevel: "medium",
    args: { outputPath: "string", text: "string", width: "number", height: "number" }
  },
  tts_basic: {
    description: "Synthèse vocale basique.",
    dangerLevel: "low",
    args: { text: "string", voice: "string", outputPath: "string" }
  },
  ocr_file: {
    description: "Reconnaissance de texte dans un fichier image ou PDF.",
    dangerLevel: "medium",
    args: { path: "string" }
  },
  zip: {
    description: "Crée une archive ZIP.",
    dangerLevel: "medium",
    args: { inputPaths: "array", outputPath: "string" }
  },
  unzip: {
    description: "Décompresse une archive ZIP.",
    dangerLevel: "medium",
    args: { zipPath: "string", outputDir: "string" }
  },
  vision_analyze: {
    description: "Analyse d'image (vision par ordinateur).",
    dangerLevel: "medium",
    args: { path: "string", task: "string" }
  },
  audio_info: {
    description: "Analyse des métadonnées audio.",
    dangerLevel: "low",
    args: { path: "string" }
  },
  video_tools: {
    description: "Outils de manipulation vidéo.",
    dangerLevel: "medium",
    args: { path: "string", action: "string" }
  },
  csv_tools: {
    description: "Outils de manipulation CSV.",
    dangerLevel: "low",
    args: { path: "string", action: "string" }
  },
  agent_log: {
    description: "Journalisation des actions de l'agent.",
    dangerLevel: "low",
    args: { message: "string", level: "string" }
  },
  download_file: {
    dangerLevel: "medium",
    description: "Télécharger un fichier depuis une URL dans le workspace.",
    constraints: { roots: WORKSPACE_ROOTS },
    args: { url: "string", outputPath: "chemin absolu" }
  },
  share_file: {
    description: "Publie un fichier local dans l'espace A-11 et peut l'envoyer par email.",
    dangerLevel: "medium",
    constraints: { roots: WORKSPACE_ROOTS, requiresAuth: true },
    args: {
      path: "string (chemin absolu ou relatif vers un fichier local)",
      filename: "string (optionnel, nom force pour le stockage)",
      contentType: "string (optionnel)",
      emailTo: "string|string[] (optionnel, un ou plusieurs destinataires email)",
      emailSubject: "string (optionnel)",
      emailMessage: "string (optionnel)",
      attachToEmail: "bool (optionnel, joindre le fichier au mail)"
    }
  },
  list_stored_files: {
    description: "Liste les fichiers déjà stockés dans l'espace A-11 de l'utilisateur.",
    dangerLevel: "low",
    constraints: { requiresAuth: true },
    args: {
      limit: "number (optionnel, 1-100)"
    }
  },
  list_resources: {
    description: "Liste les ressources de conversation stockées par A-11 (fichiers ou artefacts).",
    dangerLevel: "low",
    constraints: { requiresAuth: true },
    args: {
      conversationId: "string (optionnel)",
      kind: "string (optionnel, ex: 'file' ou 'artifact')",
      limit: "number (optionnel, 1-100)"
    }
  },
  get_latest_resource: {
    description: "Retourne la ressource la plus recente d'une conversation ou d'un type donne.",
    dangerLevel: "low",
    constraints: { requiresAuth: true },
    args: {
      conversationId: "string (optionnel)",
      kind: "string (optionnel, ex: 'file' ou 'artifact')"
    }
  },
  email_resource: {
    description: "Envoie par email une ressource déjà stockée par A-11 à partir de son resourceId.",
    dangerLevel: "medium",
    constraints: { requiresAuth: true },
    args: {
      resourceId: "number (id de la ressource)",
      to: "string|string[] (un ou plusieurs destinataires)",
      subject: "string (optionnel)",
      message: "string (optionnel)",
      attachToEmail: "bool (optionnel)"
    }
  },
  email_latest_resource: {
    description: "Envoie par email la ressource la plus recente, sans avoir besoin de fournir un chemin ou resourceId.",
    dangerLevel: "medium",
    constraints: { requiresAuth: true },
    args: {
      conversationId: "string (optionnel)",
      kind: "string (optionnel, ex: 'file' ou 'artifact')",
      to: "string|string[] (un ou plusieurs destinataires)",
      subject: "string (optionnel)",
      message: "string (optionnel)",
      attachToEmail: "bool (optionnel)"
    }
  },
  send_email: {
    description: "Envoie un email texte, avec pieces jointes locales optionnelles.",
    dangerLevel: "medium",
    constraints: { roots: WORKSPACE_ROOTS, requiresAuth: true },
    args: {
      to: "string|string[] (un ou plusieurs destinataires)",
      subject: "string (optionnel)",
      message: "string (optionnel, corps texte)",
      html: "string (optionnel, corps HTML)",
      path: "string (optionnel, fichier local a joindre)",
      paths: "string[] (optionnel, plusieurs fichiers a joindre)",
      attachToEmail: "bool (optionnel, true par defaut si path/paths present)"
    }
  },
  schedule_email: {
    description: "Programme un email pour plus tard, avec pieces jointes locales optionnelles.",
    dangerLevel: "medium",
    constraints: { roots: WORKSPACE_ROOTS, requiresAuth: true },
    args: {
      to: "string|string[] (un ou plusieurs destinataires)",
      subject: "string (optionnel)",
      message: "string (optionnel)",
      sendAt: "string ISO date/heure future (optionnel)",
      delaySeconds: "number (optionnel, delai avant envoi)",
      delayMinutes: "number (optionnel)",
      path: "string (optionnel)",
      paths: "string[] (optionnel)"
    }
  },
  schedule_resource_email: {
    description: "Programme l'envoi d'une ressource stockee a une date/heure future.",
    dangerLevel: "medium",
    constraints: { requiresAuth: true },
    args: {
      resourceId: "number",
      to: "string|string[]",
      subject: "string (optionnel)",
      message: "string (optionnel)",
      sendAt: "string ISO date/heure future (optionnel)",
      delaySeconds: "number (optionnel)",
      delayMinutes: "number (optionnel)",
      attachToEmail: "bool (optionnel)"
    }
  },
  schedule_latest_resource_email: {
    description: "Programme l'envoi de la ressource la plus recente sans donner de resourceId.",
    dangerLevel: "medium",
    constraints: { requiresAuth: true },
    args: {
      conversationId: "string (optionnel)",
      kind: "string (optionnel)",
      to: "string|string[]",
      subject: "string (optionnel)",
      message: "string (optionnel)",
      sendAt: "string ISO date/heure future (optionnel)",
      delaySeconds: "number (optionnel)",
      delayMinutes: "number (optionnel)",
      attachToEmail: "bool (optionnel)"
    }
  },
  list_scheduled_emails: {
    description: "Liste les emails planifies par A-11 pour l'utilisateur courant.",
    dangerLevel: "low",
    constraints: { requiresAuth: true },
    args: {
      status: "string (optionnel: scheduled, running, sent, failed, cancelled)",
      limit: "number (optionnel)"
    }
  },
  cancel_scheduled_email: {
    description: "Annule un email planifie tant qu'il n'a pas encore ete execute.",
    dangerLevel: "medium",
    constraints: { requiresAuth: true },
    args: {
      jobId: "string (identifiant du job planifie)"
    }
  },
  zip_and_email: {
    description: "Cree une archive ZIP a partir de plusieurs chemins locaux puis l'envoie par email.",
    dangerLevel: "medium",
    constraints: { roots: WORKSPACE_ROOTS, requiresAuth: true },
    args: {
      inputPaths: "string[] (ou paths)",
      outputPath: "string (optionnel)",
      to: "string|string[]",
      subject: "string (optionnel)",
      message: "string (optionnel)"
    }
  },
  a11_env_snapshot: {
    dangerLevel: "low",
    description: "Retourne un snapshot JSON de l'environnement A-11 (tools, roots, qflush, cerbère, env safe)."
  },
  a11_debug_echo: {
    dangerLevel: "low",
    description: "Outil de debug qui renvoie textuellement les arguments pour inspection."
  },
  write_file: {
    description: "Écrire un fichier texte (mode assistant, chemin relatif ou absolu dans le workspace).",
    dangerLevel: "medium",
    constraints: { roots: WORKSPACE_ROOTS },
    args: {
      path: "string (chemin relatif ou absolu dans un workspace autorisé)",
      content: "string (contenu texte)",
      overwrite: "bool (par défaut false)"
    }
  },
  a11_memory_write: {
    description: "Stocke une valeur courte dans le KV store local d'A-11.",
    dangerLevel: "low",
    args: {
      key: "string (clé de mémo, ex: 'bonjour_bg')",
      value: "string (valeur associée)"
    }
  },
  a11_memory_read: {
    description: "Lit une valeur depuis le KV store local d'A-11.",
    dangerLevel: "low",
    args: {
      key: "string (clé de mémo à lire)"
    }
  }
};

module.exports = {
  TOOL_MANIFEST,
  WORKSPACE_ROOTS,
  DEFAULT_WORKSPACE_ROOT,
  SAFE_DATA_ROOT,
};
