/**
 * Puts a stand-in for a package the checkout's install cannot reach from here into the
 * checkout, before the install.
 *
 *   pnpm stubs               every project whose synth block declares stubs
 *   pnpm stubs udp           one of them
 *
 * UDP's CDK app imports a tagging package published only to a private CodeArtifact
 * registry, and a public runner has no token for it. The app uses it for one thing —
 * tagging what it builds — and these docs count nothing from tags. So the config names the
 * package and a directory here holding a package of the same name that does nothing, and
 * this copies that directory into the checkout and points pnpm at it with an override, so
 * the install resolves the name without the registry. The checkout is disposable and
 * hard-reset on every sync, so `pnpm sync` applies the stubs again after every reset.
 *
 * What a stub leaves out of the templates is the stub's `why` to say, and a count that
 * depended on it would be a count the derivation could not stand behind.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseDocument } from "yaml";

import {
  assertCheckout,
  locateOrThrow,
  type Project,
  selectSourced,
  type Source,
} from "./lib/projects.js";

/** Where the stand-ins go inside the checkout. */
const STUB_DIR = ".arch-stubs";
const WORKSPACE = "pnpm-workspace.yaml";

/**
 * How a stubbed checkout is installed. The override is not in the committed lockfile, so
 * the install cannot be frozen. And pnpm's exotic-subdependency check, when it re-resolves
 * a lockfile in part, reports a plain registry package as "resolved via undefined" and
 * refuses it — tslib under @swc-node/register, in UDP's — so that check is off for this
 * install, from the command line rather than the source's own settings file. Every other
 * package still comes from the lockfile's resolution, and no lifecycle script runs.
 */
export const STUBBED_INSTALL_ARGS = [
  "install",
  "--no-frozen-lockfile",
  "--ignore-scripts",
  "--config.blockExoticSubdeps=false",
];

/**
 * The workspace file with one more override. pnpm reads overrides from here, and the
 * document is edited rather than rewritten so the source's own settings and comments
 * survive. Pure, so the merge is testable without a checkout.
 */
export function withOverride(
  workspace: string,
  pkg: string,
  target: string,
): string {
  const doc = parseDocument(workspace || "{}");
  doc.setIn(["overrides", pkg], target);
  return doc.toString();
}

/** The stubs a project declares, each checked against the directory it names. */
export function stubsOf(project: Project) {
  return (project.config.synth?.stubs ?? []).map((stub) => {
    const dir = path.join(project.dir, stub.dir);
    const manifest = path.join(dir, "package.json");
    if (!existsSync(manifest))
      throw new Error(
        `projects/${project.id}: stub "${stub.package}" names ${stub.dir}, which has no package.json`,
      );
    const name = (
      JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }
    ).name;
    if (name !== stub.package)
      throw new Error(
        `projects/${project.id}: stub ${stub.dir} is named "${String(name)}", not "${stub.package}"`,
      );
    return { ...stub, from: dir, into: path.basename(stub.dir) };
  });
}

/** The checkout a project's stubs go into — the one its CDK app synthesises in. */
export function stubsInto(project: Project): Source | null {
  const synth = project.config.synth;
  return synth?.stubs?.length
    ? locateOrThrow(project, synth.cwd, "synth.cwd").source
    : null;
}

/**
 * Copies each stub into the checkout and points pnpm at it. Returns what it put there,
 * for the caller to print.
 */
export function applyStubs(project: Project, source: Source): string[] {
  const stubs = stubsOf(project);
  if (!stubs.length) return [];
  assertCheckout(project, source);
  const applied: string[] = [];
  let workspace = existsSync(path.join(source.dir, WORKSPACE))
    ? readFileSync(path.join(source.dir, WORKSPACE), "utf8")
    : "";
  for (const stub of stubs) {
    const into = path.join(source.dir, STUB_DIR, stub.into);
    mkdirSync(path.dirname(into), { recursive: true });
    cpSync(stub.from, into, { recursive: true });
    workspace = withOverride(
      workspace,
      stub.package,
      `link:${STUB_DIR}/${stub.into}`,
    );
    applied.push(stub.package);
  }
  writeFileSync(path.join(source.dir, WORKSPACE), workspace);
  return applied;
}

function main() {
  for (const project of selectSourced(process.argv.slice(2))) {
    const source = stubsInto(project);
    if (!source) continue;
    console.log(`\n${project.id}:`);
    for (const stub of stubsOf(project))
      console.log(`  ${stub.package} — ${stub.why}`);
    const applied = applyStubs(project, source);
    console.log(
      `  ${String(applied.length)} stub(s) in ${source.root}/${STUB_DIR}, overridden in ${WORKSPACE} — install with: pnpm ${STUBBED_INSTALL_ARGS.join(" ")}`,
    );
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
