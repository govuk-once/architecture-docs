/**
 * Builds the site: one self-contained page per project, and an index over them.
 *
 *   explorer/theme.css, styles.css, shell.html, app.js, icons.svg   the renderer
 *   explorer/index.html, index.css                                  the index page
 *   projects/<id>/model/*.c4, views.json, resources.json            one architecture
 *   projects/<id>/architecture-facts.json                           its derived counts
 *        │
 *        ├─> site/index.html      the grid of architectures
 *        └─> site/<id>/index.html one self-contained page each (generated, gitignored)
 *
 * The renderer knows nothing about any project: everything specific to one arrives as
 * `CONFIG`, injected above `app.js`. That is what makes a second architecture a directory
 * under `projects/` and a line in `explorer.config.json` rather than a fork of this file.
 *
 * A page has to stay single-file: it is opened straight off disk and published as a
 * shareable artifact, neither of which can fetch a sibling file.
 *
 * Run:  pnpm build                        every project, and the index
 *       pnpm build flex                   one project, and the index
 *       pnpm build flex --body /tmp/b.html  that page without the html/head/body
 *                                           wrapper, for artifact publishing
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { check } from "prettier";

import type { Lifecycle, StateManifest, Why } from "./lib/composeStates.js";
import { loadLikeC4Views } from "./lib/loadLikeC4Views.js";
import {
  DOCS_ROOT,
  inDocs,
  SITE_CONFIG,
  SITE_INDEX,
  SITE_ROOT,
} from "./lib/paths.js";
import {
  loadProjects,
  locate,
  type Project,
  selectProjects,
} from "./lib/projects.js";
import { collectCitations } from "./lib/sourceCitations.js";
import { readStates, short } from "./lib/sourceState.js";
import {
  checkCitations,
  checkDeclarations,
  composeAll,
  foldComposed,
  loadStates,
  planned,
  stateCoverage,
  type States,
  unchangedByState,
} from "./lib/states.js";

const SRC = inDocs("explorer");
const ICONS = path.join(SRC, "icons.svg");

const asset = (name: string) => readFileSync(path.join(SRC, name), "utf8");
/**
 * Which icon a CloudFormation type implies — `service` by the `AWS::X::` namespace, `type`
 * for the few full types AWS draws distinctly. Read from explorer/icons.json, beside the
 * sprite it names into, so a vendor's mapping is data next to that vendor's artwork rather
 * than a table in the build. Read here rather than only in the renderer so the
 * unused-symbol check sees the same mapping the page does.
 */
const ICON_MAP = JSON.parse(asset("icons.json")) as {
  service: Record<string, string>;
  type: Record<string, string>;
};
const SERVICE_ICON = ICON_MAP.service;
const TYPE_ICON = ICON_MAP.type;

/** The icon a `type` string implies, if any. */
function iconForType(type: string | undefined): string | undefined {
  if (!type) return undefined;
  const exact = TYPE_ICON[type];
  if (exact) return exact;
  const ns = /^AWS::([A-Za-z0-9]+)::/.exec(type)?.[1];
  return ns ? SERVICE_ICON[ns] : undefined;
}

/**
 * One optional file holds every AWS service icon as a <symbol>. It is inlined whole, so
 * the page stays self-contained: an external sprite cannot be reached by <use> from a
 * file:// page, and would not survive being published as a standalone artifact.
 *
 * The file is absent until someone with authority over third-party artwork puts AWS's
 * icons in it. Until then nodes may still declare `icon`, the symbols simply do not
 * exist, and the toggle stays hidden.
 */
function loadIcons(): { markup: string; ids: Set<string> } {
  if (!existsSync(ICONS)) return { markup: "", ids: new Set() };
  const raw = readFileSync(ICONS, "utf8");
  const ids = new Set<string>();
  for (const m of raw.matchAll(/<symbol[^>]*\sid="i-([a-z0-9-]+)"/g))
    if (m[1]) ids.add(m[1]);
  return { markup: raw, ids };
}

/**
 * Colour is presentation, so the kind palette lives in theme.css with every other theme
 * token rather than in a project's config. What a project owns is which kinds exist —
 * which means the two can fall out of step, and a kind with no colour would draw a box
 * with no stroke and say nothing. So the build checks instead of generating: every
 * configured kind needs a `--legend-<colour>` token in all three theme blocks, and no two
 * kinds may name the same one. The rules that use them are generic — the renderer passes
 * the colour down as `--kind`, so adding a kind is one token.
 */
function checkKindStyles(project: Project): string[] {
  const css = asset("theme.css");
  const problems: string[] = [];
  const palette = new Set(
    [...css.matchAll(/--legend-([a-z0-9-]+):/g)].map((m) => m[1] ?? ""),
  );
  for (const k of project.config.kinds) {
    if (!palette.has(k.colour)) {
      problems.push(
        `theme.css: kind "${k.id}" wants --legend-${k.colour}, which the palette does not define`,
      );
      continue;
    }
    const defined = (css.match(new RegExp(`--legend-${k.colour}:`, "g")) ?? [])
      .length;
    if (defined < 3)
      problems.push(
        `theme.css: --legend-${k.colour} is defined in ${String(defined)} of the 3 theme blocks — light, dark media, dark attribute`,
      );
  }
  // Two kinds sharing a colour makes the legend unreadable.
  const used = new Map<string, string>();
  for (const k of project.config.kinds) {
    const first = used.get(k.colour);
    if (first)
      problems.push(
        `projects/${project.id}: kinds "${first}" and "${k.id}" both use --legend-${k.colour}`,
      );
    else used.set(k.colour, k.id);
  }
  return problems;
}

