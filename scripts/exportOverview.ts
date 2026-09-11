/**
 * The architecture as one page, for the people who read Confluence and not the explorer.
 *
 * One page per project, generated from the model and the built page: each diagram with
 * its words and its picture, the reference tabs listed, the planned states pointed at the
 * review page. Rewritten on every build; nothing on it is edited by hand.
 *
 *   pnpm overview            every project
 *   pnpm overview flex       one of them
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { View } from "./buildArchitectureExplorer.js";
import { loadLikeC4Views } from "./lib/loadLikeC4Views.js";
import { overviewPage, overviewPicture } from "./lib/overviewText.js";
import { attachment, inline, previewShell, snapshots } from "./lib/pages.js";
import { DOCS_ROOT, SITE_CONFIG } from "./lib/paths.js";
import { type Project, selectProjects } from "./lib/projects.js";
import { loadStates } from "./lib/states.js";

/** The two page titles, as the config sets them or as they default. */
export const titlesOf = (project: Project) => ({
  overview:
    project.config.confluence?.overviewTitle ??
    `${project.config.name} — architecture`,
  review:
    project.config.confluence?.reviewTitle ??
    `${project.config.name} — planned states, for comment`,
});

export async function main(argv: string[]): Promise<void> {
  for (const project of selectProjects(argv)) {
    const views = (await loadLikeC4Views(
      project.modelDir,
    )) as unknown as View[];
    const states = loadStates(project);
    const dir = path.join(DOCS_ROOT, "export", project.id);
    mkdirSync(dir, { recursive: true });
    const live = `${SITE_CONFIG.site.url ?? ""}${project.href}`;
    const titles = titlesOf(project);
    const page = (image: (f: string) => string) =>
      overviewPage(project, views, states, live, image, titles.review);
    writeFileSync(path.join(dir, "overview.html"), page(attachment) + "\n");
    writeFileSync(
      path.join(dir, "overview-preview.html"),
      previewShell(titles.overview, page(inline)),
    );
    const drawn = await snapshots(
      project,
      views
        .filter((v) => v.nodes)
        .map((v) => ({ file: overviewPicture(v), hash: `#tab=${v.id}` })),
      dir,
    );
    console.log(
      `${project.id}: wrote ${path.relative(DOCS_ROOT, dir)}/overview.html and overview-preview.html, ${drawn}`,
    );
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main(process.argv.slice(2));
