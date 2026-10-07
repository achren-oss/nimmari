#!/usr/bin/env bash
# Puumerkki latency bench (Render free tier test).
# Usage: BASE_URL=https://puumerkki.onrender.com ./bench.sh
# Needs: PUUMERKKI_API_KEY in the environment (optionally from $BENCH_ENV_FILE).
# Server side must have PUUMERKKI_API_KEY (same value) and PUUMERKKI_API_OWNER_ID set,
# where the owner id is an existing user row created by:
#   DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... \
#     node scripts/create-service-user.mjs bench@example.com "Bench"
# PDF rendering (Chromium) happens at signing time, so each run does:
#   upload HTML -> send -> sign (renders PDF) -> fetch signed PDF.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
[ -n "${BENCH_ENV_FILE:-}" ] && set -a && . "$BENCH_ENV_FILE" && set +a
: "${BASE_URL:?set BASE_URL}"; : "${PUUMERKKI_API_KEY:?set PUUMERKKI_API_KEY}"
BASE_URL="${BASE_URL%/}"; RUNS="${RUNS:-5}"
FIXTURE="${FIXTURE:-$DIR/fixtures/sample-form.html}"
AUTH=(-H "Authorization: Bearer $PUUMERKKI_API_KEY")
SIG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII="
VALUES='{"client_name":"Bench Client","start_date":"2026-10-07","scope":"Line one.\nLine two.","date":"2026-10-07"}'
TMP=$(mktemp); PDF=$(mktemp); trap 'rm -f "$TMP" "$PDF"' EXIT
jget(){ python3 -c "import sys,json;d=json.load(open('$TMP'));print($1)"; }
# req NAME curl-args... -> prints time, leaves body in $TMP, fails on non-2xx
req(){ local n=$1; shift; local out; out=$(curl -sS -o "$TMP" -w "%{http_code} %{time_total}" "$@")
  local code=${out%% *} t=${out##* }; printf "  %-10s http=%s %6.2fs\n" "$n" "$code" "$t" >&2
  [[ $code == 2* ]] || { echo "FAIL $n: $(head -c 300 "$TMP")" >&2; exit 1; }; echo "$t"; }

echo "==> cold /api/health (wait >15 min idle beforehand for a true cold start)"
req health --max-time 180 "$BASE_URL/api/health" >/dev/null
req health2 "$BASE_URL/api/health" >/dev/null

SUM=0
for i in $(seq 1 "$RUNS"); do
  echo "==> run $i/$RUNS"
  req upload "${AUTH[@]}" -X POST "$BASE_URL/api/documents/html" -F "title=Bench $i" -F "html=@$FIXTURE" >/dev/null
  ID=$(jget 'd["id"]')
  req send "${AUTH[@]}" -X POST "$BASE_URL/api/documents/$ID/send" -H "Content-Type: application/json" \
    -d "{\"email\":\"bench-$i@example.com\",\"name\":\"Bench\"}" >/dev/null
  TOK=$(jget 'd["url"].rsplit("/",1)[-1]')
  T=$(req sign --max-time 180 -X POST "$BASE_URL/api/sign/$TOK" -H "Content-Type: application/json" \
    -d "{\"values\":$VALUES,\"signaturePng\":\"$SIG\"}")
  out=$(curl -sS -o "$PDF" -w "%{http_code} %{time_total}" "$BASE_URL/api/sign/$TOK/pdf")
  printf "  %-10s http=%s %6.2fs bytes=%s\n" pdf "${out%% *}" "${out##* }" "$(wc -c <"$PDF")"
  [ "$(head -c 5 "$PDF")" = "%PDF-" ] || { echo "FAIL: not a PDF"; exit 1; }
  SUM=$(python3 -c "print($SUM+$T)")
done
python3 -c "print(f'==> mean sign+render: {$SUM/$RUNS:.2f}s over $RUNS runs')"