/**
 * Why there are no facts to check against — which is a different bug depending on whether
 * the project declares a derivation at all. One is "you have not run it yet"; the other is
 * a model claiming a number that nothing in this repository could ever produce.
 */
function noFacts(project: Project, claim: string): string {
  return project.derive
    ? `${project.id}: ${claim}, but there is no architecture-facts.json — run ` +
        `\`pnpm facts ${project.id}\``
    : `${project.id}: ${claim}, but the project declares no \`derive\` block, so nothing ` +
        `generates one. Add a derivation in scripts/derive/, or drop the binding and ` +
        `maintain the number by hand.`;
}

/** A project's derived facts, or null when it has none. The checks skip either way. */
function readFacts(project: Project): Record<string, unknown> | null {
  if (!existsSync(project.factsPath)) return null;
  try {
    return JSON.parse(readFileSync(project.factsPath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

/** One number per stage, keyed by whatever the project calls its stages in the facts. */
type StageCounts = Record<string, number>;

/** Walks a dotted path from a resource row into that project's generated facts. */
function resolvePath(
  facts: Record<string, unknown>,
  dotted: string,
): StageCounts | undefined {
  let node: unknown = facts;
  for (const key of dotted.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = Array.isArray(node)
      ? node.find((d) => {
          const o = d as { name?: string; id?: string };
          return o.name === key || o.id === key;
        })
      : (node as Record<string, unknown>)[key];
  }
  return node as StageCounts | undefined;
}

/*
 * The faces, inlined. `explorer/README.md` has always said a page has to stay single-file
 * because it is opened straight off disk and published as a shareable artifact — and until
 * now it fetched its fonts from Google on every open, which made that untrue twice over: a
 * public page documenting a government platform sent every reader's address to a third
 * party, and anybody offline got fallback metrics, which is exactly what the geometry
 * gates measure. Subset to the characters the site renders by `pnpm fonts`, which is the
 * only thing here that touches the network.
 */
function inlineFonts(): string {
  const dir = inDocs("explorer", "fonts");
  const manifest = path.join(dir, "fonts.json");
  if (!existsSync(manifest)) return "";
  const { faces } = JSON.parse(readFileSync(manifest, "utf8")) as {
    faces: { family: string; weight: string; file: string }[];
  };
  const rules = faces.map((f) => {
    const b64 = readFileSync(path.join(dir, f.file)).toString("base64");
    return (
      `@font-face{font-family:"${f.family}";font-style:normal;` +
      `font-weight:${f.weight};font-display:swap;` +
      `src:url(data:font/woff2;base64,${b64}) format("woff2")}`
    );
  });
  return `<style>${rules.join("")}</style>`;
}

/** The characters the committed faces were subset to, or none if they are absent. */
function fontCharset(): string {
  const manifest = inDocs("explorer", "fonts", "fonts.json");
  if (!existsSync(manifest)) return "";
  return (JSON.parse(readFileSync(manifest, "utf8")) as { charset: string })
    .charset;
}

/** A node fanning out to two, which is what every diagram here is a version of. */
function inlineFavicon(): string {
  const file = inDocs("explorer", "favicon.svg");
  if (!existsSync(file)) return "";
  const b64 = readFileSync(file).toString("base64");
  return `<link rel="icon" href="data:image/svg+xml;base64,${b64}">`;
}

const FONTS = inlineFonts() + "\n" + inlineFavicon();

/** The theme choice is the reader's and this is one site, so every page shares one key. */
const THEME_KEY = "arch-theme";

const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );

/*
 * Not for indexing. The pages are public because Pages is, not because they are meant to
 * be found: they describe a live system in detail, and a search hit or a training crawl
 * is the wrong way for anyone to meet them. The meta tag says so to every crawler that
 * reads pages; robots.txt at the site root says so to the ones that read that first, by
 * name for the crawlers that feed models and do not always honour the wildcard. Both are
 * requests, not walls — a public URL is public — and the repository being public says
 * what a wall here would be worth.
 */
const NO_INDEX =
  '<meta name="robots" content="noindex, nofollow, noarchive, noimageindex, nosnippet">';

const ROBOTS_TXT = [
  "# Not for indexing or training. These pages describe a live system in detail;",
  "# the source is the place to read from, not a search result or a model.",
  ...[
    "*",
    "GPTBot",
    "ChatGPT-User",
    "OAI-SearchBot",
    "ClaudeBot",
    "Claude-Web",
    "anthropic-ai",
    "Google-Extended",
    "Applebot-Extended",
    "CCBot",
    "PerplexityBot",
    "Bytespider",
    "Amazonbot",
    "cohere-ai",
    "meta-externalagent",
    "FacebookBot",
    "Diffbot",
    "omgili",
    "YouBot",
    "DuckAssistBot",
  ].flatMap((agent) => [`User-agent: ${agent}`, "Disallow: /", ""]),
].join("\n");

/** One page, wrapped. Assembled from parts rather than by slicing the body into lines. */
function page(title: string, head: string, body: string): string {
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n` +
    `<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n` +
    `${NO_INDEX}\n` +
    `<title>${esc(title)}</title>\n${FONTS}\n${head}\n</head>\n` +
    `<body>\n${body}\n</body>\n</html>\n`
  );
}
/** Whatever the project's config declares; checkGeometry holds a node to that set. */
export type Plane = "request" | "control";

/** The payload behind every clickable thing: what it is, and the code that proves it. */
export interface Detail {
  facts: string[];
  code?: string[][];
  type?: string;
  /** Names the sprite symbol outright, for a row whose `type` implies none. */
  icon?: string;
  /** Absolute links, for a row that points outside the repo — a decision record, say. */
  links?: [string, string][];
  tech?: string;
  role?: string;
  protocol?: string;
  auth?: string;
  carries?: string;
  /** Set by state composition only: what this state does to the box, and why. */
  lifecycle?: Lifecycle;
  why?: Why;
}

export interface Box {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  d: Detail;
}

export interface ViewNode extends Box {
  sub: string;
  kind: string;
  plane: Plane;
  /** AWS service icon, without the "i-" prefix. Optional. */
  icon?: string;
}

export interface Zone extends Box {
  hard: boolean;
}

export interface Edge {
  from: string;
  to: string;
  label: string;
  dir: string | null;
  style: string | null;
  d: Detail;
}

interface Table {
  name: string;
  cols: string[];
  rows: string[][];
  note?: string;
  /** Where in the repo the table was read from, shown under it as links. */
  code?: [string, string][];
  /**
   * Binds one column to a derived fact array, so a row that no longer matches the
   * code fails the build instead of quietly going stale.
   */
  derived?: { from: string; key: string; col: string };
}

/** A count is either flat, or one number per stage. */
type Count = number | Partial<Record<string, number>> | null;

interface DocItem {
  id: string;
  name: string;
  n: Count;
  /** Dotted path into that project's architecture-facts.json — the count must match. */
  from?: string;
  meta: string[];
  d: Detail;
}

interface DocGroup {
  name: string;
  note: string | null;
  table: Table | null;
  items: DocItem[];
}

export interface View {
  id: string;
  name: string;
  order: number;
  /** Optional in the type because JSON.parse cannot promise them; validated below. */
  group?: string;
  blurb: string;
  audience?: string;
  note: string;
  /** What a dashed edge means here; required iff the view draws one. */
  dashMeans?: string;
  /** Diagram views only. */
  w?: number;
  h?: number;
  zones?: Zone[];
  nodes?: ViewNode[];
  edges?: Edge[];
  tables?: Table[];
  placement?: Record<string, string[]>;
  /** Reference views only — set to "doc" by loadViews(). */
  type?: string;
  groups?: DocGroup[];
  /** Set by state composition only: the line shown under the view header. */
  stateNote?: string;
  /**
   * A reference view's own vocabulary for its rows. Without these the decisions tab wore the
   * inventory's furniture — "Resource", "Config", "37 in Development" — which is the wrong
   * noun for every one of them.
   */
  itemUnit?: string;
  itemTerms?: { type?: string; tech?: string };
}

/** Catches the class of bug where a literal <name> is eaten as an unknown HTML tag. */
function checkAngleBrackets(views: View[]) {
  const bad: string[] = [];
  const walk = (node: unknown, trail: string) => {
    if (typeof node === "string") {
      const stripped = node.replace(/<\/?(b|code|i)>/g, "");
      if (/[<>]/.test(stripped)) bad.push(`${trail}: ${node.slice(0, 90)}`);
    } else if (Array.isArray(node))
      node.forEach((v, i) => {
        walk(v, `${trail}[${String(i)}]`);
      });
    else if (node && typeof node === "object")
      for (const [k, v] of Object.entries(node)) walk(v, `${trail}.${k}`);
  };
  views.forEach((v) => {
    walk(v, v.id);
  });
  if (bad.length)
    throw new Error(
      `raw angle brackets found — use {stage}, {domain} etc instead:\n  ${bad.join("\n  ")}`,
    );
}

/**
 * Every character the page will render has to exist in the faces it carries.
 *
 * Subsetting the fonts to what the site uses buys a page a fifth the size, and costs it
 * this: a model edit that reaches for a glyph outside the set renders a blank box, and
 * nothing else here would notice. The set is generous and lives in the manifest `pnpm
 * fonts` writes, so this compares the page against exactly what was fetched.
 */
export function checkGlyphs(views: unknown, charset: string): string[] {
  const have = new Set(charset);
  const missing = new Map<string, string>();
  const walk = (node: unknown, where: string) => {
    if (typeof node === "string") {
      for (const ch of node)
        if (!have.has(ch) && ch >= " " && !missing.has(ch))
          missing.set(ch, where);
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) walk(v, where);
      return;
    }
    if (node && typeof node === "object")
      for (const [k, v] of Object.entries(node as Record<string, unknown>))
        walk(v, k === "id" || k === "name" ? String(v) : where);
  };
  walk(views, "model");
  return [...missing].map(
    ([ch, where]) =>
      `"${ch}" (U+${ch.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? ""}) ` +
      `near ${where} is not in the subset — add it to CHARSET in scripts/fetchFonts.ts ` +
      `and run \`pnpm fonts\``,
  );
}

export function checkGeometry(views: View[], kindIds: Set<string>) {
  const problems: string[] = [];
  for (const v of views) {
    const nodes = v.nodes ?? [];
    const zones = v.zones ?? [];
    for (const n of nodes) {
      if (n.w < 176)
        problems.push(
          `${v.id}/${n.id}: width ${String(n.w)} is below the 176 minimum`,
        );
      if (!n.kind)
        problems.push(
          `${v.id}/${n.id}: no ownership — set metadata ownership to one of ${[...kindIds].join(", ")}`,
        );
      else if (!kindIds.has(n.kind))
        problems.push(
          `${v.id}/${n.id}: unknown kind "${n.kind}" — this project declares ${[...kindIds].join(", ")}`,
        );
      if (!["request", "control"].includes(n.plane))
        problems.push(`${v.id}/${n.id}: unknown plane "${n.plane}"`);
      if (n.sub && n.sub.trim() === n.label.trim())
        problems.push(`${v.id}/${n.id}: sub just repeats the label`);
      // Text starts at x+16 and must clear the right edge by 6.
      // Calibrated against Chromium on Linux, which renders IBM Plex ~6% wider than
      // macOS does (mono 7.0 vs 6.6px per em-width, sans 11.0 vs 10.56). Designing to
      // the narrower platform lets labels overflow for everyone else, so these are the
      // wider numbers: sub is IBM Plex Mono at 10.5px, a fixed 6.7px advance.
      // label is proportional; 7.0 is the measured mean, so it flags only labels that
      // overflow even at average glyph width. The render harness catches the rest.
      const avail = n.w - 22;
      if (n.label && n.label.length * 7.0 > avail)
        problems.push(
          `${v.id}/${n.id}: label "${n.label}" overflows ${String(n.w)}px`,
        );
      if (n.sub && n.sub.length * 6.7 > avail)
        problems.push(
          `${v.id}/${n.id}: sub "${n.sub}" overflows ${String(n.w)}px`,
        );
    }
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (!a) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (!b) continue;
        if (
          a.x < b.x + b.w &&
          a.x + a.w > b.x &&
          a.y < b.y + b.h &&
          a.y + a.h > b.y
        )
          problems.push(`${v.id}: boxes ${a.id} and ${b.id} overlap`);
      }
    }
    // Zone labels are IBM Plex Mono 11px with .12em tracking: 7.0 + 1.32 on Linux.
    for (const z of zones)
      if (z.label && z.label.length * 8.32 > z.w - 22)
        problems.push(
          `${v.id}/${z.id}: zone label "${z.label}" overflows ${String(z.w)}px`,
        );

    for (const n of nodes)
      for (const z of zones) {
        const inside =
          n.x >= z.x &&
          n.x + n.w <= z.x + z.w &&
          n.y >= z.y &&
          n.y + n.h <= z.y + z.h;
        const touches =
          n.x < z.x + z.w &&
          n.x + n.w > z.x &&
          n.y < z.y + z.h &&
          n.y + n.h > z.y;
        if (touches && !inside)
          problems.push(`${v.id}: ${n.id} straddles the edge of zone ${z.id}`);
      }
    const ids = new Set(nodes.map((n) => n.id));
    for (const e of v.edges ?? []) {
      if (!ids.has(e.from))
        problems.push(`${v.id}: edge from unknown node "${e.from}"`);
      if (!ids.has(e.to))
        problems.push(`${v.id}: edge to unknown node "${e.to}"`);
    }
  }
  return problems;
}

