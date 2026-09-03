/**
 * Derives the architecture facts that can drift, for every project that declares a way to
 * derive them, straight from the source each one documents.
 *
 * How a project's facts are derived is the one thing that cannot be shared between
 * projects — FLEX's counts come from importing the same config modules the CDK app reads,
 * which is a fact about FLEX. So this file owns the loop, the skip decision and the
 * recording, and the schema knowledge lives in `scripts/derive/<module>.ts`. A project
 * with no `derive` block has no generated facts, and that is a supported state.
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
    console.log("  nothing it derives from has moved, so nothing was re-read");
    return;
  }
  console.log(`  deriving: ${stale ?? forcedBy ?? ""}`);
  // Naming the range turns "something moved" into a list of commits to actually read;
  // `pnpm drift` then says which of them touch a file the docs cite.
  if (state && state.sha !== head.sha)
    console.log(
      ensureRange(project, state.sha)
        ? `  ${String(commitsBetween(project, state.sha, head.sha).length)} commits since ` +
            `${short(state.sha)} — run \`pnpm drift ${project.id}\` for the cited files`
        : `  the range since ${short(state.sha)} cannot be listed in this checkout`,
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
  await writeState(project, {
    repo: project.source.repo,
    ref: project.source.ref,
    sha: head.sha,
    subject: head.subject,
    committed: head.committed,
    builtFrom: builtFrom(project),
    derivation: derivationHash(project, derivation),
    facts: derivation ? hashFile(project.factsPath) : "",
  });
  console.log(
    `  wrote ${rel(project.statePath)} — built from ${short(head.sha)}`,
  );
}

for (const project of selectProjects(process.argv.slice(2))) {
  console.log(`${project.id}:`);
  await deriveProject(project);
}
