# Grok Build + Codex - Mode coopération Funesterie

Status: active local guidance
Date: 2026-06-04
Local CLI observed: `grok 0.2.22`
Inspection note: Grok voit actuellement `D:\projets\funesterie` comme projet
non trusted et importe certaines permissions Claude avec des préfixes inconnus.
Il faut donc préférer les permissions explicites par session.

## Position

Grok Build peut travailler avec Codex, mais pas en mode course folle sur les
mêmes fichiers. La règle Funesterie est simple :

```txt
Codex = opérateur local / intégration / commits / prod safety
Grok Build = plan parallèle / variante / red-team / brouillon isolé
```

Grok peut proposer, comparer, vérifier ou produire une branche. Codex garde la
responsabilité de relire, tester, protéger les secrets, et pousser.

## Règle anti-conflit

Ne pas lancer Grok et Codex en modification automatique sur le même worktree.

Modes autorisés :

```txt
1. lecture / analyse seulement
2. worktree Grok dédié
3. branche Grok dédiée
4. prompt headless court avec sortie texte
```

Modes à éviter :

```txt
--always-approve sur le repo principal
--permission-mode bypassPermissions sur le repo principal
deux agents qui patchent les mêmes fichiers
lecture de secrets, .env, tokens, clés ou captures privées
```

## Commandes sûres

Inspection du projet :

```powershell
grok --cwd D:\projets\funesterie inspect
```

Question ponctuelle sans modification :

```powershell
grok --cwd D:\projets\funesterie -p "Analyse ce plan sans modifier les fichiers." --disable-web-search --no-subagents
```

Travail isolé dans un worktree :

```powershell
grok --cwd D:\projets\funesterie --worktree codex-grok-safe
```

Headless avec auto-vérification, pour comparer des approches :

```powershell
grok --cwd D:\projets\funesterie agent -p "Propose une solution, ne modifie rien." --check --output-format plain
```

## Permissions recommandées

Par défaut :

```txt
--permission-mode default
--no-memory si le sujet contient des données sensibles
--disable-web-search si la tâche porte sur le code local seulement
```

Pour de la génération de variantes :

```txt
--worktree <nom-dedie>
--check
--max-turns borné
```

À réserver à une session très surveillée :

```txt
--best-of-n
--agents
--experimental-memory
```

## MCP

Grok Build expose une commande `grok mcp`, mais l'accès MCP Funesterie doit
rester borné.

Politique :

```txt
public-safe par défaut
OAuth/proxy si besoin
jamais de token brut dans prompt, chat, screenshot ou doc
pas d'accès write Neo4j sans validation Codex/humain
```

## Workflow recommandé

```txt
1. Codex prépare le brief, les limites et les fichiers autorisés.
2. Grok produit un plan, une critique ou un patch dans un worktree.
3. Codex relit le diff.
4. Codex lance les tests.
5. Codex merge/push si c'est propre.
```

## Phrase canon

Grok Build est un atelier parallèle. Codex est le garde-fou d'intégration.
