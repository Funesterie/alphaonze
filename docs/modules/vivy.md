# Module Vivy

Statut: brouillon valide pour exposition controlee.

## Identite

Nom: Vivy

Phrase de promesse: creer, preparer et publier des contenus musicaux et media sans exposer l'infrastructure A11.

Audience: createurs, Jeff/Max, clients media, explorateurs de la face publique.

Statut public: public + connecte.

## Usage

Probleme resolu: transformer une idee, une voix, une chanson ou un brief media en contenu preparable pour publication.

Actions principales:

- preparer une voix ou reference audio;
- composer un brief chanson;
- assembler clip, titre, description et checklist de publication;
- relier Drive/YouTube dans un client OAuth separe;
- demander a A11 une aide image/video sans afficher A11 comme cockpit.

Mode demo: face publique Vivy, ecoute, vitrine et exemples.

Mode admin: configuration OAuth media, files, publication et verification.

Critere de succes: un createur comprend le prochain clic en moins de 10 secondes.

## Donnees Et Acces

Donnees utilisees: fichiers audio/video fournis, metadonnees de publication, liens Drive/YouTube autorises.

Agents impliques: Vivy, A11 en renfort media, cp pour l'entree portail.

Domaine ou chemin: `vivy.funesterie.me` ou `cp.funesterie.me/vivy`.

Ce qui doit rester cache: secrets OAuth, tokens, workers, logs, MCP brut, Neo4j brut, outils internes.

Risques: melanger artiste publique, outil connecte et console admin.

## Decision

Visible dans `cp.funesterie.me`: oui, module Createur/Media.

Visible hors authentification: oui, vitrine publique limitee.

Notes: utiliser un client OAuth separe pour Drive/YouTube afin d'eviter de polluer l'app Cloudflare/connexion simple.
