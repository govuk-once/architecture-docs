/**
 * What has moved in each project's source since these docs were built from it, and which
 * of it these docs actually make a claim about.
 *
 *   pnpm drift               every project
 *   pnpm drift flex          one of them
 *   pnpm drift flex --since 3a1c4861
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
 * Run it *before* `pnpm build`, which advances the recorded commit as soon as it
 * re-derives. If one has already run, the range is still askable — `--since <sha>` takes
 * any commit, and `git log -p projects/<id>/architecture-source.json` has every one this
 * repository has ever recorded.
 */
import { loadLikeC4Views } from "./lib/loadLikeC4Views.js";
import {
  assertSourceRoot,
  type Project,
  selectProjects,
} from "./lib/projects.js";
import { collectCitations, globToRe } from "./lib/sourceCitations.js";
import {
  changedFiles,
  commitsBetween,
  ensureRange,
  headCommit,
  readState,
  short,
  STATE_FILE,
} from "./lib/sourceState.js";

/** `--since <sha>` overrides the recorded commit, for a range asked about after the fact. */
function sinceArg(): string | null {
  const at = process.argv.indexOf("--since");
  const sha = at === -1 ? undefined : process.argv[at + 1];
  if (at !== -1 && !sha) throw new Error("--since needs a commit");
  return sha ?? null;
}

function list(title: string, lines: string[]) {
  console.log(`\n  ${title}`);
  for (const l of lines) console.log(`    ${l}`);
}

async function driftProject(project: Project, asked: string | null) {
  assertSourceRoot(project);
  const head = headCommit(project);
  const state = readState(project);

  console.log(`\n${project.id}:`);
  console.log(`  source  ${short(head.sha)}  ${head.subject}`);
  if (!asked && !state) {
    console.log(
      `  no ${STATE_FILE}: nothing records what its facts were built from.`,
    );
    console.log("  run `pnpm build` to derive them and record this commit.");
    return;
  }
  const since = asked ?? state?.sha ?? "";
  console.log(
    asked
      ? `  since   ${short(since)}  (asked for with --since)`
      : `  docs    ${short(since)}  ${state?.subject ?? ""}  (${state?.committed.slice(0, 10) ?? ""})`,
  );

  if (since === head.sha) {
    console.log(
      "  the same commit — nothing has moved since these docs were built.",
    );
    return;
  }
  if (!ensureRange(project, since)) {
    console.log(
      `  the commits between ${short(since)} and HEAD cannot be listed here — the ` +
        `checkout is shallower than the gap, or that commit is no longer on ` +
        `${project.source.ref}. git -C ${project.source.root} fetch --unshallow settles the first.`,
    );
    return;
  }

  const commits = commitsBetween(project, since, head.sha);
  const files = changedFiles(project, since, head.sha);
  console.log(
    `  ${String(commits.length)} commit(s), ${String(files.length)} file(s) changed since.`,
  );
  list("Commits", [
    ...commits.slice(0, 10).map((c) => `${short(c.sha)}  ${c.subject}`),
    ...(commits.length > 10
      ? [`… and ${String(commits.length - 10)} more`]
      : []),
  ]);

  // A project with no derivation has no inputs, so nothing here moves a generated count.
  const derivedFrom = Object.values(project.derive?.inputs ?? {}).map(globToRe);
  const derived = files.filter((f) => derivedFrom.some((re) => re.test(f)));
  if (derived.length)
    list(
      `Derived from (${String(derived.length)}) — these move the generated counts, and the build will say which`,
      derived,
    );

  const citations = collectCitations(await loadLikeC4Views(project.modelDir));
  const cited = files.filter((f) => citations.has(f));
  if (cited.length)
    list(
      `Cited (${String(cited.length)} of ${String(citations.size)}) — re-read what each of these is claimed to prove`,
      cited.flatMap((f) => [
        f,
        `    ${[...(citations.get(f) ?? [])].join(", ")}`,
      ]),
    );

  if (!derived.length && !cited.length)
    console.log(
      `\n  Nothing derived from and none of the ${String(citations.size)} cited files moved. ` +
        `That is not proof the prose is still true — only that no claim names a file in ` +
        `this range.`,
    );
  console.log(
    `\n  Once you have read them, \`pnpm build ${project.id}\` records ${short(head.sha)}.`,
  );
}

const asked = sinceArg();
const projects = selectProjects(
  // --since takes a value, which must not be read as a project id.
  process.argv.slice(2).filter((a) => a !== asked),
);
if (asked && projects.length > 1)
  throw new Error(
    "--since applies to one project's history — name the project: pnpm drift <id> --since <sha>",
  );
for (const project of projects) await driftProject(project, asked);
