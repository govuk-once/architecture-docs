/**
 * What has moved in each project's sources since these docs were built from them, and
 * which of it these docs actually make a claim about.
 *
 *   pnpm drift                     every project
 *   pnpm drift flex                one of them
 *   pnpm drift app --source ios    one source of a project that reads several
 *   pnpm drift flex --since 3a1c4861
 *   pnpm drift flex --mark-read    the reading is done, up to each checkout's HEAD
 *
 * `pnpm build` re-derives the counts a project declares a derivation for, and fails when
 * a diagram disagrees with them. Everything else in an explorer is prose written by
 * reading the code, and no build can tell that a rewritten stack has made a paragraph
 * false. What it can do is narrow the reading down: every claim names the files that
 * prove it, so the claims worth re-reading are the ones whose cited files are in the
 * range.
 *
 * That is what this prints. It never fails — it is a reading list, not a gate.
 *
 * It also prints what the citations cannot reach. A claim can only point at a file that
 * existed when it was written, so a range that adds a new library, a new middleware or a
 * whole new domain moves nothing cited and derives no different count: the model stays
 * silent about it and every gate passes. Those additions are grouped under the nearest
 * directory the model already cites from, which is what makes a new sibling of something
 * documented stand out from noise.
 *
 * It measures from the commit the model was last *read* up to — `read` in
 * architecture-source.json — not from the one the facts were derived at, so a build run
 * first cannot erase the reading list. Only `--mark-read` advances `read`, and only
 * somebody who has done the reading should run it. A project reading several
 * repositories has a `read` per repository, and a reading list per repository.
 */
import path from "node:path";

import { loadLikeC4Views } from "./lib/loadLikeC4Views.js";
import {
  assertCheckout,
  locate,
  type Project,
  selectProjects,
  type Source,
  sourceLabel,
} from "./lib/projects.js";
import { collectCitations, globToRe } from "./lib/sourceCitations.js";
import {
  addedFiles,
  changedFiles,
  commitsBetween,
  ensureRange,
  headCommit,
  markRead,
  readState,
  short,
  STATE_FILE,
} from "./lib/sourceState.js";

/** A flag that takes a value, which must then not be read as a project id. */
function valueOf(flag: string, what: string): string | null {
  const at = process.argv.indexOf(flag);
  const value = at === -1 ? undefined : process.argv[at + 1];
  if (at !== -1 && !value) throw new Error(`${flag} needs ${what}`);
  return value ?? null;
}

/** Source files a new one of which could be a new concept, rather than config or noise. */
const SOURCE_FILE = /\.(ts|tsx|js|mjs|swift|kt|kts)$/;

function list(title: string, lines: string[]) {
  console.log(`\n  ${title}`);
  for (const l of lines) console.log(`    ${l}`);
}

/** The citations into one source, by their path inside it. */
function citationsIn(
  project: Project,
  source: Source,
  all: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [rel, where] of all) {
    const at = locate(project, rel);
    if (at?.source === source) out.set(at.path, where);
  }
  return out;
}

/** The sources a command acts on: the one `--source` names, or all of them. */
function selected(project: Project, only: string | null): Source[] {
  if (!only) return project.sources;
  const s = project.sources.find((x) => x.id === only);
  if (!s)
    throw new Error(
      `${project.id} reads no source "${only}" — it reads ${project.sources.map((x) => x.id).join(", ")}`,
    );
  return [s];
}

