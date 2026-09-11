/**
 * Derives the architecture facts that can drift, for every project that declares a way to
 * derive them, from the CloudFormation each one's source holds or `pnpm synth` wrote.
 *
 * This file owns the loop, the skip decision and the recording. What is counted is the
 * project's `derive.counts`, read by `scripts/derive/cloudformation.ts` — no TypeScript per
 * project. A project with no `derive` block has no generated facts, and that is a
 * supported state.
 *
 * Deriving is skipped when nothing that feeds it has moved: each source's commit, the code
 * that reads it and the output file are all recorded in that project's
 * architecture-source.json, and a run that finds all of them unchanged leaves the facts
 * alone. See lib/sourceState.ts.
 *
 * Run: pnpm facts               every project
 *      pnpm facts flex          one of them
 *      pnpm facts --force       derive regardless
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { format } from "prettier";

import { loadDerivation } from "./derive/index.js";
import { DOCS_ROOT } from "./lib/paths.js";
import {
  assertCheckouts,
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
  readStates,
  short,
  type SourceState,
  staleness,
  writeStates,
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
  assertCheckouts(project);
  const derivation = project.derive
    ? await loadDerivation(project.derive.module)
    : null;

  const states = readStates(project);
  const rows = project.sources.map((source) => ({
    source,
    head: headCommit(source),
    state: states[source.id] ?? null,
    // With several sources a line has to say which one it is about.
    name: project.qualified ? `${source.id}: ` : "",
  }));
  const stale = rows.flatMap((r) => {
    const why = staleness(project, r.source, derivation, r.state, r.head);
    return why ? [`${r.name}${why}`] : [];
  });
  if (!forcedBy && !stale.length) {
    for (const r of rows)
      console.log(
        `  ${r.name}current at ${short(r.head.sha)} — ${r.head.subject}`,
      );
    console.log(
      "  nothing it derives from has moved, so nothing was re-derived",
    );
    return;
  }
  console.log(`  deriving: ${stale.join("; ") || forcedBy || ""}`);
  // Naming the range turns "something moved" into a list of commits to actually read;
  // `pnpm drift` then says which of them touch a file the docs cite.
  for (const r of rows)
    if (r.state && r.state.derived.sha !== r.head.sha)
      console.log(
        ensureRange(r.source, r.state.derived.sha)
          ? `  ${r.name}${String(commitsBetween(r.source, r.state.derived.sha, r.head.sha).length)} commits since ` +
              `${short(r.state.derived.sha)} — run \`pnpm drift ${project.id}\` for the cited files`
          : `  ${r.name}the range since ${short(r.state.derived.sha)} cannot be listed in this checkout`,
      );

  if (derivation) {
    const facts = await derivation.derive(project);
    // A new project has no derived/ yet; its first derivation is what creates it.
    mkdirSync(path.dirname(project.factsPath), { recursive: true });
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
  const next: Record<string, SourceState> = Object.fromEntries(
    rows.map((r) => [
      r.source.id,
      {
        repo: r.source.repo,
        ref: r.source.ref,
        derived: {
          sha: r.head.sha,
          subject: r.head.subject,
          committed: r.head.committed,
          builtFrom: builtFrom(project),
          derivation: derivationHash(project, derivation),
          facts: derivation ? hashFile(project.factsPath) : "",
        },
        read: r.state?.read ?? null,
      },
    ]),
  );
  await writeStates(project, next);
  for (const r of rows)
    console.log(
      `  ${r.name}derived from ${short(r.head.sha)}` +
        (r.state?.read
          ? `, read up to ${short(r.state.read.sha)}`
          : ", nothing recorded as read"),
    );
  console.log(`  wrote ${rel(project.statePath)}`);
}

for (const project of selectProjects(process.argv.slice(2))) {
  console.log(`${project.id}:`);
  await deriveProject(project);
}
