/**
 * What the Confluence exports share: pictures taken from the built page, and the two ways
 * a page refers to one — as an attachment in storage format, as an <img> for a browser.
 *
 * The pictures are the diagrams as the page draws them, not a second drawing: the same
 * browser the render check uses opens the built page at a deep link and photographs the
 * diagram alone. Skipped, with a word, when the page is not built or the browser is not
 * installed — every export's text stands on its own.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { DOCS_ROOT } from "./paths.js";
import type { Project } from "./projects.js";

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Confluence storage format: an attachment on the page, by file name. */
export const attachment = (file: string) =>
  `<p><ac:image ac:width="900"><ri:attachment ri:filename="${esc(file)}" /></ac:image></p>`;
/** The same page for a browser, beside the PNGs. */
export const inline = (file: string) =>
  `<p><img src="${esc(file)}" style="max-width:100%;border:1px solid #e2e8f0;border-radius:8px" /></p>`;

/** A browser preview's shell, so preview.html opens as a readable page on its own. */
export const previewShell = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>` +
  `<body style="max-width:960px;margin:32px auto;font:15px/1.55 system-ui,sans-serif;color:#16212e">` +
  `<style>table{border-collapse:collapse;font-size:14px}td,th{border:1px solid #e2e8f0;padding:6px 10px;text-align:left;vertical-align:top}</style>` +
  body +
  "\n";

export interface Shot {
  /** The PNG's file name inside the export directory. */
  file: string;
  /** The page's deep link: which view, state and mode to photograph. */
  hash: string;
}

/** Photograph each deep link of the built page into `dir`. Returns a line for the log. */
export async function snapshots(
  project: Project,
  shots: Shot[],
  dir: string,
): Promise<string> {
  if (!existsSync(project.pagePath))
    return `pictures skipped: ${path.relative(DOCS_ROOT, project.pagePath)} is not built — run pnpm build first`;
  let chromium: (typeof import("playwright"))["chromium"];
  try {
    chromium = (await import("playwright")).chromium;
  } catch {
    return "pictures skipped: playwright is not installed (pnpm add -Dw playwright && pnpm exec playwright install chromium)";
  }
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1500, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: "light",
    });
    await context.addInitScript(
      `try{localStorage.setItem(${JSON.stringify(project.id)}+":intro-seen","1")}catch{}`,
    );
    for (const shot of shots) {
      /* A fresh page per picture: a fragment on the same URL is a same-document navigation
         and would not reload. */
      const p = await context.newPage();
      await p.goto(pathToFileURL(project.pagePath).href + shot.hash);
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(300);
      /* The diagram alone: the hint strip and the reference-tables bar are the page's
         furniture, and the fit leaves margins a picture does not need. */
      await p.addStyleTag({
        content: "#hint,#tables,.tbl-head{display:none!important}",
      });
      const box = await p.evaluate(() => {
        const r = document.getElementById("root")?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
      });
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
