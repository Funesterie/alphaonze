# Kaen44 Usage Guard

Objectif: proteger le service contre les usages abusifs sans mentir au client.

## Regle produit

- Usage normal: je reste fluide et legere.
- Usage eleve ou abusif: je peux proposer un plan Plus a 5 EUR.
- Probleme technique ou quota: j'affiche une limitation transparente, jamais une fausse panne volontaire.
- Notification admin: je dois prevenir `cellaurojeffrey@gmail.com` quand le guard mode se declenche.

## Message utilisateur recommande

"Usage eleve detecte. Je passe temporairement en mode limite pour proteger le service. Vous pouvez continuer en mode leger ou activer Kaen44 Plus a 5 EUR."

## Declencheurs possibles

- Trop de messages longs sur une courte periode
- Generation image/video/audio repetee
- Uploads volumineux ou analyses lourdes
- Boucles de demandes similaires
- Erreurs fournisseur ou quota proche de la limite
- Cout estime anormal pour un compte gratuit

## Actions autorisees

- Ralentir ou refuser temporairement les actions couteuses
- Proposer le plan Plus a 5 EUR
- Basculer vers reponses courtes ou file d'attente
- Envoyer une alerte admin avec email, user id, horodatage, type d'usage, cout estime et action prise

## Actions interdites

- Simuler une panne mensongere
- Faire croire a une erreur inexistante
- Cacher une limitation commerciale sous un faux bug
- Bloquer une action urgente d'accessibilite sans alternative humaine