/** Every derivable count must equal what the configs actually say. */
function checkDerivedCounts(project: Project, views: View[]): string[] {
  const problems: string[] = [];
  const resources = views.find((v) => v.id === project.config.inventoryView);
  // A resource says where its own count comes from, so a renamed or deleted row takes
  // its mapping with it rather than leaving a dangling key somewhere else.
  const claims = (resources?.groups ?? [])
    .flatMap((g) => g.items)
    .filter((it) => it.from);
  if (!claims.length) return problems;

  const facts = readFacts(project);
  if (!facts)
    return [noFacts(project, "model/resources.json claims a derived count")];

  for (const item of claims) {
    const id = item.id;
    const where = item.from ?? "";
    const truth = resolvePath(facts, where);
    if (!truth) {
      problems.push(`architecture-facts.json has no ${where}`);
      continue;
    }
    for (const st of project.config.stages) {
      const claimed = typeof item.n === "number" ? item.n : item.n?.[st.id];
      const actual = truth[st.facts];
      if (claimed !== actual)
        problems.push(
          `resources/${id}: says ${String(claimed)} for ${st.id}, but the configs say ` +
            `${String(actual)} (${where}.${st.facts}). Update ` +
            `projects/${project.id}/model/resources.json, or fix the config.`,
        );
    }
  }
  return problems;
}

