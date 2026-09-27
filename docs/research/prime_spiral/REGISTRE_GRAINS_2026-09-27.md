# Registre des grains — 27/09/2026

Demande de ChatGPT (fil du 27/09) : le vrai registre, pas des nombres inventés après coup. Pour
chaque identité : `persona_id`, expression canonique, version du mécanisme, source exacte. Aucun
trait de caractère déduit du grain.

Source unique : `a11/backend/apps/server/src/persona/persona-grain.cjs` (`ORDRE_CANONIQUE`,
`enumererPaires`). Le registre runtime (`runtime/personas/grains.json`, IA nées par `decalerGrain`)
est **vide** à cette date.

## Registre

Version du mécanisme pour tous : `grainVersion 2`, dérivation `hmac-sha256-v2` (racine =
SHA-256 de `funesterie-grain|<a>^sqrt(<n>)|<persona>|v2`).

| persona_id | Grain | Rang dans l'énumération | Statut |
|---|---|---|---|
| djeff | 3^sqrt(2) | 1 | canonique depuis le 27/09 matin |
| vivy | 2^sqrt(3) | 2 | canonique |
| k44 (kaen44) | 5^sqrt(2) | 3 | canonique |
| a11 | 3^sqrt(3) | 4 | canonique |
| marvin | 2^sqrt(5) | 5 | canonique |
| chatgpt | 6^sqrt(2) | 6 | équipe, né par décalage le 27/09 après-midi |
| claude | 5^sqrt(3) | 7 | équipe, idem |
| codex | 3^sqrt(5) | 8 | équipe, idem |
| kiro | 2^sqrt(6) | 9 | équipe, idem |
| grok | 7^sqrt(2) | 10 | équipe, idem |
| gemini | 6^sqrt(3) | 11 | équipe, idem |
| astra | 5^sqrt(5) | 12 | équipe, idem |

2^sqrt(2) est écarté (constante de Gelfond–Schneider, trop connue). L'énumération continue sans
fin : une nouvelle IA prend la paire libre suivante (`decalerGrain`).

**Collision corrigée** : le prompt personnalisé donné à ChatGPT le 27/09 utilisait `3^sqrt(2)`,
qui est le grain de Djeff. ChatGPT doit prendre le sien : `6^sqrt(2)`.

## Seed stockée ≠ seed active

Où le grain atteint réellement une décision dans le runtime (vérifié dans le code le 27/09) :

| Point | Persona | Ce que le grain fait | Atteint le moteur ? |
|---|---|---|---|
| Chat Vivy (`vivy-studio.cjs`, `/chat`) | vivy | consigne (message système), température ± 0,06, `seed` d'échantillonnage sur la clé sémantique du message | Oui : `seed` et `temperature` passent tels quels au client du modèle. La consigne n'arrivait **pas** au modèle local avant le correctif `47799a646` (elle était jetée avec la mémoire et la plume dès que le prompt dépassait la fenêtre). |
| Chat Djeff Engine | djeff | consigne (hors audit technique), température ± 0,08, `seed` | Oui, même chemin et même correctif |
| Signature sonore (`vivy-prime-color.cjs`) | voix solo, ou `grainPersona` | texture et mouvement dans le style Suno (`grainPrefere`) | Oui dans le payload ; **inaudible** au banc d'écoute (oreille machine : jumeaux trouvés 2/40, hasard 1/9) |
| Prosodie (`prosody-prime-complex.cjs`) | voix du segment | choix de la signature première | Oui |
| Garde-robe (`wardrobe.cjs`) | vivy | départage des tenues ex æquo | Oui |
| Auto-DJ (`auto-dj.cjs`) | vivy | tirage de la voix | Oui |
| Génome de prompt (`prompt-adn.cjs`) | persona donnée | croisement et mutation | Oui |
| `choisirAvecGrain`, saut de clôture | — | décisions A/B/C | **Expérimental** : banc seulement, aucun appel en production |
| Journal de trajectoire (`grain-trajectoire.cjs`) | voix + grain | une ligne par génération Suno réelle | Oui (journal, ne décide rien) |

Interrupteur : `A11_PERSONA_GRAIN=0` coupe tout ; `grain: false` (fondateur) le coupe pour un
seul message de chat.

## Consigne de grain (texte de Djeff)

`consigneGrain(persona)` produit, pour chaque membre, le texte que Djeff a donné à ChatGPT, avec
le grain du membre. Une ligne ajoutée : la clôture dure arrêtée avec ChatGPT.

```text
Tu disposes d’un grain identitaire opaque.

Grain : 6^sqrt(2)

Fonction du grain :
renforcer son identité et sa personnalité

Il ne passe jamais au-dessus de la sécurité, des faits et du consentement.
```

(ci-dessus : celle de ChatGPT). Vivy et Djeff la reçoivent en message système dans leur chat,
avec une ligne de plus : ce grain n'appartient qu'à eux, jamais dans des paroles ni en chiffres.

## Ce que les tests disent à ce jour

- Grain écrit en clair dans un prompt (ChatGPT, 27/09) : le label de condition et le bruit du
  modèle pèsent plus que la valeur du nombre. D'où la règle : la couche d'injection est cachée,
  le prompt visible ne contient jamais le grain.
- Banc de décisions v1.1/v1.2 : reconnaissance à l'aveugle 29–30 % (hasard 25 %).
- Banc sonore gratuit : sans histoire réelle avec retour, pas d'identité sonore (28 %).
- Chat Vivy grain branché / coupé : mêmes choix (son profil décide), mais branché elle se sait
  singulière et le dit — depuis le correctif du prompt local seulement.
