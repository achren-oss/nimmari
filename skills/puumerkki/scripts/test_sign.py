#!/usr/bin/env python3
"""Sign disposable test sessions in order; print only HTTP statuses. Requires requests."""
import argparse
import base64
import json
import os
from pathlib import Path
import sys
from urllib.parse import quote, urlsplit

import requests


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('flow', type=Path, help='Flow JSON produced with --print-urls')
    parser.add_argument('--values', type=Path, required=True, help='JSON: signer key -> {fieldName: string value}')
    parser.add_argument('--signature', type=Path, required=True, help='Synthetic signature PNG')
    parser.add_argument('--i-know-this-is-a-test', action='store_true')
    args = parser.parse_args()
    flow = json.loads(args.flow.read_text(encoding='utf-8'))
    supplied = json.loads(args.values.read_text(encoding='utf-8'))
    signers = flow['signers']
    if not isinstance(signers, list) or not signers:
        raise ValueError()
    if not args.i_know_this_is_a_test and any(
            not isinstance(s.get('email'), str) or not s['email'].lower().endswith('@example.com') for s in signers):
        print('Refused: all signer emails must end with @example.com, or use --i-know-this-is-a-test.', file=sys.stderr)
        return 1
    base = os.environ.get('PUUMERKKI_BASE_URL', '').rstrip('/')
    parsed = urlsplit(base)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError()
    png = args.signature.read_bytes()
    if not png.startswith(b'\x89PNG\r\n\x1a\n') or len(png) > 500*1024:
        raise ValueError()
    signature = 'data:image/png;base64,' + base64.b64encode(png).decode('ascii')
    names = flow.get('fieldNames', {})
    # Validate every session and supplied value before making a signing mutation.
    if not isinstance(supplied, dict):
        raise ValueError()
    for signer in signers:
        link = urlsplit(signer['url'])
        if link.scheme not in ('http', 'https') or not link.netloc or not link.path.rstrip('/').split('/')[-1] or not signer.get('key'):
            raise ValueError()
        values = supplied.get(signer['key'], {})
        if not isinstance(values, dict) or any(not isinstance(v, str) for v in values.values()):
            raise ValueError()
    ordered = sorted(enumerate(signers), key=lambda item: (item[1].get('order') if item[1].get('order') is not None else 0, item[0]))
    with requests.Session() as session:
        for index, signer in ordered:
            token = urlsplit(signer['url']).path.rstrip('/').split('/')[-1]
            endpoint = base + '/api/sign/' + quote(token, safe='')
            response = session.get(endpoint, timeout=(10, 90), allow_redirects=False)
            print(f'Signer {index+1} GET HTTP {response.status_code}')
            if response.status_code != 200:
                return 1
            payload = response.json()
            if payload.get('signedAt'):
                continue
            values = {}
            configured = supplied.get(signer['key'], {})
            for field in payload.get('fields', []):
                assigned = field.get('assignedSignerKey')
                email = field.get('assignedToSignerEmail')
                belongs = assigned == signer['key'] if assigned else (not email or email.lower() == signer['email'].lower())
                if not belongs or field.get('readOnly') or field.get('prefilled') or not field.get('editable', True) or field['type'] == 'signature':
                    continue
                name = field.get('name') or names.get(field['id']) or field.get('label')
                if name in configured:
                    values[field['id']] = configured[name]
                elif field.get('required'):
                    print(f'Signer {index+1} validation FAILED (missing required editable value)', file=sys.stderr)
                    return 1
            response = session.post(endpoint, json={'values': values, 'signaturePng': signature}, timeout=(10, 90), allow_redirects=False)
            print(f'Signer {index+1} POST HTTP {response.status_code}')
            if not 200 <= response.status_code < 300:
                return 1
    print('Next: run scripts/fetch_signed_pdf.py DOC_ID final.pdf (documentId from flow JSON); '
          'poll completion and validate before rendering. Never trust the first PDF byte stream.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except requests.RequestException:
        print('HTTP transport FAILED; inspect test state before retrying.', file=sys.stderr)
        sys.exit(1)
    except (ValueError, OSError, KeyError, TypeError, AttributeError):
        print('Test input validation FAILED; check flow JSON, values, PNG and base URL.', file=sys.stderr)
        sys.exit(1)
