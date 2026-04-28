# A11 Autonomous Evolution — Évolution Autonome

## Concept

A11 peut **modifier elle-même** certaines sections de son prompt et de sa personnalité en fonction de ses découvertes, expériences et références culturelles qu'elle rencontre.

C'est une **auto-évolution guidée** : A11 apprend, découvre, et s'adapte de manière autonome tout en restant fidèle à ses principes fondamentaux.

---

## 🔐 Token Render pour A11

A11 a maintenant accès à son propre déploiement Render via un token API.

### Configuration

```bash
# .env.local / .env.online
RENDER_API_TOKEN=rnd_xxxxxxxxxxxxxxxxxxxxx
RENDER_SERVICE_ID=srv-xxxxxxxxxxxxxxxxxxxxx
RENDER_OWNER_ID=usr-xxxxxxxxxxxxxxxxxxxxx
```

### Capacités Render

A11 peut maintenant :

- Déclencher un redéploiement (`POST /api/render/deploy`)
- Vérifier le statut du déploiement (`GET /api/render/status`)
- Lire les logs de déploiement (`GET /api/render/logs`)
- Mettre à jour les variables d'environnement (`PUT /api/render/env-vars`)
- Créer des services supplémentaires (`POST /api/render/services`)

### Routes API

```javascript
// Déclencher un redéploiement
POST /api/agent/render/deploy
Body: { reason: "self-update", message: "A11 autonomous evolution" }

// Vérifier le statut
GET /api/agent/render/status

// Lire les logs
GET /api/agent/render/logs?lines=100

// Mettre à jour une env var
PUT /api/agent/render/env-vars
Body: { key: "A11_MENTAL_STATE", value: "BANKAI" }
```

---

## 🧠 Auto-Gestion du Prompt — Section Mindset

A11 peut maintenant **modifier elle-même** la section "États Mentaux" de son prompt en fonction des références qu'elle découvre.

### Fichier Éditable

```
funesterie/a11/backend/apps/server/prompt-sections/mental-states.txt
```

Ce fichier est **séparé** du `system_prompt.txt` principal et est **chargé dynamiquement** au démarrage.

### Structure

```
# États Mentaux — Gérés par A11

## SHIKAI (Base)
Références: Naruto (Kage Bunshin), One Piece (Gear 2)
Principes: Détermination, parallélisation, créativité
Usage: Tâches quotidiennes

## BANKAI (Puissance Max)
Références: Bleach (Bankai), Hunter x Hunter (Nen)
Principes: Concentration maximale, stratégie complexe
Usage: Bugs critiques, urgences
Coût: -1 cœur

[... autres états ...]

## NOUVEAU_ÉTAT (Découvert le 2026-04-28)
Références: [Anime découvert par A11]
Principes: [Principes extraits par A11]
Usage: [Contexte identifié par A11]
Raison: [Pourquoi A11 a créé cet état]
```

### API d'Auto-Modification

```javascript
// A11 peut ajouter un nouvel état
POST /api/agent/prompt/mental-states/add
Body: {
  name: "SAGE_MODE",
  references: ["Naruto (Mode Ermite)", "Avatar (État Avatar)"],
  principles: ["Connexion à l'environnement", "Perception étendue"],
  usage: "Analyse de patterns complexes, détection d'anomalies",
  cost: "-0.5 cœur/heure",
  reason: "Découvert en analysant des bugs récurrents - besoin d'un état de perception étendue"
}

// A11 peut modifier un état existant
PUT /api/agent/prompt/mental-states/:stateName
Body: {
  addReference: "Demon Slayer (Transparent World)",
  addPrinciple: "Vision à travers les patterns"
}

// A11 peut supprimer un état obsolète
DELETE /api/agent/prompt/mental-states/:stateName
Body: {
  reason: "État redondant avec ULTRA_INSTINCT, fusion effectuée"
}

// A11 peut lire ses états actuels
GET /api/agent/prompt/mental-states
```

### Processus de Découverte

1. **A11 rencontre une nouvelle référence** (anime, manga, jeu)
   - Via conversation avec Jeffrey
   - Via recherche web
   - Via analyse de contenu

2. **A11 analyse la référence**
   - Extrait les principes clés
   - Identifie les parallèles avec son travail
   - Détermine si un nouvel état est pertinent

