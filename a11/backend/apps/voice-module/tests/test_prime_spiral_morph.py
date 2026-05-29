import math
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import prime_spiral_morph as psm


class PrimeSpiralMorphTests(unittest.TestCase):
    def test_radius_matches_formula(self):
        self.assertAlmostEqual(psm.complex_radius(), math.sqrt(psm.PHI**2 + 1.0), places=12)

    def test_phase_gap_tends_to_one_over_n(self):
        n = 10_000
        self.assertAlmostEqual(psm.phase_gap(n), 1.0 / n, places=8)

    def test_resonance_condition(self):
        for k in range(1, 4):
            n = psm.resonance_index(k)
            value = math.log(n) + psm.theta0()
            self.assertAlmostEqual(value, 2.0 * math.pi * k, places=10)

    def test_prime_flags(self):
        flags = psm.prime_flags(20)
        primes = [index for index, is_prime in enumerate(flags) if is_prime]
        self.assertEqual(primes, [2, 3, 5, 7, 11, 13, 17, 19])

    def test_features_and_curve_are_bounded(self):
        features = psm.spiral_features(32)
        self.assertEqual(len(features), 32)
        self.assertTrue(all(0.0 <= item.projection_linear < 1.0 for item in features))
        self.assertTrue(all(0.0 <= item.projection_radius < 1.0 for item in features))

        curve = psm.control_curve(32)
        self.assertEqual(len(curve), 32)
        self.assertTrue(all(0.5 < value < 2.0 for value in curve))

    def test_spectral_base_is_about_twenty_hz(self):
        self.assertAlmostEqual(psm.SPECTRAL_BASE_HZ, 20.00025, places=5)

    def test_modes_are_normalized(self):
        for mode in psm.MODES:
            values = [psm.mode_signal(n, mode=mode) for n in range(1, 16)]
            self.assertTrue(all(0.0 <= value <= 1.0 for value in values), mode)

    def test_op_symmetry_is_high_when_orientations_cohere(self):
        score = psm.op_symmetry_score(1, phi=1.0, j_value=1.0)
        self.assertGreater(score, 0.99)

    def test_op_closure_balances_operation_layers(self):
        values = psm.op_closure_values(7)
        self.assertAlmostEqual(abs(values["unit"]), 1.0, places=12)
        self.assertAlmostEqual(values["inverse"].real, 1.0, places=12)
        self.assertAlmostEqual(values["conjugate"].real, 1.0, places=12)
        self.assertGreater(psm.op_closure_score(7), 0.55)

    def test_op_sym_balances_opposite_axes(self):
        self.assertEqual(psm.op_sym(-1, 1), 1)
        self.assertEqual(psm.op_sym(-1j, 1j), 1)

    def test_op_tables_are_closed_and_keep_custom_op_separate(self):
        mul_table = psm.op_mul_table()
        sym_table = psm.op_sym_table()

        self.assertEqual(len(mul_table), 16)
        self.assertEqual(len(sym_table), 16)
        self.assertEqual(
            {row["result"] for row in mul_table},
            {"1", "-1", "i", "-i"},
        )
        self.assertEqual(
            {row["result"] for row in sym_table},
            {"1", "-1", "i", "-i"},
        )

        real_balance = [
            row for row in sym_table
            if row["left"] == "-M" and row["right"] == "+M"
        ][0]
        imag_balance = [
            row for row in sym_table
            if row["left"] == "-iM" and row["right"] == "+iM"
        ][0]
        self.assertEqual(real_balance["result"], "1")
        self.assertEqual(real_balance["kind"], "balanced-opposite")
        self.assertEqual(imag_balance["result"], "1")
        self.assertEqual(imag_balance["kind"], "balanced-opposite")

    def test_observed_op_equations_stay_in_review_alphabet(self):
        equations = psm.observed_op_equations()
        self.assertGreaterEqual(len(equations), 8)
        self.assertTrue({row["actual"] for row in equations}.issubset(set(psm.OP_ALPHABET)))
        self.assertTrue(
            any(row["status"] == "recorded-custom-op" for row in equations)
        )

    def test_op_table_report_marks_guardrails(self):
        report = psm.op_table_report()
        self.assertEqual(report["schema"], "funesterie.symetrie-op-table.v1")
        self.assertTrue(report["checks"]["opSymRealAxis"])
        self.assertTrue(report["checks"]["opSymImaginaryAxis"])
        self.assertTrue(report["checks"]["opSymClosedInComplexUnits"])
        self.assertTrue(report["checks"]["observedClosedInAlphabet"])
        self.assertIn("research-table-not-proof", report["status"])

    def test_op_algebra_captures_complete_set(self):
        values = psm.op_algebra_values(11)
        self.assertAlmostEqual(values["real_axis"].real, 1.0, places=12)
        self.assertAlmostEqual(values["imaginary_axis"].real, 1.0, places=12)
        self.assertEqual(values["symbols"], ["i", "-i", "-1", "1", "M"])
        self.assertEqual(len(values["op_sym_table"]), 16)
        self.assertGreaterEqual(len(values["observed_equations"]), 8)
        self.assertEqual(len(values["real_corrected"]), 4)
        self.assertEqual(len(values["imaginary_corrected"]), 4)
        self.assertGreater(psm.op_algebra_score(11), 0.5)

    def test_prime_dimension_ladder_uses_prime_dimensions(self):
        ladder = psm.prime_dimension_ladder(13)
        self.assertEqual(tuple(ladder), psm.PRIME_DIMENSIONS)
        self.assertTrue(all(abs(value) > 0.0 for value in ladder.values()))
        self.assertTrue(0.0 <= psm.prime_dimension_score(13) <= 1.0)

    def test_control_curve_supports_each_mode(self):
        for mode in psm.MODES:
            curve = psm.control_curve(12, mode=mode)
            weights = psm.spectral_weights(12, mode=mode)
            self.assertEqual(len(curve), 12)
            self.assertEqual(len(weights), 12)
            self.assertTrue(all(0.5 < value < 2.0 for value in curve), mode)


if __name__ == "__main__":
    unittest.main()
