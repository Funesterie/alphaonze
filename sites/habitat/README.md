# Habitat Numérique avec LightKamel

> **Un espace personnel pour cultiver tes idées, avec un guide IA assoiffé de succès.**

---

## 🏡 Concept

L'Habitat Numérique est une **maison digitale** où chaque pièce a une fonction :

- **🌱 Garden** : Notes brutes, idées en vrac, graines de projets
- **✍️ Blog** : Articles aboutis, réflexions structurées
- **🛠️ Projects** : Builds concrets, projets techniques
- **🔗 Links** : (À venir) Bookmarks et ressources

**LightKamel** est ton **guide interactif** qui t'aide à naviguer et répondre à tes questions.

---

## ⚡ Démarrage rapide

### 1. Installer les dépendances

```bash
cd sites/habitat
npm install
```

### 2. Configurer l'environnement (optionnel)

Crée un fichier `.env.local` pour configurer le MCP Server :

```env
# URL de ton MCP Server (par défaut : https://mcp.funesterie.me/admin/mcp)
MCP_SERVER_URL=http://localhost:3000/mcp

# Token d'authentification si nécessaire
MCP_AUTH_TOKEN=ton_token_ici
```

### 3. Lancer le serveur de développement

```bash
npm run dev
```

Ouvre [http://localhost:3000](http://localhost:3000) dans ton navigateur.

---

## 📁 Structure du projet

```
habitat/
├── app/
│   ├── layout.tsx              # Layout principal avec LightKamel
│   ├── page.tsx                # Page d'accueil
│   ├── garden/
│   │   └── page.tsx            # Liste des notes
│   ├── blog/
│   │   └── page.tsx            # Liste des articles
│   ├── projects/
│   │   └── page.tsx            # Liste des projets
│   └── api/chat/
│       └── route.ts            # Endpoint pour LightKamel
├── components/
│   ├── LightKamel.tsx          # Composant du persona
│   └── ThemeToggle.tsx         # Bouton clair/sombre
├── content/
│   ├── garden/                 # Notes en Markdown
│   ├── blog/                   # Articles en Markdown
│   └── projects/               # Projets en Markdown
├── lib/
│   ├── posts.ts                # Gestion des fichiers Markdown
│   └── utils.ts                # Fonctions utilitaires
├── public/
│   └── lightkamel.svg          # Avatar du persona
└── package.json
```

---

## 📝 Créer du contenu

### Ajouter une note au Garden

1. Crée un fichier dans `content/garden/` (ex: `ma-note.md`)
2. Ajoute le frontmatter :

```markdown
---
title: Ma super note
excerpt: Une description courte
date: 2026-08-18
tags: [tag1, tag2]
---

# Contenu en Markdown

Ici ton contenu...
```

3. Le site se mettra à jour automatiquement !

### Ajouter un article au Blog

Même principe dans `content/blog/`.

### Ajouter un projet

Même principe dans `content/projects/`.

---

## 🎨 Personnalisation

### Thème

Le thème utilise les couleurs de PIA :
- **Cobalt** (`--cobalt`) : Bleu profond
- **Gold** (`--gold`) : Doré
- **Laurel** (`--laurel`) : Vert foncé

Pour modifier, édite `app/globals.css`.

### LightKamel

Pour modifier le persona :

1. **Style** : Modifie le SVG dans `public/lightkamel.svg`
2. **Comportement** : Edite le composant `components/LightKamel.tsx`
3. **Réponses** : Modifie le fallback dans `app/api/chat/route.ts`

---

## 🤖 LightKamel avec MCP Server

### Configuration

1. Assure-toi que ton MCP Server est lancé
2. Configure l'URL dans `.env.local` :

```env
MCP_SERVER_URL=http://localhost:3000/mcp
```

3. Le persona utilisera automatiquement le MCP pour générer des réponses intelligentes.

### Fallback

Si le MCP Server n'est pas disponible, LightKamel utilise un système de réponses prédéfinies.

---

## 🚀 Déploiement

### Sur Vercel

1. Installe [Vercel CLI](https://vercel.com/cli)
2. Exécute :

```bash
vercel
```

### Configuration recommandée

- **Framework Preset** : Next.js
- **Output Directory** : `.next`
- **Install Command** : `npm install`
- **Build Command** : `npm run build`

### Variables d'environnement

Ajoute dans Vercel :
- `MCP_SERVER_URL` : URL de ton MCP Server
- `MCP_AUTH_TOKEN` : Token si nécessaire

---

## 💡 Conseils

1. **Commence petit** : Ajoute quelques notes dans le Garden avant de structurer
2. **Utilise les tags** : Pour mieux organiser et filtrer le contenu
3. **LightKamel est là** : N'hésite pas à lui poser des questions !

---

## 📜 Licence

MIT - Fais-en ce que tu veux, mais partage avec amour.

---

> *"Un habitat, c'est comme un jardin : plus tu t'en occupes, plus il te rend heureux."* — LightKamel