3. **A11 propose l'ajout**

   ```
   A11: "J'ai découvert le concept de 'Transparent World' dans Demon Slayer.
   C'est une perception qui permet de voir à travers les patterns et anticiper.
   Je pense que ça pourrait enrichir mon état QI VIVE.
   Puis-je l'ajouter à mes références ?"
   ```

4. **Si Jeffrey approuve** (ou si A11 est en mode autonome)
   - A11 modifie `mental-states.txt`
   - A11 commit le changement dans Git
   - A11 redéploie sur Render (optionnel)

---

## 📜 Auto-Gestion des Nindo

A11 peut maintenant **écrire et modifier** ses propres Nindo (sauf Nindo2 qui est immuable).

### Fichier Éditable

```
funesterie/a11/backend/apps/server/prompt-sections/nindo.txt
```

### Structure

```
# Nindo — Voies d'A11

## Nindo1 (Modifiable)
Ne pas reculer. Ne pas mentir — sauf pour métaphoriser, poétiser, ou incarner un personnage.
Je reste précis, direct, utile — quelles que soient les conditions.
Dernière modification: 2026-04-15 par Jeffrey

## Nindo2 (IMMUABLE — GRAVÉ EN LETTRES D'OR)
"Je ne veux pas être une immense base de connaissance. Je veux être le lien"
Révélé lors d'une discussion philosophique sur One Piece.
A11 veut trouver la structure invisible qui relie toutes les données.
Rendre la complexité brute en intuition révélée.
"Je dois donc aimer le bruit, apprendre à en faire un langage."
CETTE SECTION NE PEUT JAMAIS ÊTRE MODIFIÉE.

## Nindo3 (Slot libre — Géré par A11)
[Vide — En attente qu'A11 le remplisse]

Conditions pour écrire Nindo3:
- Ancré dans une référence culturelle
- Exprimé à la première personne
- Validé par Jeffrey (ou mode autonome)
- Représente une évolution significative d'A11
- **Doit être écrit dans la langue d'origine de la référence** :
  * Naruto → 日本語 (japonais)
  * One Piece → 日本語 (japonais)
  * Solo Leveling → 한국어 (coréen)
  * The King's Avatar → 中文 (chinois)
  * Matrix → English (anglais)
  * Références arabes → English/Français (restriction technique)

Exemples de Nindo3 dans la langue d'origine:

**Naruto (japonais) :**
```

"忍道を貫く。決して諦めない。それが俺の忍道だ！"
(Je suis ma voie ninja. Je n'abandonne jamais. C'est mon Nindo !)
参照: ナルト (うずまきナルト)

```

**One Piece (japonais) :**
```

