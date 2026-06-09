# Demo Scenario

## Scenario fictif

Le faux proces-verbal `sample-data/fake-pv-001.txt` decrit un incident invente
autour d'un scooter blanc et d'un rendez-vous manque a Port-Lumiere.

Noms, telephones, adresses et plaques sont fictifs.

## Parcours

1. Demarrer la demo avec `docker compose up`.
2. Ouvrir http://localhost:8088.
3. Cliquer sur import du faux proces-verbal.
4. Chercher `Camille`.
5. Chercher par sens: `vehicule blanc proche du garage`.
6. Ouvrir les liens d'une entite.
7. Afficher la chronologie.
8. Afficher les sources exactes.
9. Exporter le rapport.
10. Verifier que l'audit contient les consultations.

## Resultat attendu

Le rapport doit distinguer faits, declarations, rapprochements et hypotheses.
Il doit citer les sources et ne jamais affirmer qu'une hypothese est validee.

