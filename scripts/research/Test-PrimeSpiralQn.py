#!/usr/bin/env python3
"""Test binary q(n) candidates for Prime Spiral research.

q(n) is treated as a binary resonance gate:
  q(n) = 1 => candidate/stable/resonant
  q(n) = 0 => not selected

The script compares several score families against actual prime labels. It is
research-only and must not be described as a prime generator.
"""

from __future__ import annotations

import argparse
import cmath
import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable


PHI = (1.0 + math.sqrt(5.0)) / 2.0
JHI = math.pi / 2.0 - PHI
C7 = abs(JHI) / PHI
MG_PHASE = 9.0 - (2.0 * 14.134725141734693790457251983562470270784257115699) / math.pi
TARGET_0005PI = 0.0005 * math.pi
PIVOT = 10.0 * C7
T_LINEAR = 0.3695
PERIOD = 40.0005
ZONE_PRIMORIAL_7 = 2 * 3 * 5 * 7
ZONE_FACTORIAL_7 = math.factorial(7)


@dataclass(frozen=True)
class ScoreFamily:
    name: str
    description: str
    score: Callable[[int], float] | None = None
    near_means_q1: bool = True
    scores: list[float] | None = None


def sieve(limit: int) -> list[bool]:
    is_prime = [False] * (limit + 1)
    if limit >= 2:
        is_prime[2:] = [True] * (limit - 1)
        p = 2
        while p * p <= limit:
            if is_prime[p]:
                for m in range(p * p, limit + 1, p):
                    is_prime[m] = False
            p += 1
    return is_prime


def dist_to_integer(x: float) -> float:
    return abs(x - round(x))


def frac(x: float) -> float:
    return x - math.floor(x)


def safe_unit(z: complex) -> complex:
    magnitude = abs(z)
    if not math.isfinite(magnitude) or magnitude == 0.0:
        return 1.0 + 0.0j
    return z / magnitude


def cross_phase_score(z: complex) -> float:
    return dist_to_integer(cmath.phase(z) / (math.pi / 2.0))


def safe_log1p(z: complex) -> complex:
    """Bounded complex log around 1+z; guards the branch singularity."""

    w = 1.0 + z
    if abs(w) < 1e-12:
        w += 1e-12
    return cmath.log(w)


def safe_div(num: complex, den: complex) -> complex:
    if abs(den) < 1e-12:
        den += 1e-12
    return num / den


def old_c1_score(n: int) -> float:
    def m_value(k: int) -> float:
        theta = 2.0 * math.pi * k / PERIOD
        return PIVOT + T_LINEAR * math.sin(theta)

    theta = 2.0 * math.pi * n / PERIOD
    b = abs(m_value(n) - m_value(n - 1)) + abs(m_value(n + 1) - m_value(n))
    r = abs(math.cos(theta) - PIVOT)
    return b / (r + T_LINEAR)


def zone_factor_score(n: int, zone: int) -> float:
    """First proxy for a zone factor: local residue plus slow zone drift."""

    zone_index = n // zone
    local_n = n % zone or zone
    return dist_to_integer((PERIOD * local_n / C7) + zone_index * MG_PHASE)


