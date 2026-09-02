/**
 * Pulls the source repository this explorer documents into a working checkout, so the docs
 * can be built from a clone of this repository alone. The checkout is disposable: it lives
 * under `.sources/`, is gitignored, and `--clean` removes it.
 *
 * Run: pnpm sync          fetch or clone, then install so the configs are importable
 *      pnpm sync --clean  remove the checkout entirely
 *
 * The install is not optional. The domain and gateway configs are imported as modules —
 * they are the same files the CDK app reads, which is why the counts can be trusted — so
 * the checkout needs its own dependencies resolvable. The alarm constructs are read as
 * text and parsed, and need nothing.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { DOCS_ROOT, SOURCE, SOURCE_ROOT } from "./lib/paths.js";

const clean = process.argv.includes("--clean");
const skipInstall = process.argv.includes("--no-install");

/** Inherits stdio so a slow clone or install shows progress rather than appearing hung. */
function run(cmd: string, args: string[], cwd: string) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

function capture(args: string[], cwd: string) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

if (clean) {
  // Remove the whole `.sources` tree, not just this one checkout, so nothing is left behind
  // for the next tool that globs.
  const sources = path.dirname(SOURCE_ROOT);
  if (existsSync(sources)) {
    rmSync(sources, { recursive: true, force: true });
    console.log(`Removed ${path.relative(DOCS_ROOT, sources)}/`);
  } else {
    console.log(`Nothing at ${SOURCE.root}`);
  }
  process.exit(0);
}

const parent = path.dirname(SOURCE_ROOT);
// git is run with this as its cwd, and a missing cwd surfaces as a confusing ENOENT on
// git itself rather than on the directory.
mkdirSync(parent, { recursive: true });

if (existsSync(path.join(SOURCE_ROOT, ".git"))) {
  console.log(`Fetching ${SOURCE.ref} in ${SOURCE.root}`);
  run("git", ["fetch", "--depth", "1", "origin", SOURCE.ref], SOURCE_ROOT);
  // Hard reset rather than pull: this checkout is disposable and must never carry local
  // edits, or the docs would be built from something nobody else can reproduce.
  run("git", ["reset", "--hard", `origin/${SOURCE.ref}`], SOURCE_ROOT);
  run("git", ["clean", "-fdx", "-e", "node_modules"], SOURCE_ROOT);
} else {
  console.log(`Cloning ${SOURCE.repo} (${SOURCE.ref}) into ${SOURCE.root}`);
  run(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "--branch",
      SOURCE.ref,
      SOURCE.repo,
      path.basename(SOURCE_ROOT),
    ],
    parent,
  );
}

const sha = capture(["rev-parse", "HEAD"], SOURCE_ROOT);
const subject = capture(["log", "-1", "--format=%s"], SOURCE_ROOT);

if (!skipInstall) {
  console.log("Installing its dependencies so the configs are importable");
  // --ignore-scripts: nothing in the checkout is executed, only imported.
  run(
    "pnpm",
    ["install", "--frozen-lockfile", "--ignore-scripts"],
    SOURCE_ROOT,
  );
}

console.log(`\n${SOURCE.root} is at ${sha.slice(0, 8)} — ${subject}`);
