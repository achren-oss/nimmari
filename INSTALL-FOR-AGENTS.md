# Install Nimmari: runbook for AI agents

## A. Default: Agent deploy with Render + Turso API keys

Use the prebuilt 1.3.1 image, then bootstrap through its one-time setup claim.
Keep credentials outside the repository. See AGENTS.md for real-document rules.
For users who don't want to give an agent provider keys, use alternative B below.

### Step 0: send ONE message requesting both keys, email and name

> I'll deploy Nimmari on Render + Turso, create your login and separate admin/agent
> keys, install the document skill, and make a silent synthetic test link (example.com;
> no email or signature). Both providers have free tiers with no card required.
>
> **Turso Platform API token** (free account; GitHub, Google or email):
> 1. Sign in at https://app.turso.tech.
> 2. Open your organization's **Settings → API Tokens** (in some dashboard versions:
> avatar/initials top-right → **Platform API Tokens**).
> 3. Create a token (any name, e.g. `nimmari-agent`), scoped to your organization if
> offered, and copy it: it is shown only once. This is a **Platform API token**,
> not a database token. CLI alternative: `turso auth api-tokens mint nimmari-agent --org <your-org>`.
>
> **Render API key** (free account; GitHub, GitLab, Google, Bitbucket or email):
> 1. Open https://dashboard.render.com and sign in.
> 2. Click your avatar top-right → **Account Settings**.
> 3. In **API Keys**, click **Create API Key**, name it e.g. `nimmari-agent`, and copy
> it: it is shown only once. Render keys start with `rnd_`.
>
> Also provide your **email and name** for the Nimmari login. Hand keys through the
> agent's secret manager or env vars `TURSO_API_TOKEN` and `RENDER_API_KEY` where
> possible; private paste otherwise, stored immediately in chmod 600 files.
> Both keys can be revoked afterwards in the same place. I recommend revoking them
> after installation if you won't need agent administration later.

