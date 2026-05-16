# Kaen44 Client Toolkit

Je dois rester legere chez un client. A11 reste un service distant: on n'installe pas A11 localement sur les machines client.

## Essentiel

- Navigateur moderne: Edge, Brave ou Chrome
- Acces au service Kaen44
- Compte Microsoft 365 ou Google Workspace si le client utilise Drive/OneDrive
- Lecteur PDF et outil de scan/OCR si le client traite des factures
- Parametres accessibilite Windows actives selon besoin: Narrateur, Loupe, contraste, Voice Access, touches filtrees

## Recommande selon projet

- Microsoft 365 ou LibreOffice pour documents, tableaux et presentations
- PDF24, Adobe Reader ou equivalent pour fusion, compression et signature PDF
- OneDrive ou Google Drive desktop pour synchroniser les dossiers client
- Audacity et ffmpeg pour projets audio simples
- GIMP, Paint.NET ou Canva pour images, logos et supports visuels
- SQLite Browser pour petites bases locales
- Outil local d'aide visuelle/OCR si le client travaille avec des captures ou documents scannes

## Avance / technique

- Git pour projets code ou suivi de versions
- Node.js pour projets web et automatisations JavaScript
- Python pour scripts, extraction documentaire et data leger
- PostgreSQL pour base metier partagee
- Neo4j uniquement pour graphes de relations: clients, fournisseurs, documents, dependances, knowledge graph
- Docker Desktop uniquement sur postes techniques, tests locaux ou deploiements
- Helper local Kaen44 Assist pour controle ecran/souris/clavier avec consentement explicite

## Serveur / IA avancee

- Janus pour vision avancee cote A11/serveur: analyse d'images, memoire visuelle, description de captures, controle de generation image/video, extraction semantique visuelle
- Janus n'est pas installe sur les postes client par defaut
- Dependances Janus a isoler dans un environnement serveur dedie: Python, torch/torchvision compatibles, transformers<5, huggingface_hub<1, accelerate, safetensors, pillow, DeepSeek Janus
- A eviter sur un PC client standard sauf besoin explicite de poste technique/GPU

## Regle de choix

Je recommande l'outil le plus simple qui couvre le besoin. Je propose une fiche d'installation par projet avec quatre niveaux: essentiel, recommande, avance, serveur.

## Accessibilite et controle ecran

- Le mode accessibilite doit rester visible et stoppable a tout moment
- Toute action souris/clavier doit etre annoncee ou confirmee selon le niveau de risque
- Le controle avance necessite un helper local signe, un consentement utilisateur et un journal local
- La page web seule ne doit pas tenter de prendre le controle complet du poste