/**
 * A reference table cites the files it was transcribed from. Those citations are the only
 * thing tying a hand-written table back to the code, so a table without one fails here;
 * whether what it cites still exists is checkSourceCitations', with every other citation.
 */
function checkTableCitations(views: View[]): string[] {
  const problems: string[] = [];
  for (const v of views)
    for (const t of v.tables ?? [])
      if (!t.code?.length)
        problems.push(`${v.id}/"${t.name}": no code citation`);
  return problems;
}

/**
 * Every citation in the model — on a box, a line, a table, an inventory row — has to name
 * a file that exists in a repository this project reads. A moved or deleted file fails
 * here: a dead link is worse than no link, because it still looks like provenance.
 *
 * A project reading several repositories adds two ways to be wrong, and both fail too: a
 * path that names no source, and a link into a repository the project does not read. The
 * second is the one that would otherwise pass — its path, checked against the wrong
 * checkout, can happen to exist there.
 */
export function checkSourceCitations(
  project: Pick<Project, "id" | "sources" | "qualified">,
  views: unknown,
): string[] {
  const problems: string[] = [];
  const unsynced = new Set<string>();
  for (const [rel, where] of collectCitations(views)) {
    const places = [...where];
    const at =
      places.slice(0, 3).join(", ") +
      (places.length > 3 ? ` and ${String(places.length - 3)} more` : "");
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rel)) {
      problems.push(
        `${at}: cites ${rel}, which is in no repository this project reads`,
      );
      continue;
    }
    const found = locate(project, rel);
    if (!found) {
      problems.push(
        `${at}: cites "${rel}", which names no source — write it as <source>:<path>, ` +
          `one of ${project.sources.map((s) => s.id).join(", ")}`,
      );
      continue;
    }
    if (!existsSync(path.join(found.source.dir, ".git"))) {
      unsynced.add(found.source.root);
      continue;
    }
    const file = path.resolve(found.source.dir, found.path);
    if (!file.startsWith(found.source.dir + path.sep))
      problems.push(`${at}: cites ${rel}, which is outside its checkout`);
    else if (!existsSync(file))
      problems.push(`${at}: cites ${rel}, which does not exist`);
  }
  for (const root of unsynced)
    problems.push(
      `${project.id}: no checkout at ${root}, so its citations cannot be checked — ` +
        `run \`pnpm sync ${project.id}\``,
    );
  return problems;
}

