/**
 * The one derivation: counts read out of CloudFormation templates, declared in config.
 *
 * A CDK app becomes templates of one shape when `cdk synth` runs — `Resources: {
 * LogicalId: { Type, Properties } }` — however differently its source is laid out. A SAM
 * or plain CloudFormation app already is one, written as YAML. Either is the shared data a
 * config-only deriver can count, and a better source than the code: a construct
 * instantiated in a loop is one line of source and many resources in a template.
 *
 * What to count is `derive.counts` in project.config.json. The vocabulary is deliberately
 * small and closed — see `CountSpec` — because a count that needs more than this is a
 * claim that belongs in prose, cited to the code, not a number the build vouches for.
 *
 * Only `Type`, the logical id, a resource's `Condition` and the CDK construct path are
 * read from a resource, plus the few properties a `distinctBy` count names in `capture`.
 * Nothing else, so an asset hash changing cannot churn the committed facts.
 *
 * A synthesised template is already per stage. One read as written is the same file for
 * every stage, and its `Conditions` decide what each stage deploys — so a stage that
 * declares the `parameters` it deploys with has each resource's `Condition` evaluated
 * against them, and a resource whose condition is false there is not counted there. A
 * condition that cannot be evaluated from literals and parameters fails the derivation
 * rather than being guessed at.
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse as parseYaml, type Tags, YAMLMap, YAMLSeq } from "yaml";

import type { CountSpec, Project, ProjectConfig } from "../lib/projects.js";
import { builtFrom, locateOrThrow } from "../lib/projects.js";
import { type Derivation, type DerivedFacts, requireInputs } from "./index.js";

interface Resource {
  Type: string;
  Condition?: string;
  Properties?: Record<string, unknown>;
  Metadata?: Record<string, unknown>;
}

interface Template {
  /**
   * `development-dvla` for a synthesised `development-dvla.template.json`; the path in the
   * checkout without its extension — `services/auth/template` — for anything else.
   */
  name: string;
  resources: Record<string, Resource>;
  conditions: Record<string, unknown>;
  parameters: Record<string, { Default?: unknown } | undefined>;
}

type Stage = ProjectConfig["stages"][number];

/** A per-stage record keyed by the name the stage goes by in the facts. */
type PerStage = Record<string, number>;

/** `{stage}` is the value the source's stage variable took; `{id}` the stage's id here. */
const fill = (s: string, st: { id: string; synth?: string }) =>
  s.replaceAll("{stage}", st.synth ?? "").replaceAll("{id}", st.id);

/**
 * CloudFormation's short-form intrinsics — `!Ref`, `!If`, `!Equals` — read back into the
 * long form a JSON template spells out, so both read the same from here on.
 */
const INTRINSICS = [
  "Ref",
  "Condition",
  "Sub",
  "GetAtt",
  "If",
  "Equals",
  "Not",
  "And",
  "Or",
  "FindInMap",
  "Join",
  "Select",
  "Split",
  "ImportValue",
  "Base64",
  "Cidr",
  "GetAZs",
  "Transform",
];
const CFN_TAGS: Tags = INTRINSICS.flatMap((n) => {
  const key = n === "Ref" || n === "Condition" ? n : `Fn::${n}`;
  return [
    {
      tag: `!${n}`,
      resolve: (s: string) => ({
        [key]: n === "GetAtt" ? s.split(".") : s,
      }),
    },
    {
      tag: `!${n}`,
      collection: "seq" as const,
      nodeClass: YAMLSeq,
      resolve: (seq: YAMLSeq) => ({ [key]: seq.toJSON() as unknown }),
    },
    {
      tag: `!${n}`,
      collection: "map" as const,
      nodeClass: YAMLMap,
      resolve: (map: YAMLMap) => ({ [key]: map.toJSON() as unknown }),
    },
  ] as Tags;
});

