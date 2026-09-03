/**
 * Serves the built site over HTTP so the architectures can be read locally instead of
 * from the published link. No dependencies — Node's http and fs only.
 *
 *   pnpm serve         builds first, then serves on http://localhost:4321
 *   pnpm serve 8080    a different port
 */
import { readFile, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";

import { SITE_ROOT } from "./lib/paths.js";
import { loadProjects } from "./lib/projects.js";

const DOCS = SITE_ROOT;
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4321);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    // A directory URL serves that directory's index, the way GitHub Pages does — so
    // /flex/ resolves locally exactly as it will once published.
    if (url.pathname.endsWith("/")) url.pathname += "index.html";
    // Resolve inside docs/ only — a request must not escape the served root.
    const target = path.join(DOCS, decodeURIComponent(url.pathname));
    if (!target.startsWith(DOCS + path.sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(target)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(await readFile(target));
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
}

createServer((req, res) => {
  void handle(req, res);
}).listen(PORT, () => {
  // The index over the projects is the site root, and every project page is one level
  // down at /<id>/. Printing the front door and the way in beats printing every project.
  console.log(`\n  Architectures   http://localhost:${String(PORT)}/`);
  for (const project of loadProjects())
    console.log(
      `  ${project.id.padEnd(14)}  http://localhost:${String(PORT)}/${project.href}`,
    );
  console.log("");
});
