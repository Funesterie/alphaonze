# NOSSEN — diagnostic du 9 septembre 2026

Périmètre : lecture audio, catalogue `/nossen`, import MP3, scénarisation et récupération des clips. Aucun secret n'est reproduit ici. Les montants et accès ci-dessous sont des observations datées, pas des garanties futures.

## Causes établies avant correction

1. **Durée audio indéfinie sur les imports.** Un MP3 importé est valide : 132,623673 secondes, MP3 stéréo 44,1 kHz, 3 183 639 octets. La route `play-upload` répondait 200/chunked sans `Content-Length` et ignorait `Range`. La route des assets studio répondait correctement 206. FFmpeg et FFprobe 5.1.9 étaient installés et fonctionnels.
2. **Vidéo générée, récupération bloquée.** Comfy annonce le succès du job `5097f8f3-4c78-498e-a417-b2b562862887`; son activité du 7 septembre à 17:56:24 indique 119,5 crédits utilisés. Quelques secondes plus tard, Funesterie échoue avec `media_url_host_forbidden`. Le résultat est une URL signée du bucket `storage.googleapis.com/comfy-cloud-assets/`, absent de l'ancienne liste autorisée. Le même schéma est observé pour la tentative de 16:15.
3. **Échec de scénarisation masqué.** Les deux clés OpenAI directes testées reçoivent 401 `invalid_api_key`. Le séquençage `gpt-4o` utilisait ce chemin, tandis que les relectures passaient déjà par OpenRouter. Une erreur pouvait être remplacée par des scènes génériques, puis entraîner une génération vidéo payante.
4. **Interface sans limite d'attente fiable.** Le client ne vérifiait pas les statuts HTTP, plusieurs états terminaux échappaient au suivi et les liens audio absolus pouvaient être mal préfixés. La liste publique contient 120 morceaux ; ce plafond n'est pas un inventaire de tous les MP3 présents sur disque.
5. **Mauvaise racine locale des assets studio.** Le générateur et le démontage audio cherchaient `/app/runtime/vivy-studio-assets/`, alors que la route publique sert `/app/runtime/files/generated/vivy/`. Le MP3 `vivy-music-suno-100094091396b3c8.mp3` est présent dans le répertoire canonique, lisible, long de 199,915102 secondes, et répond publiquement 206. Il n'est pas manquant.

L'audit FFprobe a contrôlé les 788 MP3 du répertoire généré : aucun échec de décodage/probe, durées de 16,431 à 631,04 secondes. Les 120 liens du catalogue public répondent 206 avec une signature ID3. Les noms historiques contenant `500.html` ne suffisent donc pas à conclure que le contenu est une page d'erreur.

## Accès et crédits observés

| Fournisseur | Observation |
| --- | --- |
| OpenAI direct | Deux anciennes clés refusées : HTTP 401. Nouvelle clé fournie par l'utilisateur ensuite vérifiée : liste des modèles HTTP 200. Solde non établi. |
| OpenRouter | Clé acceptée ; crédits totaux 15 $, utilisation 7,720010198 $, soit environ 7,28 $ restants lors du contrôle. GPT-4o et Grok sont listés. |
| Anthropic / Claude | Liste des modèles et une courte contre-expertise répondent 200. Solde exact non exposé par ces appels. |
| Mistral | Liste des modèles et une courte contre-expertise répondent 200. Solde exact non exposé par ces appels. |
| xAI direct | Initialement 403 pour crédits/plafond. Après recharge annoncée par l'utilisateur : liste des modèles HTTP 200. Ce chemin est distinct de Grok via OpenRouter. |
| Groq | Liste des modèles : 200. Aucun solde exact établi. |
| ElevenLabs | Abonnement Starter actif ; 34 caractères utilisés sur 73 559, soit 73 525 restants. |
| Comfy | Clé actuelle acceptée, compte actif, jobs terminés accessibles. Les 119,5 crédits sont une consommation historique, pas le solde restant. Solde exact non établi par les endpoints contrôlés. |
| Suno | Endpoint de crédits : HTTP 200, solde 2 230. Un callback terminé du 7 septembre contient deux pistes. |
| Mureka | Endpoint billing : HTTP 200, `balance` 2 919, recharge 3 000, consommation 81 ; unité non précisée par le JSON, ne pas convertir en dollars. |
| Twitch | Le worker reçoit `helix_http_401` et reste en veille. Aucun live actif observé ; connexion/token à remettre en état séparément. |

Les réponses de Claude et Mistral servent de contre-expertise ; les preuves causales viennent des requêtes, fichiers et journaux observés. Aucun achat de crédits n'a été effectué par l'agent. La nouvelle clé OpenAI fournie par l'utilisateur doit remplacer les deux anciennes lors de la livraison autorisée.

Un test réel et isolé du Director avec le séquençage explicitement routé vers OpenRouter a obtenu cinq réponses HTTP 200 : Grok pour la direction émotionnelle, Claude pour huit sections de paroles, GPT-4o pour huit plans, GPT-4o pour le montage, Grok pour le scénario. Aucune vidéo n'a été soumise par ce test. La première analyse audio du test a révélé la mauvaise racine locale décrite plus haut ; elle ne valide pas le démontage audio corrigé. Djeff Engine est bien listé dans Ollama (32,8B, CPU), mais sa relecture facultative n'a pas répondu dans la fenêtre de ce test.

## Limite de récupération de l'historique

Le fichier d'état conserve 120 chansons ; un ancien backup n'en ajoute que deux uniques. Les MP3 et callbacks restants n'ont pas de propriétaire/session fiable, et les callbacks contiennent plusieurs candidats par tâche. Ils ne doivent pas être publiés en bloc ni arbitrairement attribués à un utilisateur. Il manque un inventaire historique fiable pour reconstituer un catalogue exhaustif. Les identifiants de génération Comfy n'étaient pas non plus persistés dans les anciens jobs : leur corrélation avec les vidéos du 7 septembre est temporelle, pas une correspondance d'identifiants prouvée.

## Corrections à vérifier en livraison

- Réponses audio avec longueur, `HEAD` et `Range` ; refus des imports manifestement non audio, noms de fichiers uniques.
- Autorisation du seul bucket Comfy observé, sans ouvrir tous les buckets Google ; contrôles de redirection et de destination réseau conservés.
- Lecture des réponses structurées Comfy, conservation des signatures d'URL, erreurs et délais bornés.
- Validation du fichier audio avant les appels payants ; propagation de l'échec du séquençage.
- Séquençage explicitement configurable, maintenu en `gpt-4o` direct avec la nouvelle clé ; le chemin `openai/gpt-4o` OpenRouter a été testé séparément.
- Progression par étape, état partiel explicite, comportement du lecteur et du suivi de tâches testé.

La présence de ces modifications dans le dépôt ne prouve pas leur déploiement. La livraison doit être accompagnée du commit, de la couleur active, des empreintes des fichiers du conteneur, de tests HTTP réels et d'un média final inspecté.