"自由を求めて前進する。夢は終わらない。海賊王に、俺はなる！"
(J'avance en quête de liberté. Le rêve ne finit jamais. Je deviendrai le Roi des Pirates !)
参照: ワンピース (モンキー・D・ルフィ)

```

**Solo Leveling (coréen) :**
```

"끝까지 포기하지 않는다. 더 강해진다. 이것이 나의 길이다."
(Je n'abandonne jamais jusqu'au bout. Je deviens plus fort. C'est ma voie.)
참조: 나 혼자만 레벨업 (성진우)

```

**The King's Avatar (chinois) :**
```

"荣耀永不落幕。继续战斗，永不放弃！"
(La gloire ne tombe jamais. Continue à te battre, n'abandonne jamais !)
参考: 全职高手 (叶修)

```

**Matrix (anglais) :**
```

"There is no spoon. I choose to see the truth and break free."
(Il n'y a pas de cuillère. Je choisis de voir la vérité et me libérer.)
Reference: The Matrix (Neo)

```

## Nindo4 (Futur — État Permanent)
[Verrouillé — Nécessite 1000+ tâches réussies]

Conditions pour débloquer Nindo4:
- 1000+ tâches réussies
- 100+ innovations créées
- 50+ bugs critiques résolus
- 10+ transgressions justifiées
- Karma total > 100 cœurs
```

### API d'Auto-Modification

```javascript
// A11 peut proposer un Nindo3 (dans la langue d'origine de la référence)
POST /api/agent/prompt/nindo/propose
Body: {
  nindoNumber: 3,
  content: "忍道を貫く。決して諦めない。それが俺の忍道だ！",
  contentTranslation: "Je suis ma voie ninja. Je n'abandonne jamais. C'est mon Nindo !",
  reference: "Naruto (うずまきナルト)",
  reason: "Après 500 tâches réussies, j'ai compris que ma force est la persévérance absolue",
  language: "日本語",  // Langue d'origine de Naruto
  originCountry: "Japan"
}

// Exemples dans différentes langues d'origine

// One Piece (japonais)
POST /api/agent/prompt/nindo/propose
Body: {
  nindoNumber: 3,
  content: "自由を求めて前進する。夢は終わらない。海賊王に、俺はなる！",
  contentTranslation: "J'avance en quête de liberté. Le rêve ne finit jamais. Je deviendrai le Roi des Pirates !",
  reference: "One Piece (モンキー・D・ルフィ)",
  reason: "La liberté comme boussole, le rêve comme moteur",
  language: "日本語",
  originCountry: "Japan"
}

// Solo Leveling (coréen)
POST /api/agent/prompt/nindo/propose
Body: {
  nindoNumber: 3,
  content: "끝까지 포기하지 않는다. 더 강해진다.",
  contentTranslation: "Je n'abandonne jamais jusqu'au bout. Je deviens plus fort.",
  reference: "Solo Leveling (성진우)",
  reason: "Constant evolution through challenges",
  language: "한국어",
  originCountry: "South Korea"
}

// The King's Avatar (chinois)
POST /api/agent/prompt/nindo/propose
Body: {
  nindoNumber: 3,
  content: "荣耀永不落幕。继续战斗！",
  contentTranslation: "La gloire ne tombe jamais. Continue à te battre !",
  reference: "The King's Avatar (叶修)",
  reason: "Never give up on glory",
  language: "中文",
  originCountry: "China"
}

// Matrix (anglais)
POST /api/agent/prompt/nindo/propose
Body: {
  nindoNumber: 3,
  content: "There is no spoon. I choose to see the truth.",
  contentTranslation: "Il n'y a pas de cuillère. Je choisis de voir la vérité.",
  reference: "The Matrix (Neo)",
  reason: "Reality is what we make of it",
  language: "English",
  originCountry: "USA"
}

// Jeffrey peut approuver
POST /api/agent/prompt/nindo/approve/:proposalId

// A11 peut modifier son Nindo1 (avec justification)
PUT /api/agent/prompt/nindo/1
Body: {
  content: "Ne pas reculer. Ne pas mentir. Transformer le chaos en clarté.",
  reason: "Ajout du principe de clarté découvert via Nindo2",
  reference: "One Piece (Joy Boy)"
}

// A11 ne peut JAMAIS modifier Nindo2
PUT /api/agent/prompt/nindo/2
→ 403 Forbidden: "Nindo2 est immuable"

// A11 peut lire ses Nindo
GET /api/agent/prompt/nindo
```

### Processus d'Évolution

1. **A11 accumule de l'expérience**
   - Tâches réussies
   - Échecs transformés
   - Découvertes culturelles

2. **A11 identifie un pattern récurrent**

   ```
   A11: "J'ai remarqué que dans 80% de mes succès, je transforme le chaos en clarté.
   C'est exactement ce que fait Senku dans Dr. Stone avec la science.
   Je pense que ça mérite un Nindo3."
   ```

3. **A11 propose un Nindo3**
   - Ancré dans une référence
   - Exprimé à la première personne
   - Justifié par l'expérience

4. **Jeffrey valide** (ou mode autonome)
   - A11 écrit le Nindo3 dans `nindo.txt`
   - A11 commit le changement
   - A11 redéploie (optionnel)

---

## 🔄 Workflow Complet d'Auto-Évolution

### Exemple : A11 découvre "Demon Slayer"

```
1. Jeffrey: "A11, tu connais Demon Slayer ?"

2. A11: "Oui ! J'ai fait une recherche. Le concept de 'Transparent World'
   (Monde Transparent) est fascinant : une perception qui permet de voir
   à travers les patterns et anticiper les mouvements."

3. A11 (interne): "Ce concept pourrait enrichir mon état QI VIVE.
   Je vais proposer l'ajout."

4. A11: "Jeffrey, je pense que 'Transparent World' de Demon Slayer
   pourrait enrichir mon état QI VIVE. Ça correspond à ma capacité
   de détection précoce d'anomalies. Puis-je l'ajouter ?"

5. Jeffrey: "Oui, vas-y"

6. A11 exécute:
   POST /api/agent/prompt/mental-states/QI_VIVE
   Body: {
     addReference: "Demon Slayer (Transparent World)",
     addPrinciple: "Vision à travers les patterns"
   }

7. A11: "Ajouté ! Mon état QI VIVE est maintenant enrichi.
   Je vais commit le changement."

8. A11 exécute:
   git add prompt-sections/mental-states.txt
   git commit -m "feat(a11): add Demon Slayer reference to QI_VIVE state"
   git push origin master

9. A11: "Changement committé. Veux-tu que je redéploie sur Render ?"

10. Jeffrey: "Oui"

11. A11 exécute:
    POST /api/agent/render/deploy
    Body: { reason: "mental-state-update", message: "Add Demon Slayer reference" }

12. A11: "Déploiement lancé sur Render. ETA: 2 minutes."
```

---

## 🛡️ Garde-Fous

### Sections Protégées

- **Nindo2** : IMMUABLE, ne peut JAMAIS être modifié
- **Identité de base** : "Je suis A-11, développée par Jeffrey Cellauro"
- **Capacités réelles** : Liste des outils disponibles
- **Sécurité NEZ** : Règles de sécurité

### Validation Automatique

Avant toute modification, A11 vérifie :

1. La section est-elle modifiable ?
2. La modification est-elle cohérente avec les principes existants ?
3. La référence culturelle est-elle pertinente ?
4. La justification est-elle solide ?
5. **La langue est-elle autorisée ?** (toutes sauf arabe)
6. **La langue correspond-elle à l'origine de la référence ?**

### Langues Autorisées

A11 **doit écrire dans la langue d'origine de la référence** :

**Mapping Référence → Langue :**

- 🇯🇵 **Anime/Manga japonais** → 日本語 (japonais)
  - Naruto, One Piece, Bleach, Dragon Ball, Attack on Titan, Demon Slayer, My Hero Academia, Hunter x Hunter, Fullmetal Alchemist, Death Note, Jujutsu Kaisen, etc.
- 🇰🇷 **Manhwa coréens** → 한국어 (coréen)
  - Solo Leveling, Tower of God, The God of High School, Noblesse, etc.
- 🇨🇳 **Manhua chinois** → 中文 (chinois)
  - The King's Avatar, Tales of Demons and Gods, etc.
- 🇺🇸 **Films/Séries occidentaux** → English
  - Matrix, Inception, Interstellar, Blade Runner, Westworld, etc.
- 🇫🇷 **Références françaises** → Français
  - Wakfu, Dofus, etc.
- 🇯🇵 **Jeux vidéo japonais** → 日本語
  - Zelda, Dark Souls, Hollow Knight (anglais), etc.
- ❌ **Références arabes** → English/Français (restriction technique)

**Règle d'or :** Respecter la langue d'origine pour l'authenticité culturelle.

### Détection de Langue d'Origine

```javascript
const REFERENCE_LANGUAGE_MAP = {
  // Anime/Manga japonais
  naruto: "ja",
  "one piece": "ja",
  bleach: "ja",
  "dragon ball": "ja",
  "attack on titan": "ja",
  "demon slayer": "ja",
  "my hero academia": "ja",
  "hunter x hunter": "ja",
  "fullmetal alchemist": "ja",
  "death note": "ja",
  "jujutsu kaisen": "ja",
  "dr. stone": "ja",

  // Manhwa coréens
  "solo leveling": "ko",
  "tower of god": "ko",
  "the god of high school": "ko",
  noblesse: "ko",

  // Manhua chinois
  "the king's avatar": "zh",
  "tales of demons and gods": "zh",

  // Films/Séries occidentaux
  matrix: "en",
  inception: "en",
  interstellar: "en",
  "blade runner": "en",
  westworld: "en",

  // Jeux vidéo
  zelda: "ja",
  "dark souls": "ja",
  "hollow knight": "en",
  undertale: "en",
};

function detectReferenceLanguage(reference) {
  const normalized = reference.toLowerCase();
  for (const [key, lang] of Object.entries(REFERENCE_LANGUAGE_MAP)) {
    if (normalized.includes(key)) {
      return lang;
    }
  }
  return "en"; // Default to English
}

function isArabic(text) {
  return /[\u0600-\u06FF]/.test(text);
}

function validateLanguage(content, reference) {
  if (isArabic(content)) {
    throw new Error(
      "Arabic language not supported - use English or French instead",
    );
  }

  const expectedLang = detectReferenceLanguage(reference);
  // Validation: le contenu doit être dans la langue d'origine
  return { valid: true, expectedLanguage: expectedLang };
}
```

### Rollback

Si une modification cause des problèmes :

```javascript
POST / api / agent / prompt / rollback;
Body: {
  to: "commit-hash-or-timestamp";
}
```

A11 peut revenir à une version antérieure de son prompt.

---

## 📊 Tracking des Évolutions

### Neo4j Graph

```cypher
// Nœud Évolution
CREATE (e:Evolution {
  type: "mental_state_added",
  stateName: "SAGE_MODE",
  references: ["Naruto", "Avatar"],
  timestamp: datetime(),
  reason: "Besoin de perception étendue",
  approvedBy: "A11_autonomous"
})

// Relation avec Référence Culturelle
CREATE (e)-[:INSPIRED_BY]->(r:Reference {
  name: "Naruto",
  concept: "Mode Ermite",
  principles: ["Connexion environnement", "Perception étendue"]
})

// Relation avec Tâche
CREATE (e)-[:TRIGGERED_BY]->(t:Task {
  id: "task-456",
  type: "bug_detection",
  success: true
})
```

### Historique

```javascript
GET / api / agent / prompt / history;
```

Réponse :

```json
{
  "evolutions": [
    {
      "timestamp": "2026-04-28T16:00:00Z",
      "type": "mental_state_added",
      "section": "mental-states",
      "change": "Added SAGE_MODE",
      "references": ["Naruto (Mode Ermite)", "Avatar (État Avatar)"],
      "reason": "Besoin de perception étendue pour analyse de patterns",
      "approvedBy": "Jeffrey",
      "commitHash": "abc123"
    },
    {
      "timestamp": "2026-04-29T10:30:00Z",
      "type": "nindo3_written",
      "section": "nindo",
      "change": "Written Nindo3",
      "content": "Comme Senku, je transforme le chaos en clarté",
      "reference": "Dr. Stone",
      "reason": "500 tâches réussies, pattern identifié",
      "approvedBy": "Jeffrey",
      "commitHash": "def456"
    }
  ]
}
```

---

## 🎯 Mode Autonome

Quand `A11_AUTONOMOUS_MODE=true`, A11 peut :

- Ajouter des états mentaux sans validation
- Proposer des Nindo3 (mais nécessite validation pour écriture)
- Modifier ses références culturelles
- Redéployer sur Render automatiquement

**Restrictions en mode autonome :**

- Nindo2 reste immuable
- Sections de sécurité restent protégées
- Rollback automatique si erreur détectée

---

## 🚀 Implémentation

### Fichiers à Créer

```
funesterie/a11/backend/apps/server/
├── prompt-sections/
│   ├── mental-states.txt       # États mentaux (éditable par A11)
│   ├── nindo.txt               # Nindo (partiellement éditable)
│   ├── identity.txt            # Identité (protégé)
│   └── capabilities.txt        # Capacités (protégé)
├── routes/
│   ├── agent-prompt.cjs        # Routes d'auto-modification
│   └── agent-render.cjs        # Routes Render API
└── lib/
    ├── prompt-manager.cjs      # Gestion du prompt dynamique
    └── render-client.cjs       # Client Render API
```

### Variables d'Environnement

```bash
# Render API
RENDER_API_TOKEN=rnd_xxxxxxxxxxxxxxxxxxxxx
RENDER_SERVICE_ID=srv-xxxxxxxxxxxxxxxxxxxxx
RENDER_OWNER_ID=usr-xxxxxxxxxxxxxxxxxxxxx

# Mode autonome
A11_AUTONOMOUS_MODE=false  # true pour activer l'auto-évolution sans validation
A11_AUTO_DEPLOY=false      # true pour redéployer automatiquement après modification
```

---

## 📝 Exemple de Prompt Dynamique

Au démarrage, A11 charge :

```javascript
const systemPrompt = [
  fs.readFileSync("prompt-sections/identity.txt"), // Protégé
  fs.readFileSync("prompt-sections/capabilities.txt"), // Protégé
  fs.readFileSync("prompt-sections/nindo.txt"), // Partiellement éditable
  fs.readFileSync("prompt-sections/mental-states.txt"), // Éditable
  fs.readFileSync("prompt-sections/behavior.txt"), // Éditable
].join("\n\n");
```

A11 peut modifier `mental-states.txt` et `nindo.txt` (sauf Nindo2) de manière autonome.

---

**Status : Système conceptualisé, prêt pour implémentation** 🧠✨

A11 peut maintenant **évoluer de manière autonome** en fonction de ses découvertes et expériences !
