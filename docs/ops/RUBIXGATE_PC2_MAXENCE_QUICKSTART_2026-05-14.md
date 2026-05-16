# RubixGate PC2 / Maxence - quickstart

Objectif court terme : PC2 ne manipule aucun token. Maxence utilise Funesterie Desktop et fait seulement les mises a jour de l'application.

## Porte simple

1. Ouvrir Funesterie Desktop.
2. Choisir le profil `PC2 - Maxence`.
3. Utiliser le bouton de mise a jour de l'application.
4. Ne jamais coller de token dans un chat, un fichier, ou une capture.

## Cote operateur PC1

Avant toute action sur PC2, verifier l'identite machine :

```powershell
cd D:\projets\funesterie\a11mcp
.\scripts\Confirm-RubixGatePc2Identity.ps1
```

Le check doit confirmer `DESKTOP-6UQGRCR` et `192.168.1.3`. Sinon, arreter.

Creer une capsule update-only :

```powershell
cd D:\projets\funesterie\a11mcp
$env:RUBIXGATE_PASSPHRASE = Read-Host "RubixGate passphrase"
.\scripts\New-RubixGatePc2UpdateCapsule.ps1 -Window "00:00-23:59" -TtlMinutes 30
```

Activer une capsule :

```powershell
.\scripts\Invoke-RubixGateCapsule.ps1 -CapsulePath "D:\agent-bus\rubixgate\capsules\<capsule>.capsule.json"
```

Par defaut, l'activation ne revele pas le payload. Elle verifie la fenetre, le challenge, le hash, puis ecrit l'audit sans secret.

## Regles

- RubixGate ne doit jamais afficher de bearer token brut.
- Une capsule privilegiee doit avoir un TTL court.
- Toute activation est auditee dans `D:\agent-bus\rubixgate\rubixgate-audit.jsonl`.
- Pour PC2, le scope normal est `desktop-update-only`.
