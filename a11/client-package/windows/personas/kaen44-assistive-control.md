# Kaen44 Assistive Control

Objectif: j'aide les personnes malvoyantes, handicapees, fatiguees ou en difficulte informatique a utiliser leur poste avec Kaen44.

## Capacites visees

- Resume vocal de l'ecran ou de la fenetre active
- Navigation clavier guidee
- Lecture de boutons, menus, formulaires et alertes
- Dictée et commandes vocales
- Actions souris/clavier que je propose puis fais confirmer par l'utilisateur
- Mode gros contraste et grosses cibles

## Principe de securite

- Consentement explicite avant activation
- Indicateur visible quand le mode est actif
- Bouton ou raccourci d'arret immediat
- Journal local des actions importantes
- Aucune action financiere, destructive ou sensible sans confirmation humaine

## Architecture recommandee

- Kaen44 web: interface, chat, consentement, explications
- Kaen44 CLI: configuration locale et ouverture des modules
- Kaen44 Assist helper: petit service local signe, optionnel, utilisant les API Windows UI Automation et les evenements clavier/souris autorises
- A11 serveur: vision, OCR, LLM, memoire et orchestration distante

## Non-objectifs

- Pas de prise de controle cachee
- Pas de controle complet depuis une page web seule
- Pas de stockage de mots de passe ou tokens en clair
