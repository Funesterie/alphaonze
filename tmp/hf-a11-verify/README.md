---
title: A11
emoji: 🚀
colorFrom: indigo
colorTo: blue
sdk: gradio
sdk_version: "4.44.1"
python_version: "3.10"
app_file: app.py
pinned: false
license: mit
short_description: Application IA multimodale A11
---

# A11

Space Gradio minimal pour Hugging Face.

Objectif:
- demarrer proprement sur Hugging Face Spaces
- eviter l'erreur `ImportError: cannot import name 'HfFolder' from 'huggingface_hub'`
- garder une base simple avant integration de la vraie UI A11

Fichiers:
- `app.py`: app Gradio minimale
- `requirements.txt`: pin compatible `huggingface_hub<1`
