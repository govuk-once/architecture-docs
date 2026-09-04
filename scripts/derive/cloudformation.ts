/**
 * The one derivation: counts read out of CloudFormation templates, declared in config.
 *
 * Every project this site documents is an AWS CDK app, and `cdk synth` turns each into
 * templates of one shape — `Resources: { LogicalId: { Type, Properties } }` — however
 * differently their source is laid out. That is the shared data a config-only deriver
 * can count, and it is a better source than the code: a construct instantiated in a loop
 * is one line of source and many resources in a template.
 *
 * What to count is `derive.counts` in project.config.json. The vocabulary is deliberately
 * small and closed — see `CountSpec` — because a count that needs more than this is a
 * claim that belongs in prose, cited to the code, not a number the build vouches for.
 *
 * Only `Type`, the logical id and the CDK construct path are read from a resource, plus
 * the few properties a `distinctBy` count names in `capture`. Nothing else, so an asset
 * hash changing cannot churn the committed facts.
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import type { CountSpec, Project } from "../lib/projects.js";
import { builtFrom } from "../lib/projects.js";
import { type Derivation, type DerivedFacts, requireInputs } from "./index.js";

interface Resource {
  Type: string;
  Properties?: Record<string, unknown>;
  Metadata?: Record<string, unknown>;
}

interface Template {
  /** The file name without `.template.json`, e.g. `development-dvla`. */
  name: string;
  resources: Record<string, Resource>;
}

/** A per-stage record keyed by the name the stage goes by in the facts. */
type PerStage = Record<string, number>;

/** `{stage}` is the value the source's stage variable took; `{id}` the stage's id here. */
const fill = (s: string, st: { id: string; synth?: string }) =>
  s.replaceAll("{stage}", st.synth ?? "").replaceAll("{id}", st.id);

