# Upstreams locaux

## llama.cpp

- dossier local: `D:\funesterie\a11\a11llm\llama.cpp`
- upstream: `https://github.com/ggerganov/llama.cpp`
- commit local de reference: `7e994168b1ccc12337ba8de939c4fd466107c1fb`

Etat local observe le 2026-03-27:

- modifications non poussees dans `common/arg.h`
- modifications non poussees dans `common/json-partial.h`
- ajout/modification locale dans `docs/backend/hexagon/# Code Citations.md`
- modifications non poussees dans `docs/backend/hexagon/CMakeUserPresets.json`
- modifications non poussees dans `tools/mtmd/clip.cpp`
- fichier local `tools/mtmd/clip_macros.hint`
- modifications non poussees dans `vendor/miniaudio/miniaudio.h`
- modifications non poussees dans `vendor/nlohmann/json.hpp`

Ce repo `a11llm` ne versionne pas ce clone.

Si ces changements doivent etre partages ou sauvegardes a long terme, il faut creer un fork dedie de `llama.cpp` ou exporter un patch a part.
