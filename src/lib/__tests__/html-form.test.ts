import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import { extractFields, fillHtml, htmlToShadowParts, sanitizeCss, sanitizeFormHtml } from "../html-form";

describe("CSS sanitizer", () => {
  it("keeps normal layout CSS", () => {
    const css = ".form { display: grid; color: #123; margin: 2px; }";
    expect(sanitizeCss(css)).toBe(css);
  });
  it.each([
    "@import 'https://example.com/a.css';", "width: expression(alert(1))",
    "background: javascript:alert(1)", String.raw`background: u\72l(/x)`,
    String.raw`@\69mport '/x';`,
  ])("strips dangerous CSS %s", (css: string) => {
    expect(sanitizeCss(css)).toBe("");
    const $ = cheerio.load(sanitizeFormHtml(`<style>${css}</style><div style="${css}">x</div>`));
    expect($("style").text()).toBe("");
    expect($("div").attr("style") || "").toBe("");
  });
  it.each(["background: url(https://example.com/x)", "background: URL (/local)", "background: u/**/rl(/x)"])(
    "neutralises non-data url() %s", (css: string) => {
      expect(sanitizeCss(css)).not.toMatch(/url\s*\(/i);
    });
  it("removes remote, protocol-relative and relative image sources", () => {
    const $ = cheerio.load(sanitizeFormHtml('<img src="https://example.com/x"><img src="//example.com/x"><img src="/x"><img src="data:image/png;base64,iVBORw0KGgo=">'));
    expect($("img").map((_, el) => $(el).attr("src") || "").get())
      .toEqual(["", "", "", "data:image/png;base64,iVBORw0KGgo="]);
  });
});

describe("HTML attribute escaping", () => {
  it("escapes inserted signatures and field values", () => {
    const attack = 'x" onerror="alert(1)';
    const $ = cheerio.load(fillHtml('<div data-pm-field="sig" data-pm-type="signature"></div><input data-pm-field="text">', { text: attack }, attack));
    expect($("img").attr("src")).toBe(attack);
    expect($("img").attr("onerror")).toBeUndefined();
    expect($("input").attr("value")).toBe(attack);
    expect($("input").attr("onerror")).toBeUndefined();
  });
  it("escapes body attributes in shadow wrappers", () => {
    const { body } = htmlToShadowParts('<body class="x&quot; onclick=&quot;alert(1)">hello</body>');
    const $ = cheerio.load(body);
    expect($("div").attr("onclick")).toBeUndefined();
  });
});

import { sanitizeCss as sc } from "../html-form";
describe("sanitizeCss url handling", () => {
  it("keeps data: urls and layout", () => {
    const css = "@font-face{src:url(data:font/woff2;base64,AAAA)} .a{color:red}";
    expect(sc(css)).toBe(css);
  });
  it("neutralises remote urls but keeps other rules", () => {
    const out = sc(".a{background:url('https://evil.example/x')} .b{color:red}");
    expect(out).not.toMatch(/evil/);
    expect(out).toMatch(/color:red/);
  });
  it("drops escaped url obfuscation", () => {
    expect(sc(".a{background:u\\72l(https://evil.example)}")).toBe("");
  });
});


describe("multiline HTML fields", () => {
  const html = '<textarea data-pm-field="notes" data-pm-required style="color:red"></textarea>';
  const value = 'First line\n\n<unsafe>& last line';

  it("parses textarea as a required text field", () => {
    expect(extractFields(html)).toEqual([{ name: "notes", label: "notes", type: "text", required: true }]);
  });
  it("prefills textarea content and keeps the existing lock rules", () => {
    const $ = cheerio.load(fillHtml(html + '<textarea data-pm-field="empty"></textarea>', { notes: value }, null, { disableMode: "filled-only" }));
    expect($("[data-pm-field=notes]").text()).toBe(value);
    expect($("[data-pm-field=notes]").attr("disabled")).toBeDefined();
    expect($("[data-pm-field=empty]").attr("disabled")).toBeUndefined();
    expect($("unsafe").length).toBe(0);
  });
  it("preserves newlines and escapes HTML in the signed render", () => {
    const rendered = fillHtml(html, { notes: value }, null);
    const $ = cheerio.load(rendered);
    expect($("textarea").text()).toBe(value);
    expect($("textarea").attr("style")).toContain("white-space: pre-wrap");
    expect($("textarea").attr("style")).toContain("color:red");
    expect(rendered).toContain("&lt;unsafe&gt;&amp;");
    expect($("textarea").attr("disabled")).toBeDefined();
  });
});
