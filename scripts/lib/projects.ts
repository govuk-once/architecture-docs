/**
 * One documented architecture: its configuration, its model, and the checkouts it reads.
 *
 * Everything under `projects/<id>/` belongs to one architecture — the LikeC4 model, the
 * derived facts, the commits they were derived from, and the config that names the source
 * repositories. Everything under `explorer/` is the renderer, and knows about none of them.
 * That split is the whole of what makes a second project an addition rather than a fork:
 * adding one is a directory here and a line in the site config, and no script learns
 * anything new.
 *
 * This file is the only place that resolves a project's paths. A script asks for the
 * projects it was told to work on and gets records that already know where everything is,
 * so nothing else has to know that facts live beside the model or that a page is built to
 * `site/<id>/`.
 *
 * An architecture may be read from one repository or from several. FLEX is one; the GOV.UK
 * App is two apps, a backend and a config repository. With one, a citation is a path in
 * it. With several, every citation names its repository first — `ios:Production/…` — and
 * nothing is inferred: a path that could belong to any of four checkouts is a claim nobody
 * can check.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { DOCS_ROOT, inDocs, SITE, SITE_CONFIG, SITE_ROOT } from "./paths.js";

/** Where one source lives: the repository, the ref to track, and where it is checked out. */
export interface SourceContract {
  /** The repository to clone, and the ref to track — see scripts/syncSource.ts. */
  repo: string;
  ref: string;
  /** Where the checkout lands, relative to this repository. Disposable, gitignored. */
  root: string;
  /**
   * Base URL a citation into this source links against, ending in `/`. Required for each of
   * `sources`; a single `source` takes the project's `repo` instead.
   */
  url?: string;
}

/** One checkout a project reads, resolved. */
export interface Source {
  /**
   * How a citation names it — `ios` in `ios:Production/…`. The one source of a
   * single-source project takes the project's id, and is never named in a citation.
   */
  id: string;
  repo: string;
  ref: string;
  root: string;
  /** Base URL for links into it, ending in `/`. */
  url: string;
  /** The checkout, as an absolute path. */
  dir: string;
}

/**
 * One number the build vouches for, read out of CloudFormation templates. The vocabulary
 * is closed on purpose: a count that needs more than this is a claim for prose, cited to
 * the code, not a number the build should pretend to know.
 */
export interface CountSpec {
  /** The CloudFormation type to count, e.g. `AWS::Lambda::Function`. */
  type: string;
  /** Regex over the template name (file name minus `.template.json`); `{stage}`/`{id}` fill. */
  template?: string;
  /** Regex over the logical id. */
  logicalId?: string;
  /** Count only resources that set this property, e.g. `PermissionsBoundary`. */
  hasProperty?: string;
  /** Regex with a `name` group: one per-stage record per matching template, keyed by it. */
  perTemplate?: string;
  /** Count templates that contain a match, rather than the matches. */
  templatesContaining?: boolean;
  /** Emit one entry per distinct construct rather than a number — for tables. */
  distinctBy?: "construct";
  /** Regex → name: fold the construct's parent into a source name a table can show. */
  scopeAliases?: Record<string, string>;
  /** Properties to copy out of a `distinctBy` entry, as strings. */
  capture?: string[];
}

/**
 * How this project's facts are derived, if they are at all.
 *
 * `module` names a file in `scripts/derive/`; `cloudformation` is the one that ships,
 * and `counts` is what it reads. A project with no `derive` block simply has no
 * generated facts: every check that reads them skips, and its counts are maintained by
 * hand like any other prose.
 */
export interface DeriveContract {
  module: string;
  inputs: Record<string, string>;
  counts?: Record<string, CountSpec>;
}

/**
 * How to turn the checkout into templates — see scripts/synthSource.ts. `command` is an
 * argv array, never a shell string. `{stage}` in `env` values and `output` is the value a
 * stage's `synth` field takes; `{id}` is the stage's id here.
 */
