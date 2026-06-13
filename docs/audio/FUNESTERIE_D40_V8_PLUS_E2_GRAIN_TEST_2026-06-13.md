# Funesterie D40 V8 Plus — test grain e2

Date: 2026-06-13
Statut: branche d'ecoute parallele, non canon.

## Intention

V8 reste la version de production prudente: grain historique valide a l'ecoute,
fermeture `mg_phase` par increments centres, grille 1024.

V8 Plus applique le conseil Grok: tester en parallele la paire e2, plus propre
mathematiquement, sans remplacer la V8 historique.

## Paire active

```text
N = 40.0005
grainLow_e2  = 2e^2/N   = 0.3694481868441969
grainHigh_e2 = N/(4e^2) = 1.3533697492765318

grainLow_e2 * grainHigh_e2 = 1/2
```

La fermeture de phase reste celle de V8:

```text
deltaTheta_k = (2*pi/M) + mg_phase*(F_k-meanF) + c7PhaseScale*c7*(C_k-meanC)
M = 1024 par defaut
```

## Surface API

```text
GET  /api/double-harmonic/v8plus/status
POST /api/double-harmonic/v8plus/process
```

Vivy Studio expose l'option:

```text
Mix D40 > Version > V8 Plus e2
```

## Garde-fou

V8 Plus n'est pas une promotion du grain e2 en canon. C'est un rendu comparatif:
si l'ecoute confirme au moins la stabilite de V8 historique, la piste pourra
devenir V8.1/V9. Sinon V8 Fermeture reste la version validee.
