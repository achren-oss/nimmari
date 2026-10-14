import { fieldMatchesSigner, type FieldAssignment, type SignerIdentity } from "./signer-assignment";
import sanitizeHtml from "sanitize-html";
import * as cheerio from "cheerio";
import { formatDateFinnish } from "./validators";

export type HtmlField = {
  name: string;
  label: string;
  type: "text" | "checkbox" | "radio" | "signature" | "date" | "hetu";
  required: boolean;
  assignedSignerKey: string | null;
  assignedToSignerEmail: string | null;
  privateForOtherSigners: boolean;
};

const COMMON_ATTRS = [
  "id", "class", "style", "lang", "dir", "title", "role",
  "name", "type", "value", "placeholder", "for", "rows", "cols",
  "checked", "disabled", "readonly",
  "min", "max", "step", "pattern", "minlength", "maxlength", "required",
  "data-pm-form", "data-pm-field", "data-pm-label", "data-pm-required", "data-pm-type",
  "data-pm-signer", "data-pm-signer-key", "data-pm-role", "data-pm-private",
];

const SVG_PRESENTATION_ATTRS = [
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray",
  "d", "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "points",
  "transform", "opacity", "viewBox", "xmlns", "preserveAspectRatio",
  "font-family", "font-size", "font-weight", "text-anchor", "dy", "dx",
  "width", "height",
];

// Remove unsafe CSS. @import / expression() / javascript: drop the whole
// block (incl. escaped or comment-obfuscated spellings). url() is allowed only
// for data: URIs (e.g. embedded fonts); other url() calls are removed. Chromium
// request interception in render-pdf.ts is the second line of defence.
function decodeCss(css: string): string {
  return css.replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_, hex, char) =>
    hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : char,
  ).replace(/\/\*[\s\S]*?\*\//g, "");
}

