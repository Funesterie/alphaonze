# Funesterie D40 V8 — Fermeture `mg_phase` centrée

Date : 2026-06-13  
Statut : candidat de production expose sur `funesterie.me` apres validation tests.

## Intention

V8 reprend le socle musical stable de V6 Supreme :

- dry-first ;
- pitches, ratio M/K et plafond wet de V6 conserves ;
- pas de limiteur final ;
- pas de gain final ;
- sortie au format demande.

La nouveaute n'est pas un gain. C'est la maniere de placer `mg_phase` :

```text
mg_phase = 0.001554497790530303
target_0005pi = 0.0005*pi
phaseDelta = target_0005pi - mg_phase
```

`mg_phase` agit maintenant comme correction d'increments de phase, recentree sur
une grille 1024.

## Constantes operatoires

```text
phi = (1+sqrt(5))/2
jhi = pi/2 - phi
c7  = |jhi|/phi
mg  = mg_phase
```

Valeurs :

```text
phi = 1.618033988749895
jhi = -0.047237661954998345
c7  = 0.029194480637266783
mg_phase = 0.001554497790530303
phaseDelta = 0.00001629853626459359
```

Point important : `pivot_residual_old = 0.292 - 10*c7` n'est pas `mg_phase`.
Il reste une ancienne branche de gain/pivot audio.

## Projection angulaire D40

```text
H_D40 = (360*40)/(40.0005*4*pi)
      = 28.64753166239538

step(x) = H_D40*x
```

Pas utiles :

```text
step(phi)        = 46.35267992354451 deg
step(jhi)        = -1.3532424165133448 deg
step(c7)         = 0.836349808423289 deg
step(10*c7)      = 8.36349808423289 deg
step(mg_phase)   = 0.04453252467334052 deg
step(phaseDelta) = 0.0004669128336906442 deg
```

## Fermeture

L'ecriture instantanee :

```text
theta_k = 2*pi*u_k + mg_phase*F_k
```

laisse une couture dependante de la force locale `F`.

V8 utilise plutot :

```text
meanF = moyenne(F)
meanC = moyenne(C)

deltaTheta_k =
  (2*pi/M)
  + mg_phase*(F_k - meanF)
  + c7PhaseScale*c7*(C_k - meanC)

theta_0 = 0
theta_{k+1} = theta_k + deltaTheta_k
```

Comme les termes sont centres :

```text
sum(F_k - meanF) = 0
sum(C_k - meanC) = 0
```

la boucle ferme :

```text
theta_M = 2*pi
```

aux erreurs flottantes pres.

## Implementation

Module serveur :

```text
a11/backend/apps/server/src/audio/double-harmonic-closed-phase-v8.cjs
```

Endpoints :

```text
GET  /api/double-harmonic/v8/status
POST /api/double-harmonic/v8/process
```

Interface :

```text
Vivy Studio > Mix D40 > Version > V8 Fermeture
```

Le fichier produit porte le suffixe :

```text
funesterie-d40-v8
```

## Garde-fous

V8 expose dans l'API :

- `operators` : `phi`, `jhi`, `c7`, `mg_phase`, `phaseDelta` ;
- `projection` : `H_D40` et les pas angulaires ;
- `phaseClosure` : preuve numerique de fermeture ;
- `safety` : `mgPhaseFixed`, `noDirectMgOffset`, `centeredIncrements`,
  `pivotResidualOldIsNotMgPhase`.

Lecture canon de cette version :

```text
V6 Supreme = matiere audio stable
V7.1 = grille 1024
V8 = fermeture mg_phase par increments centres
```