function driftSource(
  project: Project,
  source: Source,
  asked: string | null,
  citations: Map<string, Set<string>>,
) {
  assertCheckout(project, source);
  const head = headCommit(source);
  const state = readState(project, source);

  console.log(`\n${sourceLabel(project, source)}:`);
  console.log(`  source  ${short(head.sha)}  ${head.subject}`);
  if (!asked && !state) {
    console.log(
      `  no ${STATE_FILE} record: nothing records what its facts were built from.`,
    );
    console.log("  run `pnpm build` to derive them and record this commit.");
    return;
  }
  // The reading list starts where the reading stopped, not where the last build ran.
  // With nothing ever marked read, the derived commit is the only honest starting point.
  const from = state?.read ?? state?.derived ?? null;
  const since = asked ?? from?.sha ?? "";
  if (state)
    console.log(
      `  derived ${short(state.derived.sha)}  ${state.derived.subject}  (${state.derived.committed.slice(0, 10)})`,
    );
  let fromLine = `  read    nothing recorded — measuring from the derived commit`;
  if (asked) fromLine = `  since   ${short(since)}  (asked for with --since)`;
  else if (state?.read)
    fromLine = `  read    ${short(since)}  ${state.read.subject}  (${state.read.committed.slice(0, 10)})`;
  console.log(fromLine);

  if (since === head.sha) {
    console.log(
      "  the same commit — nothing has moved since the model was read.",
    );
    return;
  }
  if (!ensureRange(source, since)) {
    console.log(
      `  the commits between ${short(since)} and HEAD cannot be listed here — the ` +
        `checkout is shallower than the gap, or that commit is no longer on ` +
        `${source.ref}. git -C ${source.root} fetch --unshallow settles the first.`,
    );
    return;
  }

  const commits = commitsBetween(source, since, head.sha);
  const files = changedFiles(source, since, head.sha);
  console.log(
    `  ${String(commits.length)} commit(s), ${String(files.length)} file(s) changed since.`,
  );
  list("Commits", [
    ...commits.slice(0, 10).map((c) => `${short(c.sha)}  ${c.subject}`),
    ...(commits.length > 10
      ? [`… and ${String(commits.length - 10)} more`]
      : []),
  ]);

  // What moves a generated count: the declared inputs, and — when the counts come from
  // synthesised templates — anything under the CDK app, since all of it is synthesised.
  // Only the ones in this source count here.
  const derivedFrom = [
    ...Object.values(project.derive?.inputs ?? {}),
    ...(project.config.synth ? [project.config.synth.cwd] : []),
  ].flatMap((p) => {
    const at = locate(project, p);
    return at?.source === source ? [globToRe(at.path)] : [];
  });
  const derived = files.filter((f) => derivedFrom.some((re) => re.test(f)));
  if (derived.length)
    list(
      `Derived from (${String(derived.length)}) — these move the generated counts, and the build will say which`,
      derived,
    );

  const cited = files.filter((f) => citations.has(f));
  if (cited.length)
    list(
      `Cited (${String(cited.length)} of ${String(citations.size)}) — re-read what each of these is claimed to prove`,
      cited.flatMap((f) => [
        f,
        `    ${[...(citations.get(f) ?? [])].join(", ")}`,
      ]),
    );

  /*
   * What no citation can reach. Tests, fixtures and anything under the CDK app are left
   * out: the first two are not architecture, and the third is already reported above
   * because all of it is synthesised.
   */
  const NOISE = [
    ".test.",
    ".spec.",
    "Tests.",
    "Test.kt",
    "__tests__",
    "__snapshots__",
    "/fixtures/",
    ".snap",
  ];
  const added = addedFiles(source, since, head.sha).filter(
    (f) =>
      SOURCE_FILE.test(f) &&
      !NOISE.some((n) => f.includes(n)) &&
      !citations.has(f) &&
      !derivedFrom.some((re) => re.test(f)),
  );
  if (added.length) {
    // Every directory that holds a cited file, and every directory above it.
    const known = new Set<string>();
    for (const f of citations.keys()) {
      let d = path.dirname(f);
      while (d && d !== ".") {
        known.add(d);
        d = path.dirname(d);
      }
    }
    const anchorOf = (f: string) => {
      let d = path.dirname(f);
      while (d && d !== "." && !known.has(d)) d = path.dirname(d);
      return d && d !== "." ? d : "(nowhere the model cites)";
    };
    const groups = new Map<string, string[]>();
    for (const f of added) {
      const a = anchorOf(f);
      groups.set(a, [...(groups.get(a) ?? []), f]);
    }
    const ranked = [...groups].sort((a, b) => b[1].length - a[1].length);
    list(
      `New and uncited (${String(added.length)}) — nothing here can go stale, because ` +
        `nothing claims it yet. Grouped by the nearest place the model does cite from`,
      ranked
        .slice(0, 6)
        .flatMap(([a, fs]) => [
          `${a}/ — ${String(fs.length)} file(s)`,
          ...fs.slice(0, 3).map((f) => `    ${f}`),
          ...(fs.length > 3 ? [`    … and ${String(fs.length - 3)} more`] : []),
        ]),
    );
    if (ranked.length > 6)
      console.log(`    … and ${String(ranked.length - 6)} more place(s)`);
  }

  if (!derived.length && !cited.length && !added.length)
    console.log(
      `\n  Nothing derived from and none of the ${String(citations.size)} cited files moved. ` +
        `That is not proof the prose is still true — only that no claim names a file in ` +
        `this range.`,
    );
  const which = project.qualified ? ` --source ${source.id}` : "";
  console.log(
    `\n  Once you have read them: \`pnpm drift ${project.id}${which} --mark-read\` records ${short(head.sha)} as read.`,
  );
}

async function driftProject(
  project: Project,
  asked: string | null,
  only: string | null,
) {
  const all = collectCitations(await loadLikeC4Views(project));
  for (const source of selected(project, only))
    driftSource(project, source, asked, citationsIn(project, source, all));
}

/** The other half of drift: say that the reading has been done, up to each checkout's HEAD. */
async function markProjectRead(project: Project, only: string | null) {
  for (const source of selected(project, only)) {
    assertCheckout(project, source);
    const head = headCommit(source);
    const state = await markRead(project, source, head);
    console.log(`\n${sourceLabel(project, source)}:`);
    console.log(`  read up to ${short(head.sha)} — ${head.subject}`);
    if (state.derived.sha !== head.sha)
      console.log(
        `  note: the facts were derived at ${short(state.derived.sha)} — run \`pnpm build ${project.id}\` to re-derive at this commit`,
      );
  }
}

const asked = valueOf("--since", "a commit");
const only = valueOf("--source", "a source id");
const marking = process.argv.includes("--mark-read");
const projects = selectProjects(
  // Flag values must not be read as project ids.
  process.argv.slice(2).filter((a) => a !== asked && a !== only),
);
if (asked && marking)
  throw new Error(
    "--since and --mark-read do not combine: reading is recorded at HEAD only",
  );
if ((asked || marking || only) && projects.length > 1)
  throw new Error(
    "--since, --source and --mark-read apply to one project — name it: pnpm drift <id> …",
  );
for (const project of projects) {
  if (asked && !only && project.sources.length > 1)
    throw new Error(
      `--since names a commit in one repository, and ${project.id} reads ` +
        `${String(project.sources.length)} — add --source <id>`,
    );
  if (marking) await markProjectRead(project, only);
  else await driftProject(project, asked, only);
}