def build_cascade_scores(limit: int) -> dict[str, list[float]]:
    """Build O(n) cascades where each state depends on all previous steps."""

    add_unit = [0.0] * (limit + 1)
    mul_unit = [0.0] * (limit + 1)
    exp_unit = [0.0] * (limit + 1)
    power_i_unit = [0.0] * (limit + 1)
    log1p_unit = [0.0] * (limit + 1)
    ln_then_div_unit = [0.0] * (limit + 1)
    inverse_unit = [0.0] * (limit + 1)
    ops_round_unit = [0.0] * (limit + 1)
    cross_star = [0.0] * (limit + 1)

    z_add = 1j
    z_mul = 1j
    z_exp = 1j
    z_pow = 1j
    z_log = 1j
    z_ln_div = 1j
    z_inv = 1j
    z_round = 1j
    phase = math.pi / 2.0
    cross_step = PHI + JHI + C7 + MG_PHASE
    add_step = complex(PHI, JHI)
    mul_step = complex(C7, MG_PHASE)

    for n in range(1, limit + 1):
        # Addition is also cascaded: z -> z + (phi + jhi*i), normalized.
        z_add = safe_unit(z_add + add_step)
        add_unit[n] = cross_phase_score(z_add)

        # Multiplication is also cascaded: z -> z * (c7 + mg*i), normalized.
        z_mul = safe_unit(z_mul * mul_step)
        mul_unit[n] = cross_phase_score(z_mul)

        # i -> exp(i) -> exp(exp(i)) -> ... with unit normalization.
        z_exp = safe_unit(cmath.exp(z_exp))
        exp_unit[n] = cross_phase_score(z_exp)

        # i -> i^i -> i^(i^i) -> ... using principal log(i), normalized.
        z_pow = safe_unit(cmath.exp(z_pow * (1j * math.pi / 2.0)))
        power_i_unit[n] = cross_phase_score(z_pow)

        # Log/ln are examples too: keep a guarded log1p cascade.
        z_log = safe_unit(safe_log1p(z_log))
        log1p_unit[n] = cross_phase_score(z_log)

        # Candidate after ln: division. This is a guarded proxy for
        # z -> z / (1 + ln(1+z)), not a locked Funesterie law.
        ln_part = safe_log1p(z_ln_div)
        z_ln_div = safe_unit(safe_div(z_ln_div, 1.0 + ln_part))
        ln_then_div_unit[n] = cross_phase_score(z_ln_div)

        # Inversion/division closure proxy.
        z_inv = safe_unit(safe_div(1.0, 1.0 + z_inv))
        inverse_unit[n] = cross_phase_score(z_inv)

        # Full candidate round: apply the same cascade principle across ops.
        # add -> multiply -> exp -> log/ln -> division -> inversion.
        z_round = safe_unit(z_round + add_step)
        z_round = safe_unit(z_round * mul_step)
        z_round = safe_unit(cmath.exp(z_round))
        ln_round = safe_log1p(z_round)
        z_round = safe_unit(ln_round)
        z_round = safe_unit(safe_div(z_round, 1.0 + ln_round))
        z_round = safe_unit(safe_div(1.0, 1.0 + z_round))
        ops_round_unit[n] = cross_phase_score(z_round)

        # Cross-star phase cascade: real preload + face-step modulo the cross.
        phase = (phase + cross_step) % (2.0 * math.pi)
        cross_star[n] = dist_to_integer(phase / (math.pi / 2.0))

    return {
        "cascade_add_unit": add_unit,
        "cascade_mul_unit": mul_unit,
        "cascade_exp_unit": exp_unit,
        "cascade_power_i_unit": power_i_unit,
        "cascade_log1p_unit": log1p_unit,
        "cascade_ln_then_div_unit": ln_then_div_unit,
        "cascade_inverse_unit": inverse_unit,
        "cascade_ops_round_unit": ops_round_unit,
        "cascade_cross_star_phase": cross_star,
    }