export interface SynthContract {
  /** Relative to the checkout: where the CDK app lives. Names its source, with several. */
  cwd: string;
  command: string[];
  env: Record<string, string>;
  output: string;
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
  /** Base URL every `code` citation links against, with one `source`. */
  repo?: string;
  inventoryView: string;
  /** What the inventory counts, e.g. "AWS resources" — shown wherever a box totals them. */
  inventoryLabel: string;
  iconLabel: string;
  filterHint: string;
  /**
   * The two planes a node sits on, as the legend words them. Defaults to the request-path
   * framing, which is what the `#request-path` / `#off-request-path` tags mean.
   */
  planes?: { request: string; control: string };
  /**
   * How much soft geometry — edge crossings, labels touching — this project's diagrams
   * are allowed. A ratchet the render check holds them to: it may fall, never rise. Zero
   * when unset, so a new project is told the number to lock in rather than inheriting
   * somebody else's slack.
   */
  softBudget?: number;
  /** Ratchet for the placement rules in CANVAS.md — same rule: it may fall, never rise. */
  placementBudget?: number;
  /** The same two ratchets, for the views composed from states/. */
  stateSoftBudget?: number;
  statePlacementBudget?: number;
  kinds: { id: string; label: string; colour: string }[];
  /**
   * `synth` is the value the source's stage variable takes; a stage without one is not
   * synthesised. `parameters` are the template parameters that stage deploys with, for a
   * template read as written rather than synthesised — they decide which `Condition` holds.
   */
  stages: {
    id: string;
    label: string;
    facts: string;
    synth?: string;
    parameters?: Record<string, string>;
  }[];
  /** The one repository this architecture is read from. */
  source?: SourceContract;
  /** Or several, by the name a citation uses for each. Exactly one of the two. */
  sources?: Record<string, SourceContract>;
  derive?: DeriveContract;
  synth?: SynthContract;
  /**
   * Where this project's pages go in Confluence, when they go: the architecture overview,
   * and the review page beneath it. The space key is the one thing that cannot be guessed.
   * `parent` places the overview the first time only: a page id, or a path of titles such
   * as "Architecture / FLEX", found in the space and made where missing. The titles
   * default to "<name> — architecture" and "<name> — planned states, for comment".
   */
  confluence?: {
    space: string;
    parent?: string;
    overviewTitle?: string;
    reviewTitle?: string;
  };
}

/** A loaded project, and every path that belongs to it. */
export interface Project {
  id: string;
  config: ProjectConfig;
  /** Every checkout it reads, in the order the config declares them. */
  sources: Source[];
  /** Whether a citation must name its source — true exactly when the config says `sources`. */
  qualified: boolean;
  derive: DeriveContract | null;
  /** projects/<id>/ */
  dir: string;
  modelDir: string;
  factsPath: string;
  statePath: string;
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
  "inventoryView",
  "inventoryLabel",
  "iconLabel",
  "filterHint",
] as const;

const DEFAULT_PLANES = {
  request: "on the request path",
  control: "off the request path",
};

/** A source's name, and the prefix a citation carries: `ios:` in `ios:Production/…`. */
const SOURCE_ID = /^[a-z][a-z0-9-]*$/;
const QUALIFIED = /^([a-z][a-z0-9-]*):(.+)$/;

function checkSource(
  id: string,
  where: string,
  src: SourceContract | undefined,
  needsUrl: boolean,
): void {
  const keys = needsUrl
    ? (["repo", "ref", "root", "url"] as const)
    : (["repo", "ref", "root"] as const);
  const missing = keys.filter((k) => typeof src?.[k] !== "string" || !src[k]);
  if (!src || missing.length)
    throw new Error(
      `projects/${id}: ${where} needs ${missing.join(", ")} — this is a ` +
        `repository the architecture is read from.`,
    );
  if (src.url !== undefined && !src.url.endsWith("/"))
    throw new Error(
      `projects/${id}: ${where}.url must end in "/" — a citation's path is appended to it`,
    );
}

/**
 * The config, held to the contract. Pure, and exported so the refusals can be tested
 * without a project directory for each one.
 */
