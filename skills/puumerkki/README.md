# Puumerkki skill

An agent-agnostic skill for Puumerkki's HTTP e-signature API. Read
[SKILL.md](SKILL.md) for the workflow and [API cheatsheet](reference/api-cheatsheet.md)
for schemas and implementation details. No agent vendor or connector is required.

Install Python 3 and run `python3 -m pip install -r requirements.txt`. Optional Poppler (`poppler-utils` on Debian/Ubuntu) provides PDF rendering and text checks for `scripts/render_check.sh`.
Set `PUUMERKKI_BASE_URL` and `PUUMERKKI_API_KEY` through your environment or
secret manager. Use a provisioned regular database key on the client. Administrators configure the server root `PUUMERKKI_API_KEY` and provision accounts and keys as described in the [API cheatsheet](reference/api-cheatsheet.md#accounts-and-api-keys). Root document access additionally requires `PUUMERKKI_API_OWNER_ID`. Never print
or commit keys. The Python clients accept `PUUMERKKI_BOT_API_KEY` as a deprecated fallback when `PUUMERKKI_API_KEY` is empty or unset. Use the field, prefill, and signer JSON examples in the cheatsheet,
adapting them to your document.

```sh
python3 scripts/acroform_to_fields.py form.pdf --output-dir /tmp/new-form \
  --skip-prefix witness --private national_id=party
# Review fields.json and manually add assigned signature boxes.
python3 scripts/puumerkki_flow.py /tmp/new-form/flattened.pdf --title Agreement \
  --fields /tmp/new-form/fields.json --prefill prefill.json --signers signers.json \
  --no-send > draft.json
# Verify prefilledCheck, assignments and layout before sending the documentId.
python3 scripts/puumerkki_flow.py --send-only DOC_ID --signers signers.json
# For a disposable example.com test, capture links privately with --print-urls:
python3 scripts/puumerkki_flow.py --send-only TEST_DOC_ID --signers test-signers.json \
  --print-urls > test-flow.json
python3 scripts/test_sign.py test-flow.json --values test-values.json --signature synthetic.png
python3 scripts/fetch_signed_pdf.py TEST_DOC_ID final.pdf --timeout 300
bash scripts/render_check.sh final.pdf final-render
python3 scripts/verify_webhook.py raw-body.json --signature "$received_signature"
```

Run commands from this folder, or adjust paths. Follow **draft -> verify -> send**.
The flow resolves local field names to server IDs and verifies prefill by fetching
the draft. `--no-send` outputs `documentId` and `prefilledCheck`; `--send-only`
requires a draft and never edits it. Signing URLs are excluded unless `--print-urls`
is explicit; store such output privately. New uploads and sends disable notifications;
send-only retains the existing upload notification setting. No mutations are retried.
The flow output includes a `fieldNames` ID-to-name map for PDF test submissions.
The test helper takes values keyed by signer key then field name, respects order
and editable fields, prints statuses and a PDF verification hint, and refuses non-example.com emails
unless `--i-know-this-is-a-test` is explicit. It signs actual disposable documents.
Ask who signs and collect missing information first. Complete a synthetic dry run
and inspect every rendered page, including the added multi-signer seal page,
before delivering real links. Other signers' private fields are absent from signer
GET payloads (42 of 44 in the reference test).

Always use `fetch_signed_pdf.py` before inspecting the final artifact. It reads
owner Bearer authentication from the environment, polls until `completed`, checks
the `%PDF-` header and `%%EOF` marker, and runs `pdfinfo` when available. Failed
downloads or validation get three attempts total with 1- and 2-second backoff;
only a validated download replaces the output. `--timeout` sets the completion
polling limit (default 300 seconds); `--poll-interval` defaults to 2 seconds.
Never trust the first byte stream: an immediate fetch after the last signer POST
returned an 8 KB truncated PDF without a trailer, while a later refetch was valid.

The webhook example reads `PUUMERKKI_WEBHOOK_SECRET` and verifies untouched raw
body bytes; import `verify_signature` into your HTTP receiver before parsing JSON.
The render helper prints extracted document text: run it privately, then open all
PNGs. Puumerkki supplies simple drawn/email-link signatures, and completed PDFs
show private values in full to all parties. Review the skill's limits before use.
