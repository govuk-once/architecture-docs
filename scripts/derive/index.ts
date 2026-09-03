/**
 * How a project turns its source into the facts the build holds its diagrams to.
 *
 * This is the one part of the pipeline that cannot be shared. FLEX's counts are
 * trustworthy because they come from importing the same `domain.config.ts` files the CDK
 * app reads; that is a fact about FLEX, not about architecture documentation, and UDP or
 * UNS will have their own shape or none at all. So the schema knowledge lives in a module
 * per project under `scripts/derive/`, named by that project's `derive.module`, and
 * everything upstream and downstream of it is generic.
 *
 * A project with no `derive` block has no generated facts. That is a supported state, not
 * a broken one: every check that reads them skips, and its numbers are prose maintained
 * by hand like any other claim.
 */
import type { Project } from "../lib/projects.js";

/** Whatever shape a project's derivation emits. The checks navigate it by name. */
export type DerivedFacts = Record<string, unknown>;

export interface Derivation {
  /**
   * The files whose contents change what the same source commit derives to, relative to
   * this repository. Hashed into architecture-source.json, so editing one re-derives
   * rather than leaving the previous output looking current.
   */
  files: string[];
  /** The inputs this module needs out of the project's `derive.inputs`. */
  inputs: string[];
  derive(project: Project): Promise<DerivedFacts>;
  /** One or two lines printed after a derivation, so a run says what it found. */
  summary(facts: DerivedFacts): string;
}

/**
 * Loaded by name rather than from a registry, so adding a project's derivation is adding
 * one file. A typo in the config fails here, naming the file it looked for.
 */
export async function loadDerivation(module: string): Promise<Derivation> {
  if (!/^[a-z][a-z0-9-]*$/.test(module))
    throw new Error(`derive.module "${module}" must be lowercase kebab-case`);
  let mod: { derivation?: Derivation };
  try {
    mod = (await import(`./${module}.js`)) as { derivation?: Derivation };
  } catch (err) {
    throw new Error(
      `No derivation "${module}" — expected scripts/derive/${module}.ts to export ` +
        `a \`derivation\`. Write one against that project's configs, or drop the ` +
        `\`derive\` block and maintain its counts by hand.`,
      { cause: err },
    );
  }
  if (!mod.derivation)
    throw new Error(
      `scripts/derive/${module}.ts does not export \`derivation\``,
    );
  return mod.derivation;
}

/** The inputs a derivation declares, checked before it runs so it can assume them. */
export function requireInputs(
  project: Project,
  derivation: Derivation,
): Record<string, string> {
  const inputs = project.derive?.inputs ?? {};
  const missing = derivation.inputs.filter((k) => !inputs[k]);
  if (missing.length)
    throw new Error(
      `projects/${project.id}: derive.inputs needs ${missing.join(", ")} for the ` +
        `"${project.derive?.module ?? "?"}" derivation`,
    );
  return inputs;
}