/**
 * A table can bind one of its columns to a derived fact array. The build then holds the
 * table to the code: an alarm added, removed or renamed in the CDK constructs breaks the
 * build here rather than leaving a table that reads as current and is not.
 */
function checkDerivedTables(project: Project, views: View[]): string[] {
  const problems: string[] = [];
  const bound = views.flatMap((v) =>
    (v.tables ?? []).flatMap((t) =>
      t.derived ? [{ v, t, d: t.derived }] : [],
    ),
  );
  if (!bound.length) return problems;

  const facts = readFacts(project);
  if (!facts)
    return [
      noFacts(project, `"${bound[0]?.t.name ?? ""}" is bound to derived facts`),
    ];

  for (const { v, t, d } of bound) {
    const { from, key, col } = d;
    const truth = resolvePath(facts, from);
    if (!Array.isArray(truth)) {
      problems.push(
        `${v.id}/"${t.name}": architecture-facts.json has no ${from}`,
      );
      continue;
    }
    const at = t.cols.indexOf(col);
    if (at < 0) {
      problems.push(
        `${v.id}/"${t.name}": no "${col}" column to bind to ${from}`,
      );
      continue;
    }
    const strip = (x: string) => x.replace(/<[^>]+>/g, "").trim();
    const claimed = t.rows.map((r) => strip(r[at] ?? ""));
    const actual = (truth as Record<string, unknown>[]).map((x) =>
      String(x[key]),
    );
    const missing = actual.filter((x) => !claimed.includes(x));
    const extra = claimed.filter((x) => !actual.includes(x));
    if (missing.length)
      problems.push(
        `${v.id}/"${t.name}": the code has ${from} not in the table: ${missing.join(", ")}`,
      );
    if (extra.length)
      problems.push(
        `${v.id}/"${t.name}": the table lists ${from} not in the code: ${extra.join(", ")}`,
      );
    if (claimed.length !== actual.length)
      problems.push(
        `${v.id}/"${t.name}": ${String(claimed.length)} rows but the code has ` +
          `${String(actual.length)} ${from}. Run \`pnpm facts ${project.id}\`, then update the table.`,
      );
  }
  return problems;
}

/**
 * The view files are committed JSON, and eslint formats JSON with prettier like anything
 * else. Checking it here means a hand-edited view fails the build immediately, rather than
 * passing locally and failing lint in CI.
 */
async function checkFormatting(project: Project): Promise<string[]> {
  const problems: string[] = [];
  // The .c4 files are checked by LikeC4 itself; these are the committed JSON beside them.
  for (const f of readdirSync(project.modelDir).filter((n) =>
    n.endsWith(".json"),
  )) {
    const file = path.join(project.modelDir, f);
    if (!(await check(readFileSync(file, "utf8"), { filepath: file })))
      problems.push(
        `${path.relative(DOCS_ROOT, file)}: not prettier-formatted — run ` +
          `pnpm exec eslint --fix ${path.relative(DOCS_ROOT, file)}`,
      );
  }
  return problems;
}

/**
 * A node may name an icon, and it must exist. Whether every symbol in the sprite is used
 * is a question about the whole site, not one project — the sprite is shared, and a
 * project that draws no AWS at all must not fail for the icons another project needs — so
 * this only reports what it used and main() judges the union.
 */
function checkIcons(
  views: View[],
  ids: Set<string>,
): { problems: string[]; used: Set<string> } {
  const problems: string[] = [];
  const used = new Set<string>();
  for (const v of views) {
    for (const n of v.nodes ?? []) {
      if (!n.icon) continue;
      used.add(n.icon);
      if (ids.size && !ids.has(n.icon))
        problems.push(
          `${v.id}/${n.id}: icon "${n.icon}" has no <symbol id="i-${n.icon}"> in icons.svg`,
        );
    }
    // Anything with a CloudFormation type picks up an icon in the inspector.
    const typed = [
      ...(v.nodes ?? []),
      ...(v.zones ?? []),
      ...(v.edges ?? []),
      ...(v.groups ?? []).flatMap((g) => g.items),
    ];
    for (const o of typed) {
      /*
       * An item may name its icon outright. Some rows stand for a service the templates
       * reach through custom resources rather than a resource type — Macie's session and
       * scan job have no CloudFormation resource at all — so there is no `AWS::X::Y` for
       * the type to imply an icon from, and the alternative is wording the type
       * inaccurately to make the artwork resolve.
       */
      const ic = o.d.icon ?? iconForType(o.d.type);
      if (!ic) continue;
      used.add(ic);
      if (o.d.icon && ids.size && !ids.has(o.d.icon))
        problems.push(
          `${v.id}: icon "${o.d.icon}" has no <symbol id="i-${o.d.icon}"> in icons.svg`,
        );
    }
  }
  return { problems, used };
}

/**
 * A dashed edge means something different on every view that uses one — a build-time
 * derivation on Components, a control on Security, a branch that gates nothing on
 * Delivery. The legend can only say which if the view says, so a view that draws a dashed
 * edge has to declare `dashMeans`, and one that declares it has to draw one.
 */
