/**
 * One documented architecture: its configuration, its model, and the checkout it reads.
 *
 * Everything under `projects/<id>/` belongs to one architecture — the LikeC4 model, the
 * derived facts, the commit they were derived from, and the config that names the source
 * repository. Everything under `explorer/` is the renderer, and knows about none of them.
 * That split is the whole of what makes a second project an addition rather than a fork:
 * adding one is a directory here and a line in the site config, and no script learns
 * anything new.
 *
 * This file is the only place that resolves a project's paths. A script asks for the
 * projects it was told to work on and gets records that already know where everything is,
 * so nothing else has to know that facts live beside the model or that a page is built to
 * `site/<id>/`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { DOCS_ROOT, inDocs, SITE, SITE_CONFIG, SITE_ROOT } from "./paths.js";

/** Where a project's source lives. Generic: every project has exactly this. */
export interface SourceContract {
  /** The repository to clone, and the ref to track — see scripts/syncSource.ts. */
  repo: string;
  ref: string;
  /** Where the checkout lands, relative to this repository. Disposable, gitignored. */
  root: string;
}

/**
 * How this project's facts are derived, if they are at all.
 *
 * `module` names a file in `scripts/derive/`, and `inputs` is that module's own contract
 * — FLEX's deriver wants three globs, another project's will want something else. A
 * project with no `derive` block simply has no generated facts: every check that reads
 * them skips, and its counts are maintained by hand like any other prose.
 */
export interface DeriveContract {
  module: string;
  inputs: Record<string, string>;
}

/** Everything true of one architecture rather than of the site or of the renderer. */
export interface ProjectConfig {
  /** Short name, for the index card and the tab title. */
  name: string;
  /** Long name, for the browser tab and the header brand. */
  title: string;
  tagline: string;
  /** One paragraph on the index card: what this architecture is. */
  blurb: string;
  /** Base URL every `code` citation links against. */
  repo: string;
  inventoryView: string;
  iconLabel: string;
  filterHint: string;
  /**
   * How much soft geometry — edge crossings, labels touching — this project's diagrams
   * are allowed. A ratchet the render check holds them to: it may fall, never rise. Zero
   * when unset, so a new project is told the number to lock in rather than inheriting
   * somebody else's slack.
   */
  softBudget?: number;
  kinds: { id: string; label: string; colour: string }[];
  stages: { id: string; label: string; facts: string }[];
  source: SourceContract;
  derive?: DeriveContract;
}

/** A loaded project, and every path that belongs to it. */
export interface Project {
  id: string;
  config: ProjectConfig;
  source: SourceContract;
  derive: DeriveContract | null;
  /** projects/<id>/ */
  dir: string;
  modelDir: string;
  factsPath: string;
  statePath: string;
  /** The checkout being documented, outside this repository. */
  sourceRoot: string;
  /** site/<id>/<page> — the built explorer, and the href the index links to. */
  pagePath: string;
  href: string;
}

const PROJECTS_DIR = inDocs("projects");

const STRINGS = [
  "name",
  "title",
  "tagline",
  "blurb",
  "repo",
  "inventoryView",
  "iconLabel",
  "filterHint",
] as const;

