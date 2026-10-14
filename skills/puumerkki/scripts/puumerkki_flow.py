#!/usr/bin/env python3
"""Create a link-only PDF signing workflow. Requires Python 3 and requests."""
import argparse
import json
import os
from pathlib import Path
import sys
from urllib.parse import quote, urlsplit

import requests

MAX_PDF_BYTES = 4 * 1024 * 1024


def load_json(path):
    with open(path, encoding="utf-8") as stream:
        return json.load(stream)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path, nargs="?")
    parser.add_argument("--title")
    parser.add_argument("--fields", help='JSON object: {"fields": [...]}')
    parser.add_argument("--prefill", help="JSON object mapping unique field names to string values")
    parser.add_argument("--signers", help="JSON array of signers (email, name, key, optional order)")
    parser.add_argument("--audit-timezone", default="Europe/Helsinki")
    parser.add_argument("--webhook-url")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--no-send", action="store_true", help="Prepare and check a draft without sending")
    modes.add_argument("--send-only", metavar="DOC_ID", help="Send an existing verified draft")
    parser.add_argument("--print-urls", action="store_true", help="Include sensitive signing URLs in stdout")
    args = parser.parse_args()
    if not args.signers or (not args.send_only and not all((args.pdf, args.title, args.fields, args.prefill))):
        parser.error("--signers is required; creation also requires pdf, --title, --fields and --prefill")
    if args.send_only and any((args.pdf, args.title, args.fields, args.prefill, args.webhook_url)):
        parser.error("--send-only cannot be combined with creation arguments")
    base = os.environ.get("PUUMERKKI_BASE_URL", "").rstrip("/")
    key = os.environ.get("PUUMERKKI_BOT_API_KEY", "")
    parsed_url = urlsplit(base)
    if (parsed_url.scheme not in ("http", "https") or not parsed_url.netloc
            or parsed_url.username or parsed_url.password or parsed_url.query or parsed_url.fragment):
        raise ValueError("Set PUUMERKKI_BASE_URL to the instance URL without credentials, query, or fragment")
    if not key:
        raise ValueError("Set PUUMERKKI_BOT_API_KEY")
    fields_body = load_json(args.fields) if not args.send_only else {"fields": []}
    prefill = load_json(args.prefill) if not args.send_only else {}
    signers = load_json(args.signers)
    if not isinstance(fields_body, dict) or not isinstance(fields_body.get("fields"), list):
        raise ValueError('Fields JSON must be {"fields": [...]}')
    if not args.send_only and not fields_body["fields"]:
        raise ValueError("Configure at least one field")
    names = [f.get("name") for f in fields_body["fields"]]
    if any(not isinstance(n, str) or not n.strip() for n in names) or len(set(names)) != len(names):
        raise ValueError("Give every field a unique nonempty name for local prefill mapping")
    if not isinstance(prefill, dict) or any(not isinstance(v, str) for v in prefill.values()):
        raise ValueError("Prefill JSON must map field names to strings")
    if set(prefill) - set(names):
        raise ValueError("Prefill contains unknown field names")
    if any(f["name"] in prefill and f.get("type") == "signature" for f in fields_body["fields"]):
        raise ValueError("Signatures cannot be prefilled")
    if not isinstance(signers, list) or not signers or any(
            not isinstance(s, dict) or not s.get("email") for s in signers):
        raise ValueError("Signers JSON must be a nonempty array with email on each signer")
    if not args.send_only:
        if args.pdf.stat().st_size > MAX_PDF_BYTES:
            raise ValueError("PDF exceeds 4 MiB (4194304 bytes)")
        with args.pdf.open("rb") as stream:
            if stream.read(5) != b"%PDF-":
                raise ValueError("Input must be a PDF")

    with requests.Session() as session:
        session.headers["Authorization"] = "Bearer " + key

        def api(method, path, **kwargs):
            # Never retry mutations automatically; a timeout may follow a committed write.
            response = session.request(method, base + path, timeout=(10, 90),
                                       allow_redirects=False, **kwargs)
            if not 200 <= response.status_code < 300:
                # Do not echo server bodies, URLs, headers, or credentials into logs.
                raise RuntimeError(f"API {method} failed with HTTP {response.status_code}; inspect document state before retrying")
            return response.json()

        if args.send_only:
            doc_id = args.send_only
            path = "/api/documents/" + quote(doc_id, safe="")
            doc = api("GET", path)
            if doc.get("status") != "draft":
                raise ValueError("--send-only requires an existing draft")
        else:
            data = {"title": args.title, "notify": "false", "auditTimezone": args.audit_timezone}
            if args.webhook_url:
                data["webhookUrl"] = args.webhook_url
            with args.pdf.open("rb") as stream:
                uploaded = api("POST", "/api/documents", data=data,
                               files={"pdf": (args.pdf.name, stream, "application/pdf")})
            doc_id = uploaded["id"]
            print(f"Created document {doc_id}", file=sys.stderr)
            path = "/api/documents/" + quote(doc_id, safe="")
            api("PUT", path + "/fields", json=fields_body)
            doc = api("GET", path)
            # PDF prefill uses server-generated IDs, NOT field names.
            ids_by_name = {f["name"]: f["id"] for f in doc["fields"]}
            values = {ids_by_name[name]: value for name, value in prefill.items()}
            api("PUT", path + "/prefill", json={"values": values, "mode": "merge"})
            checked = api("GET", path)
            actual = {f["name"]: f for f in checked["fields"]}
            checks = []
            for name, value in prefill.items():
                field = actual[name]
                checkbox = field.get("type") == "checkbox"
                cleared = value not in ("true", "on", "1") if checkbox else not value.strip()
                expected = "true" if checkbox else value
                ok = (not field.get("prefilled") and not field.get("value")) if cleared else (
                    field.get("prefilled") is True and field.get("value") == expected)
                checks.append({"name": name, "ok": bool(ok), "prefilled": bool(field.get("prefilled"))})
            check = {"ok": all(c["ok"] for c in checks), "fields": checks}
            if args.no_send or not check["ok"]:
                print(json.dumps({"documentId": doc_id, "prefilledCheck": check}, indent=2))
                if not check["ok"]:
                    raise RuntimeError("Prefill verification failed; draft was not sent")
                return
            doc = checked
        result = api("POST", path + "/send", json={"signers": signers, "notify": False})
        if "signers" in result:
            links = result["signers"]
        else:
            links = [{**signers[0], **{k: v for k, v in result.items() if k != "expiresAt"}}]
        # Preserve signer identity even for the single-signer response shape.
        for index, link in enumerate(links):
            source = next((s for s in signers if s.get("key") == link.get("key")), signers[index])
            for attribute in ("email", "name", "order"):
                if attribute in source:
                    link.setdefault(attribute, source[attribute])
        if not args.print_urls:
            links = [{k: v for k, v in link.items() if k != "url"} for link in links]
        print(json.dumps({"documentId": doc_id, "expiresAt": result["expiresAt"],
                          "fieldNames": {f["id"]: f["name"] for f in doc["fields"]},
                          "signers": links}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except requests.RequestException:
        print("HTTP transport failed; inspect document state before retrying (no automatic retry).", file=sys.stderr)
        sys.exit(1)
    except (KeyError, TypeError, AttributeError):
        print("Unexpected input or API response shape; inspect document state before retrying.", file=sys.stderr)
        sys.exit(1)
    except (ValueError, OSError, RuntimeError) as error:
        # Local messages avoid dumping JSON values; redact the key defensively.
        message = str(error)
        secret = os.environ.get("PUUMERKKI_BOT_API_KEY")
        if secret:
            message = message.replace(secret, "[redacted]")
        print(message, file=sys.stderr)
        sys.exit(1)
