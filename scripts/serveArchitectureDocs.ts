/**
 * Serves the built site over HTTP so the architectures can be read locally instead of
 * from the published link. No dependencies — Node's http and fs only.
 *
 *   pnpm serve            builds first, then serves on http://localhost:4321
 *   pnpm serve 8080       a different port
 *   pnpm serve --edit     the same URL, plus the state editor at /editor/
 *
 * `--edit` is a different server in one important respect: it writes files. So it binds
 * loopback and nothing else, and without the flag `/editor/` and `/api/` do not exist. The
 * read-only mode is unchanged and still binds every interface, because showing a colleague
 * the docs across the room is a reasonable thing to do with it and writing files is not.
 */
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";

import {
  autofix,
  type DraftFiles,
  editorModel,
  previewPage,
  readStateFile,
  saveEdits,
  stamps,
  validateEdits,
} from "./lib/editorApi.js";
import { DOCS_ROOT, SITE_ROOT } from "./lib/paths.js";
import { loadProjects } from "./lib/projects.js";

const DOCS = SITE_ROOT;
/*
 * The last draft the editor sent, per project. Held here so the preview tab — a separate
 * document with no way to ask the editor for anything — can be a plain URL that always
 * shows the current unsaved work. It lives for the life of the process and never touches
 * disk: a draft is not a decision, and only Save makes it one.
 */
const drafts = new Map<string, DraftFiles>();
const argv = process.argv.slice(2);
const EDIT = argv.includes("--edit");
const PORT = Number(
  argv.find((a) => /^\d+$/.test(a)) ?? process.env.PORT ?? 4321,
);

/* tsx's `.bin` entry is a shell wrapper, so node cannot run it — the module's own CLI is
   the thing to spawn. Running the real build rather than importing it keeps the editor
   honest: it sees the same output and the same exit code CI would. */
const BUILD_ARGS = (project: string) => [
  path.join(DOCS_ROOT, "node_modules/tsx/dist/cli.mjs"),
  path.join(DOCS_ROOT, "scripts/buildArchitectureExplorer.ts"),
  project,
];
/* One build at a time. Two quick saves otherwise spawn two builds writing the same page,
   and whichever finishes second decides what is on disk. */
let building: Promise<unknown> = Promise.resolve();

/* The editor and the explorer's stylesheet are served out of the repo, never out of site/
   — that separation is what keeps the editor off the published pages, and lets its canvas
   paint with the explorer's own stylesheet rather than a copy of it. */
const rootFor = (p: string) =>
  EDIT && /^\/(editor|explorer)(\/|$)/.test(p) ? DOCS_ROOT : DOCS;

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

/**
 * Told to the preview tab, and to nothing else. Injected as the page is served rather than
 * written into it, so `site/` on disk is untouched and there is no path by which a reload
 * listener reaches the published artefact.
 */