function readConfig(id: string, file: string): ProjectConfig {
  let cfg: Partial<ProjectConfig>;
  try {
    cfg = JSON.parse(readFileSync(file, "utf8")) as Partial<ProjectConfig>;
  } catch (err) {
    throw new Error(
      `projects/${id}/project.config.json is missing or not valid JSON`,
      { cause: err },
    );
  }
  const blank = STRINGS.filter((k) => {
    const v = cfg[k];
    return typeof v !== "string" || !v.trim();
  });
  if (blank.length)
    throw new Error(`projects/${id}: config has no ${blank.join(", ")}`);

  const src = cfg.source;
  const missingSource = (["repo", "ref", "root"] as const).filter(
    (k) => typeof src?.[k] !== "string" || !src[k],
  );
  if (!src || missingSource.length)
    throw new Error(
      `projects/${id}: "source" needs ${missingSource.join(", ")} — this is the ` +
        `repository the architecture is read from.`,
    );

  if (!cfg.kinds?.length)
    throw new Error(`projects/${id}: config has no kinds`);
  if (!cfg.stages?.length)
    throw new Error(`projects/${id}: config has no stages`);
  for (const k of cfg.kinds) {
    if (!/^[a-z][a-z0-9-]*$/.test(k.id))
      throw new Error(`projects/${id}: kind id "${k.id}" must be kebab-case`);
    if (!k.colour.trim())
      throw new Error(
        `projects/${id}: kind "${k.id}" names no colour from the palette`,
      );
  }

  if (cfg.softBudget !== undefined && !Number.isInteger(cfg.softBudget))
    throw new Error(`projects/${id}: softBudget must be a whole number`);

  const derive = cfg.derive;
  if (derive && (!derive.module || typeof derive.inputs !== "object"))
    throw new Error(
      `projects/${id}: "derive" needs a module in scripts/derive/ and an inputs object`,
    );
  return cfg as ProjectConfig;
}

function toProject(id: string): Project {
  const dir = path.join(PROJECTS_DIR, id);
  if (!existsSync(dir))
    throw new Error(
      `explorer.config.json lists "${id}", but projects/${id}/ does not exist. ` +
        `A project is a directory there with a project.config.json and a model/.`,
    );
  const config = readConfig(id, path.join(dir, "project.config.json"));
  return {
    id,
    config,
    source: config.source,
    derive: config.derive ?? null,
    dir,
    modelDir: path.join(dir, "model"),
    factsPath: path.join(dir, "architecture-facts.json"),
    statePath: path.join(dir, "architecture-source.json"),
    sourceRoot: path.resolve(DOCS_ROOT, config.source.root),
    pagePath: path.join(SITE_ROOT, id, SITE.page),
    href: `${id}/`,
  };
}

/** Every project the site publishes, in the order the index lists them. */
export function loadProjects(): Project[] {
  return SITE_CONFIG.projects.map((id) => toProject(id));
}

/**
 * The projects a command was asked to act on: the ids given as arguments, or all of them.
 *
 * Every script takes the same optional argument, so `pnpm build` and `pnpm build flex`
 * differ only in how many projects the same loop runs over — which is what keeps a
 * one-project site and a three-project site the same program.
 */
export function selectProjects(argv: string[]): Project[] {
  const ids = argv.filter((a) => !a.startsWith("-"));
  if (!ids.length) return loadProjects();
  const known = new Set(SITE_CONFIG.projects);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length)
    throw new Error(
      `No such project: ${unknown.join(", ")}. explorer.config.json lists ` +
        `${SITE_CONFIG.projects.join(", ")}.`,
    );
  return ids.map((id) => toProject(id));
}

/**
 * The inputs a project's facts are derived from, as one line.
 *
 * Recorded in architecture-source.json and compared on the next run, so pointing a
 * derivation at a different glob re-derives rather than reusing what the old one found.
 */
export const builtFrom = (project: Project) =>
  project.derive
    ? Object.values(project.derive.inputs).join(", ")
    : "nothing derived — this project's counts are prose";

/** Resolve a repo-relative path — a citation, a glob root — inside a project's checkout. */
export const inSource = (project: Project, ...rel: string[]) =>
  path.join(project.sourceRoot, ...rel);

/**
 * A missing or wrong `source.root` otherwise surfaces as an empty facts file or a
 * citation check that fails on every path at once, which reads as the docs being broken
 * rather than pointed at nothing. Fail here instead, naming what was expected and where.
 *
 * The probe is the checkout's own `.git`, not a file inside it, because what counts as a
 * file inside it is the one thing that differs between projects.
 */
export function assertSourceRoot(project: Project): void {
  if (!existsSync(path.join(project.sourceRoot, ".git")))
    throw new Error(
      `No checkout of ${project.id}'s source at ${project.source.root} — run ` +
        `\`pnpm sync ${project.id}\` to pull ${project.source.repo}.`,
    );
}
