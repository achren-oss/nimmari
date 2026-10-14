# Install Puumerkki: runbook for AI agents

Use this runbook when a user asks you to install Puumerkki. Run the Bash blocks in order in the same shell on the Docker host. This installs version 1.1.1, provisions a real login and a separate regular agent key, and prepares a disposable signing link. Do not sign or fill anything for the user. See [AGENTS.md](AGENTS.md) for real-document rules.

## 1. Check prerequisites and choose URLs

```bash
set +x
set -euo pipefail
for tool in docker curl python3 openssl; do
  command -v "$tool" >/dev/null || { printf 'Missing prerequisite: %s\n' "$tool"; exit 1; }
done
docker info >/dev/null
python3 --version
openssl version
# Python 3 handles JSON below; jq is an optional alternative.
command -v jq >/dev/null && jq --version || true
```

Install missing tools through the host's package manager; start Docker if needed. Python must support `venv` and pip for step 6. Git is needed only if downloading the repository. Poppler (`pdftoppm`, often packaged as `poppler-utils`) is needed for the smoke-test placement preview.

Choose an unused host port and the URL the user will actually open. Defaults:

```bash
PORT=3000
PUBLIC_URL="http://localhost:$PORT"
BASE_URL="http://localhost:$PORT"
export BASE_URL PUBLIC_URL
```

For a remote host, set `PUBLIC_URL` to its reachable HTTPS origin, with no trailing slash (for example `https://sign.example.org`). Configure DNS, TLS and reverse proxy forwarding to the host port before proceeding. `BASE_URL` is the local API connection; `PUBLIC_URL` is used for login and generated links. Localhost links work only on the same machine. Docker's port mapping below exposes the port on host interfaces; choose host firewall rules appropriate to your deployment.

## 2. Generate secrets without printing them

Keep secrets outside the repository. Do not enable tracing, use `echo`, dump env files, or include secrets in reports or logs. These commands refuse to overwrite an existing installation directory; on a rerun, inspect the existing installation instead of generating replacements.

```bash
set +x
umask 077
INSTALL_DIR="$HOME/.config/puumerkki"
mkdir -p "$HOME/.config"
mkdir "$INSTALL_DIR"
SERVER_ENV="$INSTALL_DIR/server.env"
export INSTALL_DIR SERVER_ENV
{
  printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -hex 32)"
  printf 'PUUMERKKI_API_KEY=%s\n' "$(openssl rand -hex 32)"
} > "$SERVER_ENV"
chmod 600 "$SERVER_ENV"
```

`server.env` contains the authentication secret and root administration key. The root does not need `PUUMERKKI_API_OWNER_ID` for account/key provisioning. Never give the root key to the document agent.

## 3. Start Docker and wait for health

```bash
docker run -d --name puumerkki --restart unless-stopped \
  -p "$PORT:3000" -v puumerkki-data:/data \
  --env-file "$SERVER_ENV" \
  -e BETTER_AUTH_URL="$PUBLIC_URL" -e APP_URL="$PUBLIC_URL" \
  ghcr.io/achren-oss/puumerkki:1.1.1

healthy=false
for attempt in {1..60}; do
  if curl --silent --show-error --fail --connect-timeout 3 --max-time 5 "$BASE_URL/api/health" \
      -o "$INSTALL_DIR/health.json" 2>/dev/null &&
      python3 -c 'import json,sys; sys.exit(json.load(open(sys.argv[1])).get("status") != "ok")' \
        "$INSTALL_DIR/health.json"; then
    healthy=true
    break
  fi
  sleep 2
done
[ "$healthy" = true ] || { printf 'Health check failed; inspect docker logs puumerkki\n'; exit 1; }
```

The image includes Chromium, runs migrations at startup, listens on container port 3000, and defaults to SQLite at `/data/puumerkki.db`. The named volume persists accounts, documents and signatures across container replacement. No email provider is configured by these commands.