function readTemplates(project: Project, pattern: string): Template[] {
  const files = globSync(pattern, { cwd: project.sourceRoot });
  return files
    .map((f) => {
      const file = path.join(project.sourceRoot, f);
      const parsed = JSON.parse(readFileSync(file, "utf8")) as {
        Resources?: Record<string, Resource>;
      };
      return {
        name: path.basename(f).replace(/\.template\.json$/, ""),
        resources: parsed.Resources ?? {},
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The construct id and its parent, from the `aws:cdk:path` CDK writes into every
 * resource's metadata: `stack/Parent/Id/Resource`. The synth step turns that metadata on.
 * Without it the logical id minus its 8-hex suffix is the best available, and the scope
 * is unknown.
 */
function construct(
  logicalId: string,
  r: Resource,
): { id: string; scope: string } {
  const p = r.Metadata?.["aws:cdk:path"];
  if (typeof p === "string" && p) {
    const segs = p.split("/");
    if (segs.at(-1) === "Resource") segs.pop();
    return { id: segs.at(-1) ?? logicalId, scope: segs.at(-2) ?? "" };
  }
  return { id: logicalId.replace(/[0-9A-F]{8}$/, ""), scope: "" };
}

/** A property as one stable string: a `Ref`/`Fn::*` becomes the name it refers to. */
function render(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v !== "object") return "";
  if (Array.isArray(v)) return v.map(render).filter(Boolean).join(", ");
  const o = v as Record<string, unknown>;
  if (typeof o.Ref === "string") return o.Ref;
  const fn = Object.keys(o).find((k) => k.startsWith("Fn::"));
  if (fn) return render(o[fn]);
  return JSON.stringify(o);
}

/** Every value a property takes across a kind's instances — one string, or several. */
function collapse(values: Set<string>): string {
  return [...values].filter(Boolean).sort().join(" | ");
}

function matches(spec: CountSpec, st: { id: string; synth?: string }) {
  const template = spec.template ? new RegExp(fill(spec.template, st)) : null;
  const logicalId = spec.logicalId ? new RegExp(spec.logicalId) : null;
  const per = spec.perTemplate ? new RegExp(fill(spec.perTemplate, st)) : null;
  return {
    template: (t: Template) =>
      (!template || template.test(t.name)) && (!per || per.test(t.name)),
    resource: (lid: string, r: Resource) =>
      r.Type === spec.type && (!logicalId || logicalId.test(lid)),
    per,
  };
}

function alias(
  scope: string,
  aliases: Record<string, string> | undefined,
): string {
  for (const [re, name] of Object.entries(aliases ?? {}))
    if (new RegExp(re).test(scope)) return name;
  return scope;
}

function deriveSync(project: Project): DerivedFacts {
  const inputs = requireInputs(project, derivation);
  const pattern = inputs.templates ?? "";
  const stages = project.config.stages.filter((s) => s.synth);
  const counts = project.derive?.counts ?? {};

  const byStage = new Map<string, Template[]>();
  for (const st of stages) {
    const templates = readTemplates(project, fill(pattern, st));
    if (!templates.length)
      throw new Error(
        `projects/${project.id}: no templates for stage "${st.id}" at ` +
          `${fill(pattern, st)} under ${project.source.root} — run \`pnpm synth ${project.id}\``,
      );
    byStage.set(st.id, templates);
  }

  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(counts)) {
    if (spec.distinctBy) {
      // One entry per distinct (scope, construct id), across every stage it appears in.
      const kinds = new Map<
        string,
        {
          scope: string;
          id: string;
          stages: Set<string>;
          props: Map<string, Set<string>>;
        }
      >();
      for (const st of stages) {
        const m = matches(spec, st);
        for (const t of byStage.get(st.id) ?? [])
          if (m.template(t))
            for (const [lid, r] of Object.entries(t.resources)) {
              if (!m.resource(lid, r)) continue;
              const c = construct(lid, r);
              const scope = alias(c.scope, spec.scopeAliases);
              const key = `${scope}/${c.id}`;
              const k = kinds.get(key) ?? {
                scope,
                id: c.id,
                stages: new Set<string>(),
                props: new Map<string, Set<string>>(),
              };
              k.stages.add(st.facts);
              for (const p of spec.capture ?? []) {
                const set = k.props.get(p) ?? new Set<string>();
                set.add(render(r.Properties?.[p]));
                k.props.set(p, set);
              }
              kinds.set(key, k);
            }
      }
      out[name] = [...kinds.values()]
        .sort(
          (a, b) => a.scope.localeCompare(b.scope) || a.id.localeCompare(b.id),
        )
        .map((k) => ({
          scope: k.scope,
          id: k.id,
          stages: [...k.stages],
          ...Object.fromEntries([...k.props].map(([p, v]) => [p, collapse(v)])),
        }));
      continue;
    }
    if (spec.perTemplate) {
      // One per-stage record per matching template, keyed by the pattern's `name` group.
      const rows: Record<string, PerStage> = {};
      for (const st of stages) {
        const m = matches(spec, st);
        for (const t of byStage.get(st.id) ?? []) {
          const hit = m.per?.exec(t.name);
          const key = hit?.groups?.name;
          if (!hit || !key || !m.template(t)) continue;
          const n = Object.entries(t.resources).filter(([lid, r]) =>
            m.resource(lid, r),
          ).length;
          (rows[key] ??= Object.fromEntries(stages.map((s) => [s.facts, 0])))[
            st.facts
          ] = n;
        }
      }
      out[name] = Object.fromEntries(
        Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)),
      );
      continue;
    }
    const per: PerStage = {};
    for (const st of stages) {
      const m = matches(spec, st);
      const templates = (byStage.get(st.id) ?? []).filter(m.template);
      per[st.facts] = spec.templatesContaining
        ? templates.filter((t) =>
            Object.entries(t.resources).some(([lid, r]) => m.resource(lid, r)),
          ).length
        : templates.reduce(
            (n, t) =>
              n +
              Object.entries(t.resources).filter(([lid, r]) =>
                m.resource(lid, r),
              ).length,
            0,
          );
    }
    out[name] = per;
  }

  return {
    generatedFrom: builtFrom(project),
    stages: stages.map((s) => s.facts),
    counts: out,
  };
}

/** Sync inside, a promise outside: a missing template rejects rather than throwing early. */
const derive = (project: Project): Promise<DerivedFacts> =>
  Promise.resolve().then(() => deriveSync(project));

export const derivation: Derivation = {
  files: ["scripts/derive/cloudformation.ts"],
  inputs: ["templates"],
  derive,
  summary: (facts) => {
    const counts = (facts.counts ?? {}) as Record<string, unknown>;
    return Object.entries(counts)
      .map(([k, v]) =>
        Array.isArray(v)
          ? `${k}: ${String(v.length)} distinct`
          : `${k}: ${JSON.stringify(v)}`,
      )
      .join("\n");
  },
};

/** Exported for the tests; `derivation` is the only production entry point. */
export const internal = { construct, render, collapse, fill };
