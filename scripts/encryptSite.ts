/**
 * Seal the built site behind a password, in place.
 *
 * Run by the deploy job with SITE_PASSWORD from the github-pages environment: every HTML
 * file under site/ becomes a page that asks for the password and decrypts in the browser.
 * With no password set it does nothing and says so, and the site publishes as it is. The
 * build, the render check and the exports never see this: they run on the plain site.
 *
 *   SITE_PASSWORD=… pnpm encrypt-site       seal site/ in place
 *   pnpm encrypt-site --password …          the same, from the command line
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { encryptPage } from "./lib/encryptPage.js";
import { DOCS_ROOT, SITE_CONFIG, SITE_ROOT } from "./lib/paths.js";

function* htmlFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* htmlFiles(full);
    else if (entry.endsWith(".html")) yield full;
  }
}

export function main(argv: string[]): void {
  const at = argv.indexOf("--password");
  const password = at >= 0 ? argv[at + 1] : process.env.SITE_PASSWORD;
  if (!password) {
    console.log("no SITE_PASSWORD: the site publishes as it is");
    return;
  }
  const files = [...htmlFiles(SITE_ROOT)];
  for (const file of files) {
    const html = readFileSync(file, "utf8");
    if (html.includes('id="sealed"')) continue; // already sealed: idempotent
    writeFileSync(file, encryptPage(html, password, SITE_CONFIG.title));
  }
  console.log(
    `sealed ${String(files.length)} page(s) under ${path.relative(DOCS_ROOT, SITE_ROOT)}/ behind the password`,
  );
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main(process.argv.slice(2));