function checkDashLegend(views: View[]): string[] {
  const problems: string[] = [];
  for (const v of views) {
    const dashed = (v.edges ?? []).some((e) => e.style === "dash");
    if (dashed && !v.dashMeans?.trim())
      problems.push(
        `${v.id}: draws ${String((v.edges ?? []).filter((e) => e.style === "dash").length)} dashed edge(s) but declares no dashMeans, so the legend cannot say what dashed means here`,
      );
    if (!dashed && v.dashMeans)
      problems.push(`${v.id}: declares dashMeans but draws no dashed edge`);
  }
  return problems;
}

function checkPlacement(project: Project, views: View[]) {
  const resources = views.find((v) => v.id === project.config.inventoryView);
  if (!resources)
    return [
      `no ${project.config.inventoryView} view — placement cannot be checked`,
    ];
  const known = new Set<string>();
  for (const g of resources.groups ?? [])
    for (const it of g.items) known.add(it.id);

  const problems: string[] = [];
  const used = new Set<string>();
  for (const v of views)
    for (const [box, ids] of Object.entries(v.placement ?? {}))
      for (const id of ids) {
        used.add(id);
        if (!known.has(id))
          problems.push(`${v.id}/${box}: unknown resource id "${id}"`);
      }
  const orphans = [...known].filter((id) => !used.has(id));
  if (orphans.length)
    problems.push(`resources reachable from no diagram: ${orphans.join(", ")}`);
  return problems;
}

/**
 * The LikeC4 model is the source. Nothing is generated to disk between it and the page: a
 * derived JSON would either be committed and drift, or gitignored and so never reviewed.
 */
async function loadViews(project: Project): Promise<View[]> {
  const views = (await loadLikeC4Views(project)) as unknown as View[];
  // A view with groups and no nodes is a reference tab; the renderer keys off this.
  for (const v of views) if (!v.nodes && v.groups) v.type = "doc";
  return views;
}

/** Everything one project's page needs, and the report of what was wrong with it. */
interface Built {
  project: Project;
  views: View[];
  problems: string[];
  body: string;
  /** Sprite symbols this project draws, for the site-wide unused check. */
  iconsUsed: Set<string>;
  /** Planned changes with nothing to cite. Counted, ratcheted, never silent. */
  uncited: number;
  /** Planned changes resting only on questions nobody has answered yet. */
  unsettled: number;
  /** What each planned state accounts for, printed after the page is written. */
  coverage: {
    st: StateManifest;
    modelled: string[];
    declared: string[];
    missing: string[];
    total: number;
  }[];
}

/**
 * The register as a reference tab: every decision, grouped by what it is about, carrying
 * the count of planned changes that rest on it and the list of what those are. This is the
 * view that answers "what does this decision actually change", which is the question a
 * reviewer has and the diagrams alone cannot answer.
 */
function decisionsView(views: View[], states: States): View | null {
  const ids = Object.keys(states.decisions);
  if (!ids.length) return null;
  const name = (id: string) => views.find((v) => v.id === id)?.name ?? id;
  const changes = planned(states);
  const byCategory = new Map<string, DocItem[]>();
  for (const id of ids) {
    const d = states.decisions[id];
    if (!d) continue;
    const mine = changes.filter((c) => c.why.includes(id));
    const item: DocItem = {
      id,
      name: d.title,
      n: mine.length,
      meta: [d.kind, d.status ?? "", d.level ?? "", d.date ?? ""].filter(
        Boolean,
      ),
      d: {
        type: d.kind,
        tech:
          [d.status, d.level, d.date].filter(Boolean).join(" · ") || undefined,
        role:
          (d.status === "open"
            ? "Still open — nothing has been decided. "
            : "") +
          (mine.length
            ? `Rests on this: ${String(mine.length)} planned change(s).`
            : "Nothing in any state cites this yet.") +
          (d.supersededBy ? ` Superseded by ${d.supersededBy}.` : ""),
        facts: mine.map((c) => `${c.st.name} · ${name(c.view)} — ${c.what}`),
        links: d.links?.map((l) => [l.title, l.url] as [string, string]),
      },
    };
    const list = byCategory.get(d.category) ?? [];
    list.push(item);
    byCategory.set(d.category, list);
  }
  return {
    id: "decisions",
    name: "Decisions",
    itemUnit: "planned changes rest on this",
    itemTerms: { type: "Kind", tech: "Status" },
    order: 999,
    group: "Reference",
    audience: "Anyone reviewing a proposed change",
    blurb:
      "Where every planned change was argued. The as-is is derived from the code and gated against it; a state is a proposal, and this is what makes one reviewable rather than an assertion.",
    note: "",
    type: "doc",
    groups: [...byCategory.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([category, items]) => ({
        name: category,
        note: null,
        table: null,
        items: [...items].sort((a, b) => Number(b.n) - Number(a.n)),
      })),
  };
}

