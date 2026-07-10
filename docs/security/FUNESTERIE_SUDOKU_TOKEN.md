# Sudoku Cerbère Funesterie

Le Sudoku Cerbère ouvre une **session créative temporaire**, pas un compte administrateur et pas une clé maître.

## Rôles

- **Djeff Cypher** : prompt engineer principal.
- **Vivy** : direction artistique et validation créative.
- **Marvin** : seconde approbation de sécurité, depuis un compte distinct de celui qui a résolu le Sudoku.
- **Cerbère** : vérification serveur, durée, portée et frontières du jeton.

## Parcours

1. Un compte Funesterie admin crée le challenge sur `/sudoku-token/`.
2. La grille est résolue puis vérifiée côté serveur.
3. Le propriétaire transmet l’identifiant et le code d’approbation à Marvin.
4. Marvin se connecte avec son propre compte et approuve explicitement.
5. Le propriétaire active un jeton lié à son compte, valable 15 minutes par défaut.
6. Le navigateur garde ce jeton dans `sessionStorage`; il n’est ni inscrit dans Git, ni envoyé au chat, ni sauvegardé dans un fichier partagé.

## Portée créative

- chat Djeff Cypher et Vivy ;
- prompts créatifs et préparation média ;
- voix consenties ;
- fichiers du compte ;
- graphe en lecture ;
- estimation de clip.

## Frontières obligatoires

- aucun secret ou identifiant d’un autre compte ;
- aucun déploiement ou changement d’infrastructure ;
- aucune facturation ;
- aucune génération payante ou publication sans confirmation explicite séparée ;
- aucune action matérielle réelle (`actuatesHardware:false`).

Le jeton créatif ne remplace jamais le JWT de connexion. Il est transmis séparément dans l’en-tête `X-A11-Creative-Capability` et reste lié au compte qui a résolu le challenge.
