/**
 * The three roots this package works against, kept deliberately separate.
 *
 * - `DOCS_ROOT`   — this repository: the model, the config, the scripts, the facts file.
 * - `SITE_ROOT`   — where the built site is assembled for GitHub Pages. Generated and
 *                   gitignored; nothing in it is a source file.
 * - `SOURCE_ROOT` — the FLEX checkout being documented, which lives outside this
 *                   repository entirely and is read, never written.
 *
 * Both are declared in `explorer.config.json` — `site` and `source` — so the layout is
 * stated in one file rather than assumed by each script. `source.root` is the only thing
 * that has to change to document a checkout somewhere else, and CI sets it by placing the
 * checkout where it already points.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const DOCS_ROOT = path.resolve(import.meta.dirname, "../..");

const CONFIG_PATH = path.join(DOCS_ROOT, "explorer/explorer.config.json");

/** Where the built site is assembled, and what the explorer is called inside it. */
export interface SiteContract {
  root: string;
  page: string;
}

/** Everything this repository reads out of the FLEX source, declared in one place. */
export interface SourceContract {
  /** The repository to clone, and the ref to track — see scripts/syncSource.ts. */
  repo: string;
  ref: string;
  /** Where the checkout lives, relative to this repository. Disposable and gitignored. */
  root: string;
  /** Imported as modules — these are the files the CDK app itself reads. */
  domainConfigs: string;
  gatewayConfigs: string;
  /** Read as text and parsed, so this one needs no install in the checkout. */
  alarmConstructs: string;
}

function readConfig(): {
  source: SourceContract;
  site: SiteContract;
} {
  let parsed: {
    source?: Partial<SourceContract>;
    site?: Partial<SiteContract>;
  };
  try {
    parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as typeof parsed;
  } catch (err) {
    throw new Error("explorer.config.json is missing or not valid JSON", {
      cause: err,
    });
  }
  const { source, site } = parsed;
  const missingSource = (
    [
      "repo",
      "ref",
      "root",
      "domainConfigs",
      "gatewayConfigs",
      "alarmConstructs",
    ] as const
  ).filter((k) => typeof source?.[k] !== "string" || !source[k]);
  if (!source || missingSource.length)
    throw new Error(
      `explorer.config.json: "source" needs ${missingSource.join(", ")} — this is where ` +
        `the FLEX checkout and the files read from it are declared.`,
    );
  const missingSite = (["root", "page"] as const).filter(
    (k) => typeof site?.[k] !== "string" || !site[k],
  );
  if (!site || missingSite.length)
    throw new Error(
      `explorer.config.json: "site" needs ${missingSite.join(", ")} — this is where the ` +
        `built site is assembled.`,
    );
  return { source: source as SourceContract, site: site as SiteContract };
}

const config = readConfig();

export const SOURCE = config.source;
export const SITE = config.site;

export const SOURCE_ROOT = path.resolve(DOCS_ROOT, SOURCE.root);
export const SITE_ROOT = path.resolve(DOCS_ROOT, SITE.root);

/** The built explorer, inside the site. */
export const SITE_PAGE = path.join(SITE_ROOT, SITE.page);

/**
 * A wrong `source.root` otherwise surfaces as an empty facts file or a citation check that
 * fails on every path at once, which reads as the docs being broken rather than pointed at
 * the wrong place. Fail here instead, naming what was expected and where it looked.
 */
export function assertSourceRoot(): void {
  const probe = path.join(SOURCE_ROOT, SOURCE.alarmConstructs);
  if (!existsSync(probe))
    throw new Error(
      `No source checkout at ${SOURCE.root} — expected to find ` +
        `${SOURCE.alarmConstructs} there. Run \`pnpm sync\` to pull ${SOURCE.repo}.`,
    );
}

/** Resolve a repo-relative path — a citation, a glob root — inside the FLEX checkout. */
export const inSource = (...rel: string[]) => path.join(SOURCE_ROOT, ...rel);

/** Resolve a path inside this repository. */
export const inDocs = (...rel: string[]) => path.join(DOCS_ROOT, ...rel);
