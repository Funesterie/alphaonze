# Vérification automatique de la présence du script SD sur Railway

import os

script_path = os.environ.get('SD_SCRIPT_PATH', '/app/apps/server/tools/sd/generate_sd_image.py')

if os.path.exists(script_path):
    print(f"[OK] Script trouvé : {script_path}")
    exit(0)
else:
    print(f"[ERREUR] Script introuvable : {script_path}")
    exit(1)