def families(limit: int) -> list[ScoreFamily]:
    cross_scale = math.pi / 2.0
    cascades = build_cascade_scores(limit)
    return [
        ScoreFamily(
            "old_c1_high",
            "Old C1 score S(n); high score means q(n)=1.",
            old_c1_score,
            near_means_q1=False,
        ),
        ScoreFamily(
            "res_40pi_over_c7",
            "q(n)=1 when (40.0005*pi*n)/c7 is near an integer.",
            lambda n: dist_to_integer((PERIOD * math.pi * n) / C7),
        ),
        ScoreFamily(
            "res_40_over_c7",
            "q(n)=1 when (40.0005*n)/c7 is near an integer.",
            lambda n: dist_to_integer((PERIOD * n) / C7),
        ),
        ScoreFamily(
            "res_tlinear",
            "q(n)=1 when T_linear*n is near an integer.",
            lambda n: dist_to_integer(T_LINEAR * n),
        ),
        ScoreFamily(
            "res_mg_phase",
            "q(n)=1 when mg_phase*n is near an integer.",
            lambda n: dist_to_integer(MG_PHASE * n),
        ),
        ScoreFamily(
            "res_target_0005pi",
            "q(n)=1 when target_0005pi*n is near an integer.",
            lambda n: dist_to_integer(TARGET_0005PI * n),
        ),
        ScoreFamily(
            "res_cross_unit",
            "q(n)=1 when n*(phi+jhi+c7+mg_phase)/(pi/2) is near an integer.",
            lambda n: dist_to_integer(n * (PHI + JHI + C7 + MG_PHASE) / cross_scale),
        ),
        ScoreFamily(
            "res_ra_preload_flat",
            "Flat preload test: q(n)=1 when 2*R_a proxy n*phi/(pi/2) is near an integer.",
            lambda n: dist_to_integer(2.0 * n * PHI / cross_scale),
        ),
        ScoreFamily(
            "zone_7_primorial_210",
            "Experimental zone factor: local n inside 7#=210 plus slow mg_phase zone drift.",
            lambda n: zone_factor_score(n, ZONE_PRIMORIAL_7),
        ),
        ScoreFamily(
            "zone_7_factorial_5040",
            "Experimental zone factor: local n inside 7!=5040 plus slow mg_phase zone drift.",
            lambda n: zone_factor_score(n, ZONE_FACTORIAL_7),
        ),
        ScoreFamily(
            "cascade_add_unit",
            "Iterated bounded addition cascade z_n=unit(z_{n-1}+phi+jhi*i), z_0=i.",
            scores=cascades["cascade_add_unit"],
        ),
        ScoreFamily(
            "cascade_mul_unit",
            "Iterated bounded multiplication cascade z_n=unit(z_{n-1}*(c7+mg_phase*i)), z_0=i.",
            scores=cascades["cascade_mul_unit"],
        ),
        ScoreFamily(
            "cascade_exp_unit",
            "Iterated bounded cascade z_n=unit(exp(z_{n-1})), z_0=i; q(n)=1 near cross-face closure.",
            scores=cascades["cascade_exp_unit"],
        ),
        ScoreFamily(
            "cascade_power_i_unit",
            "Iterated bounded cascade z_n=unit(i^z_{n-1}), z_0=i; q(n)=1 near cross-face closure.",
            scores=cascades["cascade_power_i_unit"],
        ),
        ScoreFamily(
            "cascade_log1p_unit",
            "Iterated bounded log/ln cascade z_n=unit(log(1+z_{n-1})), z_0=i.",
            scores=cascades["cascade_log1p_unit"],
        ),
        ScoreFamily(
            "cascade_ln_then_div_unit",
            "Candidate after ln: iterated bounded z_n=unit(z/(1+ln(1+z))), z_0=i.",
            scores=cascades["cascade_ln_then_div_unit"],
        ),
        ScoreFamily(
            "cascade_inverse_unit",
            "Iterated bounded division/inversion closure z_n=unit(1/(1+z_{n-1})), z_0=i.",
            scores=cascades["cascade_inverse_unit"],
        ),
        ScoreFamily(
            "cascade_ops_round_unit",
            "Full bounded op round: add -> multiply -> exp -> log/ln -> divide -> invert, repeated to n.",
            scores=cascades["cascade_ops_round_unit"],
        ),
        ScoreFamily(
            "cascade_cross_star_phase",
            "Cross-star phase cascade with real preload and pi/2 face closure.",
            scores=cascades["cascade_cross_star_phase"],
        ),
    ]


def family_score(family: ScoreFamily, n: int) -> float:
    if family.scores is not None:
        return family.scores[n]
    if family.score is None:
        raise ValueError(f"Score family {family.name} has no score source")
    return family.score(n)


