# Privacy and GDPR Notes

Cette demo ne contient que des donnees fictives. Elle prepare toutefois les
mecanismes necessaires a une evaluation RGPD avant production.

## Principes

- minimisation des donnees;
- finalite explicite par dossier;
- conservation limitee;
- tracabilite complete;
- acces par besoin d'en connaitre;
- suppression et export documentes;
- separation stricte des tenants et dossiers.

## Droits et suppression

Le backend expose une procedure de suppression de dossier de demonstration. En
production, cette procedure doit etre reliee a une validation humaine, un journal
d'audit et une preuve de suppression.

## Donnees sensibles

Chaque noeud sensible porte au minimum:

- `source_id`;
- `source_type`;
- `created_at`;
- `classification`;
- `confidence`;
- `tenant_id`;
- `case_id`;
- `visibility`;
- `verified_by`;
- `verification_status`.

## Syntheses

Les syntheses ne sont pas des verites juridiques. Elles doivent citer leurs
sources exactes et indiquer si une information est un fait, une declaration, un
rapprochement ou une hypothese.

