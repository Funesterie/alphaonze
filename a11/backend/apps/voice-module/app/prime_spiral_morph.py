"""Prime-spiral control curves for experimental audio morphing.

This module turns Djeff's prime/complex-spiral notes into deterministic DSP
control signals. It is research code: it does not prove anything about prime
numbers or Riemann zeros, and it is not wired into the production voice path.

Core formulas captured from the screenshots:
  z0 = phi - j*i
  R = sqrt(phi^2 + j^2)
  z_n = n * (+/-phi +/- j*i) * exp(i * log(n))
  theta(n) = log(n) + arg(+/-phi +/- j*i)
  P(n) = |n * (+/-phi +/- j)| mod 1
  delta_theta = log(n + 1) - log(n) ~= 1 / n
  op_sym(-M/M, +M/M) = 1 and op_sym(-iM/M, +iM/M) = 1
  dimensions 1, 2, 3, 5, 7 add sqrt, inversion, exp/log, ln/log and
  global symmetry layers.
"""

from __future__ import annotations

import argparse
import cmath
import json
import math
from dataclasses import asdict, dataclass
from typing import Iterable


PHI = (1.0 + math.sqrt(5.0)) / 2.0
TWO_PI = 2.0 * math.pi
SPECTRAL_PI = 40.0005 * math.pi
SPECTRAL_BASE_HZ = SPECTRAL_PI / TWO_PI

ORIENTATIONS: dict[str, tuple[int, int]] = {
    # z0 = phi - j*i, the default direction from the screenshots.
    "right": (1, -1),
    "left": (-1, -1),
    "mirror": (1, 1),
    "mirror_inverted": (-1, 1),
}

MODES = (
    "phi_j_spiral",
    "riemann_chirp",
    "modular_grid",
    "gap_law",
    "resonance",
    "op_symmetry",
    "op_closure",
    "op_algebra",
    "prime_dimensions",
    "hybrid",
)

PRIME_DIMENSIONS = (1, 2, 3, 5, 7)

OP_DIRECTIONS: dict[str, complex] = {
    "+M": complex(1.0, 0.0),
    "-M": complex(-1.0, 0.0),
    "+iM": complex(0.0, 1.0),
    "-iM": complex(0.0, -1.0),
}

OP_ALPHABET = ("i", "-i", "-1", "1", "M")


@dataclass(frozen=True)
class SpiralFeature:
    n: int
    is_prime: bool
    radius: float
    phase: float
    phase_gap: float
    projection_radius: float
    projection_linear: float
    gain_db: float


def _assert_positive_n(n: int) -> int:
    value = int(n)
    if value <= 0:
        raise ValueError("n must be a positive integer")
    return value


def _orientation(name: str | tuple[int, int]) -> tuple[int, int]:
    if isinstance(name, tuple):
        if len(name) != 2 or name[0] not in (-1, 1) or name[1] not in (-1, 1):
            raise ValueError("orientation tuple must be two signs: (-1|1, -1|1)")
        return name
    try:
        return ORIENTATIONS[str(name)]
    except KeyError as error:
        known = ", ".join(sorted(ORIENTATIONS))
        raise ValueError(f"unknown orientation {name!r}; expected one of: {known}") from error


def base_vector(phi: float = PHI, j_value: float = 1.0, orientation: str | tuple[int, int] = "right") -> complex:
    sign_phi, sign_j = _orientation(orientation)
    return complex(sign_phi * float(phi), sign_j * float(j_value))


def complex_radius(phi: float = PHI, j_value: float = 1.0) -> float:
    return math.hypot(float(phi), float(j_value))


def theta0(phi: float = PHI, j_value: float = 1.0, orientation: str | tuple[int, int] = "right") -> float:
    return cmath.phase(base_vector(phi, j_value, orientation))


def spiral_point(n: int, phi: float = PHI, j_value: float = 1.0, orientation: str | tuple[int, int] = "right") -> complex:
    value = _assert_positive_n(n)
    return value * base_vector(phi, j_value, orientation) * cmath.exp(1j * math.log(value))


