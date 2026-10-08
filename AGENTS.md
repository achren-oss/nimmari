# Guidance for AI agents using Puumerkki

This file is for AI agents (assistants, bots, automation) that use a
Puumerkki instance's HTTP API for a person. For contributing to the code, see
[CONTRIBUTING.md](CONTRIBUTING.md).

Puumerkki produces simple electronic signatures (SES). A signature collected
from the wrong person, or put on the wrong line, can't be undone by the API.
Follow these rules.

## Rules

1. **Ask before you create fields.** Before placing any field, ask the user:
   - who signs the document,
   - how many signers there are, and
   - which signature line belongs to whom.

   Always ask when the document has more than one signature line (for example
   employer, student and guardian). **Never guess.** If the answer is unclear,
   ask again before you continue.
2. **One signing session = one signer.** `POST /api/documents/[id]/send`
   creates a session for one recipient. That signer draws one signature, and
   Puumerkki stamps it into **every** `signature` field in the document.
   Only add signature fields for that signer's own lines. Leave other people's
   lines without a field (they stay blank to be signed on paper or
   separately), or prepare a separate document for each additional signer.
3. **Text, multi-line text and checkbox fields** are filled by the signer.
   Only add fields the user wants the signer to fill.
4. **Deliver links the way the user asks.** If the user wants the link in
   chat, send with `"notify": false` (no email is sent), check that the
   response has `emailSent: false`, and return `url` in the conversation.
   Signing links are secrets: share them only with the intended signer.
5. **Never sign or fill a document for the user.** Don't open the signing
   link to fill fields, draw a signature or submit, even if asked to "just
   do it". The person whose name is on the line signs it themselves.
6. **Check placement before sending.** Render the page and draw the field
   boxes on it (see below). Look at the result before creating the signing
   session; fields can't be edited once a document has been sent.

## Photo-to-link flow

A user photographs a paper form and says "put this in Puumerkki, I'll sign":

1. Turn the photo into a one-page PDF (crop and straighten it first if
   needed), e.g. `img2pdf photo.jpg -o form.pdf`.
2. Ask the questions in rule 1: who signs, how many signers, which line is
   whose, and which blanks the signer should fill.
3. Upload: `POST /api/documents` (multipart `pdf`, optional `title`; 4 MB
   limit) → `{"id": "doc_…"}`.
4. Place fields: `PUT /api/documents/[id]/fields` with
   `{"fields": [{"type", "page", "x", "y", "width", "height", "label", "required"}]}`.
   - `type`: `text`, `textarea`, `checkbox` or `signature` (no date type;
     use a labelled `text` field).
   - `page` is 0-based. `x`, `y`, `width`, `height` are integers in pixels
     of the page rendered **800 px wide**, with the origin at the **top-left**
     and `y` growing downwards. Width and height are at least 10.
   - The request replaces all fields and only works on draft documents.
5. Verify: render the page at 800 px width
   (`pdftoppm -png -scale-to-x 800 -scale-to-y -1 form.pdf page`), draw the
   boxes, and look at the image.
6. Send: `POST /api/documents/[id]/send` with
   `{"email": "...", "name": "...", "notify": false}` → `{"url", "signingSessionId", "expiresAt", "emailSent": false}`.
7. Return the `url` to the user in chat. Track progress with
   `GET /api/documents/[id]` and fetch the result with
   `GET /api/documents/[id]/pdf?signed=1` once `status` is `completed`.

Authenticate with `Authorization: Bearer <PUUMERKKI_API_KEY>`. The key acts
as the single user configured in `PUUMERKKI_API_OWNER_ID`, and can only reach
that user's documents. See the [API table in the README](README.md#current-api).