Sources: [Turso authentication](https://docs.turso.tech/api-reference/authentication)
(official; describes the dashboard's organization-level token table),
[Windmill Turso guide](https://hub.windmill.dev/resource_types/172/turso) (third-party),
and [ReachSSH setup guide](https://reachssh.com/sync/setup/) (third-party).
Render: [API documentation](https://render.com/docs/api) and
[official tutorial](https://render.com/tutorials/firstdeploy/install-skills-and-optional-mcp)
(Account Settings → API Keys → Create API Key; keys start with `rnd_`).
Dashboard menu labels may vary by version.

Wait for these inputs; never invent the email or name. Never paste tokens into commands
or transcripts, echo them, enable tracing, or dump secrets. Capture private pasted keys
through non-logged secret input into protected files, never shell command text. Ask again
only for missing inputs or genuine ambiguity about organizations, workspaces or resources.

### 1. Prerequisites and protected state

```bash
set +x
set -euo pipefail
umask 077
for tool in curl python3 openssl; do
  command -v "$tool" >/dev/null || { printf 'Missing prerequisite: %s\n' "$tool"; exit 1; }
done
INSTALL_DIR="$HOME/.config/nimmari"
mkdir -p "$HOME/.config"
mkdir "$INSTALL_DIR"
SERVER_ENV="$INSTALL_DIR/server.env"
export INSTALL_DIR SERVER_ENV
: "${RENDER_API_KEY:?Load from secret manager}"
: "${TURSO_API_TOKEN:?Load from secret manager}"
```

If the directory exists, inspect the existing deployment privately and resume; do not overwrite secrets or recreate resources. Python needs venv/pip for the skill; Poppler (`pdftoppm`, often `poppler-utils`) is needed for the test placement preview. Install missing prerequisites as necessary. Git is optional when source is already available.

The following small HTTP helper uses curl with headers in a protected file and JSON over stdin; no secret is passed in curl's argv. Responses stay in protected files. Python urllib reading environment variables is an equally valid alternative. Do not use verbose curl or automatic retries for writes. Network timeouts can occur after a successful write: inspect resource state before repeating it.

```bash
set +x
python3 - <<'PYHTTP'
import os, pathlib
root = pathlib.Path(os.environ['INSTALL_DIR'])
for name, var in [('render', 'RENDER_API_KEY'), ('turso', 'TURSO_API_TOKEN')]:
    token = os.environ[var]
    assert token and not any(c in token for c in '\r\n')
    p = root / (name + '.headers')
    with p.open('x') as f:
        f.write('Authorization: Bearer ' + token + '\nContent-Type: application/json\n')
    p.chmod(0o600)
PYHTTP
api() {
  # api provider METHOD URL output-file [body-file]; inspect only safe metadata.
  local provider="$1" method="$2" url="$3" output="$4"
  local code
  if [ "$#" = 5 ]; then
    code=$(curl --silent --show-error --connect-timeout 10 --max-time 90 \
      --request "$method" --header @"$INSTALL_DIR/$provider.headers" \
      --data-binary @- --output "$output" --write-out '%{http_code}' "$url" < "$5")
  else
    code=$(curl --silent --show-error --connect-timeout 10 --max-time 90 \
      --request "$method" --header @"$INSTALL_DIR/$provider.headers" \
      --output "$output" --write-out '%{http_code}' "$url")
  fi
  chmod 600 "$output"
  case "$code" in
    2??) ;;
    *) printf 'HTTP %s from %s; inspect protected response, stop before retrying\n' "$code" "$provider"; return 1 ;;
  esac
}
api turso GET https://api.turso.tech/v1/organizations "$INSTALL_DIR/organizations.json"
api render GET 'https://api.render.com/v1/owners?limit=100' "$INSTALL_DIR/owners.json"
```

Read the protected metadata: Turso returns an array with `slug`, `name`, `type`; Render returns an array of `{owner:{id,name,...},cursor}`. Follow Render cursor pagination when the result fills a page. Select the personal Turso organization if it is the only one; if several, ask which slug. Select the sole Render owner; if several, ask which workspace. Export `TURSO_ORG` and `RENDER_OWNER_ID` with the selected identifiers. Do not guess.

References: [Turso organizations](https://docs.turso.tech/api-reference/organizations/list), [Render owners](https://api-docs.render.com/reference/list-owners).

### 2. Create the Turso database through the Platform API

```bash
set +x
: "${TURSO_ORG:?Select organization first}"
TURSO_ORG_URL="https://api.turso.tech/v1/organizations/$TURSO_ORG"
export TURSO_ORG TURSO_ORG_URL
api turso GET "$TURSO_ORG_URL/groups" "$INSTALL_DIR/groups.json"
```

Inspect `groups`. Use `default` if present. If absent and another group exists, use that existing group (ask if several choices); Free permits only one group. If there are no groups, query `GET https://api.turso.tech/v1/locations` into a protected file and choose the available location closest to Frankfurt. Use `fra` only if returned; current codes may instead be `aws-eu-west-1` (Ireland). Create with `POST $TURSO_ORG_URL/groups`, body `{"name":"default","location":"<returned location code>"}` using `api` and a protected body file. On 409, retrieve groups and inspect rather than overwriting. Export `TURSO_GROUP` as the chosen group name.

```bash
set +x
export TURSO_GROUP="${TURSO_GROUP:-default}"
python3 - <<'PYDB'
import json, os, pathlib
p = pathlib.Path(os.environ['INSTALL_DIR']) / 'database-create.json'
p.write_text(json.dumps({'name': 'nimmari', 'group': os.environ['TURSO_GROUP']}))
PYDB
api turso POST "$TURSO_ORG_URL/databases" "$INSTALL_DIR/database.json" "$INSTALL_DIR/database-create.json"
api turso POST "$TURSO_ORG_URL/databases/nimmari/auth/tokens?authorization=full-access" "$INSTALL_DIR/database-token.json"
python3 - <<'PYDB'
import json, os, pathlib
root = pathlib.Path(os.environ['INSTALL_DIR'])
db = json.loads((root / 'database.json').read_text())['database']
token = json.loads((root / 'database-token.json').read_text())['jwt']
assert db['Name'] == 'nimmari' and db['Hostname'] and token
with pathlib.Path(os.environ['SERVER_ENV']).open('x') as f:
    f.write('DATABASE_URL=libsql://' + db['Hostname'] + '\nDATABASE_AUTH_TOKEN=' + token + '\n')
pathlib.Path(os.environ['SERVER_ENV']).chmod(0o600)
PYDB
```

On database 409, stop this block: inspect `GET $TURSO_ORG_URL/databases/nimmari` (response `database.Hostname`, `database.group`). Do not migrate an unrelated database. Establish whether it belongs to this installation before reusing it or asking about another name. The token endpoint returns `jwt`; omitted expiration defaults to `never`, so protect it and rotate when needed. The Platform token stays with the installer, never in the service environment.

Official schemas: [create database](https://docs.turso.tech/api-reference/databases/create), [retrieve database](https://docs.turso.tech/api-reference/databases/retrieve), [database tokens](https://docs.turso.tech/api-reference/databases/create-token), [groups](https://docs.turso.tech/api-reference/groups/create), [locations](https://docs.turso.tech/api-reference/locations/list).

### 3. Generate server secrets without printing

```bash
set +x
{
  printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -hex 32)"
  printf 'NIMMARI_SETUP_CODE=%s\n' "$(openssl rand -hex 24)"
} >> "$SERVER_ENV"
chmod 600 "$SERVER_ENV"
```

Do this once. No root `NIMMARI_API_KEY` goes into Render: setup claim creates revocable
admin and regular database keys instead of a long-lived master key on the server.
Copy the setup code privately for the shared claim step:

```bash
python3 - <<'PYCODE'
import os, pathlib
root = pathlib.Path(os.environ['INSTALL_DIR'])
env = dict(line.split('=', 1) for line in pathlib.Path(os.environ['SERVER_ENV']).read_text().splitlines())
with (root/'setup-code').open('x') as output:
    output.write(env['NIMMARI_SETUP_CODE'])
(root/'setup-code').chmod(0o600)
PYCODE
```

### 4. Create the free Render image service

```bash
set +x
: "${RENDER_OWNER_ID:?Select workspace first}"
export RENDER_OWNER_ID
python3 - <<'PYRENDER'
import json, os, pathlib
root = pathlib.Path(os.environ['INSTALL_DIR'])
env = dict(line.split('=', 1) for line in pathlib.Path(os.environ['SERVER_ENV']).read_text().splitlines())
body = {'type': 'web_service', 'name': 'nimmari', 'ownerId': os.environ['RENDER_OWNER_ID'],
    'image': {'ownerId': os.environ['RENDER_OWNER_ID'], 'imagePath': 'ghcr.io/achren-oss/nimmari:1.3.1'},
    'serviceDetails': {'runtime': 'image', 'plan': 'free', 'region': 'frankfurt',
        'healthCheckPath': '/api/health', 'numInstances': 1},
    'envVars': [{'key': k, 'value': v} for k, v in env.items()]}
(root / 'service-create.json').write_text(json.dumps(body))
PYRENDER
api render POST https://api.render.com/v1/services "$INSTALL_DIR/service.json" "$INSTALL_DIR/service-create.json"
python3 - <<'PYRENDER'
import json, os, pathlib, shlex
root = pathlib.Path(os.environ['INSTALL_DIR'])
s = json.loads((root / 'service.json').read_text())['service']
url = s['serviceDetails']['url'].rstrip('/')
assert url.startswith('https://')
with (root / 'deployment.env').open('x') as f:
    for k, v in {'SERVICE_ID': s['id'], 'PUBLIC_URL': url, 'BASE_URL': url,
                 'RENDER_DASHBOARD_URL': s['dashboardUrl'], 'TURSO_ORG': os.environ['TURSO_ORG']}.items():
        f.write(k + '=' + shlex.quote(v) + '\n')
PYRENDER
set -a
source "$INSTALL_DIR/deployment.env"
set +a
```

The create payload contains only `DATABASE_URL`, `DATABASE_AUTH_TOKEN`,
`BETTER_AUTH_SECRET`, and `NIMMARI_SETUP_CODE`. Render supplies `RENDER_EXTERNAL_URL`
automatically; no `BETTER_AUTH_URL`/`APP_URL`, environment replacement, or second deploy
is needed. Always take `PUBLIC_URL` from `service.serviceDetails.url`; Render may append
a suffix. On 409 inspect existing services before retrying; never overwrite a deployment.
Save the returned service ID and dashboard URL.

[Dockerfile](Dockerfile) defaults `PORT=3000`; Render supplies its own `PORT`. [The entrypoint](scripts/docker-entrypoint.sh) runs migrations then `node server.js`, which reads that environment variable and binds `0.0.0.0`. Do not override Render's port or add a local database/disk. Chromium is bundled. No email provider is configured here.

Official API: [create service](https://api-docs.render.com/reference/create-service).

### 5. Wait for deployment and health (usually under a minute; allow up to ten)

```bash
set +x
healthy=false
deadline=$((SECONDS + 600))
while [ "$SECONDS" -lt "$deadline" ]; do
  api render GET "https://api.render.com/v1/services/$SERVICE_ID/deploys?limit=1" "$INSTALL_DIR/deploy-status.json"
  status=$(python3 -c 'import json,sys; x=json.load(open(sys.argv[1])); print(x[0]["deploy"]["status"] if x else "pending")' "$INSTALL_DIR/deploy-status.json")
  case "$status" in
    build_failed|update_failed|pre_deploy_failed|canceled|deactivated)
      printf 'Deploy stopped: %s; inspect dashboard logs/events\n' "$status"; exit 1 ;;
  esac
  if [ "$status" = live ] &&
      curl --silent --show-error --fail --connect-timeout 5 --max-time 20 \
        "$PUBLIC_URL/api/health" -o "$INSTALL_DIR/health.json" 2>/dev/null &&
      python3 -c 'import json,sys; sys.exit(json.load(open(sys.argv[1])).get("status") != "ok")' "$INSTALL_DIR/health.json"; then
    healthy=true; break
  fi
  sleep 10
done
[ "$healthy" = true ] || { printf 'Health timeout; inspect Render deployment and cold start\n'; exit 1; }
```

The first deploy pulls the image and runs migrations; it usually takes under a minute, but allow up to ten minutes. Subsequent cold starts can take about 45 seconds to a minute. Check [deploy status](https://api-docs.render.com/reference/list-deploys) as well as health so a failed deploy does not silently look successful. Preserve deployment state on a timeout; do not create another service.

### 6. Claim the first account and protect credentials

Set `OWNER_EMAIL` and `OWNER_NAME` privately from step 0. Public signup is disabled.

```bash
set +x
umask 077
: "${PUBLIC_URL:?Set service URL first}"
: "${OWNER_EMAIL:?Set user-supplied email first}"
: "${OWNER_NAME:?Set user-supplied name first}"
export PUBLIC_URL OWNER_EMAIL OWNER_NAME
python3 - <<'PY'
import json, os, pathlib, shlex, urllib.request
root = pathlib.Path(os.environ['INSTALL_DIR'])
url = os.environ['PUBLIC_URL'].rstrip('/')
with urllib.request.urlopen(url+'/api/setup/claim', timeout=120) as response:
    assert json.load(response) == {'enabled': True, 'claimed': False}
body = dict(setupCode=(root/'setup-code').read_text().strip(),
            email=os.environ['OWNER_EMAIL'], name=os.environ['OWNER_NAME'])
request = urllib.request.Request(url+'/api/setup/claim', data=json.dumps(body).encode(),
    headers={'Content-Type':'application/json'}, method='POST')
with urllib.request.urlopen(request, timeout=120) as response:
    assert response.status == 201
    result = json.load(response)
for filename, key in [('server-admin.env','adminKey'),('agent.env','agentKey')]:
    path = root/filename
    with path.open('x') as output:
        output.write('NIMMARI_API_KEY='+shlex.quote(result[key]['key'])+'\n')
        output.write('NIMMARI_BASE_URL='+shlex.quote(result['baseUrl'])+'\n')
    path.chmod(0o600)
path = root/'account-once.json'
with path.open('x') as output:
    json.dump(dict(result['account'], password=result['password']), output)
path.chmod(0o600)
(root/'setup-code').unlink()
PY
```

Never print the claim response. Hand the password over once privately with the login URL
and email, or have the user read account-once.json locally if no private channel exists.
Remove that file after handoff. Keep server-admin.env securely for administration; load
only agent.env into the document agent. A timeout may mean the claim succeeded: inspect
GET state before retrying; plaintext credentials cannot be recovered.

After claim, `NIMMARI_SETUP_CODE` can stay in Render: it is single-use. Removing it
is optional hardening, not required for installation.

### 7. Verify the regular key and install the skill

```bash
set +x
set -a
source "$INSTALL_DIR/agent.env"
set +a
# README's authentication check: omit the required PDF, expect HTTP 400.
code=$(printf 'Authorization: Bearer %s\n' "$NIMMARI_API_KEY" | \
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --request POST --header @- --form notify=false "$NIMMARI_BASE_URL/api/documents")
[ "$code" = 400 ] || { printf 'Expected HTTP 400, received %s\n' "$code"; exit 1; }
```

#### Install the portable skill

Use an existing repository clone, or shallow-clone the release (git is optional if the source is already available; otherwise download and unpack the v1.3.1 source archive with curl):

```bash
set +x
# Skip this clone/cd pair when already in the repository.
git clone --depth 1 --branch v1.3.1 https://github.com/achren-oss/nimmari "$INSTALL_DIR/source"
cd "$INSTALL_DIR/source"
```

Copy the entire skill into your agent's skill directory. This example uses Codex; adjust `SKILLS_DIR` for your agent. If the destination exists, inspect it before replacing anything.

```bash
set +x
SKILLS_DIR="$HOME/.codex/skills"
mkdir -p "$SKILLS_DIR"
[ ! -e "$SKILLS_DIR/nimmari" ]
cp -R skills/nimmari "$SKILLS_DIR/nimmari"
python3 -m venv "$INSTALL_DIR/venv"
source "$INSTALL_DIR/venv/bin/activate"
python3 -m pip install -r skills/nimmari/requirements.txt
python3 skills/nimmari/scripts/nimmari_flow.py --help
```

Read the installed `SKILL.md` before real document work. The helper requires `requests`; the requirements also install `pypdf`. Keep the source checkout for the following commands.

### 8. Prepare a synthetic smoke test, preview, then send silently

Run this disposable synthetic test by default as part of the authorized installation; do not ask for another confirmation. It creates persistent test data with **one synthetic signer, `user-smoke@example.com`, and one signature line assigned to key `smoke`**. This is deliberate synthetic-test authorization, not permission to create fields on real documents without asking. Never use the owner's real email. The test is cancellable; never sign it for the user. Mention it in the final report.

The repository's `scripts/fixtures/acroform-fillable.pdf` has existing form fields; instead, this dependency-free Python generator makes a simple one-page PDF with exactly one line. It also makes an SVG placement overlay on the same 800-pixel coordinate grid.

```bash
set +x
SMOKE_DIR="$INSTALL_DIR/smoke"
mkdir "$SMOKE_DIR"
export SMOKE_DIR
python3 - <<'PY'
import json, os, pathlib
out = pathlib.Path(os.environ['SMOKE_DIR'])
stream = b'BT /F1 20 Tf 72 680 Td (Nimmari disposable smoke test) Tj ET\n72 480 m 372 480 l S\n'
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
set +x
python3 skills/nimmari/scripts/nimmari_flow.py "$SMOKE_DIR/smoke.pdf" \
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

### 9. Cleanup and teardown — only on explicit user request

After private password handoff and key provisioning succeed, remove `account-once.json`. Keep `server.env`, `server-admin.env`, `agent.env` and `deployment.env` securely backed up; never commit them. Remove transient `*.headers`, create/request JSON files, database-token responses and Render env payloads when no longer needed; they contain credentials. Recommend revoking the Render/Turso provider keys in the same settings used to create them unless future agent administration is wanted. This does not revoke the separate database token or Nimmari keys. Smoke output contains a secret signing link.

To invalidate the synthetic test, only with explicit user authorization, call `POST /api/documents/{documentId}/cancel` with the regular agent key and optional `{"reason":"Installation smoke test cleanup"}`. Cancellation is terminal. Local file deletion does not invalidate links.

**Do not tear down as routine cleanup.** Only after the user explicitly requests the particular deletion, use the protected HTTP helper:

```bash
set +x
# Destructive: execute only the deletion(s) explicitly requested by the user.
api render DELETE "https://api.render.com/v1/services/$SERVICE_ID" "$INSTALL_DIR/render-delete.json"
api turso DELETE "$TURSO_ORG_URL/databases/nimmari" "$INSTALL_DIR/turso-delete.json"
```

Deleting the service stops hosting; deleting the database permanently removes its accounts, documents and signatures. Confirm the saved identifiers refer to this installation. [Render deletion](https://api-docs.render.com/reference/delete-service), [Turso deletion](https://docs.turso.tech/api-reference/databases/delete).

### 10. Final report

Never include keys, authentication secrets or passwords. Deliver the synthetic link only to the requesting user in chat:

```text
Nimmari URL: <PUBLIC_URL; login at /login>
Cold start: sleeps after 15 minutes idle; allow about 45 seconds to a minute to wake
Account email: <user-supplied email>
Secrets stored at: <absolute server.env, server-admin.env and agent.env paths; private password handoff status>
Render service: <service ID> — <returned dashboardUrl>
Turso database: nimmari (organization <slug>)
Smoke-test link: <private synthetic URL; example.com signer; no emails sent>
Anything unclear: <unresolved choices/blockers, or None>
```

## Troubleshooting

| Claim response | Action |
| --- | --- |
| 404 | Missing/short setup code: set `NIMMARI_SETUP_CODE` (32+ characters) in Render Environment and redeploy. |
| 409 | Accounts already exist; use existing administrator credentials. Never replace them silently. |
| 410 | Already claimed. If not by you, treat as compromised; arrange explicit authorization to delete and redeploy. |
| 429 | Wait for the ten-minute rate-limit window. |
| 403 / 503 | Check the setup code privately / inspect database and rate-limiter availability. |

- **Render/Turso 401 or 403:** invalid/expired token or insufficient workspace/org access. Obtain a correct API credential privately; do not dump headers. Turso needs a Platform API token for provisioning.
- **Render 402:** payment information required. Stop and report it. Do not add a card, select a paid plan, or silently move providers.
- **Deploy failed:** open the saved Render dashboard URL and inspect logs privately; fetch service events with `GET /v1/services/{serviceId}/events` through `api`. Redact secrets before reporting. Check image tag, migrations and database connectivity. [Service events](https://api-docs.render.com/reference/list-events).
- **Health timeout/cold start:** allow about 45 seconds to a minute for waking; the first deploy usually takes under a minute, but allow up to ten minutes; inspect deploy state and logs before extending the wait. Do not treat Render's loading HTML as healthy JSON.
- **Turso group/location errors:** list groups and locations; use a returned location code. Free allows one group; reuse the existing group rather than trying to buy another. Inspect 409 conflicts and ownership before reuse. Do not overwrite a database.
- **Nimmari 401:** use the regular owner-scoped key from `agent.env` for documents; keep `server-admin.env` for administration. The missing-PDF authentication check must return 400.
- **Timeout during a write:** inspect saved metadata and remote state before retrying account, key, database, service or signing-session creation.

## Free hosting facts and button behavior

[Render Free](https://render.com/docs/free) provides 0.1 CPU / 512 MB RAM, 750 free instance hours per workspace per month, and needs no card. It sleeps after 15 minutes without traffic; waking takes about 45 seconds to a minute. Its filesystem is ephemeral, so **use Turso, never local SQLite on Render**. Chromium HTML-form rendering works but is slow: about 10 seconds per HTML signing in our [measured benchmark](docs/benchmarks/render-free-2026-10-07.md). PDF uploads use pdf-lib and do not need Chromium. In a local container limited to 512 MB RAM and 0.1 CPU (`docker --memory 512m --cpus 0.1`), an HTML-form signing including Chromium rendering completed in about 18 s with about 116 MiB memory in use afterwards (measured 14 October 2026).

**Measured end-to-end (15 October 2026):** A real run of section A using a Render free web service in Frankfurt from `ghcr.io/achren-oss/nimmari:1.3.0` and a real Turso database in `aws-eu-west-1` took 77 s from step 1 through the smoke test. From the Render service creation API call, deployment reached `live` in 44 s and health was OK at 52 s. Setup claim, login, skill install and the silent smoke test passed. An HTML-form signing including Chromium rendering on the free instance took about 15 s. After about 17 minutes idle, the first `/api/health` request took 45 s (cold start), and the next took 0.5 s. Teardown via the documented `DELETE` calls worked.

[Turso Free](https://turso.tech/pricing) is $0, needs no card, and includes 100 databases, 5 GB storage, 500M rows read and 10M rows written per month. Signed PDFs live in the database. Stay within the free quotas; never enable paid resources automatically.

Alternatives checked on 14 October 2026: [Fly.io](https://fly.io/docs/about/pricing/) has only a trial for new organizations, no ongoing free tier; [Koyeb](https://www.koyeb.com/docs/faqs/pricing) requires a card with a $29 verification hold for its free instance (since February 2026); [Railway Free](https://railway.com/pricing) provides $1/month credit and 0.5 GB RAM per service. Render + Turso is the default.

The [Deploy button](https://render.com/docs/deploy-to-render) works out of the box for
public repositories according to Render's docs. Whether the dashboard asks to connect
a Git provider has not been verified. The [Blueprint](https://render.com/docs/infrastructure-as-code)
auto-syncs changes on the linked branch by default: changing its image tag updates
instances. sync:false values are prompted only on initial creation.
[RENDER_EXTERNAL_URL](https://render.com/docs/environment-variables) supplies the service
URL automatically, so APP_URL and BETTER_AUTH_URL are unnecessary for this flow.

## B. Alternative: No keys for the agent: Deploy to Render button

For users who don't want to give an agent provider keys. This is an independent path:
skip A's steps 0–5. Generate the code in a fresh private directory:

```bash
set +x
set -euo pipefail
umask 077
INSTALL_DIR="$HOME/.config/nimmari"
mkdir -p "$HOME/.config"
mkdir "$INSTALL_DIR"
export INSTALL_DIR
openssl rand -hex 24 > "$INSTALL_DIR/setup-code"
chmod 600 "$INSTALL_DIR/setup-code"
```

Send one message with the generated code:

> 1. Sign in at https://app.turso.tech (GitHub, Google or email; free, no card).
> Create a database, copy its libsql:// URL and create a read+write database token.
> 2. Use the Deploy button below. Sign in to Render (free, no card), fill
> DATABASE_URL, DATABASE_AUTH_TOKEN and NIMMARI_SETUP_CODE=<generated code>, then
> click Deploy Blueprint. Put the database credentials only in Render.
> 3. Return the service URL plus your email and name for the first Nimmari login.
> I'll claim it and make a silent synthetic test link without signing.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/achren-oss/nimmari)

No fork, local Docker or provider API keys are needed. Set and export `PUBLIC_URL`,
`OWNER_EMAIL`, `OWNER_NAME` from the reply. Wait for `/api/health` JSON `status: "ok"`
(up to ten minutes, bounded HTTP timeouts; inspect the dashboard on failure), then
run A's **step 6** claim and **steps 7–8** skill/silent test, and provide the final
report. Mark provider identifiers unavailable if not supplied. No `server.env` or
`deployment.env` is needed for this path. Keep the database token solely in Render.
See shared troubleshooting and hosting notes above.

## C. Local/self-managed only on explicit request

Skip hosted steps 0–5 only when the user requests this path. Ask for the first account email/name if missing. Run these tested Docker steps on the intended host, then run the local bootstrap below and shared steps 7–8 and the final report (mark Render/Turso not applicable). No provider tokens are needed. Do not choose this path because the hosted setup has an unresolved error.

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

Install missing tools through the host's package manager; start Docker if needed. Python must support `venv` and pip for the shared skill-installation step. Git is needed only if downloading the repository. Poppler (`pdftoppm`, often packaged as `poppler-utils`) is needed for the smoke-test placement preview.

Choose an unused host port and the URL the user will actually open. Defaults:

```bash
set +x
PORT=3000
PUBLIC_URL="http://localhost:$PORT"
BASE_URL="http://localhost:$PORT"
export BASE_URL PUBLIC_URL
```

For a remote host, set `PUBLIC_URL` to its reachable HTTPS origin, with no trailing slash (for example `https://sign.example.org`). Configure DNS, TLS and reverse proxy forwarding to the host port before proceeding. `BASE_URL` is the local API connection; `PUBLIC_URL` is used for login and generated links. Localhost links work only on the same machine. Docker's port mapping below exposes the port on host interfaces; choose host firewall rules appropriate to your deployment.

### Generate local secrets

Keep secrets outside the repository. Do not enable tracing, use `echo`, dump env files, or include secrets in reports or logs. These commands refuse to overwrite an existing installation directory; on a rerun, inspect the existing installation instead of generating replacements.

```bash
set +x
umask 077
INSTALL_DIR="$HOME/.config/nimmari"
mkdir -p "$HOME/.config"
mkdir "$INSTALL_DIR"
SERVER_ENV="$INSTALL_DIR/server.env"
export INSTALL_DIR SERVER_ENV
{
  printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -hex 32)"
  printf 'NIMMARI_API_KEY=%s\n' "$(openssl rand -hex 32)"
} > "$SERVER_ENV"
chmod 600 "$SERVER_ENV"
```

`server.env` contains the authentication secret and root administration key. The root does not need `NIMMARI_API_OWNER_ID` for account/key provisioning. Never give the root key to the document agent.

### Start Docker and wait for health

```bash
set +x
docker run -d --name nimmari --restart unless-stopped \
  -p "$PORT:3000" -v nimmari-data:/data \
  --env-file "$SERVER_ENV" \
  -e BETTER_AUTH_URL="$PUBLIC_URL" -e APP_URL="$PUBLIC_URL" \
  ghcr.io/achren-oss/nimmari:1.3.1

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
[ "$healthy" = true ] || { printf 'Health check failed; inspect docker logs nimmari\n'; exit 1; }
```

The image includes Chromium, runs migrations at startup, listens on container port 3000, and defaults to SQLite at `/data/nimmari.db` (reusing `/data/puumerkki.db` when the new file is absent). The named volume persists accounts, documents and signatures across container replacement. No email provider is configured by these commands.


Stop with `docker stop nimmari`, restart with `docker start nimmari`. `docker rm nimmari` on a stopped container preserves the named volume. Never delete `nimmari-data` without explicit permanent-deletion authorization. Inspect existing containers/secrets before repairing a partial install. For port conflicts choose another host `PORT`, update URLs and recreate the container with the same volume and secrets. Inspect `docker logs --tail 100 nimmari` privately; do not dump `docker inspect` environment values. For image-pull errors check the exact public tag and registry access before altering saved GHCR credentials.

For a native install follow [README Quick start](README.md#quick-start), including Node/npm, Chromium, secret configuration and migrations, then run the local bootstrap below and shared steps 7–8. Do not pass Docker's `/data` path to native setup. Stale exported environment variables override `.env.local`; unset stale database/auth settings without printing their values.

### Local account/key bootstrap (root-key path, unchanged)

#### Provision the first account

Use the email and name already supplied in step 0; never invent either. Set `OWNER_EMAIL` and `OWNER_NAME` privately in the shell. Public signup is disabled.

```bash
set +x
export OWNER_EMAIL OWNER_NAME
python3 - <<'PY'
import json, os, pathlib, urllib.request
root = pathlib.Path(os.environ['INSTALL_DIR'])
secrets = dict(line.split('=', 1) for line in pathlib.Path(os.environ['SERVER_ENV']).read_text().splitlines())
body = {'email': os.environ['OWNER_EMAIL'], 'name': os.environ['OWNER_NAME']}
request = urllib.request.Request(os.environ['BASE_URL'] + '/api/accounts',
    data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + secrets['NIMMARI_API_KEY'],
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

#### Create and verify the regular agent key

```bash
set +x
python3 - <<'PY'
import json, os, pathlib, shlex, urllib.request
root = pathlib.Path(os.environ['INSTALL_DIR'])
account = json.loads((root / 'account-once.json').read_text())
secrets = dict(line.split('=', 1) for line in pathlib.Path(os.environ['SERVER_ENV']).read_text().splitlines())
body = {'name': 'Document agent', 'scope': 'regular', 'ownerUserId': account['id']}
request = urllib.request.Request(os.environ['BASE_URL'] + '/api/keys',
    data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + secrets['NIMMARI_API_KEY'],
    'Content-Type': 'application/json'}, method='POST')
with urllib.request.urlopen(request, timeout=90) as response:
    assert response.status == 201
    key = json.load(response)
assert key['key'] and key['scope'] == 'regular' and key['ownerUserId'] == account['id']
path = root / 'agent.env'
with path.open('x') as output:
    output.write('NIMMARI_API_KEY=' + shlex.quote(key['key']) + '\n')
    output.write('NIMMARI_BASE_URL=' + shlex.quote(os.environ['PUBLIC_URL']) + '\n')
path.chmod(0o600)
(root / 'agent-key-id.txt').write_text(key['id'] + '\n')
PY
set +x
set -a
source "$INSTALL_DIR/agent.env"
set +a
# README's authentication check: omit the required PDF, expect HTTP 400.
code=$(printf 'Authorization: Bearer %s\n' "$NIMMARI_API_KEY" | \
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --request POST --header @- --form notify=false "$NIMMARI_BASE_URL/api/documents")
[ "$code" = 400 ] || { printf 'Expected HTTP 400, received %s\n' "$code"; exit 1; }
```

`agent.env` holds only the regular owner-scoped key and the reachable instance URL. Load it into the agent's environment with tracing disabled. Do not source `server.env` into the document agent. If key creation times out, inspect key metadata before creating another key; plaintext is returned only at creation.

Continue with shared steps 7–8 and the final report above.
