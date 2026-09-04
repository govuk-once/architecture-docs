/**
 * What has moved in each project's source since these docs were built from it, and which
 * of it these docs actually make a claim about.
 *
 *   pnpm drift                     every project
 *   pnpm drift flex                one of them
 *   pnpm drift flex --since 3a1c4861
 *   pnpm drift flex --mark-read    the reading is done, up to the checkout's HEAD
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
 * It measures from the commit the model was last *read* up to — `read` in
 * architecture-source.json — not from the one the facts were derived at, so a build run
 * first cannot erase the reading list. Only `--mark-read` advances `read`, and only
 * somebody who has done the reading should run it.
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
  markRead,
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

  // What moves a generated count: the declared inputs, and — when the counts come from
  // synthesised templates — anything under the CDK app, since all of it is synthesised.
  const derivedFrom = [
    ...Object.values(project.derive?.inputs ?? {}),
    ...(project.config.synth ? [project.config.synth.cwd] : []),
  ].map(globToRe);
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
    `\n  Once you have read them: \`pnpm drift ${project.id} --mark-read\` records ${short(head.sha)} as read.`,
  );
}

/** The other half of drift: say that the reading has been done, up to the checkout's HEAD. */
async function markProjectRead(project: Project) {
  assertSourceRoot(project);
  const head = headCommit(project);
  const state = await markRead(project, head);
  console.log(`\n${project.id}:`);
  console.log(`  read up to ${short(head.sha)} — ${head.subject}`);
  if (state.derived.sha !== head.sha)
    console.log(
      `  note: the facts were derived at ${short(state.derived.sha)} — run \`pnpm build ${project.id}\` to re-derive at this commit`,
    );
}

const asked = sinceArg();
const marking = process.argv.includes("--mark-read");
const projects = selectProjects(
  // --since takes a value, which must not be read as a project id.
  process.argv.slice(2).filter((a) => a !== asked),
);
if (asked && marking)
  throw new Error(
    "--since and --mark-read do not combine: reading is recorded at HEAD only",
  );
if ((asked || marking) && projects.length > 1)
  throw new Error(
    "--since and --mark-read apply to one project — name it: pnpm drift <id> --since <sha> | --mark-read",
  );
for (const project of projects)
  if (marking) await markProjectRead(project);
  else await driftProject(project, asked);
