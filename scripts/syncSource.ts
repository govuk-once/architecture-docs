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
 * A project may read several repositories; each is pulled on its own, and each reports
 * where it stands against the commit it was last read up to.
 *
 * Only the checkout `pnpm synth` runs is installed — the CDK app has to resolve its
 * dependencies, so the first install is not optional there. A checkout nothing executes
 * is never installed: a Swift or Kotlin repository has nothing pnpm could install, and a
 * Node one read only for its files needs nothing.
 *
 * The install is the slowest step here, though, and most commits touch no manifest at
 * all. So it is skipped when nothing in the range since the last built commit changed
 * one — see lib/sourceState.ts for what that commit is and why it is recorded.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { DOCS_ROOT, inDocs } from "./lib/paths.js";
import {
  loadProjects,
  locateOrThrow,
  type Project,
  selectProjects,
  type Source,
  sourceLabel,
} from "./lib/projects.js";
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

/** The one checkout `pnpm synth` executes, and so the only one with dependencies to install. */
function installsIn(project: Project): Source | null {
  const synth = project.config.synth;
  return synth ? locateOrThrow(project, synth.cwd, "synth.cwd").source : null;
}

/**
 * Why a checkout has to be installed again, or null when it does not.
 *
 * The recorded commit is the last one the *facts* were built from, which may be behind
 * the last one installed. That only ever widens the range being examined, so the answer
 * errs towards installing — never towards skipping an install that was needed.
 */
function installReason(
  project: Project,
  source: Source,
  head: Commit,
): string | null {
  if (forceInstall) return "--install";
  if (!existsSync(path.join(source.dir, "node_modules")))
    return "the checkout has no node_modules yet";
  const state = readState(project, source);
  if (!state)
    return `no ${STATE_FILE}, so what has already been installed is unknown`;
  const base = state.derived.sha;
  if (base === head.sha) return null;
  if (!ensureRange(source, base))
    return `the range since ${short(base)} cannot be listed, so what changed is unknown`;
  const touched = changedFiles(source, base, head.sha).filter((f) =>
    MANIFEST.test(f),
  );
  return touched.length
    ? `${String(touched.length)} dependency manifest(s) changed: ${touched.slice(0, 3).join(", ")}`
    : null;
}

/** Fetch or clone, then report where the checkout now stands against the last build. */
function syncSource(project: Project, source: Source, installs: boolean) {
  console.log(`\n${sourceLabel(project, source)}:`);
  const parent = path.dirname(source.dir);
  // git is run with this as its cwd, and a missing cwd surfaces as a confusing ENOENT on
  // git itself rather than on the directory.
  mkdirSync(parent, { recursive: true });

  if (existsSync(path.join(source.dir, ".git"))) {
    console.log(`  fetching ${source.ref} in ${source.root}`);
    run("git", ["fetch", "--depth", "1", "origin", source.ref], source.dir);
    // Hard reset rather than pull: this checkout is disposable and must never carry local
    // edits, or the docs would be built from something nobody else can reproduce.
    run("git", ["reset", "--hard", `origin/${source.ref}`], source.dir);
    // node_modules survives an install decision; cdk.out survives so a sync that finds
    // the app untouched does not force a re-synth. `pnpm synth` always rewrites it.
    run(
      "git",
      ["clean", "-fdx", "-e", "node_modules", "-e", "cdk.out"],
      source.dir,
    );
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
        path.basename(source.dir),
      ],
      parent,
    );
  }

  const head = headCommit(source);
  const reason =
    skipInstall || !installs ? null : installReason(project, source, head);
  if (reason) {
    console.log(`  installing its dependencies — ${reason}`);
    // --ignore-scripts: no lifecycle script runs. `pnpm synth` is the only command that
    // executes the checkout, and it is opt-in.
    run(
      "pnpm",
      ["install", "--frozen-lockfile", "--ignore-scripts"],
      source.dir,
    );
  } else if (!installs) {
    console.log("  no install — nothing synthesises from this checkout");
  } else if (!skipInstall) {
    console.log(
      "  install skipped — no dependency manifest moved since the last build (--install to force)",
    );
  }

  console.log(`  at ${short(head.sha)} — ${head.subject}`);

  // What to read next. A commit count is the difference between "something moved over
  // there" and a list of commits somebody can actually go and read.
  const state = readState(project, source);
  const read = state?.read?.sha;
  if (!state) {
    console.log("  nothing built from it yet — run `pnpm build`");
  } else if (read === head.sha) {
    console.log("  and the model has been read up to exactly this commit");
  } else if (!read) {
    console.log(
      `  nothing records how far the model has been read — run \`pnpm drift ${project.id}\``,
    );
  } else if (ensureRange(source, read)) {
    const n = commitsBetween(source, read, head.sha).length;
    console.log(
      `  ${String(n)} commit(s) since ${short(read)}, the last one read — run ` +
        `\`pnpm drift ${project.id}\` for the cited files among them`,
    );
  } else {
    console.log(
      `  the model was read up to ${short(read)}; the range from it cannot be listed here`,
    );
  }
}

if (clean) {
  // Every checkout, then the tree they conventionally live in — so a project pointed
  // somewhere unusual is still removed, and nothing is left behind for the next tool
  // that globs.
  const gone: string[] = [];
  for (const project of loadProjects())
    for (const source of project.sources)
      if (existsSync(source.dir)) {
        rmSync(source.dir, { recursive: true, force: true });
        gone.push(source.root);
      }
  const sources = inDocs(".sources");
  if (existsSync(sources)) {
    rmSync(sources, { recursive: true, force: true });
    gone.push(path.relative(DOCS_ROOT, sources) + "/");
  }
  console.log(gone.length ? `Removed ${gone.join(", ")}` : "Nothing to remove");
} else {
  for (const project of selectProjects(process.argv.slice(2))) {
    const installs = installsIn(project);
    for (const source of project.sources)
      syncSource(project, source, source === installs);
  }
}
