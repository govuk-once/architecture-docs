/**
 * The paste page: instructions above the rule, the page below it, and for each picture a
 * placeholder that survives the paste and a button that copies the picture alone.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { embedded, pasteShell } from "./pages.js";

describe("pasteShell", () => {
  const html = pasteShell(
    {
      title: "FLEX — architecture",
      parent: "GOV.UK Once",
      folder: "export/flex",
    },
    "<p>body</p>",
  );

  it("names the title and parent above the rule and starts the page with the title", () => {
    expect(html).toContain("<strong>Page title:</strong> FLEX — architecture");
    expect(html).toContain("<strong>Parent page:</strong> GOV.UK Once");
    expect(html).toContain("<code>export/flex/</code>");
    const rule = html.indexOf('id="copy-from-here"');
    expect(rule).toBeGreaterThan(0);
    expect(html.slice(rule)).toContain(
      "<h1>FLEX — architecture</h1>\n<p>body</p>",
    );
  });

  it("carries the script the copy buttons need", () => {
    expect(html).toContain("navigator.clipboard.write");
  });

  it("says nothing about a parent for the page at the top", () => {
    expect(
      pasteShell({ title: "Top", folder: "export/index" }, ""),
    ).not.toContain("Parent page");
  });
});

describe("embedded", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pages-"));
  writeFileSync(path.join(dir, "a.png"), Buffer.from([1, 2, 3]));
  const image = embedded(dir);

  it("inlines the bytes and leaves a placeholder and a copy button that survive a paste", () => {
    expect(image("a.png")).toContain('src="data:image/png;base64,AQID"');
    expect(image("a.png")).toContain("[Picture: a.png — paste it here");
    expect(image("a.png")).toContain('class="copy-picture" data-file="a.png"');
  });

  it("never puts the button's words in the copied text", () => {
    expect(image("a.png")).not.toMatch(/<button[^>]*>[^<]+<\/button>/);
  });

  it("says when the picture was never taken", () => {
    expect(image("b.png")).toContain("Picture b.png was not taken");
  });
});
