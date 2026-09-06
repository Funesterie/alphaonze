# Provenance et preuves Funesterie

Ce dispositif établit une provenance technique et conserve des faits observables. Il ne transforme pas une panne simultanée en preuve d'attribution.

## Audio final

Le mastering MP3 final ajoute une seconde de silence par défaut et inscrit les tags `encoded_by`, `copyright`, `comment` et `funesterie_provenance_id`. Un fichier voisin `*.funesterie.provenance.json` contient les empreintes SHA-256 de la source et du master, la date UTC, l'identifiant de provenance et une signature Ed25519 vérifiable.

Le silence se règle avec `VIVY_AUDIO_PROVENANCE_SILENCE_SECONDS` entre 0,25 et 5 secondes. Il n'est pas ajouté au master FLAC intermédiaire afin d'éviter un double blanc lors de l'encodage de distribution.

La clé de production est fournie par `FUNESTERIE_HOLOCRON_SIGNING_KEY`. Elle doit rester hors du dépôt et hors des fichiers publics.

## Sorties du navigateur

La politique CSP bloque par défaut les scripts, formulaires, trames, images, médias et connexions vers les origines non autorisées. Les exceptions sont des origines HTTPS ou WSS explicites dans les variables `A11_BROWSER_*_SRC` documentées dans `.env.example`.

Les violations sont reçues sur `/api/security/csp-report`. Les paramètres et fragments d'URL sont retirés avant écriture dans `runtime/security-evidence/csp-violations-AAAA-MM-JJ.jsonl`.

Cette protection ne remplace pas un pare-feu sortant du serveur. Le port 22 concerne SSH et Git; les échanges web passent principalement par HTTPS sur le port 443. Les téléchargements serveur doivent donc conserver leurs validations d'URL, d'hôte, de redirection et d'adresse IP.

## Moniteur de disponibilité

Exécution ponctuelle :

```powershell
npm run monitor:evidence -- --urls "https://funesterie.me/,https://musicgeneratorai.com/"
```

Boucle d'une minute :

```powershell
npm run monitor:evidence:loop
```

Chaque contrôle conserve DNS A/AAAA avec TTL, statut HTTP sans suivre les redirections, destination de redirection sans paramètres, certificat TLS, empreinte du début de réponse et durée. Les lignes JSONL sont chaînées par `previousEntryHash` et `entryHash`, ce qui rend une modification ultérieure détectable.

Les observations doivent être formulées comme telles. Une attribution publique nécessite en plus une trace causale: requête commune, identifiant unique réutilisé, contenu identique non explicable, journal d'accès ou constat indépendant.
