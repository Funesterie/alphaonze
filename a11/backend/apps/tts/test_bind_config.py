import unittest

from bind_config import resolve_bind_host


class BindConfigTests(unittest.TestCase):
    def test_defaults_to_localhost(self):
        self.assertEqual(resolve_bind_host({}), "127.0.0.1")

    def test_prefers_tts_host(self):
        self.assertEqual(
            resolve_bind_host({"TTS_HOST": "0.0.0.0", "HOST": "127.0.0.1"}),
            "0.0.0.0",
        )

    def test_falls_back_to_generic_host(self):
        self.assertEqual(
            resolve_bind_host({"HOST": "192.168.1.44"}),
            "192.168.1.44",
        )


if __name__ == "__main__":
    unittest.main()
