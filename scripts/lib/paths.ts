/**
 * The roots this package works against, and the site-level configuration.
 *
 * - `DOCS_ROOT`  — this repository: the renderer, the scripts, the projects.
 * - `SITE_ROOT`  — where the built site is assembled for GitHub Pages. Generated and
 *                  gitignored; nothing in it is a source file.
 * - `SITE_INDEX` — the index page over the projects, at the root of the site.
 *
 * A project adds two more roots of its own — its directory here, and the checkout it
 * documents, which lives outside this repository entirely and is read, never written.
 * Those are in lib/projects.ts, because they are per project and these are not.
 *
 * `explorer.config.json` at the repository root is the site: what it is called, which
 * projects it publishes, and which it says are planned. Everything true of one
 * architecture rather than of the site is in that project's own `project.config.json`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const DOCS_ROOT = path.resolve(import.meta.dirname, "../..");

/** Resolve a path inside this repository. */
export const inDocs = (...rel: string[]) => path.join(DOCS_ROOT, ...rel);

const CONFIG_PATH = inDocs("explorer.config.json");

/** Where the built site is assembled, and what each page is called inside it. */
export interface SiteContract {
  root: string;
  page: string;
}

/**
 * An architecture this site intends to document and does not yet.
 *
 * It earns a card on the index so the scope is visible, and the card says plainly that
 * nothing has been read from that repository. `seenFrom` names the project whose model
 * the description was taken from, because a description of UDP written while reading
 * FLEX is evidence about FLEX, not about UDP.
 */
export interface PlannedProject {
  id: string;
  name: string;
  tagline: string;
  blurb: string;
  seenFrom?: string;
}

export interface SiteConfig {
  title: string;
  tagline: string;
  blurb: string;
  site: SiteContract;
  /** Directory names under projects/, in the order they appear on the index. */
  projects: string[];
  planned: PlannedProject[];
}

function readSiteConfig(): SiteConfig {
  let parsed: Partial<SiteConfig>;
  try {
    parsed = JSON.parse(
      readFileSync(CONFIG_PATH, "utf8"),
    ) as Partial<SiteConfig>;
  } catch (err) {
    throw new Error("explorer.config.json is missing or not valid JSON", {
      cause: err,
    });
  }
  const missing = (["title", "tagline", "blurb"] as const).filter(
    (k) => typeof parsed[k] !== "string" || !parsed[k],
  );
  if (missing.length)
    throw new Error(
      `explorer.config.json: the site needs ${missing.join(", ")} — this is what the ` +
        `index page over the projects says about itself.`,
    );
  const site = parsed.site;
  const missingSite = (["root", "page"] as const).filter(
    (k) => typeof site?.[k] !== "string" || !site[k],
  );
  if (!site || missingSite.length)
    throw new Error(
      `explorer.config.json: "site" needs ${missingSite.join(", ")} — this is where the ` +
        `built site is assembled.`,
    );
  if (!Array.isArray(parsed.projects) || !parsed.projects.length)
    throw new Error(
      `explorer.config.json: "projects" must list at least one directory under projects/.`,
    );
  for (const id of parsed.projects)
    if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id))
      throw new Error(
        `explorer.config.json: project id ${JSON.stringify(id)} must be lowercase ` +
          `kebab-case — it names a directory and a URL`,
      );
  const planned = parsed.planned ?? [];
  for (const p of planned)
    if (!p.id || !p.name || !p.tagline || !p.blurb)
      throw new Error(
        `explorer.config.json: a planned project needs id, name, tagline and blurb; ` +
          `${JSON.stringify(p)} is missing one`,
      );
  const clash = planned.filter((p) => parsed.projects?.includes(p.id));
  if (clash.length)
    throw new Error(
      `explorer.config.json: ${clash.map((p) => p.id).join(", ")} is both built and ` +
        `planned — a project that exists is not planned.`,
    );
  return { ...(parsed as SiteConfig), planned };
}

export const SITE_CONFIG = readSiteConfig();
export const SITE = SITE_CONFIG.site;

export const SITE_ROOT = path.resolve(DOCS_ROOT, SITE.root);

/** The index over the projects, at the root of the site. */
export const SITE_INDEX = path.join(SITE_ROOT, SITE.page);
