/**
 * Pulls the source repositories this site documents into working checkouts, so the docs
 * can be built from a clone of this repository alone. Each checkout is disposable: they
 * live under `.sources/`, are gitignored, and `--clean` removes them.
 *
 * Run: pnpm sync               every project
 *      pnpm sync flex          one of them
 *      pnpm sync --install     install regardless
 *      pnpm sync --clean       remove every checkout
 *
 * The install is not optional the first time. A project's derivation may import its
 * source's config modules — FLEX's does, which is why its counts can be trusted — so the
 * checkout needs its own dependencies resolvable.
 *
 * It is the slowest step here, though, and most commits touch no manifest at all. So it
 * is skipped when nothing in the range since the last built commit changed one — see
 * lib/sourceState.ts for what that commit is and why it is recorded.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { DOCS_ROOT, inDocs } from "./lib/paths.js";
import { loadProjects, type Project, selectProjects } from "./lib/projects.js";
import {
  changedFiles,
  type Commit,
  commitsBetween,
  ensureRange,
  headCommit,
  readState,
  short,
  STATE_FILE,
} from "./lib/sourceState.js";

const clean = process.argv.includes("--clean");
const skipInstall = process.argv.includes("--no-install");
const forceInstall = process.argv.includes("--install");

/**
 * The dependency manifests inside a checkout. Nothing else can change what an install
 * would produce, so a range that touches none of them cannot have invalidated the
 * node_modules already there.
 */
const MANIFEST =
  /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc)$/;

/** Inherits stdio so a slow clone or install shows progress rather than appearing hung. */
function run(cmd: string, args: string[], cwd: string) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

/**
 * Why a checkout has to be installed again, or null when it does not.
 *
 * The recorded commit is the last one the *facts* were built from, which may be behind
 * the last one installed. That only ever widens the range being examined, so the answer
 * errs towards installing — never towards skipping an install that was needed.
 */
function installReason(project: Project, head: Commit): string | null {
  if (forceInstall) return "--install";
  if (!existsSync(path.join(project.sourceRoot, "node_modules")))
    return "the checkout has no node_modules yet";
  const state = readState(project);
  if (!state)
    return `no ${STATE_FILE}, so what has already been installed is unknown`;
  if (state.sha === head.sha) return null;
  if (!ensureRange(project, state.sha))
    return `the range since ${short(state.sha)} cannot be listed, so what changed is unknown`;
  const touched = changedFiles(project, state.sha, head.sha).filter((f) =>
    MANIFEST.test(f),
  );
  return touched.length
    ? `${String(touched.length)} dependency manifest(s) changed: ${touched.slice(0, 3).join(", ")}`
    : null;
}

/** Fetch or clone, then report where the checkout now stands against the last build. */
function syncProject(project: Project) {
  const { source, sourceRoot } = project;
  console.log(`\n${project.id}:`);
  const parent = path.dirname(sourceRoot);
  // git is run with this as its cwd, and a missing cwd surfaces as a confusing ENOENT on
  // git itself rather than on the directory.
  mkdirSync(parent, { recursive: true });

  if (existsSync(path.join(sourceRoot, ".git"))) {
    console.log(`  fetching ${source.ref} in ${source.root}`);
    run("git", ["fetch", "--depth", "1", "origin", source.ref], sourceRoot);
    // Hard reset rather than pull: this checkout is disposable and must never carry local
    // edits, or the docs would be built from something nobody else can reproduce.
    run("git", ["reset", "--hard", `origin/${source.ref}`], sourceRoot);
    run("git", ["clean", "-fdx", "-e", "node_modules"], sourceRoot);
  } else {
    console.log(`  cloning ${source.repo} (${source.ref}) into ${source.root}`);
    run(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        source.ref,
        source.repo,
        path.basename(sourceRoot),
      ],
      parent,
    );
  }

  const head = headCommit(project);
  const reason = skipInstall ? null : installReason(project, head);
  if (reason) {
    console.log(`  installing its dependencies — ${reason}`);
    // --ignore-scripts: nothing in the checkout is executed, only imported.
    run(
      "pnpm",
      ["install", "--frozen-lockfile", "--ignore-scripts"],
      sourceRoot,
    );
  } else if (!skipInstall) {
    console.log(
      "  install skipped — no dependency manifest moved since the last build (--install to force)",
    );
  }

  console.log(`  at ${short(head.sha)} — ${head.subject}`);

  // What to read next. A commit count is the difference between "something moved over
  // there" and a list of commits somebody can actually go and read.
  const state = readState(project);
  if (!state) {
    console.log("  nothing built from it yet — run `pnpm build`");
  } else if (state.sha === head.sha) {
    console.log("  which is the commit the committed facts were built from");
  } else if (ensureRange(project, state.sha)) {
    const n = commitsBetween(project, state.sha, head.sha).length;
    console.log(
      `  ${String(n)} commit(s) since ${short(state.sha)}, which the committed facts were ` +
        `built from — run \`pnpm drift ${project.id}\` for the cited files among them`,
    );
  } else {
    console.log(
      `  the facts were built from ${short(state.sha)}; the range from it cannot be listed here`,
    );
  }
}

if (clean) {
  // Every checkout, then the tree they conventionally live in — so a project pointed
  // somewhere unusual is still removed, and nothing is left behind for the next tool
  // that globs.
  const gone: string[] = [];
  for (const project of loadProjects())
    if (existsSync(project.sourceRoot)) {
      rmSync(project.sourceRoot, { recursive: true, force: true });
      gone.push(project.source.root);
    }
  const sources = inDocs(".sources");
  if (existsSync(sources)) {
    rmSync(sources, { recursive: true, force: true });
    gone.push(path.relative(DOCS_ROOT, sources) + "/");
  }
  console.log(gone.length ? `Removed ${gone.join(", ")}` : "Nothing to remove");
} else {
  for (const project of selectProjects(process.argv.slice(2)))
    syncProject(project);
}