export function validateConfig(id: string, raw: unknown): ProjectConfig {
  const cfg = (raw ?? {}) as Partial<ProjectConfig>;
  const blank = STRINGS.filter((k) => {
    const v = cfg[k];
    return typeof v !== "string" || !v.trim();
  });
  if (blank.length)
    throw new Error(`projects/${id}: config has no ${blank.join(", ")}`);

  if (cfg.source && cfg.sources)
    throw new Error(
      `projects/${id}: declares both "source" and "sources" — one repository is ` +
        `"source", several are "sources"`,
    );
  if (cfg.sources) {
    const entries = Object.entries(cfg.sources);
    if (!entries.length)
      throw new Error(`projects/${id}: "sources" names no repository`);
    if (cfg.repo !== undefined)
      throw new Error(
        `projects/${id}: "repo" is for a single source — with "sources", each one ` +
          `carries its own url`,
      );
    for (const [name, src] of entries) {
      if (!SOURCE_ID.test(name))
        throw new Error(
          `projects/${id}: source "${name}" must be lowercase kebab-case — a citation ` +
            `names it as ${name}:path`,
        );
      checkSource(id, `sources.${name}`, src, true);
    }
    const roots = entries.map(([, s]) => path.normalize(s.root));
    if (new Set(roots).size !== roots.length)
      throw new Error(
        `projects/${id}: two sources share a root — each needs its own checkout`,
      );
  } else {
    checkSource(id, `"source"`, cfg.source, false);
    if (typeof cfg.repo !== "string" || !cfg.repo.trim())
      throw new Error(`projects/${id}: config has no repo`);
  }

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
  for (const st of cfg.stages)
    for (const [k, v] of Object.entries(st.parameters ?? {}))
      if (typeof v !== "string")
        throw new Error(
          `projects/${id}: stage "${st.id}" parameter ${k} must be a string, as ` +
            `CloudFormation passes it`,
        );

  for (const key of [
    "softBudget",
    "placementBudget",
    "stateSoftBudget",
    "statePlacementBudget",
  ] as const)
    if (cfg[key] !== undefined && !Number.isInteger(cfg[key]))
      throw new Error(`projects/${id}: ${key} must be a whole number`);

  const confluence = cfg.confluence;
  if (confluence && !confluence.space.trim())
    throw new Error(`projects/${id}: confluence needs a space key`);

  const derive = cfg.derive;
  if (derive && (!derive.module || typeof derive.inputs !== "object"))
    throw new Error(
      `projects/${id}: "derive" needs a module in scripts/derive/ and an inputs object`,
    );
  for (const [name, spec] of Object.entries(derive?.counts ?? {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name))
      throw new Error(`projects/${id}: count "${name}" must be an identifier`);
    if (!spec.type)
      throw new Error(`projects/${id}: count "${name}" needs a type`);
    for (const k of ["template", "logicalId", "perTemplate"] as const)
      if (spec[k] !== undefined) new RegExp(spec[k]);
    for (const re of Object.keys(spec.scopeAliases ?? {})) new RegExp(re);
  }
  const synth = cfg.synth;
  if (synth) {
    if (!synth.command.length)
      throw new Error(`projects/${id}: synth.command must be an argv array`);
    if (!synth.cwd || !synth.output)
      throw new Error(`projects/${id}: synth needs cwd and output`);
    for (const st of cfg.stages)
      if (st.synth !== undefined && !st.synth)
        throw new Error(
          `projects/${id}: stage "${st.id}" has an empty synth value`,
        );
  }
  return { ...(cfg as ProjectConfig), planes: cfg.planes ?? DEFAULT_PLANES };
}

function readConfig(id: string, file: string): ProjectConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(
      `projects/${id}/project.config.json is missing or not valid JSON`,
      { cause: err },
    );
  }
  return validateConfig(id, raw);
}

/** The checkouts a config names, resolved against this repository. */
export function resolveSources(id: string, config: ProjectConfig): Source[] {
  const at = (s: SourceContract, name: string, url: string): Source => ({
    id: name,
    repo: s.repo,
    ref: s.ref,
    root: s.root,
    url,
    dir: path.resolve(DOCS_ROOT, s.root),
  });
  if (config.sources)
    return Object.entries(config.sources).map(([name, s]) =>
      at(s, name, s.url ?? ""),
    );
  const one = config.source as SourceContract;
  return [at(one, id, one.url ?? config.repo ?? "")];
}

/**
 * A project directory read as a project. Exported so `projects/_template` — which no
 * site config lists, and which nothing therefore builds — can still be held to the same
 * contract as a real one.
 */
