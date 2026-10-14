"""Offline regression tests for signed PDF download integrity."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import requests

import fetch_signed_pdf as helper


PDF = b'%PDF-1.7\nstartxref\n0\n%%EOF\n'


def response(data=PDF, status=200, **headers):
    return Mock(status_code=status, content=data, headers={
        'Content-Length': str(len(data)),
        'X-Content-SHA256': hashlib.sha256(data).hexdigest(),
        **headers,
    })


class FetchTests(unittest.TestCase):
    def download(self, replies, output):
        session = Mock()
        session.get.side_effect = [Mock(status_code=200, json=lambda: {'status': 'completed'}),
                                   *replies]
        with patch.object(helper.shutil, 'which', return_value=None), \
                patch.object(helper.time, 'sleep') as sleep:
            helper.fetch(session, 'https://example.invalid/api/documents/test', output, 30, 2)
        return sleep

    def test_valid_download(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'signed.pdf'
            self.download([response()], output)
            self.assertEqual(output.read_bytes(), PDF)

    def test_invalid_downloads_preserve_existing_output(self):
        for bad in [response(**{'Content-Length': '1'}),
                    response(**{'X-Content-SHA256': '0' * 64}),
                    response(**{'Content-Length': ''}),
                    response(**{'X-Content-SHA256': ''}),
                    response(b'%PDF-1.7\n%%EOF'),
                    response(PDF + b' ' * 2048)]:
            with self.subTest(headers=bad.headers), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / 'signed.pdf'
                output.write_bytes(b'existing')
                with self.assertRaisesRegex(RuntimeError, 'after 3 attempts'):
                    self.download([bad] * 3, output)
                self.assertEqual(output.read_bytes(), b'existing')
                self.assertEqual(list(Path(directory).iterdir()), [output])

    def test_retry_after_and_transport_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'signed.pdf'
            sleep = self.download([response(status=503, **{'Retry-After': '7'}),
                                   requests.ConnectionError(), response()], output)
            self.assertEqual([call.args[0] for call in sleep.call_args_list], [7, 2])
            self.assertEqual(output.read_bytes(), PDF)

    def test_retry_after_parsing(self):
        self.assertEqual(helper.retry_after_seconds('0', 2), 0)
        self.assertEqual(helper.retry_after_seconds('invalid', 2), 2)
        self.assertEqual(helper.retry_after_seconds('Wed, 01 Jan 2020 00:00:00 GMT', 2), 0)


if __name__ == '__main__':
    unittest.main()