## 4. Ask for the user's account details, then provision

**Ask the user for their email address and name. Never invent either.** Wait for the answer. Enter their exact answer at the prompts (or supply these variables through your interactive shell tooling). Public signup is disabled.

```bash
read -r -p 'Account email supplied by the user: ' OWNER_EMAIL
read -r -p 'Account name supplied by the user: ' OWNER_NAME
export OWNER_EMAIL OWNER_NAME
python3 - <<'PY'
import json, os, pathlib, urllib.request
root = pathlib.Path(os.environ['INSTALL_DIR'])
secrets = dict(line.split('=', 1) for line in pathlib.Path(os.environ['SERVER_ENV']).read_text().splitlines())
body = {'email': os.environ['OWNER_EMAIL'], 'name': os.environ['OWNER_NAME']}
request = urllib.request.Request(os.environ['BASE_URL'] + '/api/accounts',
    data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + secrets['PUUMERKKI_API_KEY'],
    'Content-Type': 'application/json'}, method='POST')
with urllib.request.urlopen(request, timeout=90) as response:
    assert response.status == 201
    account = json.load(response)
assert account['id'] and account['password']
path = root / 'account-once.json'
with path.open('x') as output:
    json.dump(account, output)
path.chmod(0o600)
PY
```

Omitting `password` asks the server to generate it. Securely read `account-once.json` using a private, non-logged file viewer. Show its `password` to the user **once in a private channel**, with the login URL (`PUBLIC_URL/login`) and email. Tell them to store it in their password manager and change it through their account's supported password flow. Do not print the response to a shared terminal, transcript or final report. If no private delivery channel is available, have the user read the file locally; do not disclose it in public chat. Keep the file until password handoff and key provisioning succeed, then remove it.

On an HTTP error, stop and inspect state before retrying: a timeout may occur after an account was created. A 409 means the email already exists; do not choose another person's address or silently replace credentials.

## 5. Create and verify the regular agent key

```bash
python3 - <<'PY'
import json, os, pathlib, shlex, urllib.request
root = pathlib.Path(os.environ['INSTALL_DIR'])
account = json.loads((root / 'account-once.json').read_text())
secrets = dict(line.split('=', 1) for line in pathlib.Path(os.environ['SERVER_ENV']).read_text().splitlines())
body = {'name': 'Document agent', 'scope': 'regular', 'ownerUserId': account['id']}
request = urllib.request.Request(os.environ['BASE_URL'] + '/api/keys',
    data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + secrets['PUUMERKKI_API_KEY'],
    'Content-Type': 'application/json'}, method='POST')
with urllib.request.urlopen(request, timeout=90) as response:
    assert response.status == 201
    key = json.load(response)
assert key['key'] and key['scope'] == 'regular' and key['ownerUserId'] == account['id']
path = root / 'agent.env'
with path.open('x') as output:
    output.write('PUUMERKKI_API_KEY=' + shlex.quote(key['key']) + '\n')
    output.write('PUUMERKKI_BASE_URL=' + shlex.quote(os.environ['PUBLIC_URL']) + '\n')
path.chmod(0o600)
(root / 'agent-key-id.txt').write_text(key['id'] + '\n')
PY
set +x
set -a
source "$INSTALL_DIR/agent.env"
set +a
# README's authentication check: omit the required PDF, expect HTTP 400.
code=$(printf 'Authorization: Bearer %s\n' "$PUUMERKKI_API_KEY" | \
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --request POST --header @- --form notify=false "$PUUMERKKI_BASE_URL/api/documents")
[ "$code" = 400 ] || { printf 'Expected HTTP 400, received %s\n' "$code"; exit 1; }
```

`agent.env` holds only the regular owner-scoped key and the reachable instance URL. Load it into the agent's environment with tracing disabled. Do not source `server.env` into the document agent. If key creation times out, inspect key metadata before creating another key; plaintext is returned only at creation.

