#!/usr/bin/env python3
"""Poll completion and download a validated signed PDF. Requires requests."""
import argparse
import math
import hashlib
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from env import nimmari_env
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote, urlsplit

import requests


def positive_seconds(value):
    seconds = float(value)
    if not math.isfinite(seconds) or seconds <= 0:
        raise argparse.ArgumentTypeError('Must be a finite positive number of seconds')
    return seconds


def retry_after_seconds(value, fallback):
    if value:
        try:
            if value.strip().isdigit():
                return int(value.strip())
            date = parsedate_to_datetime(value)
            return max(0, (date - datetime.now(timezone.utc)).total_seconds())
        except (ValueError, TypeError, OverflowError):
            pass
    return fallback


def fetch(session, endpoint, output, timeout, poll_interval):
    deadline = time.monotonic() + timeout
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError('Timed out waiting for document completion')
        response = session.get(endpoint, timeout=(min(10, remaining), min(30, remaining)),
                               allow_redirects=False)
        if response.status_code != 200:
            raise RuntimeError(f'Document GET failed with HTTP {response.status_code}')
        status = response.json()['status']
        if time.monotonic() >= deadline:
            raise RuntimeError('Timed out waiting for document completion')
        if status == 'completed':
            break
        if status in ('cancelled', 'declined'):
            raise RuntimeError('Document ended without completion')
        if status not in ('draft', 'sent'):
            raise RuntimeError('Unexpected document status')
        time.sleep(min(poll_interval, max(0, deadline - time.monotonic())))

    pdfinfo = shutil.which('pdfinfo')
    if not pdfinfo:
        print('pdfinfo unavailable; checking integrity headers and PDF markers.', file=sys.stderr)
    # Three attempts total; invalid bytes never replace the requested output.
    for attempt in range(1, 4):
        temporary = None
        retry_delay = 2 ** (attempt - 1)
        try:
            response = session.get(endpoint + '/pdf?signed=1', timeout=(10, 90),
                                   allow_redirects=False)
            if response.status_code == 503:
                retry_delay = retry_after_seconds(response.headers.get('Retry-After'), retry_delay)
                raise RuntimeError('PDF not ready')
            if response.status_code != 200:
                raise RuntimeError('Signed PDF HTTP failure')
            data = response.content
            length = response.headers.get('Content-Length', '')
            if not length.isdigit() or len(data) != int(length):
                raise RuntimeError('PDF length missing or mismatched')
            digest = response.headers.get('X-Content-SHA256', '')
            if hashlib.sha256(data).hexdigest() != digest.lower():
                raise RuntimeError('PDF SHA-256 missing or mismatched')
            if (not data.startswith(b'%PDF-') or b'%%EOF' not in data[-2048:]
                    or b'startxref' not in data):
                raise RuntimeError('Missing PDF header or trailer')
            with tempfile.NamedTemporaryFile(dir=output.parent, suffix='.pdf', delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(data)
            if pdfinfo:
                result = subprocess.run([pdfinfo, str(temporary)], stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL, timeout=30, check=False)
                if result.returncode != 0:
                    raise RuntimeError('pdfinfo could not parse the PDF')
            temporary.replace(output)
            print('Validated signed PDF saved.')
            return
        except (requests.RequestException, RuntimeError, subprocess.TimeoutExpired):
            print(f'Signed PDF attempt {attempt}/3 failed download or validation.', file=sys.stderr)
            if attempt == 3:
                raise RuntimeError('Signed PDF failed after 3 attempts') from None
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        time.sleep(retry_delay)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('document_id')
    parser.add_argument('output', type=Path, help='Destination PDF (parent directory must exist)')
    parser.add_argument('--timeout', type=positive_seconds, default=300,
                        help='Completion polling timeout in seconds (default: 300)')
    parser.add_argument('--poll-interval', type=positive_seconds, default=2,
                        help='Seconds between status checks (default: 2)')
    args = parser.parse_args()
    # NIMMARI_BOT_API_KEY is a deprecated fallback; prefer NIMMARI_API_KEY.
    base = nimmari_env("BASE_URL").rstrip('/')
    key = (nimmari_env("API_KEY") or nimmari_env("BOT_API_KEY"))
    parsed = urlsplit(base)
    if (parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username
            or parsed.password or parsed.query or parsed.fragment or not key
            or not args.document_id.strip()):
        raise ValueError()
    with requests.Session() as session:
        session.headers['Authorization'] = 'Bearer ' + key
        fetch(session, base + '/api/documents/' + quote(args.document_id, safe=''),
              args.output, args.timeout, args.poll_interval)


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        # Only fixed local messages; never emit bodies, URLs, headers or the key.
        message = str(error)
        key = (nimmari_env("API_KEY") or nimmari_env("BOT_API_KEY"))
        print(message.replace(key, '[redacted]') if key else message, file=sys.stderr)
        sys.exit(1)
    except (requests.RequestException, ValueError, OSError, KeyError, TypeError):
        print('Fetch failed; check environment, document response and output destination.', file=sys.stderr)
        sys.exit(1)
