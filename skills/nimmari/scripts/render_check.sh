#!/usr/bin/env bash
# Requires Poppler (pdftoppm, pdftotext, pdfinfo). Inspect all PNGs yourself.
set -euo pipefail
if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 input.pdf [new-output-directory]" >&2
  exit 2
fi
for tool in pdftoppm pdftotext pdfinfo; do
  command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 1; }
done
pdf=$(realpath -- "$1")
out=${2:-"${pdf%.pdf}-render"}
# Require a new directory so stale PNGs cannot masquerade as current pages.
mkdir -- "$out"
out=$(realpath -- "$out")
pdfinfo "$pdf" > "$out/pdfinfo.txt"
pdftoppm -r 150 -png "$pdf" "$out/page"
pdftotext -layout "$pdf" "$out/text.txt"
pages=$(awk '/^Pages:/ {print $2}' "$out/pdfinfo.txt")
shopt -s nullglob
images=("$out"/page-*.png)
printf 'PDF pages: %s; rendered PNGs: %s\n' "$pages" "${#images[@]}"
[[ "$pages" -eq "${#images[@]}" ]] || { echo "Page count mismatch" >&2; exit 1; }
printf 'Extracted text bytes: %s\n' "$(wc -c < "$out/text.txt")"
if [[ ! -s "$out/text.txt" ]]; then
  echo "No text extracted (scan/image PDFs may have no text layer)."
fi
printf 'Seal markers (Sealed): %s\n' "$(awk '{n+=gsub(/Sealed/, "Sealed")} END {print n+0}' "$out/text.txt")"
printf 'Audit/hash lines:\n'
awk '/SHA-256|Europe\/Helsinki|Sealed/ {print}' "$out/text.txt"
printf 'Text preview (first 40 lines):\n'
sed -n '1,40p' "$out/text.txt"
printf 'Open EVERY PNG in %s; text extraction does not prove visual correctness.\n' "$out"