function readTemplates(project: Project, pattern: string): Template[] {
  const at = locateOrThrow(project, pattern, "derive.inputs.templates");
  const root = at.source.dir;
  return globSync(at.path, { cwd: root })
    .map((f) => {
      const text = readFileSync(path.join(root, f), "utf8");
      const parsed = (
        f.endsWith(".json")
          ? JSON.parse(text)
          : parseYaml(text, { customTags: CFN_TAGS, logLevel: "error" })
      ) as {
        Resources?: Record<string, Resource>;
        Conditions?: Record<string, unknown>;
        Parameters?: Record<string, { Default?: unknown }>;
      };
      return {
        name: f.endsWith(".template.json")
          ? path.basename(f).replace(/\.template\.json$/, "")
          : f.replace(/\.(json|ya?ml)$/, ""),
        resources: parsed.Resources ?? {},
        conditions: parsed.Conditions ?? {},
        parameters: parsed.Parameters ?? {},
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A value a condition compares: a literal, or a parameter the stage deploys with. */
function conditionValue(v: unknown, t: Template, st: Stage): string {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return String(v);
  const ref = (v as { Ref?: unknown } | null)?.Ref;
  if (typeof ref === "string") {
    const given = st.parameters?.[ref] ?? t.parameters[ref]?.Default;
    if (typeof given === "string" || typeof given === "number")
      return String(given);
    throw new Error(
      `${t.name}: parameter ${ref} has no value for stage "${st.id}" and no Default — ` +
        `declare it in that stage's parameters`,
    );
  }
  throw new Error(
    `${t.name}: cannot evaluate ${JSON.stringify(v)} in a condition — only literals and ` +
      `parameter references`,
  );
}

/** Whether a condition expression holds for a stage, from literals and parameters alone. */
function holds(t: Template, expr: unknown, st: Stage, seen: string[]): boolean {
  const o = (expr ?? {}) as Record<string, unknown>;
  const args = (k: string) => (Array.isArray(o[k]) ? o[k] : null);
  if (typeof o.Condition === "string")
    return namedHolds(t, o.Condition, st, seen);
  const eq = args("Fn::Equals");
  if (eq?.length === 2)
    return conditionValue(eq[0], t, st) === conditionValue(eq[1], t, st);
  const not = args("Fn::Not");
  if (not?.length === 1) return !holds(t, not[0], st, seen);
  const and = args("Fn::And");
  if (and) return and.every((c) => holds(t, c, st, seen));
  const or = args("Fn::Or");
  if (or) return or.some((c) => holds(t, c, st, seen));
  throw new Error(
    `${t.name}: cannot evaluate the condition ${JSON.stringify(expr)}`,
  );
}

function namedHolds(
  t: Template,
  name: string,
  st: Stage,
  seen: string[] = [],
): boolean {
  if (seen.includes(name))
    throw new Error(
      `${t.name}: condition ${name} refers to itself (${seen.join(" → ")})`,
    );
  if (!(name in t.conditions))
    throw new Error(`${t.name}: condition ${name} is not declared`);
  return holds(t, t.conditions[name], st, [...seen, name]);
}

/** Whether a stage deploys a resource: always, unless its parameters make its condition false. */
const deploys = (t: Template, r: Resource, st: Stage) =>
  !st.parameters || !r.Condition || namedHolds(t, r.Condition, st);

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

function matches(spec: CountSpec, st: Stage) {
  const template = spec.template ? new RegExp(fill(spec.template, st)) : null;
  const logicalId = spec.logicalId ? new RegExp(spec.logicalId) : null;
  const per = spec.perTemplate ? new RegExp(fill(spec.perTemplate, st)) : null;
  return {
    template: (t: Template) =>
      (!template || template.test(t.name)) && (!per || per.test(t.name)),
    resource: (t: Template, lid: string, r: Resource) =>
      r.Type === spec.type &&
      (!logicalId || logicalId.test(lid)) &&
      (!spec.hasProperty || r.Properties?.[spec.hasProperty] !== undefined) &&
      deploys(t, r, st),
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
  // With a synth step, only the stages it synthesises have templates. Without one, the
  // templates are the files as written, and every stage reads them.
  const synthesised = project.config.synth !== undefined;
  const stages = synthesised
    ? project.config.stages.filter((s) => s.synth)
    : project.config.stages;
  const counts = project.derive?.counts ?? {};

  const byStage = new Map<string, Template[]>();
  for (const st of stages) {
    const templates = readTemplates(project, fill(pattern, st));
    if (!templates.length)
      throw new Error(
        `projects/${project.id}: no templates for stage "${st.id}" at ` +
          `${fill(pattern, st)} — ` +
          (synthesised
            ? `run \`pnpm synth ${project.id}\``
            : `check derive.inputs.templates against the checkout`),
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
              if (!m.resource(t, lid, r)) continue;
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
            m.resource(t, lid, r),
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
            Object.entries(t.resources).some(([lid, r]) =>
              m.resource(t, lid, r),
            ),
          ).length
        : templates.reduce(
            (n, t) =>
              n +
              Object.entries(t.resources).filter(([lid, r]) =>
                m.resource(t, lid, r),
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
export const internal = { construct, render, collapse, fill, namedHolds };