export function sanitizeCss(css: string): string {
  const normalized = decodeCss(css);
  if (/@import|expression\s*\(|javascript\s*:/i.test(normalized)) return "";
  // Escapes inside url() can't be reasoned about safely; drop the block.
  if (/url\s*\(/i.test(normalized) && !/url\s*\(/i.test(css.replace(/\/\*[\s\S]*?\*\//g, ""))) return "";
  const out = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi,
    (m, _q, u: string) => (/^\s*data:/i.test(u) ? m : "none"),
  );
  // Any url() left that isn't data: was malformed/odd — drop the block.
  return /url\s*\(\s*['"]?\s*(?!data:)/i.test(out) ? "" : out;
}

export function sanitizeFormHtml(html: string): string {
  let sanitized = sanitizeHtml(html, {
    allowedTags: [
      "html", "head", "meta", "title", "style", "body",
      "div", "section", "article", "header", "footer", "main", "nav", "aside",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "span", "strong", "em", "i", "b", "u", "br", "hr", "small", "code", "pre", "blockquote",
      "ul", "ol", "li", "dl", "dt", "dd",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
      "form", "fieldset", "legend", "label",
      "input", "textarea", "select", "option",
      "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "clipPath", "mask",
      "img",
    ],
    allowedAttributes: {
      "*": [...COMMON_ATTRS, "data-*"],
      a: ["href", "target", "rel", ...COMMON_ATTRS],
      img: ["src", "alt", "width", "height", ...COMMON_ATTRS],
      meta: ["charset", "name", "content", "http-equiv"],
      svg: SVG_PRESENTATION_ATTRS,
      g: SVG_PRESENTATION_ATTRS,
      path: SVG_PRESENTATION_ATTRS,
      rect: SVG_PRESENTATION_ATTRS,
      circle: SVG_PRESENTATION_ATTRS,
      ellipse: SVG_PRESENTATION_ATTRS,
      line: SVG_PRESENTATION_ATTRS,
      polyline: SVG_PRESENTATION_ATTRS,
      polygon: SVG_PRESENTATION_ATTRS,
      text: SVG_PRESENTATION_ATTRS,
      tspan: SVG_PRESENTATION_ATTRS,
    },
    allowedSchemes: ["data"],
    allowProtocolRelative: false,
    allowedSchemesByTag: { img: ["data"] },
    allowedStyles: {
      "*": {
        // Permissive — forms need lots of layout CSS. The dangerous vectors
        // (url(http://...) for exfil, expression(...), behavior:url(...)) are
        // blocked separately below.
        "*": [/^.*$/],
      },
    },
    transformTags: {
      "*": (tag, attribs) => {
        if (attribs.style) attribs.style = sanitizeCss(attribs.style);
        if (tag === "img" && attribs.src && !/^data:/i.test(attribs.src)) delete attribs.src;
        return { tagName: tag, attribs };
      },
    },
    parser: { lowerCaseTags: true, lowerCaseAttributeNames: true },
    selfClosing: ["img", "br", "hr", "input", "meta", "link"],
    // Keep layout styles; unsafe style content is removed below.
    allowVulnerableTags: true,
  });

  sanitized = sanitized.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (_, open, css, close) => open + sanitizeCss(css) + close);

  // Ensure meta charset survives. Without it, downloaded HTML files
  // would display non-ASCII characters incorrectly when opened.
  if (!/charset\s*=/i.test(sanitized)) {
    sanitized = sanitized.replace(/<head([^>]*)>/i, '<head$1><meta charset="utf-8">');
    if (!/<meta\s+charset/i.test(sanitized)) {
      // No <head> at all — prepend one.
      sanitized = '<head><meta charset="utf-8"></head>' + sanitized;
    }
  }
  return sanitized;
}

export function extractFields(html: string): HtmlField[] {
  const $ = cheerio.load(html);
  const fields: HtmlField[] = [];
  const seen = new Set<string>();

  $("[data-pm-field]").each((_, el) => {
    const $el = $(el);
    const name = ($el.attr("data-pm-field") ?? "").trim();
    if (!name || seen.has(name)) return;

    const tag = (el as { tagName?: string }).tagName?.toLowerCase();

    // A <fieldset data-pm-field> is only a real field if it contains radios.
    // Independent-checkbox groupings sometimes get a fieldset wrapper for
    // semantics or styling — those should not become a phantom field.
    if (tag === "fieldset" && $el.find('input[type="radio"]').length === 0) {
      return;
    }

    seen.add(name);

    const label = ($el.attr("data-pm-label") ?? name).trim();
    const required = $el.attr("data-pm-required") !== undefined;
    const explicitType = ($el.attr("data-pm-type") ?? "").trim().toLowerCase();
    const inputType = ($el.attr("type") ?? "").trim().toLowerCase();

    let type: HtmlField["type"] = "text";
    if (explicitType === "signature" || $el.hasClass("pm-signature")) {
      type = "signature";
    } else if (explicitType === "date" || inputType === "date") {
      type = "date";
    } else if (explicitType === "hetu" || $el.hasClass("pm-hetu")) {
      type = "hetu";
    } else if (tag === "input" && inputType === "checkbox") {
      type = "checkbox";
    } else if (tag === "fieldset") {
      type = "radio";
    } else if (tag === "input" || tag === "textarea") {
      type = "text";
    } else if (tag === "div" || tag === "span") {
      type = "signature";
    }

    const signerRaw = ($el.attr("data-pm-signer") ?? "").trim().toLowerCase();
    const assignedToSignerEmail = signerRaw && signerRaw.includes("@") ? signerRaw : null;
    const privateForOtherSigners = $el.attr("data-pm-private") !== undefined;

    fields.push({
      name,
      label,
      type,
      required,
      assignedToSignerEmail,
      assignedSignerKey: ($el.attr("data-pm-signer-key") ?? $el.attr("data-pm-role"))?.trim() || null,
      privateForOtherSigners,
    });
  });

  return fields;
}

/**
 * Repackage a full HTML document for embedding inside a Shadow DOM tree,
 * so the form renders inline (single page scroll surface) but its CSS still
 * stays scoped to the shadow boundary.
 *
 * The form's <body> becomes a <div class="pm-form-root"> wrapper, and any
 * "body" selector in its <style> blocks is rewritten to ".pm-form-root" so
 * the layout rules still apply. Selectors like "html, body" are split into
 * ":host" (for the shadow root) and ".pm-form-root".
 */
export function htmlToShadowParts(html: string): { styles: string; body: string } {
  const $ = cheerio.load(html);

  // Rewrite "body" and "html" selectors in <style> blocks. Selectors not at a
  // word boundary (e.g. "anybody") are left untouched.
  $("style").each((_, el) => {
    const css = $(el).text();
    const rewritten = css
      // "html, body" or "html,body" → "html, body" both rewritten
      .replace(/(^|[,\s{}>])html\s*,\s*body(?=[\s,{>:.+~])/g, "$1:host, .pm-form-root")
      .replace(/(^|[,\s{}>])body\s*,\s*html(?=[\s,{>:.+~])/g, "$1.pm-form-root, :host")
      // Standalone "body" (followed by space, comma, brace, etc.)
      .replace(/(^|[,\s{}>])body(?=[\s,{>:.+~])/g, "$1.pm-form-root")
      // Standalone "html"
      .replace(/(^|[,\s{}>])html(?=[\s,{>:.+~])/g, "$1:host");
    $(el).text(rewritten);
  });

  const stylesHtml = $("style").map((_, el) => $.html(el)).get().join("\n");

  const bodyEl = $("body");
  const bodyContent = bodyEl.html() ?? "";
  const bodyClass = bodyEl.attr("class");
  const bodyStyle = bodyEl.attr("style");
  const cls = bodyClass ? `pm-form-root ${bodyClass}` : "pm-form-root";
  const styleAttr = bodyStyle ? ` style="${escapeHtml(bodyStyle)}"` : "";
  const wrapperHtml = `<div class="${escapeHtml(cls)}"${styleAttr}>${bodyContent}</div>`;

  return { styles: stylesHtml, body: wrapperHtml };
}

export function inferTitle(html: string, fallback: string): string {
  const $ = cheerio.load(html);
  const titleEl = $("title").first().text().trim();
  if (titleEl) return titleEl;
  const h1 = $("h1").first().text().trim();
  if (h1) return h1;
  return fallback;
}

export type AuditMeta = {
  documentId: string;
  contentHashShort: string; // already shortened (e.g. "7e2af1c9…b40c")
  signedAt: Date;
  recipientEmail: string;
  // For multi-signer docs: how many signers have already sealed this doc
  // (used to append audit lines instead of replacing them).
  existingSignerCount?: number;
};

export function appendAuditFooter(html: string, audit: AuditMeta): string {
  const dt = audit.signedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const existingCount = audit.existingSignerCount ?? 0;

  // If this is not the first signer, append to existing audit section.
  if (existingCount > 0 && html.includes("data-pm-audit")) {
    // Find the audit section and append a new line to it
    const auditLine = `<br><span class="seal-mark">&#10003; Sealed</span> by ${escapeHtml(audit.recipientEmail)} on ${dt}`;
    const auditSectionEnd = html.lastIndexOf("</section>");
    if (auditSectionEnd > 0 && html.substring(Math.max(0, auditSectionEnd - 200), auditSectionEnd).includes("data-pm-audit")) {
      return html.substring(0, auditSectionEnd) + auditLine + "\n" + html.substring(auditSectionEnd);
    }
  }

  // First signer or fallback: create a new audit section
  const footer = `
<style>
  .pm-audit{margin-top:32px;padding-top:14px;border-top:1px solid #97876a;font-family:'Helvetica Neue',Arial,sans-serif;font-size:10px;line-height:1.6;color:#5a4a31;}
  .pm-audit .seal-mark{font-style:italic;color:#4a6b3f;font-weight:600;}
  .pm-audit code{font-family:'SF Mono','Menlo',monospace;font-size:9px;color:#1d2839;}
  /* iOS Safari fades text in disabled form controls. After signing, every
     field is disabled — without this, the signed values read as ghost-grey
     placeholders on iPhone. Scoped to signed docs (this style only ships
     when appendAuditFooter runs). */
  input:disabled, textarea:disabled, select:disabled{
    -webkit-text-fill-color: currentColor !important;
    opacity: 1 !important;
    color: inherit !important;
  }
</style>
<section class="pm-audit" data-pm-audit>
<span class="seal-mark">&#10003; Sealed</span> by ${escapeHtml(audit.recipientEmail)} on ${dt} &middot;
Document <code>${escapeHtml(audit.documentId)}</code> &middot;
SHA-256 <code>${escapeHtml(audit.contentHashShort)}</code>
</section>`;
  if (html.includes("</body>")) return html.replace("</body>", footer + "\n</body>");
  return html + footer;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
}

export function fillHtml(
  html: string,
  values: Record<string, string>,
  signaturePng: string | null,
  opts: { disableMode?: "all" | "filled-only" } = {},
): string {
  const $ = cheerio.load(html);
  const disableMode = opts.disableMode ?? "all";

  $("[data-pm-field]").each((_, el) => {
    const $el = $(el);
    const name = $el.attr("data-pm-field");
    if (!name) return;
    const v = values[name];
    const tag = (el as { tagName?: string }).tagName?.toLowerCase();
    const inputType = ($el.attr("type") ?? "").trim().toLowerCase();
    const isSignature = $el.hasClass("pm-signature") || $el.attr("data-pm-type") === "signature";
    let didFill = false;

    if (isSignature) {
      const sig = (name && values[name]?.startsWith("data:image/")) ? values[name] : signaturePng;
      if (sig) {
        $el.empty();
        $el.append(
          `<img alt="Signature" src="${escapeHtml(sig)}" style="max-width:100%;max-height:100%;height:auto;display:block;" />`,
        );
        $el.addClass("has-signature");
      }
      return;
    }

    if (tag === "input" && inputType === "checkbox") {
      if (v === "true" || v === "on" || v === "1") {
        $el.attr("checked", "checked");
        didFill = true;
      } else {
        $el.removeAttr("checked");
      }
    } else if (tag === "input" && inputType === "radio") {
      // Handled at fieldset level below.
    } else if (tag === "fieldset") {
      const groupName = $el.find("input[type=radio]").first().attr("name");
      if (groupName && v) {
        $el.find("input[type=radio]").filter((_, r) => $(r).attr("name") === groupName).each((_, r) => {
          const $r = $(r);
          if ($r.attr("value") === v) {
            $r.attr("checked", "checked");
            didFill = true;
          } else {
            $r.removeAttr("checked");
          }
        });
      }
    } else if (tag === "textarea") {
      if (disableMode === "all") {
        $el.attr("style", `${$el.attr("style") ?? ""};white-space: pre-wrap;`);
      }
      if (v !== undefined) {
        $el.text(v);
        didFill = !!v;
      }
    } else if (tag === "input") {
      if (v !== undefined) {
        let display = v;
        const pmType = ($el.attr("data-pm-type") ?? "").trim().toLowerCase();
        if (pmType === "date" || inputType === "date") {
          display = formatDateFinnish(v);
        } else if (pmType === "hetu" || $el.hasClass("pm-hetu")) {
          display = v;
        }
        $el.attr("value", display);
        didFill = !!v;
      }
    }

    if (disableMode === "filled-only" && didFill) {
      if (tag === "fieldset") {
        $el.find("input").attr("disabled", "disabled");
      } else {
        $el.attr("disabled", "disabled");
      }
    }
  });

  if (disableMode === "all") {
    $("input, textarea, select").each((_, el) => {
      $(el).attr("disabled", "disabled");
    });
  }

  return $.html();
}

/** Remove other slots' controls, including their source values, before sending HTML to a signer. */
export function htmlVisibleToSigner(
  html: string,
  fields: (FieldAssignment & { name: string | null })[],
  signer: SignerIdentity,
): string {
  const hiddenNames = new Set(fields.filter((f) => !fieldMatchesSigner(f, signer)).map((f) => f.name));
  if (!hiddenNames.size) return html;
  const $ = cheerio.load(html);
  $("[data-pm-field]").each((_, el) => {
    if (hiddenNames.has($(el).attr("data-pm-field") ?? null)) $(el).remove();
  });
  return $.html();
}
