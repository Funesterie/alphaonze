# A11 Canonical Structure

La structure canonique d'A11 est maintenant celle-ci:

```text
a11/
  backend/apps/server/   API unique pour local et production
  backend/apps/tts/      TTS local optionnel
  frontend/apps/web/     Frontend unique pour local et production
  launchers/             Orchestration locale et raccourcis Windows
  runtime/               Runtime local unifie (genere, ignore par Git)
```

Regles simples:

- `backend/apps/server` et `frontend/apps/web` sont la seule source produit.
- le local et la prod utilisent les memes apps, seulement avec des variables d'environnement differentes.
- `launchers` pilote la stack locale et ecrit dans `a11/runtime`.
- Railway deploie `a11/backend/apps/server`.
- Netlify publie `a11/frontend`.
- le LLM local standard est `Ollama + gemma4:e4b`.

Ce qui n'est plus une structure canonique:

- `a11desktoptauri` : wrapper legacy, non requis pour lancer A11.
- `dragon` : workspace separe/legacy, plus dans le chemin principal A11.
- `a11_runtime`, `tmp`, profils navigateur et autres sorties generees : runtime jetable, jamais source de verite.

<!-- funesterie-donations:start -->
## Support Funesterie / NOSSEN

Support is voluntary, but it keeps the public modules, registry, compute, and maintenance work alive.

- Wero: `+33 7 83 46 37 61`
- PayPal: https://paypal.me/funeste38
- Stripe/card checkout: https://funesterie.me/subscription
- Custom support/contact: https://funesterie.me/contact/
<!-- funesterie-donations:end -->