## 6. Install the portable skill

Use an existing repository clone, or download one into a new directory:

```bash
# Skip this clone/cd pair when already in the repository.
git clone --depth 1 https://github.com/achren-oss/puumerkki "$INSTALL_DIR/source"
cd "$INSTALL_DIR/source"
```

Copy the entire skill into your agent's skill directory. This example uses Codex; adjust `SKILLS_DIR` for your agent. If the destination exists, inspect it before replacing anything.

```bash
SKILLS_DIR="$HOME/.codex/skills"
mkdir -p "$SKILLS_DIR"
[ ! -e "$SKILLS_DIR/puumerkki" ]
cp -R skills/puumerkki "$SKILLS_DIR/puumerkki"
python3 -m venv "$INSTALL_DIR/venv"
source "$INSTALL_DIR/venv/bin/activate"
python3 -m pip install -r skills/puumerkki/requirements.txt
python3 skills/puumerkki/scripts/puumerkki_flow.py --help
```

Read the installed `SKILL.md` before real document work. The helper requires `requests`; the requirements also install `pypdf`. Keep the source checkout for the following commands.

## 7. Prepare a synthetic smoke test, preview, then send silently

This step creates persistent test data. Confirm the user wants this disposable test before running it. Explain that it has **one synthetic signer, `user-smoke@example.com`, and one signature line belonging to that slot**, with no real identity or legal document. Ask them to confirm that arrangement before creating fields. Never substitute this address for their real account email. If they decline, skip the smoke test and report that it was skipped.

The repository's `scripts/fixtures/acroform-fillable.pdf` has existing form fields; instead, this dependency-free Python generator makes a simple one-page PDF with exactly one line. It also makes an SVG placement overlay on the same 800-pixel coordinate grid.

```bash
SMOKE_DIR="$INSTALL_DIR/smoke"
mkdir "$SMOKE_DIR"
export SMOKE_DIR
python3 - <<'PY'
import json, os, pathlib
out = pathlib.Path(os.environ['SMOKE_DIR'])
stream = b'BT /F1 20 Tf 72 680 Td (Puumerkki disposable smoke test) Tj ET\n72 480 m 372 480 l S\n'
objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'endstream']
pdf = bytearray(b'%PDF-1.4\n')
offsets = [0]
for i, obj in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf.extend(f'{i} 0 obj\n'.encode() + obj + b'\nendobj\n')
xref = len(pdf)
pdf.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
for offset in offsets[1:]:
    pdf.extend(f'{offset:010d} 00000 n \n'.encode())
pdf.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
(out / 'smoke.pdf').write_bytes(pdf)
field = {'name': 'smoke_signature', 'type': 'signature', 'page': 0,
    'x': 96, 'y': 350, 'width': 400, 'height': 77, 'label': 'Synthetic smoke signature',
    'required': True, 'assignedSignerKey': 'smoke'}
(out / 'fields.json').write_text(json.dumps({'fields': [field]}))
(out / 'prefill.json').write_text('{}')
(out / 'signers.json').write_text(json.dumps([{'email': 'user-smoke@example.com', 'key': 'smoke'}]))
(out / 'placement.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="800" height="1067"><image xlink:href="page.png" width="800" height="1067"/><rect x="96" y="350" width="400" height="77" fill="red" fill-opacity="0.15" stroke="red"/></svg>')
PY
command -v pdftoppm >/dev/null
pdftoppm -singlefile -png -scale-to-x 800 -scale-to-y -1 \
  "$SMOKE_DIR/smoke.pdf" "$SMOKE_DIR/page"
```

Open `placement.svg` in an image viewer/browser supporting its adjacent `page.png` (or draw the JSON rectangle on `page.png` with your image tools). **Visually inspect the rendered page and overlay**: the red signature box must sit above and end at the only signature line. Do not send until you have viewed it. Install Poppler or report the blocker if rendering is unavailable.

