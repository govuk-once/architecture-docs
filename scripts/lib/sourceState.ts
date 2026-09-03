/**
 * The source commit a project's committed facts were last derived from.
 *
 * `pnpm sync` pulls a checkout and `pnpm facts` derives from it, and both need an answer
 * to the same question: has this project's source actually moved since the last run? With
 * nothing recorded the only honest answer is "assume so", so every run reinstalls the
 * checkout's dependencies and re-imports every config to produce a byte-identical file.
 *
 * So the commit is recorded, in `architecture-source.json` beside that project's facts
 * and committed with them. It is kept *out* of `architecture-facts.json` deliberately:
 * that file is the drift gate, and CI fails when a rebuild changes it. A commit hash
 * folded in there would fire that gate on every source commit, including the many that
 * change nothing here — which trains everyone to ignore it, and is the same as it never
 * firing at all.
 *
 * Nothing is skipped on the strength of the hash alone. Reusing a previous derivation
 * needs the source commit, the code that did the deriving, and the output file itself to
 * all still be what they were — so editing a deriving script or hand-editing the facts
 * re-derives instead of quietly going stale.
 *
 * Everything here takes the project it is asking about. Two projects track two different
 * repositories at two different commits, and nothing about the mechanism cares which.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { format } from "prettier";

import type { Derivation } from "../derive/index.js";
import { inDocs } from "./paths.js";
import { builtFrom, type Project } from "./projects.js";

export const STATE_FILE = "architecture-source.json";

/** What was built, from where, by what. Every field is part of the skip decision. */
export interface SourceState {
  /** Which repository and ref — pointing this at another checkout invalidates it. */
  repo: string;
  ref: string;
  /** The commit, with enough of it to read in a diff without a checkout to hand. */
  sha: string;
  subject: string;
  committed: string;
  /** The inputs read at that commit — the `derive.inputs` of project.config.json. */
  builtFrom: string;
  /** Hash of the code that did the deriving, so changing it re-derives. */
  derivation: string;
  /** Hash of the architecture-facts.json it produced, so a hand-edit re-derives. */
  facts: string;
}

export interface Commit {
  sha: string;
  subject: string;
  committed: string;
}

export const short = (sha: string) => sha.slice(0, 8);

/* ------------------------------------------------------------------------------------ *
 * Reading a checkout
 * ------------------------------------------------------------------------------------ */

const LOG_FORMAT = "%H%x00%cI%x00%s";

export function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/** git failing is an answer here — a missing commit, a missing remote — not a crash. */
export function tryGit(args: string[], cwd: string): string | null {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

function parseCommit(line: string): Commit {
  const [sha = "", committed = "", subject = ""] = line.split("\0");
  return { sha, committed, subject };
}

export function headCommit(project: Project): Commit {
  return parseCommit(
    git(["log", "-1", `--format=${LOG_FORMAT}`], project.sourceRoot),
  );
}

/**
 * Whether the commits between `sha` and HEAD can actually be listed in this checkout,
 * deepening it once if that is what it takes.
 *
 * Ancestry is the test, not whether the object exists — testing existence was a bug.
 * `pnpm sync` fetches one commit deep, which re-grafts the history but leaves the old
 * objects lying around, so `cat-file -e` answers yes while `log sha..HEAD` quietly
 * reports one commit where there were eight. A graft between the two breaks ancestry,
 * which is exactly the signal wanted: "cannot see it" must never be reported as
 * "nothing changed".
 *
 * False also covers a commit that is no longer on the branch at all — a force-push or a
 * rebase — which is equally a range nobody should be shown a number for.
 */
export function ensureRange(
  project: Project,
  sha: string,
  depth = 250,
): boolean {
  const at = project.sourceRoot;
  const reachable = () =>
    tryGit(["merge-base", "--is-ancestor", sha, "HEAD"], at) !== null;
  if (reachable()) return true;
  if (tryGit(["rev-parse", "--is-shallow-repository"], at) !== "true")
    return false;
  tryGit(
    ["fetch", `--deepen=${String(depth)}`, "origin", project.source.ref],
    at,
  );
  return reachable();
}

export function changedFiles(
  project: Project,
  from: string,
  to = "HEAD",
): string[] {
  const out = tryGit(
    ["diff", "--name-only", `${from}..${to}`],
    project.sourceRoot,
  );
  return out ? out.split("\n").filter(Boolean) : [];
}

export function commitsBetween(
  project: Project,
  from: string,
  to = "HEAD",
): Commit[] {
  const out = tryGit(
    ["log", `--format=${LOG_FORMAT}`, `${from}..${to}`],
    project.sourceRoot,
  );
  return out ? out.split("\n").filter(Boolean).map(parseCommit) : [];
}

/* ------------------------------------------------------------------------------------ *
 * Hashing what the derivation depends on
 * ------------------------------------------------------------------------------------ */

const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 16);

export function hashFile(file: string): string {
  return existsSync(file) ? digest(readFileSync(file, "utf8")) : "";
}

/**
 * A hash of the code that derives this project's facts, and of the inputs it was pointed
 * at. Editing a deriving script changes what the same commit derives to, so the hash
 * changes and the next run re-derives rather than leaving the previous output looking
 * current. Which files count is the derivation's own declaration — see derive/index.ts —
 * because they differ per project.
 *
 * A project with no derivation hashes to a constant, which is correct: there is no code
 * whose change could make facts it does not have stale.
 */
export function derivationHash(
  project: Project,
  derivation: Derivation | null,
): string {
  return digest(
    [
      ...(derivation?.files ?? []).map((f) => `${f}:${hashFile(inDocs(f))}`),
      `inputs:${builtFrom(project)}`,
    ].join("\n"),
  );
}

/* ------------------------------------------------------------------------------------ *
 * The state file
 * ------------------------------------------------------------------------------------ */

export function readState(project: Project): SourceState | null {
  if (!existsSync(project.statePath)) return null;
  try {
    return JSON.parse(readFileSync(project.statePath, "utf8")) as SourceState;
  } catch {
    return null;
  }
}

/** Prettier-formatted, like the facts: it is committed, and eslint lints JSON too. */
export async function writeState(
  project: Project,
  state: SourceState,
): Promise<void> {
  writeFileSync(
    project.statePath,
    await format(JSON.stringify(state), { parser: "json" }),
  );
}

/**
 * Why the recorded state cannot be reused, or null when it can.
 *
 * The reason is prose because it is printed. "Up to date" with no statement of what was
 * checked is exactly the kind of unbacked claim this repository exists to avoid.
 */
export function staleness(
  project: Project,
  derivation: Derivation | null,
  state: SourceState | null,
  head: Commit,
): string | null {
  const src = project.source;
  if (!state)
    return `no ${STATE_FILE} — nothing records what the facts came from`;
  if (state.repo !== src.repo || state.ref !== src.ref)
    return `built from ${state.repo} (${state.ref}), now pointed at ${src.repo} (${src.ref})`;
  if (state.sha !== head.sha)
    return `the source moved — built at ${short(state.sha)}, the checkout is at ${short(head.sha)}`;
  if (state.builtFrom !== builtFrom(project))
    return "the inputs named in project.config.json changed";
  if (state.derivation !== derivationHash(project, derivation))
    return "the code that derives the facts changed";
  // A project with no derivation has no facts file, and correctly stops here.
  if (!derivation) return null;
  if (!existsSync(project.factsPath))
    return "architecture-facts.json is missing";
  if (state.facts !== hashFile(project.factsPath))
    return "architecture-facts.json no longer matches what was derived";
  return null;
}
