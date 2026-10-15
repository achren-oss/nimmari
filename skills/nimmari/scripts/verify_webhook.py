#!/usr/bin/env python3
"""Verify exact webhook bytes before parsing JSON; this is not an HTTP server."""
import argparse
import hashlib
import hmac
import json
from env import nimmari_env
from pathlib import Path
import re
import sys


def verify_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    """Pass the untouched request body and X-Puumerkki-Signature header."""
    if not secret or not isinstance(signature, str) or not re.fullmatch(r"[0-9a-f]{64}", signature):
        return False
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("body", type=Path, help="File containing exact raw HTTP body bytes")
    parser.add_argument("--signature", required=True, help="X-Puumerkki-Signature header value")
    args = parser.parse_args()
    secret = nimmari_env("WEBHOOK_SECRET")
    if not secret:
        parser.error("Set NIMMARI_WEBHOOK_SECRET to the same secret configured on the instance")
    raw = args.body.read_bytes()
    if not verify_signature(raw, args.signature, secret):
        print("Invalid webhook signature", file=sys.stderr)
        return 1
    payload = json.loads(raw)
    print(json.dumps({"verified": True, "event": payload.get("event"),
                      "documentId": payload.get("document", {}).get("id")}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, AttributeError):
        print("Cannot read a valid webhook payload", file=sys.stderr)
        sys.exit(1)