```bash
python3 skills/puumerkki/scripts/puumerkki_flow.py "$SMOKE_DIR/smoke.pdf" \
  --title 'Disposable installation smoke test' \
  --fields "$SMOKE_DIR/fields.json" --prefill "$SMOKE_DIR/prefill.json" \
  --signers "$SMOKE_DIR/signers.json" --print-urls > "$SMOKE_DIR/result.json"
chmod 600 "$SMOKE_DIR/result.json"
python3 - <<'PY'
import json, os, pathlib
result = json.loads((pathlib.Path(os.environ['SMOKE_DIR']) / 'result.json').read_text())
assert len(result['signers']) == 1
assert result['signers'][0]['emailSent'] is False
assert result['signers'][0]['url']
PY
```

The helper sets upload `notify="false"` and send `notify:false`; there is no `--notify` flag. `--prefill` is required even for an empty object. `--print-urls` includes the secret URL in the protected output file. Read that file privately and **return the signing URL to the user in chat**, identifying it as a synthetic test link. Never email it, publish it, or open it to fill, draw or submit a signature. If the helper fails, inspect document state before retrying; writes are not automatically retried.

## 8. Optional cleanup and non-Docker fallback

After private password handoff and key provisioning, remove `account-once.json`. Keep `server.env`, `agent.env`, and the named volume securely backed up; never commit them. Smoke files include a secret link; remove them when no longer needed. To invalidate an outstanding test link, obtain explicit authorization and cancel its document with `POST /api/documents/{documentId}/cancel` using the regular key and optional JSON `{"reason":"Installation smoke test cleanup"}`. Cancellation is terminal. Local file deletion alone does not invalidate links or remove server data.

To stop the service: `docker stop puumerkki`; restart with `docker start puumerkki`. Removing a stopped container with `docker rm puumerkki` preserves the named volume. Do not delete `puumerkki-data` unless the user explicitly requests permanent data deletion.

Without Docker, follow [README Quick start](README.md#quick-start), including Node/npm, Chromium, secret configuration and migrations, then return to account provisioning here. Do not pass the Docker-only `/data` database path to the native setup.

## Troubleshooting

- **Port in use:** select another `PORT`, update local URLs, and recreate the failed container after inspecting its state. If the public origin changes, recreate with matching `BETTER_AUTH_URL` and `APP_URL`; preserve the volume and secrets.
- **Health not ok:** inspect `docker ps -a` and `docker logs --tail 100 puumerkki` privately for migration, database permissions or startup errors. Do not dump `docker inspect` environment values. Check the local port and public proxy separately.
- **401:** wrong, missing or revoked key, or missing owner configuration. Use `agent.env` for documents; an ownerless root key is for administration. The README check must return 400, not 401.
- **Shell environment overrides `.env.local`:** for native installs, stale exported variables take precedence in Node/Next.js. Unset stale `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `PUUMERKKI_API_KEY` and related settings before loading the intended file. Do not print their values while diagnosing.
- **Image pull unauthorized:** verify the exact public image/tag `ghcr.io/achren-oss/puumerkki:1.1.1` and registry connectivity. Stale GHCR credentials may interfere; inspect your registry setup and use `docker logout ghcr.io` only if discarding that host's saved login is appropriate. If authentication is required, use an authorized token with package-read access via `docker login ghcr.io --password-stdin`; never paste tokens into command arguments or logs.
- **Container name already exists:** inspect the existing container first. Do not overwrite an existing deployment or its secrets while trying to repair a partial install.

## Final report

Fill this template; never include keys, authentication secrets or the generated password:

```text
Puumerkki URL: <public URL>
Account email: <user-supplied email>
Secrets stored at: <absolute server.env and agent.env paths; password handoff/storage status, no values>
Smoke-test link: <private synthetic signing URL, or skipped/blocked and why>
Anything unclear: <list unresolved choices or blockers; “None” if resolved>
```