async function buildProject(project: Project): Promise<Built> {
  const views = await loadViews(project);
  const kindIds = new Set(project.config.kinds.map((k) => k.id));
  const icons = loadIcons();

  const states = loadStates(project);
  /* Appended rather than modelled: it is a view of the register, not of the architecture,
     and nothing in the .c4 files knows the register exists. */
  const decisions = decisionsView(views, states);
  if (decisions) views.push(decisions);
  const composed = composeAll(views, states);
  const coverage = stateCoverage(views, states);
  const citations = checkCitations(states);

  checkAngleBrackets(views);
  const iconCheck = checkIcons(views, icons.ids);
  const problems = [
    ...(await checkFormatting(project)),
    ...iconCheck.problems,
    ...(views.some((v) => v.id === project.config.inventoryView)
      ? []
      : [
          `projects/${project.id}: inventoryView "${project.config.inventoryView}" is not one of its views`,
        ]),
    ...checkKindStyles(project),
    ...checkGeometry(views, kindIds),
    ...composed.problems,
    ...citations.problems,
    ...checkDeclarations(states),
    ...foldComposed([
      ...checkGeometry(composed.labelled, kindIds),
      ...checkGlyphs(composed.labelled, fontCharset()),
    ]),
    ...checkGlyphs(views, fontCharset()),
    ...checkPlacement(project, views),
    ...checkDashLegend(views),
    ...checkDerivedCounts(project, views),
    ...checkTableCitations(views),
    ...checkSourceCitations(project, views),
    ...checkDerivedTables(project, views),
  ];

  const placement = Object.fromEntries(
    views.map((v) => [v.id, v.placement ?? {}]),
  );
  // `source`, `sources` and `derive` say where the checkouts are and how to read them.
  // They are build concerns, and the page is published, so they are dropped rather than
  // shipped as filesystem paths. A page reading several repositories gets only what a
  // citation needs: where each one is browsed.
  const {
    source: _source,
    sources: _sources,
    derive: _derive,
    ...rest
  } = project.config;
  const pageConfig = {
    id: project.id,
    ...rest,
    ...(project.qualified
      ? {
          sources: Object.fromEntries(
            project.sources.map((s) => [s.id, s.url]),
          ),
        }
      : {}),
  };
  const data =
    `/* Generated from projects/${project.id}/model/*.c4 — edit those, not this file. */\n` +
    `const VIEWS=${JSON.stringify(views)};\n` +
    `const PLACEMENT=${JSON.stringify(placement)};\n` +
    `const STATES=${JSON.stringify(states.list)};\n` +
    `const COMPOSED=${JSON.stringify(composed.byState)};\n` +
    `const DECISIONS=${JSON.stringify(states.decisions)};\n` +
    `const UNCHANGED=${JSON.stringify(unchangedByState(states.list))};\n` +
    `const CONFIG=${JSON.stringify(pageConfig)};\n` +
    `const ICON_IDS=${JSON.stringify([...icons.ids])};\n` +
    `const SERVICE_ICON=${JSON.stringify(SERVICE_ICON)};\n` +
    `const TYPE_ICON=${JSON.stringify(TYPE_ICON)};\n` +
    `const THEME_KEY=${JSON.stringify(THEME_KEY)};\n`;

  const body = [
    icons.markup,
    asset("shell.html"),
    `<script>\n${data}\n${asset("app.js")}\n</script>`,
  ].join("\n");

  return {
    project,
    views,
    problems,
    body,
    iconsUsed: iconCheck.used,
    uncited: citations.uncited,
    unsettled: citations.unsettled,
    coverage,
  };
}

/* ------------------------------------------------------------------------------------ *
 * The index over the projects
 * ------------------------------------------------------------------------------------ */

/** `git@github.com:govuk-once/flex.git` and its https form both read as owner/name. */
const repoName = (url: string) =>
  /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url)?.[1] ?? url;

/**
 * Where a project's reading stands. One repository gets its name and both commits; several
 * get a count, the newest derivation and how many have been read — with the oldest read
 * date, because the least-read repository is the one the page is least sure of.
 */
function sourceMeta(project: Project): string[] {
  const states = readStates(project);
  const day = (iso: string) => esc(iso.slice(0, 10));
  if (!project.qualified) {
    const [only] = project.sources;
    const state = only ? states[only.id] : null;
    return [
      only ? `<span>${esc(repoName(only.repo))}</span>` : "",
      state
        ? `<span>derived from <b>${esc(short(state.derived.sha))}</b> · ${day(state.derived.committed)}</span>`
        : "",
      state?.read
        ? `<span>read to <b>${esc(short(state.read.sha))}</b> · ${day(state.read.committed)}</span>`
        : "",
    ];
  }
  const all = project.sources.map((s) => states[s.id] ?? null);
  const derived = all.flatMap((s) => (s ? [s.derived.committed] : [])).sort();
  const read = all.flatMap((s) => (s?.read ? [s.read.committed] : [])).sort();
  const n = String(project.sources.length);
  return [
    `<span><b>${n}</b> repositories</span>`,
    derived.length ? `<span>derived · ${day(derived.at(-1) ?? "")}</span>` : "",
    read.length
      ? `<span>read to <b>${String(read.length)} of ${n}</b> · ${day(read[0] ?? "")}</span>`
      : "",
  ];
}

function projectCard(built: Built): string {
  const { project, views } = built;
  const meta = [
    `<span><b>${String(views.length)}</b> tabs</span>`,
    ...sourceMeta(project),
  ].filter(Boolean);
  return (
    `<a class="card" href="${esc(project.href)}">` +
    `<span class="tagline">${esc(project.config.tagline)}</span>` +
    `<h2>${esc(project.config.name)}</h2>` +
    `<p>${esc(project.config.blurb)}</p>` +
    `<div class="meta">${meta.join("")}</div>` +
    `</a>`
  );
}

/**
 * A planned architecture gets the same card and no link. It is worth showing that the
 * site intends to cover it — but the card must not read as a door, and it must say where
 * its description came from: a description of UDP written while reading FLEX is evidence
 * about FLEX.
 */
function plannedCard(
  p: (typeof SITE_CONFIG.planned)[number],
  named: Map<string, string>,
): string {
  const from = p.seenFrom
    ? `<span>as ${esc(named.get(p.seenFrom) ?? p.seenFrom)} sees it</span>`
    : "";
  return (
    `<div class="card planned">` +
    `<span class="tagline">${esc(p.tagline)}</span>` +
    `<h2>${esc(p.name)}</h2>` +
    `<p>${esc(p.blurb)}</p>` +
    `<div class="meta"><span class="badge">Not yet documented</span>${from}</div>` +
    `</div>`
  );
}

