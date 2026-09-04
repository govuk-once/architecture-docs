/**
 * Derives the architecture facts that can drift, for every project that declares a way to
 * derive them, from the CloudFormation `pnpm synth` wrote for each one.
 *
 * This file owns the loop, the skip decision and the recording. What is counted is the
 * project's `derive.counts`, read by `scripts/derive/cloudformation.ts` — no TypeScript per
 * project. A project with no `derive` block has no generated facts, and that is a
 * supported state.
 *
 * Deriving is skipped when nothing that feeds it has moved: the source commit, the code
 * that reads it and the output file are all recorded in that project's
 * architecture-source.json, and a run that finds all three unchanged leaves the facts
 * alone. See lib/sourceState.ts.
 *
 * Run: pnpm facts               every project
 *      pnpm facts flex          one of them
 *      pnpm facts --force       derive regardless
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { format } from "prettier";

import { loadDerivation } from "./derive/index.js";
import { DOCS_ROOT } from "./lib/paths.js";
import {
  assertSourceRoot,
  builtFrom,
  type Project,
  selectProjects,
} from "./lib/projects.js";
import {
  commitsBetween,
  derivationHash,
  ensureRange,
  hashFile,
  headCommit,
  readState,
  short,
  staleness,
  writeState,
} from "./lib/sourceState.js";

/**
 * CI is the authority on whether the committed facts still match the source — deriving
 * them again and diffing the result is the entire point of the run — so it never reuses a
 * recorded state. Locally, reusing it is the point.
 */
function forcedBecause(): string | null {
  if (process.argv.includes("--force")) return "--force";
  if (process.env.CI) return "CI does not reuse a recorded state";
  return null;
}
const forcedBy = forcedBecause();

const rel = (file: string) => path.relative(DOCS_ROOT, file);

async function deriveProject(project: Project): Promise<void> {
  assertSourceRoot(project);
  const derivation = project.derive
    ? await loadDerivation(project.derive.module)
    : null;

  const head = headCommit(project);
  const state = readState(project);
  const stale = staleness(project, derivation, state, head);
  if (!forcedBy && stale === null) {
    console.log(`  current at ${short(head.sha)} — ${head.subject}`);
    console.log(
      "  nothing it derives from has moved, so nothing was re-derived",
    );
    return;
  }
  console.log(`  deriving: ${stale ?? forcedBy ?? ""}`);
  // Naming the range turns "something moved" into a list of commits to actually read;
  // `pnpm drift` then says which of them touch a file the docs cite.
  if (state && state.derived.sha !== head.sha)
    console.log(
      ensureRange(project, state.derived.sha)
        ? `  ${String(commitsBetween(project, state.derived.sha, head.sha).length)} commits since ` +
            `${short(state.derived.sha)} — run \`pnpm drift ${project.id}\` for the cited files`
        : `  the range since ${short(state.derived.sha)} cannot be listed in this checkout`,
    );

  if (derivation) {
    const facts = await derivation.derive(project);
    // Formatted with prettier so the committed file is lint-clean by construction —
    // eslint checks it like any other JSON, and nobody should have to remember --fix.
    writeFileSync(
      project.factsPath,
      await format(JSON.stringify(facts), { parser: "json" }),
    );
    console.log(`  wrote ${rel(project.factsPath)}`);
    for (const line of derivation.summary(facts).split("\n"))
      console.log(`  ${line}`);
  } else {
    console.log(
      "  no derivation declared — this project's counts are prose, checked by hand",
    );
  }

  // Recorded only now, and including a hash of what was just written, so the state can
  // never claim a derivation that did not finish or an output somebody edited after.
  // `read` is not this command's to touch: deriving is not reading.
  await writeState(project, {
    repo: project.source.repo,
    ref: project.source.ref,
    derived: {
      sha: head.sha,
      subject: head.subject,
      committed: head.committed,
      builtFrom: builtFrom(project),
      derivation: derivationHash(project, derivation),
      facts: derivation ? hashFile(project.factsPath) : "",
    },
    read: state?.read ?? null,
  });
  console.log(
    `  wrote ${rel(project.statePath)} — derived from ${short(head.sha)}` +
      (state?.read
        ? `, read up to ${short(state.read.sha)}`
        : ", nothing recorded as read"),
  );
}

for (const project of selectProjects(process.argv.slice(2))) {
  console.log(`${project.id}:`);
  await deriveProject(project);
}