def phase(n: int, phi: float = PHI, j_value: float = 1.0, orientation: str | tuple[int, int] = "right") -> float:
    value = _assert_positive_n(n)
    return (math.log(value) + theta0(phi, j_value, orientation)) % TWO_PI


def phase_gap(n: int) -> float:
    value = _assert_positive_n(n)
    return math.log1p(1.0 / value)


def projection_radius(n: int, phi: float = PHI, j_value: float = 1.0, orientation: str | tuple[int, int] = "right") -> float:
    return abs(spiral_point(n, phi, j_value, orientation)) % 1.0


def projection_linear(n: int, phi: float = PHI, j_value: float = 1.0, orientation: str | tuple[int, int] = "right") -> float:
    value = _assert_positive_n(n)
    sign_phi, sign_j = _orientation(orientation)
    projected = value * ((sign_phi * float(phi)) + (sign_j * float(j_value)))
    return abs(projected) % 1.0


def resonance_index(k: int, phi: float = PHI, j_value: float = 1.0, orientation: str | tuple[int, int] = "right") -> float:
    """Return n where log(n) + theta0 = 2*pi*k."""

    harmonic = int(k)
    if harmonic < 0:
        raise ValueError("k must be non-negative")
    return math.exp((TWO_PI * harmonic) - theta0(phi, j_value, orientation))


def riemann_like_chirp(k: int, scale: float = 1.265, spectral_pi: float = SPECTRAL_PI) -> float:
    """Empirical sqrt chirp from the notes: t_k ~= sqrt(40.0005*pi*k) * 1.265."""

    harmonic = _assert_positive_n(k)
    return math.sqrt(float(spectral_pi) * harmonic) * float(scale)


def gain_db_from_projection(projection: float, max_db: float = 3.0) -> float:
    clipped = min(1.0, max(0.0, float(projection)))
    return ((2.0 * clipped) - 1.0) * float(max_db)


def gain_linear_from_db(db_value: float) -> float:
    return 10.0 ** (float(db_value) / 20.0)


def _unit_interval(value: float) -> float:
    return min(1.0, max(0.0, float(value)))


def _unit_from_signed(value: float, limit: float = 1.0) -> float:
    bounded = max(-limit, min(limit, float(value)))
    return 0.5 + (bounded / (2.0 * limit))


