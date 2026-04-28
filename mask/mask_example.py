from mask_engine import CasqueEtoile
import json

# Exemple d'utilisation du moteur casque étoilé
casque = CasqueEtoile()
casque.add_node("Mario 64", "subject")
casque.add_node("étoile", "attribute")
casque.add_node("orange", "attribute")
casque.add_relation("Mario 64", "étoile", 0.8)
casque.add_relation("étoile", "orange", 0.95)
mask = casque.to_mask("Mario 64 avec une étoile orange")
print(json.dumps(mask, ensure_ascii=False, indent=2))