const LIVE_RELOAD = `<script>
(() => {
  const ch = new BroadcastChannel("architecture-docs");
  ch.onmessage = (e) => { if (e.data === "rebuilt") location.reload(); };
})();
</script>`;

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const json = (res: ServerResponse, code: number, value: unknown) => {
  res.writeHead(code, {
    "content-type": TYPES[".json"],
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
};

/** A page with the reload listener in it, which only the editor's own server ever sends. */
const html = (res: ServerResponse, s: string) => {
  res.writeHead(200, {
    "content-type": TYPES[".html"],
    "cache-control": "no-store",
  });
  res.end(s.replace("</body>", LIVE_RELOAD + "</body>"));
};

/** The editor's routes. None of them are mounted without `--edit`. */
async function api(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const project = url.searchParams.get("project") ?? "";
  try {
    if (url.pathname === "/api/model") {
      json(res, 200, {
        ...(await editorModel(project)),
        stamps: stamps(project),
      });
      return;
    }
    if (url.pathname === "/api/file") {
      json(
        res,
        200,
        readStateFile(project, url.searchParams.get("path") ?? ""),
      );
      return;
    }
    if (url.pathname === "/api/validate" && req.method === "POST") {
      const sent = (await body(req)) as {
        files: DraftFiles;
        want?: { state: string; view: string; mode?: "future" | "changes" };
        check?: boolean;
      };
      drafts.set(project, sent.files);
      json(
        res,
        200,
        await validateEdits(project, sent.files, sent.want, sent.check ?? true),
      );
      return;
    }
    if (url.pathname === "/api/autofix" && req.method === "POST") {
      const sent = (await body(req)) as {
        files: DraftFiles;
        only?: string[];
      };
      const out = await autofix(project, sent.files, sent.only);
      drafts.set(project, out.files);
      json(res, 200, out);
      return;
    }
    if (url.pathname === "/api/save" && req.method === "POST") {
      const sent = (await body(req)) as {
        files: DraftFiles;
        stamps?: Record<string, number>;
      };
      json(res, 200, {
        ...(await saveEdits(project, sent.files, sent.stamps ?? {})),
        stamps: stamps(project),
      });
      return;
    }
    if (url.pathname === "/api/build" && req.method === "POST") {
      const run = () =>
        new Promise<{ output: string; ok: boolean }>((resolve) =>
          execFile(
            process.execPath,
            BUILD_ARGS(project),
            { cwd: DOCS_ROOT },
            (err, stdout, stderr) => {
              resolve({ output: (stdout + stderr).trim(), ok: !err });
            },
          ),
        );
      building = building.then(run);
      const out = await building;
      json(res, 200, out);
      return;
    }
    json(res, 404, { error: "no such route" });
  } catch (err) {
    json(res, 400, { error: String(err instanceof Error ? err.message : err) });
  }
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");

    /* A preview of what has not been saved. Same page, same renderer, same everything —
       only the composed states differ, and only until Save makes them real. */
    if (EDIT && /^\/preview\/[^/]+\/?$/.test(url.pathname)) {
      const id = url.pathname.split("/").filter(Boolean)[1] ?? "";
      html(res, await previewPage(id, drafts.get(id) ?? {}));
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      if (!EDIT) {
        json(res, 404, {
          error: "the editor is not running — use pnpm serve --edit",
        });
        return;
      }
      await api(req, res, url);
      return;
    }

    // A directory URL serves that directory's index, the way GitHub Pages does — so
    // /flex/ resolves locally exactly as it will once published.
    if (url.pathname.endsWith("/")) url.pathname += "index.html";
    /* And a directory named without its trailing slash redirects to it, which is also what
       Pages does. Without this, typing /editor or /flex got a bare 404 and looked for all
       the world like the thing had not been built. */ else if (
      !path.extname(url.pathname)
    ) {
      const dir = path.join(
        rootFor(url.pathname),
        decodeURIComponent(url.pathname),
      );
      const asDir = await stat(dir).catch(() => null);
      if (asDir?.isDirectory()) {
        res.writeHead(302, { location: url.pathname + "/" + url.search });
        res.end();
        return;
      }
    }

    const root = rootFor(url.pathname);
    // Resolve inside the served root only — a request must not escape it.
    const target = path.join(root, decodeURIComponent(url.pathname));
    if (!target.startsWith(root + path.sep)) {
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
    const content = await readFile(target);
    if (EDIT && root === DOCS && target.endsWith(".html")) {
      html(res, content.toString("utf8"));
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(target)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(content);
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
}

const server = createServer((req, res) => {
  void handle(req, res);
});
const ready = () => {
  // The index over the projects is the site root, and every project page is one level
  // down at /<id>/. Printing the front door and the way in beats printing every project.
  console.log(`\n  Architectures   http://localhost:${String(PORT)}/`);
  for (const project of loadProjects())
    console.log(
      `  ${project.id.padEnd(14)}  http://localhost:${String(PORT)}/${project.href}`,
    );
  if (EDIT) {
    console.log(`\n  State editor    http://localhost:${String(PORT)}/editor/`);
    for (const project of loadProjects())
      console.log(
        `  Preview draft   http://localhost:${String(PORT)}/preview/${project.id}/`,
      );
    console.log(`  Writing to      projects/<id>/states/ · loopback only`);
  }
  console.log("");
};
if (EDIT) server.listen(PORT, "127.0.0.1", ready);
else server.listen(PORT, ready);
