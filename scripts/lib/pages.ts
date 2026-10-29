/**
 * What the Confluence exports share: pictures taken from the built page, and the ways a
 * page refers to one — as an attachment in storage format, as an <img> for a browser, and
 * embedded in the page itself for one that is copied into the editor by hand.
 *
 * The pictures are the diagrams as the page draws them, not a second drawing: the same
 * browser the render check uses opens the built page at a deep link and photographs the
 * diagram alone. Skipped, with a word, when the page is not built or the browser is not
 * installed — every export's text stands on its own.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { DOCS_ROOT } from "./paths.js";

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Confluence storage format: an attachment on the page, by file name. */
export const attachment = (file: string) =>
  `<p><ac:image ac:width="900"><ri:attachment ri:filename="${esc(file)}" /></ac:image></p>`;
/** The same page for a browser, beside the PNGs. */
export const inline = (file: string) =>
  `<p><img src="${esc(file)}" style="max-width:100%;border:1px solid #e2e8f0;border-radius:8px" /></p>`;

/**
 * The picture inside the page, for one that is copied from a browser into the Confluence
 * editor. Confluence drops an embedded picture on paste, so each one is followed by a
 * placeholder line that does survive the paste, and a button that puts that one picture
 * on the clipboard: click it, click the placeholder in Confluence, paste. The button's
 * words are CSS-generated, so they are never copied with the text.
 */
export const embedded = (dir: string) => (file: string) => {
  const at = path.join(dir, file);
  if (!existsSync(at))
    return `<p style="color:#b45309"><em>Picture ${esc(file)} was not taken — run pnpm build, then pnpm overview again.</em></p>`;
  const bytes = readFileSync(at).toString("base64");
  return (
    `<p><img src="data:image/png;base64,${bytes}" alt="${esc(file)}" style="max-width:100%;border:1px solid #e2e8f0;border-radius:8px" /></p>` +
    `<p class="slot"><button type="button" class="copy-picture" data-file="${esc(file)}" aria-label="Copy picture ${esc(file)}"></button>` +
    `[Picture: ${esc(file)} — paste it here, then delete this line]</p>`
  );
};

/* The copy buttons: the picture above each one, onto the clipboard as a PNG. */
const PASTE_SCRIPT = `<script>
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button.copy-picture");
  if (!b) return;
  const img = b.closest("p").previousElementSibling.querySelector("img");
  try {
    const blob = await (await fetch(img.src)).blob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    document.querySelectorAll("button.copy-picture").forEach((x) => x.removeAttribute("data-state"));
    b.dataset.state = "done";
  } catch {
    b.dataset.state = "failed";
  }
});
</script>`;

const PASTE_STYLE = `<style>
.slot{color:#64748b;font-size:13px}
.copy-picture{font:inherit;margin-right:8px;padding:3px 10px;border:1px solid #94a3b8;border-radius:6px;background:#fff;cursor:pointer}
.copy-picture::before{content:"Copy picture"}
.copy-picture[data-state=done]::before{content:"Copied — paste it into Confluence"}
.copy-picture[data-state=done]{border-color:#15803d;color:#15803d}
.copy-picture[data-state=failed]::before{content:"Could not copy — right-click the picture, Copy image"}
.copy-picture[data-state=failed]{border-color:#b45309;color:#b45309}
</style>`;