export function toProject(id: string): Project {
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
    sources: resolveSources(id, config),
    qualified: config.sources !== undefined,
    derive: config.derive ?? null,
    dir,
    modelDir: path.join(dir, "model"),
    // The build owns everything under derived/; nothing there is edited by hand.
    factsPath: path.join(dir, "derived", "architecture-facts.json"),
    statePath: path.join(dir, "derived", "architecture-source.json"),
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
    ? [
        Object.values(project.derive.inputs).join(", "),
        // The counts and the synth recipe are inputs too: change either, re-derive.
        ...(project.derive.counts
          ? [`counts=${JSON.stringify(project.derive.counts)}`]
          : []),
        ...(project.config.synth
          ? [`synth=${JSON.stringify(project.config.synth)}`]
          : []),
      ].join(" ")
    : "nothing derived — this project's counts are prose";

/** A path inside one of a project's checkouts. */
export interface Located {
  source: Source;
  /** Relative to that checkout. */
  path: string;
}

/**
 * Which checkout a repository-relative path — a citation, a glob, synth's cwd — is in.
 *
 * With one source every path is in it, and nothing is parsed: a colon is a legal
 * character in a path. With several, the path must name its source, and null means it
 * named none or one the project does not read. There is no default source to fall back
 * on, because a default is exactly how a claim ends up checked against the wrong
 * repository and found true.
 */
export function locate(
  project: Pick<Project, "sources" | "qualified">,
  rel: string,
): Located | null {
  const [only] = project.sources;
  if (!project.qualified) return only ? { source: only, path: rel } : null;
  const m = QUALIFIED.exec(rel);
  const source = m ? project.sources.find((s) => s.id === m[1]) : undefined;
  return source && m?.[2] ? { source, path: m[2] } : null;
}

/** `locate` for a path the config gives, where naming no source is a config error. */
export function locateOrThrow(
  project: Project,
  rel: string,
  what: string,
): Located {
  const at = locate(project, rel);
  if (!at)
    throw new Error(
      `projects/${project.id}: ${what} "${rel}" names no source it reads — ` +
        `write it as <source>:<path>, one of ${project.sources.map((s) => s.id).join(", ")}`,
    );
  return at;
}

/** Resolve a repository-relative path to a file on disk, or null when it names no source. */
export function inSource(project: Project, rel: string): string | null {
  const at = locate(project, rel);
  return at ? path.join(at.source.dir, at.path) : null;
}

/**
 * The citation a link in the model stands for: a path in the source whose URL it starts
 * with — named by its source when the project reads several. A link into any other
 * repository comes back unchanged, still absolute, so the build can refuse it by name
 * rather than check its path against a checkout it was never in.
 */
export function citationFor(
  project: Pick<Project, "sources" | "qualified">,
  url: string,
): string {
  const longestFirst = [...project.sources].sort(
    (a, b) => b.url.length - a.url.length,
  );
  for (const s of longestFirst)
    if (s.url && url.startsWith(s.url)) {
      const rest = url.slice(s.url.length);
      return project.qualified ? `${s.id}:${rest}` : rest;
    }
  return url;
}

/**
 * A missing or wrong `root` otherwise surfaces as an empty facts file or a citation
 * check that fails on every path at once, which reads as the docs being broken rather
 * than pointed at nothing. Fail here instead, naming what was expected and where.
 *
 * The probe is the checkout's own `.git`, not a file inside it, because what counts as a
 * file inside it is the one thing that differs between projects.
 */
export function assertCheckout(project: Project, source: Source): void {
  const which = project.qualified ? `source "${source.id}"` : "source";
  if (!existsSync(path.join(source.dir, ".git")))
    throw new Error(
      `No checkout of ${project.id}'s ${which} at ${source.root} — run ` +
        `\`pnpm sync ${project.id}\` to pull ${source.repo}.`,
    );
}

/** Every checkout a project reads has to be there. */
export function assertCheckouts(project: Project): void {
  for (const s of project.sources) assertCheckout(project, s);
}

/** How a log line names one source: the project, and the source when there are several. */
export const sourceLabel = (project: Project, source: Source) =>
  project.qualified ? `${project.id} · ${source.id}` : project.id;
