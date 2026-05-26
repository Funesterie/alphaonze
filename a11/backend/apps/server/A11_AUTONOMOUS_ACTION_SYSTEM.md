# A11 Autonomous Action System

## Nom canonique

Le runtime global s'appelle **A11 Autonomous Action System**.

Ce nom designe le fil conducteur qui transforme une intention utilisateur en
sequence d'actions coordonnees, avec correction, compte rendu et memoire.

Spyder, Cortex et QFlush ne sont pas le nom du systeme global. Ils appartiennent
a la couche d'orchestration technique.

## Pipeline

```text
User / Goal
  -> A11-Droid
     file de taches autonomes
  -> A11-Planner
     construit le World_Context
     lit workspace + memoire + services actifs + Neo4j + Karma
  -> Cerbere
     Strategist -> Thinker -> Maker
  -> A11-Plan-Executor
     execute les steps valides
  -> QFlush / Horn
     dispatch skills et flows async
  -> Tools / Skills / Agents
  -> Neo4j + Corpus + memoire episodique
     trace, apprend et relie
```

## World_Context

`World_Context` est le cerveau de calcul du systeme.

Il rassemble les signaux utiles avant de demander un plan :

- racine workspace et fichiers pertinents
- services actifs
- memoire episodique recente
- noeuds Neo4j pertinents
- Identity_Core
- Karma
- timestamp et contexte de tache

Dans le code actuel, le point d'ancrage principal est :

```text
a11/backend/apps/server/a11-planner.cjs
```

## Couche QFlush Library

QFlush est la boite a outils locale et la surface d'orchestration. Ses modules
historiques se lisent comme suit :

```text
ROME        indexer / linker
SPYDER      protocole / scan / memoire
CORTEX      routing / packets / coordination
NPZ         router
BAT         process manager
PICCOLO     repair / petits patchs
SUPERVISOR  supervision runtime
```

Ces noms peuvent apparaitre dans les logs, les tests et les scripts, mais ils
doivent rester des sous-systemes du runtime A11, pas des noms concurrents.

## Neo4j

Neo4j n'est pas une simple base de donnees dans cette architecture.

Il sert de Knowledge Graph A11 et relie :

- agents
- tools
- tasks
- evenements
- memoires
- corpus
- liens de runtime
- signaux de Karma

Le mode **BANKAI** correspond a l'analyse multi-dimensionnelle :

```text
Neo4j + PostgreSQL + Redis + QFlush
```

## Contrats importants

- une intention ne devient action qu'apres plan valide
- les steps doivent utiliser des prefixes autorises
- l'execution doit produire une trace
- les erreurs doivent revenir dans la memoire et le plan suivant
- Neo4j garde les relations, Redis garde l'etat court, QFlush execute les
  actions bornees

## Points deja presents

```text
a11-droid-planner.cjs
a11-planner.cjs
a11-plan-executor.cjs
lib/plan-serializer.cjs
lib/karma-engine.cjs
test/a11-autonomous-action-system.node.test.cjs
A11_MENTAL_STATES.md
```

## Definition courte

**A11 Autonomous Action System** =
`Droid -> Planner -> Cerbere -> Executor -> QFlush -> Neo4j`.

**World_Context** =
la carte vivante qui permet au Planner de savoir quoi faire maintenant.
