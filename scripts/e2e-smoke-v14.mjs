/** Synthetic signing test. Creates persistent test records; never use real signer data. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID, createHmac, createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
const base = (process.env.NIMMARI_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
let key = process.env.NIMMARI_BOT_API_KEY;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(path, { body, method = body ? "POST" : "GET", headers = {}, auth = true } = {}) {
  const response = await fetch(base + path, { method, headers: { ...(auth && key ? { Authorization: `Bearer ${key}` } : {}), ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...headers }, ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
  assert(response.ok, `${method} ${path.replace(/\/api\/sign\/[^/]+/, "/api/sign/[secret]")} returned ${response.status}`);
  return response;
}
let receiver;
let received = 0;
let webhookUrl = process.env.WEBHOOK_RECEIVER_URL;
try {
  if (!key) {
    assert(process.env.NIMMARI_SETUP_CODE, "Set NIMMARI_BOT_API_KEY, or NIMMARI_SETUP_CODE for a fresh database");
    const claim = await (await api("/api/setup/claim", { auth: false, body: { setupCode: process.env.NIMMARI_SETUP_CODE, email: `smoke-${randomUUID()}@example.com`, name: "Synthetic Owner" } })).json();
    key = claim.agentKey.key;
    console.log("Setup claim passed (credentials kept in memory).");
  }
  if (!webhookUrl && ["localhost", "127.0.0.1"].includes(new URL(base).hostname)) {
    receiver = createServer(async (req, res) => {
      let raw = ""; for await (const chunk of req) raw += chunk;
      if (process.env.NIMMARI_WEBHOOK_SECRET) assert.equal(req.headers["x-puumerkki-signature"], createHmac("sha256", process.env.NIMMARI_WEBHOOK_SECRET).update(raw).digest("hex"));
      received++; res.writeHead(received === 1 ? 500 : 200); res.end("synthetic receiver");
    });
    await new Promise((resolve) => receiver.listen(3334, "127.0.0.1", resolve));
    webhookUrl = "http://127.0.0.1:3334/hook";
  }
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 640]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.12, .18, .22), muted = rgb(.4, .46, .48), green = rgb(.16, .38, .31);
  const text = (value, x, y, size = 12, font = regular, color = ink) => page.drawText(value, { x, y, size, font, color });
  page.drawRectangle({ x: 0, y: 560, width: 595, height: 80, color: rgb(.94, .97, .95) });
  text("EXAMPLE STUDIO", 42, 601, 10, bold, green);
  text("A good project starts here.", 42, 577, 23, bold);
  text("Service agreement", 42, 520, 20, bold);
  text("SYNTHETIC DEMONSTRATION  /  20 OCTOBER 2026", 42, 496, 9, regular, muted);
  text("Prepared for Alex Example", 42, 450, 14, bold);
  text("Example Studio will prepare a visual concept for a sample project.", 42, 420);
  text("The project includes a discovery session, initial concepts and", 42, 399);
  text("one round of feedback. Delivery is agreed together before work begins.", 42, 378);
  text("Project fee", 42, 329, 10, bold, muted); text("EUR 1,200 (example only)", 42, 306, 14);
  text("Client name", 42, 258, 10, bold, muted);
  text("Client signature", 42, 172, 10, bold, muted);
  page.drawLine({ start: { x: 42, y: 92 }, end: { x: 553, y: 92 }, color: rgb(.8, .85, .82), thickness: 1 });
  text("Example document. No real agreement or personal data.", 42, 50, 9, regular, muted);
  const form = new FormData(); form.set("pdf", new Blob([await pdf.save()], { type: "application/pdf" }), "synthetic-agreement.pdf");
  form.set("title", "Example Studio - service agreement"); form.set("notify", "false"); if (webhookUrl) form.set("webhookUrl", webhookUrl);
  const { id } = await (await api("/api/documents", { body: form })).json();
  const path = `/api/documents/${id}`;
  await api(path + "/fields", { method: "PUT", body: { fields: [
    { type: "text", name: "client", page: 0, x: 56, y: 522, width: 680, height: 44, label: "Client name" },
    { type: "signature", name: "signature", page: 0, x: 56, y: 643, width: 680, height: 80, label: "Your signature", assignedSignerKey: "client" },
  ] } });
  const draft = await (await api(path)).json();
  const clientField = draft.fields.find((f) => f.name === "client");
  await api(path + "/prefill", { method: "PUT", body: { values: { [clientField.id]: "Alex Example" } } });
  const body = { signers: [{ email: "alex@example.com", name: "Alex Example", key: "client" }], notify: false };
  const headers = { "Idempotency-Key": randomUUID() };
  const first = await (await api(path + "/send", { body, headers })).json();
  assert.deepEqual(await (await api(path + "/send", { body, headers })).json(), first);
  assert.equal((await (await api(path)).json()).signingSessions.length, 1);
  const listed = await (await api("/api/documents?status=sent&limit=100")).json();
  assert(listed.documents.some((d) => d.id === id));
  const fresh = await (await api(path + "/signers/client/reissue", { body: { notify: false } })).json();
  const oldToken = new URL(first.url).pathname.split("/").pop();
  assert([404, 410].includes((await fetch(base + `/api/sign/${oldToken}`)).status));
  const token = new URL(fresh.url).pathname.split("/").pop();
  await api(`/api/sign/${token}`, { auth: false });
  if (process.env.NIMMARI_SCREENSHOT_PATH) {
    const { default: puppeteer } = await import("puppeteer-core");
    const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
    try {
      const view = await browser.newPage(); await view.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
      await view.goto(fresh.url, { waitUntil: "networkidle0" });
      await view.waitForSelector("canvas"); await sleep(1500);
      await view.screenshot({ path: process.env.NIMMARI_SCREENSHOT_PATH });
    } finally { await browser.close(); }
  }
  const signaturePng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";
  await api(`/api/sign/${token}`, { auth: false, body: { values: {}, signaturePng } });
  assert.equal((await (await api(path)).json()).status, "completed");
  if (webhookUrl) {
    let history = await (await api(path + "/webhooks")).json();
    assert.equal(history.deliveries.length, 1);
    // The local receiver fails once; wait for persisted backoff, then use the cron endpoint.
    if (history.deliveries[0].status === "pending") {
      if (receiver) assert.equal(history.deliveries[0].attemptCount, 1);
      const due = new Date(history.deliveries[0].nextAttemptAt).getTime();
      console.log("First webhook attempt failed as intended; waiting for retry backoff.");
      await sleep(Math.max(0, due - Date.now()) + 1000);
      await api("/api/webhooks/deliveries/process", { body: {} });
      history = await (await api(path + "/webhooks")).json();
      assert.equal(history.deliveries[0].attemptCount, 2); assert.equal(history.deliveries[0].status, "delivered");
      if (receiver) assert.equal(received, 2);
    }
    console.log(`Webhook history: ${history.deliveries[0].attemptCount} attempts, ${history.deliveries[0].status}.`);
  }
  const download = await api(path + "/pdf?signed=1");
  const downloaded = new Uint8Array(await download.arrayBuffer());
  assert.equal(Number(download.headers.get("Content-Length")), downloaded.length);
  assert.equal(download.headers.get("X-Content-SHA256"), createHash("sha256").update(downloaded).digest("hex"));
  assert(Buffer.from(downloaded).subarray(0, 5).equals(Buffer.from("%PDF-")));
  assert((await PDFDocument.load(downloaded)).getPageCount() >= 1);
  console.log("PASS: upload, fields, prefill, idempotent send, list, reissue, synthetic sign, history and signed PDF.");
} finally { if (receiver) await new Promise((resolve) => receiver.close(resolve)); }