def prime_flags(limit: int) -> list[bool]:
    size = int(limit)
    if size < 0:
        raise ValueError("limit must be non-negative")
    flags = [False, False] + [True] * max(0, size - 1)
    for candidate in range(2, int(math.sqrt(size)) + 1):
        if flags[candidate]:
            start = candidate * candidate
            step = candidate
            flags[start : size + 1 : step] = [False] * (((size - start) // step) + 1)
    return flags[: size + 1]


def op_symmetry_score(
    n: int,
    phi: float = PHI,
    j_value: float = 1.0,
) -> float:
    """Coherence score for all four +/- orientations.

    This is the code form of Djeff's "OP symmetry": all possible orientations
    are projected, then compared. When they agree, coherence tends to 1.
    """

    values = [
        projection_linear(n, phi=phi, j_value=j_value, orientation=name)
        for name in ORIENTATIONS
    ]
    mean = sum(values) / len(values)
    variance = sum((item - mean) ** 2 for item in values) / len(values)
    return _unit_interval(1.0 - (4.0 * variance))


def _safe_complex_log(value: complex) -> complex:
    if abs(value) < 1e-12:
        value = complex(1e-12, 0.0)
    return cmath.log(value)


def _safe_complex_inverse(value: complex) -> complex:
    if abs(value) < 1e-12:
        return complex(0.0, 0.0)
    return 1.0 / value


def _normalize_complex(value: complex) -> complex:
    magnitude = abs(value)
    if magnitude < 1e-12:
        return complex(1.0, 0.0)
    return value / magnitude


def _complex_symbol(value: complex, eps: float = 1e-9) -> str:
    """Return a compact symbolic label for OP-table unit values."""

    item = complex(value)
    known = (
        (complex(0.0, 1.0), "i"),
        (complex(0.0, -1.0), "-i"),
        (complex(-1.0, 0.0), "-1"),
        (complex(1.0, 0.0), "1"),
    )
    for target, label in known:
        if abs(item - target) <= eps:
            return label
    return f"{item.real:.6g}{item.imag:+.6g}i"


def _symbol_to_complex(symbol: str) -> complex:
    try:
        return OP_DIRECTIONS[symbol]
    except KeyError as error:
        known = ", ".join(OP_DIRECTIONS)
        raise ValueError(f"unknown OP direction {symbol!r}; expected one of: {known}") from error


def _op_table_row(left: str, right: str, result: complex, kind: str) -> dict[str, str]:
    return {
        "left": left,
        "right": right,
        "result": _complex_symbol(result),
        "kind": kind,
    }


def op_sym(left: complex, right: complex, eps: float = 1e-9) -> complex:
    """Balance opposite directions around M.

    The screenshots distinguish normal multiplication from the OP symmetry
    operator: opposed ratios such as -M/M and +M/M close back to 1.
    """

    lhs = complex(left)
    rhs = complex(right)
    if abs(lhs + rhs) <= eps:
        return complex(1.0, 0.0)
    return lhs * rhs


def op_mul_table() -> list[dict[str, str]]:
    """Standard complex multiplication over the OP cross directions.

    This table is the control table. It is ordinary mathematics and should
    stay separate from Djeff's custom `op_sym` resonance operator.
    """

    rows: list[dict[str, str]] = []
    for left, left_value in OP_DIRECTIONS.items():
        for right, right_value in OP_DIRECTIONS.items():
            rows.append(_op_table_row(left, right, left_value * right_value, "complex-mul"))
    return rows


def op_sym_table() -> list[dict[str, str]]:
    """Custom resonance table where opposite arms close back to identity."""

    rows: list[dict[str, str]] = []
    for left, left_value in OP_DIRECTIONS.items():
        for right, right_value in OP_DIRECTIONS.items():
            is_opposite = abs(left_value + right_value) <= 1e-9
            rows.append(
                _op_table_row(
                    left,
                    right,
                    op_sym(left_value, right_value),
                    "balanced-opposite" if is_opposite else "complex-mul-fallback",
                )
            )
    return rows


def observed_op_equations() -> list[dict[str, object]]:
    """Screenshot-derived equations kept as observations, not proof.

    OCR and the screenshots contain several corrected/retried variants. This
    list records the stable-looking claims as test targets while preserving
    their operator family.
    """

    return [
        {
            "id": "O1-real-axis-balance",
            "source": "FORMULA_REGISTRY O1",
            "operator": "op_sym",
            "left": "-M/M",
            "right": "+M/M",
            "expected": "1",
            "actual": _complex_symbol(op_sym(-1, 1)),
            "status": "passes",
        },
        {
            "id": "O1-imaginary-axis-balance",
            "source": "FORMULA_REGISTRY O1",
            "operator": "op_sym",
            "left": "-iM/M",
            "right": "+iM/M",
            "expected": "1",
            "actual": _complex_symbol(op_sym(-1j, 1j)),
            "status": "passes",
        },
        {
            "id": "O2-real-same-negative",
            "source": "d72868ac-7228-488f-a0c7-68517916024f.jpg",
            "operator": "op",
            "left": "-Mr/Mr",
            "right": "-Mi/Mi",
            "expected": "-1",
            "actual": "-1",
            "status": "recorded-custom-op",
        },
        {
            "id": "O2-real-same-positive",
            "source": "d72868ac-7228-488f-a0c7-68517916024f.jpg",
            "operator": "op",
            "left": "Mr/Mr",
            "right": "Mi/Mi",
            "expected": "-1",
            "actual": "-1",
            "status": "recorded-custom-op",
        },
        {
            "id": "O2-real-mixed-negative-positive",
            "source": "d72868ac-7228-488f-a0c7-68517916024f.jpg",
            "operator": "op",
            "left": "-Mr/Mr",
            "right": "Mi/Mi",
            "expected": "M",
            "actual": "M",
            "status": "recorded-custom-op",
        },
        {
            "id": "O2-real-mixed-positive-negative",
            "source": "d72868ac-7228-488f-a0c7-68517916024f.jpg",
            "operator": "op",
            "left": "Mr/Mr",
            "right": "-Mi/Mi",
            "expected": "M",
            "actual": "M",
            "status": "recorded-custom-op",
        },
        {
            "id": "O4-missing-identity-a",
            "source": "fff248b7-46be-42fd-9ab9-80dbc4552bf1.jpg",
            "operator": "op",
            "left": "-(Mr/Mi)",
            "right": "Mr/-Mi",
            "expected": "1",
            "actual": "1",
            "status": "recorded-custom-op",
        },
        {
            "id": "O4-missing-identity-b",
            "source": "fff248b7-46be-42fd-9ab9-80dbc4552bf1.jpg",
            "operator": "op",
            "left": "Mr/Mi",
            "right": "-(-Mi/Mr)",
            "expected": "1",
            "actual": "1",
            "status": "recorded-custom-op",
        },
    ]


def op_table_report() -> dict[str, object]:
    """Return an executable OP-algebra report for review and docs."""

    mul_rows = op_mul_table()
    sym_rows = op_sym_table()
    observations = observed_op_equations()
    observed_symbols = {str(row["actual"]) for row in observations}
    sym_symbols = {row["result"] for row in sym_rows}
    return {
        "schema": "funesterie.symetrie-op-table.v1",
        "status": "research-table-not-proof",
        "directions": list(OP_DIRECTIONS),
        "alphabet": list(OP_ALPHABET),
        "complexMultiplication": mul_rows,
        "opSym": sym_rows,
        "observedEquations": observations,
        "checks": {
            "opSymClosedInComplexUnits": sorted(sym_symbols).count("M") == 0
            and sym_symbols.issubset({"i", "-i", "-1", "1"}),
            "observedClosedInAlphabet": observed_symbols.issubset(set(OP_ALPHABET)),
            "opSymRealAxis": _complex_symbol(op_sym(-1, 1)) == "1",
            "opSymImaginaryAxis": _complex_symbol(op_sym(-1j, 1j)) == "1",
        },
        "guardrails": [
            "op_sym is a custom resonance operator, not ordinary multiplication.",
            "O2/O4 equations are recorded screenshot targets; keep them out of production math until the custom op is independently defined.",
            "Use this table for audio/control experiments and symbolic review, not as a Riemann proof.",
        ],
    }


def op_closure_values(
    n: int,
    phi: float = PHI,
    j_value: float = 1.0,
    orientation: str | tuple[int, int] = "right",
) -> dict[str, complex]:
    """Return the multi-operation imaginary ladder for one n.

    Djeff's refinement: not just +/- orientation symmetry, but closure across
    imaginary operation layers. In plain terms: -i^2 = 1 should have echoes
    through exp, log/ln, inversion, conjugation and normalization.
    """

    z = spiral_point(n, phi=phi, j_value=j_value, orientation=orientation)
    unit = _normalize_complex(z)
    imaginary_square_identity = -((1j * unit) ** 2)
    log_exp_identity = cmath.exp(_safe_complex_log(unit))
    exp_log_identity = _safe_complex_log(cmath.exp(unit))
    inverse_identity = unit * _safe_complex_inverse(unit)
    conjugate_identity = unit * unit.conjugate()
    return {
        "unit": unit,
        "minus_i_squared": imaginary_square_identity,
        "exp_log": log_exp_identity,
        "log_exp": exp_log_identity,
        "inverse": inverse_identity,
        "conjugate": conjugate_identity,
    }


def _identity_error(value: complex) -> float:
    return abs(value - 1.0)


def op_closure_score(
    n: int,
    phi: float = PHI,
    j_value: float = 1.0,
    orientation: str | tuple[int, int] = "right",
) -> float:
    """Score how strongly the operation ladder balances back to 1."""

    values = op_closure_values(n, phi=phi, j_value=j_value, orientation=orientation)
    errors = [
        _identity_error(values["minus_i_squared"]),
        _identity_error(values["exp_log"]),
        min(_identity_error(values["log_exp"]), abs(values["log_exp"] - values["unit"])),
        _identity_error(values["inverse"]),
        _identity_error(values["conjugate"]),
    ]
    average_error = sum(errors) / len(errors)
    return _unit_interval(1.0 / (1.0 + average_error))


def op_algebra_values(
    n: int,
    phi: float = PHI,
    j_value: float = 1.0,
    orientation: str | tuple[int, int] = "right",
) -> dict[str, object]:
    """Return the OP cross algebra around M.

    This captures the latest notes as a symbolic/numeric bridge:
    real and imaginary opposite pairs close to 1 under op_sym, while the full
    local alphabet remains {i, -i, -1, 1, M}.
    """

    center = _normalize_complex(spiral_point(n, phi=phi, j_value=j_value, orientation=orientation))
    real_neg = complex(-1.0, 0.0)
    real_pos = complex(1.0, 0.0)
    imag_neg = complex(0.0, -1.0)
    imag_pos = complex(0.0, 1.0)
    return {
        "center": center,
        "real_axis": op_sym(real_neg, real_pos),
        "imaginary_axis": op_sym(imag_neg, imag_pos),
        "op_sym_table": op_sym_table(),
        "observed_equations": observed_op_equations(),
        "real_corrected": [real_neg, real_neg, center, center],
        "imaginary_corrected": [imag_pos, imag_neg, imag_neg, imag_pos],
        "complete_set": [imag_pos, imag_neg, real_neg, real_pos, center],
        "symbols": ["i", "-i", "-1", "1", "M"],
    }


def _unit_magnitude_score(value: complex) -> float:
    return _unit_interval(1.0 / (1.0 + abs(abs(value) - 1.0)))


def op_algebra_score(
    n: int,
    phi: float = PHI,
    j_value: float = 1.0,
    orientation: str | tuple[int, int] = "right",
) -> float:
    """Score closure of the OP cross around M."""

    values = op_algebra_values(n, phi=phi, j_value=j_value, orientation=orientation)
    real_axis = values["real_axis"]
    imag_axis = values["imaginary_axis"]
    complete_set = values["complete_set"]
    if not isinstance(real_axis, complex) or not isinstance(imag_axis, complex):
        raise TypeError("OP axes must be complex values")
    if not isinstance(complete_set, list):
        raise TypeError("OP complete set must be a list")
    identity_score = (
        (1.0 / (1.0 + _identity_error(real_axis)))
        + (1.0 / (1.0 + _identity_error(imag_axis)))
    ) / 2.0
    alphabet_score = sum(_unit_magnitude_score(complex(item)) for item in complete_set) / len(complete_set)
    return _unit_interval(
        (
            identity_score
            + alphabet_score
            + op_symmetry_score(n, phi=phi, j_value=j_value)
            + op_closure_score(n, phi=phi, j_value=j_value, orientation=orientation)
        )
        / 4.0
    )


def _safe_log_base(value: complex, base: complex) -> complex:
    return _safe_complex_log(value) / _safe_complex_log(base)


def prime_dimension_ladder(
    n: int = 1,
    phi: float = PHI,
    j_value: float = 1.0,
    orientation: str | tuple[int, int] = "right",
) -> dict[int, complex]:
    """Return the 1,2,3,5,7 operation ladder from the screenshots.

    The expressions are normalized after each layer so they can be used as DSP
    controls without numeric explosion. The raw idea is preserved: imaginary
    root, root/inversion, exp/log, nested ln/log, then global OP symmetry.
    """

    _assert_positive_n(n)
    d1 = _normalize_complex(cmath.sqrt(-1j))
    d2 = _normalize_complex(-cmath.exp(_safe_complex_log(complex(2.0, 0.0)) * d1 / 2.0))
    d3_raw = _safe_log_base(cmath.exp(3.0 ** (d2 + 1.0)), complex(-3.0, 0.0))
    d3 = _normalize_complex(d3_raw)
    nested = -_safe_log_base(cmath.exp((3.0 * d3) ** (d2 + 1.0)), complex(5.0, 0.0))
    d5 = _normalize_complex(-_safe_log_base(nested, complex(-5.0, 0.0)))
    symmetry_seed = _normalize_complex(d1 + d2 + d3 + d5)
    d7 = op_sym(symmetry_seed, -symmetry_seed)
    center = _normalize_complex(spiral_point(n, phi=phi, j_value=j_value, orientation=orientation))
    return {
        1: _normalize_complex(d1 * center),
        2: _normalize_complex(d2 * center),
        3: _normalize_complex(d3 * center),
        5: _normalize_complex(d5 * center),
        7: _normalize_complex(d7),
    }


def prime_dimension_score(
    n: int,
    phi: float = PHI,
    j_value: float = 1.0,
    orientation: str | tuple[int, int] = "right",
) -> float:
    """Score how tightly the prime-dimension ladder stays balanced."""

    ladder = prime_dimension_ladder(n, phi=phi, j_value=j_value, orientation=orientation)
    magnitude_score = sum(_unit_magnitude_score(value) for value in ladder.values()) / len(ladder)
    closure = op_algebra_score(n, phi=phi, j_value=j_value, orientation=orientation)
    dimension_rhythm = sum(1.0 / dimension for dimension in PRIME_DIMENSIONS) / len(PRIME_DIMENSIONS)
    return _unit_interval((magnitude_score + closure + dimension_rhythm) / 3.0)


def resonance_score(
    n: int,
    phi: float = PHI,
    j_value: float = 1.0,
    orientation: str | tuple[int, int] = "right",
) -> float:
    """Score proximity to log(n) + theta0 = 2*pi*k."""

    angle = phase(n, phi=phi, j_value=j_value, orientation=orientation)
    distance = min(angle, TWO_PI - angle)
    return _unit_interval(1.0 - (distance / math.pi))


def mode_signal(
    n: int,
    mode: str = "hybrid",
    phi: float = PHI,
    j_value: float = 1.0,
    orientation: str | tuple[int, int] = "right",
) -> float:
    """Return a normalized 0..1 signal for one research mode."""

    value = _assert_positive_n(n)
    selected = str(mode or "hybrid").strip().lower().replace("-", "_")

    if selected == "phi_j_spiral":
        return projection_radius(value, phi=phi, j_value=j_value, orientation=orientation)
    if selected == "riemann_chirp":
        return (riemann_like_chirp(value) % SPECTRAL_BASE_HZ) / SPECTRAL_BASE_HZ
    if selected == "modular_grid":
        return projection_linear(value, phi=phi, j_value=j_value, orientation=orientation)
    if selected == "gap_law":
        return _unit_interval(1.0 - min(1.0, value * phase_gap(value)))
    if selected == "resonance":
        return resonance_score(value, phi=phi, j_value=j_value, orientation=orientation)
    if selected == "op_symmetry":
        return op_symmetry_score(value, phi=phi, j_value=j_value)
    if selected == "op_closure":
        return op_closure_score(value, phi=phi, j_value=j_value, orientation=orientation)
    if selected == "op_algebra":
        return op_algebra_score(value, phi=phi, j_value=j_value, orientation=orientation)
    if selected == "prime_dimensions":
        return prime_dimension_score(value, phi=phi, j_value=j_value, orientation=orientation)
    if selected == "hybrid":
        parts = [
            mode_signal(value, "phi_j_spiral", phi, j_value, orientation),
            mode_signal(value, "riemann_chirp", phi, j_value, orientation),
            mode_signal(value, "modular_grid", phi, j_value, orientation),
            mode_signal(value, "resonance", phi, j_value, orientation),
            mode_signal(value, "op_symmetry", phi, j_value, orientation),
            mode_signal(value, "op_closure", phi, j_value, orientation),
            mode_signal(value, "op_algebra", phi, j_value, orientation),
            mode_signal(value, "prime_dimensions", phi, j_value, orientation),
        ]
        return sum(parts) / len(parts)

    known = ", ".join(MODES)
    raise ValueError(f"unknown mode {mode!r}; expected one of: {known}")


def spiral_features(
    limit: int,
    phi: float = PHI,
    j_value: float = 1.0,
    orientation: str | tuple[int, int] = "right",
    max_db: float = 3.0,
) -> list[SpiralFeature]:
    size = _assert_positive_n(limit)
    flags = prime_flags(size)
    features: list[SpiralFeature] = []
    for n in range(1, size + 1):
        p_radius = projection_radius(n, phi, j_value, orientation)
        p_linear = projection_linear(n, phi, j_value, orientation)
        db_value = gain_db_from_projection(p_linear, max_db=max_db)
        features.append(
            SpiralFeature(
                n=n,
                is_prime=flags[n],
                radius=abs(spiral_point(n, phi, j_value, orientation)),
                phase=phase(n, phi, j_value, orientation),
                phase_gap=phase_gap(n),
                projection_radius=p_radius,
                projection_linear=p_linear,
                gain_db=db_value,
            )
        )
    return features


def control_curve(
    length: int,
    phi: float = PHI,
    j_value: float = 1.0,
    orientation: str | tuple[int, int] = "right",
    max_db: float = 3.0,
    prime_boost_db: float = 1.0,
    mode: str = "hybrid",
) -> list[float]:
    """Return bounded linear gain multipliers for later streaming DSP tests."""

    size = _assert_positive_n(length)
    flags = prime_flags(size)
    curve: list[float] = []
    for n in range(1, size + 1):
        db_value = gain_db_from_projection(mode_signal(n, mode, phi, j_value, orientation), max_db=max_db)
        if flags[n]:
            db_value += float(prime_boost_db) * (1.0 - min(1.0, phase_gap(n)))
        curve.append(gain_linear_from_db(db_value))
    return curve


def spectral_weights(
    bins: int,
    phi: float = PHI,
    j_value: float = 1.0,
    orientation: str | tuple[int, int] = "right",
    strength: float = 0.25,
    mode: str = "hybrid",
) -> list[float]:
    """Small, stable EQ/formant weights for frequency-bin experiments."""

    size = _assert_positive_n(bins)
    weights: list[float] = []
    for n in range(1, size + 1):
        signal = mode_signal(n, mode, phi, j_value, orientation)
        weights.append(1.0 + float(strength) * ((2.0 * signal) - 1.0))
    return weights


def _records(items: Iterable[SpiralFeature]) -> list[dict[str, float | int | bool]]:
    return [asdict(item) for item in items]


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate prime-spiral research control curves.")
    parser.add_argument("--limit", type=int, default=32)
    parser.add_argument("--phi", type=float, default=PHI)
    parser.add_argument("--j", dest="j_value", type=float, default=1.0)
    parser.add_argument("--orientation", default="right", choices=sorted(ORIENTATIONS))
    parser.add_argument("--mode", default="hybrid", choices=MODES)
    parser.add_argument("--curve", action="store_true", help="print gain curve instead of feature records")
    parser.add_argument("--op-table", action="store_true", help="print the Symetrie OP table report")
    args = parser.parse_args()

    if args.op_table:
        payload = op_table_report()
    elif args.curve:
        payload = {
            "schema": "funesterie.prime-spiral-control-curve.v1",
            "spectralBaseHz": SPECTRAL_BASE_HZ,
            "mode": args.mode,
            "curve": control_curve(args.limit, args.phi, args.j_value, args.orientation, mode=args.mode),
        }
    else:
        payload = {
            "schema": "funesterie.prime-spiral-features.v1",
            "spectralBaseHz": SPECTRAL_BASE_HZ,
            "features": _records(spiral_features(args.limit, args.phi, args.j_value, args.orientation)),
        }
    print(json.dumps(payload, indent=2, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