def derivative_primitive_metrics(top_k: list[tuple[int, float, bool]], is_prime: list[bool], limit: int) -> dict:
    q = [0] * (limit + 1)
    for n, _, _ in top_k:
        q[n] = 1

    selected_total = 0
    prime_total = 0
    abs_error_sum = 0
    max_abs_error = 0
    derivative_transitions = 0
    derivative_prime_hits = 0
    rising_edges = 0
    rising_prime_hits = 0
    falling_edges = 0

    prev = 0
    samples = []
    sample_step = max(1, limit // 10)

    for n in range(2, limit + 1):
        current = q[n]
        delta = current - prev
        if delta != 0:
            derivative_transitions += 1
            if is_prime[n]:
                derivative_prime_hits += 1
            if delta > 0:
                rising_edges += 1
                if is_prime[n]:
                    rising_prime_hits += 1
            else:
                falling_edges += 1

        selected_total += current
        if is_prime[n]:
            prime_total += 1
        err = abs(selected_total - prime_total)
        abs_error_sum += err
        max_abs_error = max(max_abs_error, err)

        if n % sample_step == 0 or n == limit:
            samples.append({"n": n, "primitiveQ": selected_total, "primePi": prime_total, "absError": err})

        prev = current

    return {
        "derivative": {
            "definition": "Δq(n)=q(n)-q(n-1)",
            "transitions": derivative_transitions,
            "transitionPrimeHits": derivative_prime_hits,
            "transitionPrimePrecision": derivative_prime_hits / derivative_transitions if derivative_transitions else 0.0,
            "risingEdges": rising_edges,
            "risingPrimeHits": rising_prime_hits,
            "risingPrimePrecision": rising_prime_hits / rising_edges if rising_edges else 0.0,
            "fallingEdges": falling_edges,
        },
        "primitive": {
            "definition": "Q(n)=Σ_{k<=n} q(k)",
            "finalQ": selected_total,
            "finalPrimePi": prime_total,
            "meanAbsErrorVsPrimePi": abs_error_sum / max(1, limit - 1),
            "maxAbsErrorVsPrimePi": max_abs_error,
            "samples": samples,
        },
    }


def evaluate_family(family: ScoreFamily, is_prime: list[bool], limit: int) -> dict:
    rows = []
    for n in range(2, limit + 1):
        score = family_score(family, n)
        if not math.isfinite(score):
            score = float("inf")
        rows.append((n, score, is_prime[n]))

    prime_count = sum(1 for n in range(2, limit + 1) if is_prime[n])
    baseline = prime_count / max(1, limit - 1)

    if family.near_means_q1:
        ranked = sorted(rows, key=lambda item: (item[1], item[0]))
    else:
        ranked = sorted(rows, key=lambda item: (-item[1], item[0]))

    top_k = ranked[:prime_count]
    hits = sum(1 for _, _, prime in top_k if prime)
    top_precision = hits / max(1, len(top_k))
    top_recall = hits / max(1, prime_count)
    calculus = derivative_primitive_metrics(top_k, is_prime, limit)

    # Scan thresholds, but avoid the trivial "select everything" threshold.
    best = {"f1": 0.0, "precision": 0.0, "recall": 0.0, "selected": 0, "hits": 0, "threshold": None}
    hits_so_far = 0
    max_selected = int((limit - 1) * 0.5)
    for idx, (n, score, prime) in enumerate(ranked, start=1):
        if prime:
            hits_so_far += 1
        if idx > max_selected:
            break
        precision = hits_so_far / idx
        recall = hits_so_far / max(1, prime_count)
        f1 = (2.0 * precision * recall / (precision + recall)) if precision + recall else 0.0
        if f1 > best["f1"]:
            best = {
                "f1": f1,
                "precision": precision,
                "recall": recall,
                "selected": idx,
                "hits": hits_so_far,
                "threshold": score,
            }

    return {
        "name": family.name,
        "description": family.description,
        "orientation": "low_score_q1" if family.near_means_q1 else "high_score_q1",
        "baselinePrimeDensity": baseline,
        "topK": {
            "k": prime_count,
            "hits": hits,
            "precision": top_precision,
            "recall": top_recall,
            "liftVsPrimeDensity": top_precision / baseline if baseline else 0.0,
            "sample": [
                {"n": n, "score": score, "isPrime": prime}
                for n, score, prime in top_k[:20]
            ],
        },
        "calculus": calculus,
        "bestThresholdLimited": best,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=10_000)
    parser.add_argument(
        "--output",
        default=r"D:\projets\funesterie\.codex-tmp\prime-spiral-qn-test.json",
    )
    args = parser.parse_args()

    if args.limit < 100:
        raise SystemExit("--limit must be >= 100")

    is_prime = sieve(args.limit)
    results = [evaluate_family(family, is_prime, args.limit) for family in families(args.limit)]
    results_sorted = sorted(
        results,
        key=lambda row: (
            row["topK"]["liftVsPrimeDensity"],
            row["topK"]["precision"],
            row["bestThresholdLimited"]["f1"],
        ),
        reverse=True,
    )

    payload = {
        "schema": "funesterie.prime_spiral_qn_test.v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "limit": args.limit,
        "definition": {
            "q0": "q(n)=0 means not selected / no detected resonance",
            "q1": "q(n)=1 means selected / resonant candidate",
            "guard": "Research-only. Passing a test does not prove primality; failing a test only rejects that score family.",
        },
        "constants": {
            "phi": PHI,
            "jhi": JHI,
            "c7": C7,
            "pivot": PIVOT,
            "tLinear": T_LINEAR,
            "period": PERIOD,
            "mgPhase": MG_PHASE,
            "target0005pi": TARGET_0005PI,
            "zonePrimorial7": ZONE_PRIMORIAL_7,
            "zoneFactorial7": ZONE_FACTORIAL_7,
        },
        "results": results_sorted,
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    print("Prime Spiral q(n) binary test")
    print(f"  limit: {args.limit}")
    print(f"  output: {output}")
    print("  best families by topK lift:")
    for row in results_sorted[:5]:
        print(
            "   - {name}: precision={precision:.4f}, lift={lift:.3f}, hits={hits}/{k}, bestF1={f1:.4f}".format(
                name=row["name"],
                precision=row["topK"]["precision"],
                lift=row["topK"]["liftVsPrimeDensity"],
                hits=row["topK"]["hits"],
                k=row["topK"]["k"],
                f1=row["bestThresholdLimited"]["f1"],
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
