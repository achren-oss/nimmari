"""Run with python3 -m unittest discover -s skills/nimmari/scripts -p test_env.py."""
import os
import unittest
from unittest.mock import patch
from env import nimmari_env


class EnvTests(unittest.TestCase):
    def test_alias_precedence(self):
        for name in ('BASE_URL', 'API_KEY', 'BOT_API_KEY', 'WEBHOOK_SECRET'):
            with self.subTest(name=name), patch.dict(os.environ, {}, clear=True):
                self.assertEqual(nimmari_env(name), '')
                os.environ['PUUMERKKI_' + name] = 'legacy'
                self.assertEqual(nimmari_env(name), 'legacy')
                os.environ['NIMMARI_' + name] = 'new'
                self.assertEqual(nimmari_env(name), 'new')
                os.environ['NIMMARI_' + name] = ''
                self.assertEqual(nimmari_env(name), '')