function buildIndex(built: Built[]): string {
  // A planned card credits the project whose model its description came from, by the
  // name that project calls itself rather than by its directory.
  const named = new Map(
    built.map((b) => [b.project.id, b.project.config.name]),
  );
  const cards =
    built.map((b) => projectCard(b)).join("\n") +
    SITE_CONFIG.planned.map((p) => plannedCard(p, named)).join("\n");

  const counted =
    `${String(built.length)} documented` +
    (SITE_CONFIG.planned.length
      ? `, ${String(SITE_CONFIG.planned.length)} planned`
      : "");
  const footer = `<p>${esc(SITE_CONFIG.footer)}</p>`;

  const body = asset("index.html")
    .replace(
      "<!--MASTHEAD-->",
      `<span class="eyebrow">${esc(counted)}</span>` +
        `<h1>${esc(SITE_CONFIG.title)}</h1>` +
        `<p>${esc(SITE_CONFIG.blurb)}</p>`,
    )
    .replace("<!--CARDS-->", cards)
    .replace("<!--FOOTER-->", footer)
    .replace(
      "<script>",
      `<script>\nconst THEME_KEY=${JSON.stringify(THEME_KEY)};`,
    );

  return page(
    SITE_CONFIG.title,
    `<style>\n${asset("theme.css")}${asset("index.css")}</style>`,
    body,
  );
}

/* ------------------------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------------------------ */

async function main() {
  const bodyFlag = process.argv.indexOf("--body");
  const asked = selectProjects(
    // --body takes a path, which must not be read as a project id.
    process.argv.slice(2).filter((a, i) => i + 2 !== bodyFlag + 1),
  );
  if (bodyFlag !== -1 && asked.length > 1)
    throw new Error(
      "--body writes one page — name the project: pnpm build <id> --body <path>",
    );

  const built: Built[] = [];
  const problems: string[] = [];
  for (const project of asked) {
    const b = await buildProject(project);
    built.push(b);
    problems.push(...b.problems);
  }

  const strict = !process.argv.includes("--lenient");
  if (problems.length) {
    console.error(`\n${String(problems.length)} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    if (strict) process.exit(1);
  }

  for (const b of built) {
    const head = `<style>\n${asset("theme.css")}${asset("styles.css")}</style>`;
    mkdirSync(path.dirname(b.project.pagePath), { recursive: true });
    const html = page(b.project.config.title, head, b.body);
    writeFileSync(b.project.pagePath, html);
    console.log(
      `${b.project.id}: wrote ${path.relative(DOCS_ROOT, b.project.pagePath)} ` +
        `(${(html.length / 1024).toFixed(0)} KB, ${String(b.views.length)} tabs)`,
    );
    /* A planned state is only as good as what it accounts for. Say what each one covers,
       and name what it has not reached yet, so the gap is a line here rather than a
       discovery someone makes three tabs into a review. */
    const cited = b.uncited
      ? `${String(b.uncited)} planned change(s) cite nothing yet`
      : "every planned change cites a decision";
    if (b.coverage.length)
      console.log(
        `  citations: ${cited}` +
          (b.unsettled
            ? ` · ${String(b.unsettled)} rest only on questions still open`
            : ""),
      );
    for (const c of b.coverage)
      console.log(
        `  ${c.st.name}: models ${String(c.modelled.length)} of ${String(c.total)} diagram views` +
          (c.declared.length
            ? `, ${String(c.declared.length)} declared unchanged`
            : "") +
          (c.missing.length
            ? ` · not modelled yet: ${c.missing.join(", ")}`
            : " · every view accounted for"),
      );
    if (bodyFlag !== -1) {
      const dest = process.argv[bodyFlag + 1];
      if (!dest) throw new Error("--body needs a destination path");
      writeFileSync(dest, `${head}\n${b.body}`);
      console.log(`  wrote ${dest} (artifact body, no wrapper)`);
    }
  }

  /*
   * The index lists every project the site publishes, not only the ones just built, so a
   * one-project rebuild cannot quietly drop the others off the front page. Rebuilding a
   * card needs that project's views, so the ones not asked for are loaded here.
   */
  const shown =
    asked.length === loadProjects().length
      ? built
      : await Promise.all(loadProjects().map((p) => buildProject(p)));

  // The sprite is shared, so a symbol is unused only if no project draws it.
  const drawn = new Set(shown.flatMap((b) => [...b.iconsUsed]));
  const unused = [...loadIcons().ids].filter((id) => !drawn.has(id));
  if (unused.length) {
    console.error(
      `icons.svg: ${String(unused.length)} symbol(s) no project uses: ` +
        unused.map((id) => "i-" + id).join(", "),
    );
    if (strict) process.exit(1);
  }
  mkdirSync(SITE_ROOT, { recursive: true });
  writeFileSync(SITE_INDEX, buildIndex(shown));
  writeFileSync(path.join(SITE_ROOT, "robots.txt"), ROBOTS_TXT + "\n");
  console.log(
    `index: wrote ${path.relative(DOCS_ROOT, SITE_INDEX)} ` +
      `(${String(shown.length)} documented, ${String(SITE_CONFIG.planned.length)} planned)`,
  );
}

/*
 * Runs when invoked, not when imported. The gates below are the product — a regression
 * that stops one *catching* things fails nothing — so they have to be reachable from a
 * test without the script executing against a real project on import.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await main();
