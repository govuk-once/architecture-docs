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
  assertSourceRoot,
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
  assertSourceRoot(project);
  const cwd = path.resolve(project.sourceRoot, synth.cwd);
  // The checkout is somebody else's repository; nothing here may reach outside it.
  if (!cwd.startsWith(project.sourceRoot + path.sep))
    throw new Error(
      `projects/${project.id}: synth.cwd "${synth.cwd}" is outside the checkout`,
    );

  // cdk.json context is what the CLI would have passed; the two aws: flags are what it
  // would have added. Path metadata is required by the derivation, not optional.
  const cdkJson = path.join(cwd, "cdk.json");
  const declared = existsSync(cdkJson)
    ? ((
        JSON.parse(readFileSync(cdkJson, "utf8")) as {
          context?: Record<string, unknown>;
        }
      ).context ?? {})
    : {};
  const context = {
    ...declared,
    "aws:cdk:bundling-stacks": [],
    "aws:cdk:enable-path-metadata": true,
  };

  for (const st of project.config.stages.filter((s) => s.synth)) {
    const out = path.resolve(project.sourceRoot, fill(synth.output, st));
    if (!out.startsWith(project.sourceRoot + path.sep))
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
      CDK_CONTEXT_JSON: JSON.stringify(context),
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
      `${String(n)} templates in ${((Date.now() - started) / 1000).toFixed(0)}s → ${path.relative(project.sourceRoot, out)}`,
    );
  }
}

for (const project of selectProjects(process.argv.slice(2)))
  synthProject(project);
