#!/usr/bin/env bash
# End-to-end smoke test: provision → login → upload HTML → create signing session →
# sign → fetch signed PDF → verify %PDF- header.
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HOST="${HOST:-http://localhost:3000}"
HOST="${HOST%/}"
COOKIE_JAR=$(mktemp)
PDF_OUT=$(mktemp)
OWNER_PDF=$(mktemp)
trap 'rm -f "$COOKIE_JAR" "$PDF_OUT" "$OWNER_PDF"' EXIT
TS="$(date +%s)-$$"
EMAIL="smoke-$TS@example.com"
SIG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII="

# Admin provisioning replaces disabled public signup. Do not enable shell tracing.
NIMMARI_API_KEY="${NIMMARI_API_KEY-${PUUMERKKI_API_KEY-}}"
ROOT_KEY="${NIMMARI_API_KEY:-}"
if [[ -z "$ROOT_KEY" ]]; then
  echo "A root API key is required for smoke account provisioning" >&2
  exit 1
fi
echo "==> provision ($EMAIL)"
curl -fsS -X POST "$HOST/api/accounts" \
  -H "Authorization: Bearer $ROOT_KEY" -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke\",\"email\":\"$EMAIL\",\"password\":\"password1234\"}" \
  -o /dev/null -w "  http=%{http_code}\n"
echo "==> login"
curl -fsS -c "$COOKIE_JAR" -X POST "$HOST/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"password1234\"}" \
  -o /dev/null -w "  http=%{http_code}\n"

echo "==> upload HTML"
DOC_JSON=$(curl -fsS -b "$COOKIE_JAR" -X POST "$HOST/api/documents/html" \
  -F "title=Smoke" -F "html=@$SCRIPT_DIR/fixtures/sample-form.html")
echo "  $DOC_JSON"
DOC_ID=$(echo "$DOC_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

echo "==> create signing session"
SEND_JSON=$(curl -fsS -b "$COOKIE_JAR" -X POST "$HOST/api/documents/$DOC_ID/send" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"recipient-$TS@example.com\",\"name\":\"Recipient\",\"notify\":false}")
echo "  $SEND_JSON"
TOKEN=$(echo "$SEND_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["url"].rsplit("/",1)[-1])')

echo "==> sign (token=$TOKEN)"
VALUES='{"client_name":"Example Client","start_date":"2026-10-07","scope":"Provide consulting services.\nDeliver a written report.","date":"2026-10-07"}'
SIGN_RES=$(curl -fsS -X POST "$HOST/api/sign/$TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"values\":$VALUES,\"signaturePng\":\"$SIG\"}")
echo "  $SIGN_RES"

echo "==> fetch signed PDF (signer endpoint)"
HTTP=$(curl -fsS -o "$PDF_OUT" -w "%{http_code} %{content_type}" "$HOST/api/sign/$TOKEN/pdf")
echo "  $HTTP"
HEAD=$(head -c 5 "$PDF_OUT")
echo "  head=$HEAD bytes=$(wc -c < "$PDF_OUT")"
if [ "$HEAD" != "%PDF-" ]; then
  echo "FAIL: not a PDF"
  exit 1
fi

echo "==> fetch signed PDF (owner endpoint)"
HTTP=$(curl -fsS -b "$COOKIE_JAR" -o "$OWNER_PDF" -w "%{http_code} %{content_type}" "$HOST/api/documents/$DOC_ID/pdf?signed=1")
echo "  $HTTP"
OHEAD=$(head -c 5 "$OWNER_PDF")
echo "  head=$OHEAD bytes=$(wc -c < "$OWNER_PDF")"
if [ "$OHEAD" != "%PDF-" ]; then
  echo "FAIL: owner PDF not valid"
  exit 1
fi

echo "PASS"

