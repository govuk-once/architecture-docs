/**
 * Synthesises each project's CDK app into CloudFormation templates, per stage, inside its
 * checkout — the input to the `cloudformation` derivation and the best thing for whoever
 * authors the model to read: fully expanded, per stage, nothing to reason through.
 *
 *   pnpm synth               every project that declares `synth`
 *   pnpm synth flex          one of them
 *
 * This is the one command in this repository that executes the source it documents.
 * `pnpm sync` and `pnpm build` never do; it is opt-in and explicit for that reason, and
 * what it runs is exactly the `synth.command` in the project's config, with the CDK app
 * run directly rather than through the `cdk` CLI. Directly, because the CLI insists on
 * resolving every context lookup against AWS, and a lookup this repository cannot make
 * (a KMS alias, say) is then a hard failure. The app alone writes a dummy value and
 * carries on, which is exactly right for counting resources by type.
 *
 * The app is handed the context its cdk.json declares plus two of the CLI's own flags:
 * no asset bundling (fast, no Docker), and construct-path metadata on every resource,
 * which is how the derivation names an alarm by its construct rather than by a hash.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";

import {
  assertCheckout,
  locateOrThrow,
  type Project,
  selectProjects,
} from "./lib/projects.js";

const fill = (s: string, st: { id: string; synth?: string }) =>
  s.replaceAll("{stage}", st.synth ?? "").replaceAll("{id}", st.id);

function synthProject(project: Project): void {
  const synth = project.config.synth;
  console.log(`\n${project.id}:`);
  if (!synth) {
    console.log("  no synth block — nothing to synthesise");
    return;
  }
  // A project reading several repositories synthesises in the one its cwd names.
  const at = locateOrThrow(project, synth.cwd, "synth.cwd");
  const root = at.source.dir;
  assertCheckout(project, at.source);
  const cwd = path.resolve(root, at.path);
  // The checkout is somebody else's repository; nothing here may reach outside it.
  if (!cwd.startsWith(root + path.sep))
    throw new Error(
      `projects/${project.id}: synth.cwd "${synth.cwd}" is outside the checkout`,
    );

  // cdk.json context is what the CLI would have passed, and cdk.context.json beside it is
  // what the CLI would have cached from earlier lookups — an app that looks a value up
  // gets the committed answer rather than a dummy. The two aws: flags are what the CLI
  // would have added. Path metadata is required by the derivation, not optional.
  const readJson = (file: string): Record<string, unknown> =>
    existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)
      : {};
  const declared = (readJson(path.join(cwd, "cdk.json")).context ??
    {}) as Record<string, unknown>;
  const cached = readJson(path.join(cwd, "cdk.context.json"));
  const context = {
    ...cached,
    ...declared,
    "aws:cdk:bundling-stacks": [],
    "aws:cdk:enable-path-metadata": true,
  };

  // What the app needs built before it can be run: UDP loads every function from a
  // build directory its own script writes. Run once, in the checkout, as the source
  // defines it — the same command its pipeline runs — never a stand-in for it.
  if (synth.prepare) {
    const at = locateOrThrow(project, synth.prepare.cwd, "synth.prepare.cwd");
    const prepCwd = path.resolve(at.source.dir, at.path);
    if (at.source !== locateOrThrow(project, synth.cwd, "synth.cwd").source)
      throw new Error(
        `projects/${project.id}: synth.prepare.cwd must be in the same source as synth.cwd`,
      );
    const [cmd, ...args] = synth.prepare.command;
    const started = Date.now();
    process.stdout.write(`  prepare: ${synth.prepare.command.join(" ")} … `);
    execFileSync(cmd ?? "", args, {
      cwd: prepCwd,
      stdio: ["ignore", "ignore", "inherit"],
    });
    console.log(`${((Date.now() - started) / 1000).toFixed(0)}s`);
  }

  for (const st of project.config.stages.filter((s) => s.synth)) {
    const outAt = locateOrThrow(
      project,
      fill(synth.output, st),
      "synth.output",
    );
    const out = path.resolve(root, outAt.path);
    if (outAt.source !== at.source || !out.startsWith(root + path.sep))
      throw new Error(
        `projects/${project.id}: synth.output "${synth.output}" is outside the checkout`,
      );
    rmSync(out, { recursive: true, force: true });
    const env = {
      ...process.env,
      ...Object.fromEntries(
        Object.entries(synth.env).map(([k, v]) => [k, fill(v, st)]),
      ),
      CDK_OUTDIR: out,
      CDK_CONTEXT_JSON: JSON.stringify({
        ...context,
        ...Object.fromEntries(
          Object.entries(synth.context ?? {}).map(([k, v]) => [k, fill(v, st)]),
        ),
      }),
    };
    const [cmd, ...args] = synth.command;
    const started = Date.now();
    process.stdout.write(`  ${st.id.padEnd(5)} ${st.synth ?? ""} … `);
    execFileSync(cmd ?? "", args, {
      cwd,
      env,
      stdio: ["ignore", "ignore", "inherit"],
    });
    const n = globSync("*.template.json", { cwd: out }).length;
    console.log(
      `${String(n)} templates in ${((Date.now() - started) / 1000).toFixed(0)}s → ${path.relative(root, out)}`,
    );
  }
}

for (const project of selectProjects(process.argv.slice(2)))
  synthProject(project);
