# Roles and Permissions

## public_demo

- Lire uniquement les donnees fictives de demonstration.
- Rechercher avec limitation stricte.
- Aucun import, export sensible ou suppression.

## analyste

- Lire un dossier autorise.
- Effectuer des recherches lexicales et semantiques.
- Consulter les sources et la chronologie.
- Exporter un rapport demo source.

## enqueteur

- Permissions analyste.
- Importer un document dans un dossier autorise.
- Demander une resolution de doublons.

## superviseur

- Permissions enqueteur.
- Valider ou invalider des hypotheses.
- Supprimer un dossier apres procedure.
- Consulter l'audit du dossier.

## administrateur_technique

- Maintenance technique.
- Gestion des comptes et de la configuration.
- Jamais utilise par un agent IA.
- Jamais expose via MCP.

## Regle generale

Un role ne suffit pas. Chaque action doit aussi verifier:

- tenant;
- dossier;
- utilisateur;
- statut agent/humain;
- classification et visibilite.

