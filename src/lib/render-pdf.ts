import puppeteer, { type Browser } from "puppeteer-core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Inline print rules — same as the in-browser ?print=1 path so the rendered
// PDF matches what users have always seen on "View as PDF". Forces background
// printing (custom checkboxes), zeros body padding (compounds with @page
// margins), and keeps the audit footer on the same page when possible.
const PRINT_CSS = `
<style>
@page { size: A4; margin: 10mm 14mm; }
@media print {
  html, body, * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }
  html, body { background: white !important; }
  body { padding-top: 0 !important; padding-bottom: 0 !important; }
  .pm-audit {
    margin-top: 6px !important;
    padding-top: 4px !important;
    page-break-before: avoid !important;
    page-break-inside: avoid !important;
    break-before: avoid !important;
    break-inside: avoid !important;
  }
}
</style>`;

function injectPrintCss(html: string): string {
  if (html.includes("</body>")) return html.replace("</body>", PRINT_CSS + "</body>");
  return html + PRINT_CSS;
}

// Pinned to chromium-min v153. The binary is downloaded once per cold start
// and cached in /tmp by sparticuz. Update both the dep version and this URL
// together; the pack tarball is published per release.
const CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar";

async function launchBrowser(): Promise<Browser> {
  const onServerless = !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.VERCEL;
  if (onServerless) {
    const chromium = (await import("@sparticuz/chromium-min")).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
      headless: true,
    });
  }
  // Local dev: use the system Chrome. Override via PUPPETEER_EXECUTABLE_PATH.
  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  // Containers usually lack the kernel features for Chromium's sandbox.
  // PUPPETEER_NO_SANDBOX=1 (set in the Docker image) disables it; rendered
  // HTML is sanitized and network access is blocked during rendering.
  const args =
    process.env.PUPPETEER_NO_SANDBOX === "1"
      ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      : [];
  // Some hosts (e.g. Render) give Chromium no usable HOME/config dir, so the
  // crashpad handler aborts with "--database is required". Disable crash
  // reporting and point profile/config dirs at a fresh temp directory.
  const userDataDir = await mkdtemp(join(tmpdir(), "puumerkki-chrome-"));
  args.push("--disable-crash-reporter", "--disable-breakpad", "--no-first-run", "--disable-gpu");
  const env = {
    ...process.env,
    HOME: userDataDir,
    XDG_CONFIG_HOME: userDataDir,
    XDG_CACHE_HOME: userDataDir,
  };
  const browser = await puppeteer.launch({ executablePath, headless: true, args, userDataDir, env });
  browser.once("disconnected", () => void rm(userDataDir, { recursive: true, force: true }));
  return browser;
}

export async function renderHtmlToPdf(html: string): Promise<Uint8Array> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      if (url.startsWith("data:") || (url === "about:blank" && request.isNavigationRequest() && request.frame() === page.mainFrame())) {
        void request.continue();
      } else {
        void request.abort();
      }
    });
    // puppeteer-core 25 dropped "networkidle0"/"networkidle2" as setContent
    // wait targets (they only apply to real navigations now). "load" plus the
    // explicit fonts.ready wait below covers the same case we cared about
    // (async webfont loads finishing after the initial content is parsed).
    await page.setContent(injectPrintCss(html), { waitUntil: "load" });
    // Wait for any web-loaded fonts to be ready before snapshotting.
    await page.evaluateHandle(() => (document as Document).fonts?.ready);
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", right: "14mm", bottom: "10mm", left: "14mm" },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}