/** A browser preview's shell, so preview.html opens as a readable page on its own. */
export const previewShell = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>` +
  `<body style="max-width:960px;margin:32px auto;font:15px/1.55 system-ui,sans-serif;color:#16212e">` +
  `<style>table{border-collapse:collapse;font-size:14px}td,th{border:1px solid #e2e8f0;padding:6px 10px;text-align:left;vertical-align:top}</style>` +
  body +
  "\n";

/** Where to put the page, for the person pasting it. */
export interface Placement {
  title: string;
  /** The page it goes beneath, by title; none for the page at the top. */
  parent?: string;
  /** The export directory, relative to the repository, where the pictures are. */
  folder: string;
}

/**
 * A page to copy into the Confluence editor by hand: the instructions above a rule, the
 * page below it. Select from the rule down, copy, paste: the text arrives and the pictures
 * do not, leaving a placeholder line for each. Then each picture's button copies it alone,
 * to paste over its placeholder.
 */
export const pasteShell = (where: Placement, body: string) =>
  previewShell(
    where.title,
    PASTE_STYLE +
      `<div style="background:#f1f5f9;border-radius:8px;padding:12px 16px;font-size:14px">` +
      `<p style="margin:0 0 6px"><strong>Page title:</strong> ${esc(where.title)}</p>` +
      (where.parent
        ? `<p style="margin:0 0 6px"><strong>Parent page:</strong> ${esc(where.parent)}</p>`
        : "") +
      `<ol style="margin:0;padding-left:20px">` +
      `<li>Select everything below the line, copy, and paste into the Confluence editor. The text arrives; the pictures do not.</li>` +
      `<li>For each picture, click its <em>Copy picture</em> button here, then select its placeholder line in Confluence and paste over it.</li>` +
      `<li>If a button cannot copy, right-click the picture and choose Copy image, or drag in the file from <code>${esc(where.folder)}/</code>.</li>` +
      `</ol>` +
      `</div>` +
      `<hr id="copy-from-here" style="margin:24px 0;border:0;border-top:2px dashed #94a3b8" />` +
      `<h1>${esc(where.title)}</h1>\n` +
      body +
      PASTE_SCRIPT,
  );

export interface Shot {
  /** The PNG's file name inside the export directory. */
  file: string;
  /** The page's deep link: which view, state and mode to photograph. */
  hash: string;
}

/** A built page to photograph: a project's explorer, or the index over them. */
export interface Photographed {
  id: string;
  pagePath: string;
  /** The element to clip to; the explorer's canvas when not given. */
  clip?: string;
  /** A selector to hide while the picture is taken, beside the explorer's furniture. */
  hide?: string;
}

/** Photograph each deep link of the built page into `dir`. Returns a line for the log. */
export async function snapshots(
  page: Photographed,
  shots: Shot[],
  dir: string,
): Promise<string> {
  if (!existsSync(page.pagePath))
    return `pictures skipped: ${path.relative(DOCS_ROOT, page.pagePath)} is not built — run pnpm build first`;
  let chromium: (typeof import("playwright"))["chromium"];
  try {
    chromium = (await import("playwright")).chromium;
  } catch {
    return "pictures skipped: playwright is not installed (pnpm add -Dw playwright && pnpm exec playwright install chromium)";
  }
  /* Hinting off, as the render check runs: linear text metrics, the same on every
     platform, so a picture taken here matches what the check measured. */
  const browser = await chromium.launch({
    args: ["--font-render-hinting=none"],
  });
  const clip = page.clip ?? "#root";
  const hidden = ["#hint", "#tables", ".tbl-head", page.hide]
    .filter(Boolean)
    .join(",");
  try {
    const context = await browser.newContext({
      viewport: { width: 1500, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: "light",
    });
    await context.addInitScript(
      `try{localStorage.setItem(${JSON.stringify(page.id)}+":intro-seen","1")}catch{}`,
    );
    for (const shot of shots) {
      /* A fresh page per picture: a fragment on the same URL is a same-document navigation
         and would not reload. */
      const p = await context.newPage();
      await p.goto(pathToFileURL(page.pagePath).href + shot.hash);
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(300);
      /* The diagram alone: the hint strip and the reference-tables bar are the page's
         furniture, and the fit leaves margins a picture does not need. */
      await p.addStyleTag({
        content: `${hidden}{display:none!important}`,
      });
      const box = await p.evaluate((sel: string) => {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
      }, clip);
      const pad = 24;
      await p.screenshot({
        path: path.join(dir, shot.file),
        clip: box
          ? {
              x: Math.max(0, box.x - pad),
              y: Math.max(0, box.y - pad),
              width: box.width + 2 * pad,
              height: box.height + 2 * pad,
            }
          : undefined,
      });
      await p.close();
    }
  } finally {
    await browser.close();
  }
  return `${String(shots.length)} picture(s)`;
}
