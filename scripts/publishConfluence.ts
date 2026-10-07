/**
 * Put the architecture overview where the people are.
 *
 * One page per project that names a Confluence space in its config: the architecture
 * overview, rewritten on every build. It is exported as `pnpm overview` does, then created
 * or updated with its pictures attached — only when it would change, because every update
 * notifies the page's watchers. The review page for the planned states goes beneath it from
 * govuk-once/architecture-docs-states, which finds this page by its title. Runs after each build of main from .github/workflows/confluence.yml,
 * and by hand from a machine with the three variables set.
 *
 *   CONFLUENCE_BASE_URL   https://<site>.atlassian.net/wiki
 *   CONFLUENCE_USER       the account's email
 *   CONFLUENCE_TOKEN      an API token for that account
 *
 *   pnpm confluence              every configured project
 *   pnpm confluence flex         one of them
 *   pnpm confluence --dry-run    say what would happen, write nothing
 *   pnpm confluence --force      publish even when nothing changed
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { main as exportOverview, titlesOf } from "./exportOverview.js";
import {
  type Attachment,
  type Outcome,
  publish,
  type Site,
} from "./lib/confluence.js";
import { DOCS_ROOT } from "./lib/paths.js";
import { selectProjects } from "./lib/projects.js";

const pictures = (dir: string, prefix: string): Attachment[] =>
  readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".png"))
    .sort()
    .map((name) => ({
      name,
      bytes: new Uint8Array(readFileSync(path.join(dir, name))),
    }));

const said = (out: Outcome, title: string, space: string, base: string) => {
  const where = out.page?.url ?? `${base}/spaces/${space}`;
  const n = String(out.attachments.length);
  return {
    unchanged: `unchanged — nothing written (${where})`,
    created: `created ${where}`,
    updated: `updated ${where} (version ${String(out.page?.version ?? "?")})`,
    "would-create": `would create "${title}" in ${space} with ${n} picture(s)`,
    "would-update": `would update ${where} with ${n} picture(s)`,
  }[out.action];
};

export async function main(argv: string[]): Promise<void> {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const ids = argv.filter((a) => !a.startsWith("--"));
  const projects = selectProjects(ids).filter((p) => p.config.confluence);
  if (!projects.length) {
    console.log(
      "nothing to publish: no project names a Confluence space under `confluence` in its config",
    );
    return;
  }
  const base = process.env.CONFLUENCE_BASE_URL?.replace(/\/$/, "");
  const user = process.env.CONFLUENCE_USER;
  const token = process.env.CONFLUENCE_TOKEN;
  if (!base || !user || !token)
    throw new Error(
      "CONFLUENCE_BASE_URL, CONFLUENCE_USER and CONFLUENCE_TOKEN must all be set",
    );
  const site: Site = {
    base,
    auth: Buffer.from(`${user}:${token}`).toString("base64"),
  };
  const opts = {
    force: flags.has("--force"),
    dryRun: flags.has("--dry-run"),
    note: {
      commit: process.env.GITHUB_SHA ?? "local",
      at: new Date().toISOString(),
    },
  };

  const named = projects.map((p) => p.id);
  await exportOverview(named);

  for (const project of projects) {
    const conf = project.config.confluence;
    if (!conf) continue;
    const dir = path.join(DOCS_ROOT, "export", project.id);
    const titles = titlesOf(project);
    const report = (out: Outcome, title: string) => {
      console.log(
        `${project.id}: ${title} — ${said(out, title, conf.space, base)}`,
      );
      if (out.madeParents.length)
        console.log(
          `  ${out.action.startsWith("would") ? "would make" : "made"} the parent page(s) ${out.madeParents.join(" / ")}`,
        );
      for (const a of out.attachments)
        if (a.action !== "kept") console.log(`  ${a.action} ${a.name}`);
    };

    const overview = await publish(
      site,
      {
        space: conf.space,
        parent: conf.parent,
        title: titles.overview,
        body: readFileSync(path.join(dir, "overview.html"), "utf8"),
        attachments: pictures(dir, "overview-"),
      },
      opts,
    );
    report(overview, titles.overview);
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly)
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exitCode = 1;
  });
