# Prime Spiral Corpus OCR Status - 2026-05-28

## Snapshot

- Image inventory: 891 files
- OCR outputs: 886 files
- Not OCRed: 5 HEIC files
- Tag output: `D:\projets\funesterie\.codex-tmp\prime-spiral-tags.json`
- Rome tag output: `D:\projets\funesterie\.codex-tmp\prime-spiral-tags.rome.json`
- Review queue: `D:\projets\funesterie\.codex-tmp\prime-spiral-review-queue.json`
- Inventory output: `D:\projets\funesterie\.codex-tmp\prime-spiral-image-inventory.json`
- OCR root: `D:\projets\funesterie\.codex-tmp\prime-spiral-ocr`

## Sources

| Source | Files |
| --- | ---: |
| `C:\Users\Djeff\Desktop\prems` | 14 |
| `C:\Users\Djeff\Downloads\AmazonPhotos` | 235 |
| `E:\maths` | 642 |

## Tag Summary

| Family | Count |
| --- | ---: |
| constants | 625 |
| op_symmetry | 430 |
| audio_mapping | 367 |
| phi_j_spiral | 142 |
| math_general | 103 |
| op_closure | 101 |
| modular_projection | 91 |
| prime_dimensions | 80 |
| riemann_chirp | 29 |
| unclear | 3 |

| Maturity | Count |
| --- | ---: |
| unclear | 670 |
| try | 151 |
| retry | 32 |
| concrete | 29 |
| fail | 9 |

| Math status | Count |
| --- | ---: |
| custom_op | 506 |
| unclear | 240 |
| experimental_mapping | 136 |
| inconsistent | 9 |

## Notes

- Tesseract 5.5.0 is installed through winget.
- French OCR data is stored locally under `.codex-tmp\tessdata`.
- `tesseract-main.zip` in Downloads is source code, not a ready-to-run executable.
- HEIC files were inventoried but not OCRed by this pipeline.
- The first tag pass is heuristic. It is meant to find clusters, not to certify formulas.
- Rome was used with a temporary workspace under `.codex-tmp\rome-tag` so the repository root was not polluted with a permanent `rome.json`.
- `op_symmetry`, `op_closure`, and `prime_dimensions` are marked as custom algebra until the `op` and `Sym` operators are formally defined.
- `audio_mapping` and `riemann_chirp` are marked experimental. They are not treated as mathematical proofs.
- The review queue contains 172 entries prioritized from concrete/retry/fail items and high-value families.

## Next Pass

1. Review all `concrete`, `retry`, and `fail` entries manually.
2. Build `FORMULA_REGISTRY.md` from reviewed entries only.
3. Define the OP operator table before using OP formulas in code.
4. Keep module work frozen until a formula has both `family` and `mathStatus`.
