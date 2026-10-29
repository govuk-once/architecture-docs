/**
 * The architecture as one page, for the people who read Confluence and not the explorer.
 *
 * One page per project, generated from the model and the built page: each diagram with
 * its words and its picture, the reference tabs listed, the planned states pointed at the
 * review page. Rewritten on every build; nothing on it is edited by hand. Three forms of
 * each, in export/<id>/: `overview.html` in storage format for `pnpm confluence`,
 * `overview-preview.html` to read in a browser, and `overview-paste.html` to copy into the
 * Confluence editor by hand, pictures embedded. Beside them, export/index/ holds the page
 * over the projects, the parent of the others when they are pasted.
 *
 *   pnpm overview            every project
 *   pnpm overview flex       one of them
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { View } from "./buildArchitectureExplorer.js";
import { loadLikeC4Views } from "./lib/loadLikeC4Views.js";
import {
  indexPage,
  indexPicture,
  overviewPage,
  overviewPicture,
} from "./lib/overviewText.js";
import {
  attachment,
  embedded,
  inline,
  pasteShell,
  previewShell,
  snapshots,
} from "./lib/pages.js";
import { DOCS_ROOT, SITE_CONFIG, SITE_INDEX } from "./lib/paths.js";
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

const live = (href: string) => `${SITE_CONFIG.site.url ?? ""}${href}`;

/** The page over the projects, for pasting: the parent of every overview page. */
async function exportIndex(projects: Project[]): Promise<void> {
  const dir = path.join(DOCS_ROOT, "export", "index");
  mkdirSync(dir, { recursive: true });
  const entries = projects.map((p) => ({
    name: p.config.name,
    tagline: p.config.tagline,
    blurb: p.config.blurb,
    url: live(p.href),
    pageTitle: titlesOf(p).overview,
  }));
  const drawn = SITE_CONFIG.fit
    ? await snapshots(
        {
          id: "index",
          pagePath: SITE_INDEX,
          clip: ".scroll svg",
          hide: ".note",
        },
        [{ file: indexPicture, hash: "" }],
        dir,
      )
    : "no fit sketch to picture";
  const page = pasteShell(
    { title: SITE_CONFIG.title, folder: path.relative(DOCS_ROOT, dir) },
    indexPage(SITE_CONFIG, entries, live(""), embedded(dir)),
  );
  writeFileSync(path.join(dir, "index-paste.html"), page);
  console.log(
    `index: wrote ${path.relative(DOCS_ROOT, dir)}/index-paste.html, ${drawn}`,
  );
}

export async function main(argv: string[]): Promise<void> {
  const projects = selectProjects(argv);
  for (const project of projects) {
    const views = (await loadLikeC4Views(project)) as unknown as View[];
    const states = loadStates(project);
    const dir = path.join(DOCS_ROOT, "export", project.id);
    mkdirSync(dir, { recursive: true });
    const url = live(project.href);
    const titles = titlesOf(project);
    const page = (image: (f: string) => string) =>
      overviewPage(project, views, states, url, image, titles.review);
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
    /* After the pictures, because this one carries them. */
    writeFileSync(
      path.join(dir, "overview-paste.html"),
      pasteShell(
        {
          title: titles.overview,
          parent: SITE_CONFIG.title,
          folder: path.relative(DOCS_ROOT, dir),
        },
        page(embedded(dir)),
      ),
    );
    console.log(
      `${project.id}: wrote ${path.relative(DOCS_ROOT, dir)}/overview.html, overview-preview.html and overview-paste.html, ${drawn}`,
    );
  }
  /* The index is over every project, so only a run over all of them writes it. */
  if (projects.length === selectProjects([]).length)
    await exportIndex(projects);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main(process.argv.slice(2));
