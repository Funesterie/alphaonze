import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient

from app.main import app


class PrimeSpiralEndpointTests(unittest.TestCase):
    def test_research_endpoint_returns_bounded_curves(self):
        client = TestClient(app)
        response = client.post(
            "/research/prime-spiral/control",
            json={"length": 8, "bins": 6, "mode": "op_algebra", "includeFeatures": True},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["researchOnly"])
        self.assertEqual(len(payload["curve"]), 8)
        self.assertEqual(len(payload["weights"]), 6)
        self.assertEqual(len(payload["features"]), 8)
        self.assertEqual(payload["params"]["mode"], "op_algebra")
        self.assertTrue(all(0.5 < value < 2.0 for value in payload["curve"]))

    def test_health_mentions_research_endpoint(self):
        client = TestClient(app)
        payload = client.get("/health").json()
        self.assertEqual(payload["research"]["primeSpiral"]["endpoint"], "/research/prime-spiral/control")


if __name__ == "__main__":
    unittest.main()
