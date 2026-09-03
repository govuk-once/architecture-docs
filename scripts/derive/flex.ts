/**
 * FLEX's derivation: domains, routes, access tiers, environments, service gateways and
 * their resources, straight from the configs the CDK app itself reads.
 *
 * The counts can be trusted precisely because this imports the same `domain.config.ts`
 * and `gateway.config.ts` modules the CDK app imports, rather than parsing a copy of
 * them. Alarms have no config to import, so they are read out of the CDK constructs'
 * TypeScript AST — see lib/extractAlarms.ts.
 *
 * buildArchitectureExplorer.ts checks the counts on the diagrams against what this emits
 * and fails when they disagree, so a route added to a domain cannot silently leave a
 * stale number on a diagram.
 *
 * None of this is portable to another project, and it is not meant to be: it is a
 * statement about FLEX's config schema. Another repository gets its own module beside
 * this one, or none — see ./index.ts.
 */
import { glob } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  type ArchitectureFacts,
  type DomainConfigShape,
  type DomainFact,
  type GatewayConfigShape,
  type GatewayFact,
  type PerStage,
  type RouteFact,
  type RouteTree,
  type Stage,
  STAGES,
} from "../lib/architectureTypes.js";
import { extractAlarms } from "../lib/extractAlarms.js";
import { builtFrom, type Project } from "../lib/projects.js";
import { type Derivation, type DerivedFacts, requireInputs } from "./index.js";

async function loadConfigs<T>(pattern: string, root: string): Promise<T[]> {
  const out: T[] = [];
  for await (const entry of glob(pattern, { cwd: root })) {
    // tsx transpiles the TypeScript config on import, so no extra loader is needed.
    const mod = (await import(pathToFileURL(path.join(root, entry)).href)) as {
      config?: T;
    };
    if (mod.config) out.push(mod.config);
  }
  return out;
}

function flatten(routes: RouteTree, commonAccess: string): RouteFact[] {
  const out: RouteFact[] = [];
  for (const [version, paths] of Object.entries(routes))
    for (const [routePath, methods] of Object.entries(paths))
      for (const [method, gateways] of Object.entries(methods))
        for (const gateway of ["public", "private"] as const) {
          const rc = gateways[gateway];
          if (!rc) continue;
          out.push({
            version,
            path: routePath,
            method,
            gateway,
            name: rc.name,
            access: rc.access ?? commonAccess,
            // route-level environments gate independently of the domain
            ...(rc.environments ? { environments: rc.environments } : {}),
          });
        }
  return out;
}

/** Mirrors isStageAllowed: a non-persistent stage ignores gating entirely. */
const allowed = (envs: string[] | undefined | null, stage: Stage) =>
  !envs || envs.includes(stage);

async function derive(project: Project): Promise<DerivedFacts> {
  // The globs come from the project's derive.inputs, so what this reads out of the
  // source is declared in config rather than spelled out again here.
  // requireInputs has already established that all three are present and non-empty.
  const inputs = requireInputs(project, derivation);
  const domainGlob = inputs.domainConfigs ?? "";
  const gatewayGlob = inputs.gatewayConfigs ?? "";
  const alarmConstructs = inputs.alarmConstructs ?? "";
  const root = project.sourceRoot;

  const domainConfigs = await loadConfigs<DomainConfigShape>(domainGlob, root);
  const gatewayConfigs = await loadConfigs<GatewayConfigShape>(
    gatewayGlob,
    root,
  );

  const domains: DomainFact[] = domainConfigs
    .map((c) => {
      const commonAccess = c.common?.access ?? "isolated";
      const routes = flatten(c.routes, commonAccess);
      const perStage = Object.fromEntries(
        STAGES.map((s) => [
          s,
          allowed(c.environments, s)
            ? routes.filter((r) => allowed(r.environments, s)).length
            : 0,
        ]),
      ) as Record<Stage, number>;
      return {
        name: c.name,
        environments: c.environments ?? null,
        commonAccess,
        timeoutSeconds: c.common?.function?.timeoutSeconds ?? null,
        routes,
        counts: {
          public: routes.filter((r) => r.gateway === "public").length,
          private: routes.filter((r) => r.gateway === "private").length,
          total: routes.length,
        },
        perStage: { ...perStage, ephemeral: routes.length },
        integrations: Object.entries(c.integrations ?? {}).map(([key, v]) => ({
          key,
          type: v.type,
          target: v.target ?? c.name,
          route: v.route,
        })),
        resources: Object.entries(c.resources ?? {}).map(([key, v]) => ({
          key,
          type: v.type,
          path: v.path,
          scope: v.scope ?? null,
        })),
        featureFlags: Object.keys(c.featureFlags ?? {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const gateways: GatewayFact[] = gatewayConfigs
    .map((c) => ({
      name: c.name,
      environments: c.environments,
      access: c.access,
      routeCount: Object.keys(c.routes).length,
      routes: Object.keys(c.routes),
      resources: Object.entries(c.resources ?? {}).map(([key, v]) => ({
        key,
        type: v.type,
        path: v.path,
        env: v.env ?? null,
      })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const tierOf = (d: DomainFact) => d.commonAccess;
  const totals = {
    domains: domains.length,
    gateways: gateways.length,
    routeFunctions: Object.fromEntries([
      ...STAGES.map((s) => [s, domains.reduce((n, d) => n + d.perStage[s], 0)]),
      ["ephemeral", domains.reduce((n, d) => n + d.perStage.ephemeral, 0)],
    ]) as PerStage,
    byTier: {
      egress: Object.fromEntries([
        ...STAGES.map((s) => [
          s,
          domains
            .filter((d) => tierOf(d) === "private")
            .reduce((n, d) => n + d.perStage[s], 0),
        ]),
        [
          "ephemeral",
          domains
            .filter((d) => tierOf(d) === "private")
            .reduce((n, d) => n + d.perStage.ephemeral, 0),
        ],
      ]) as PerStage,
      isolated: Object.fromEntries([
        ...STAGES.map((s) => [
          s,
          domains
            .filter((d) => tierOf(d) === "isolated")
            .reduce((n, d) => n + d.perStage[s], 0),
        ]),
        [
          "ephemeral",
          domains
            .filter((d) => tierOf(d) === "isolated")
            .reduce((n, d) => n + d.perStage.ephemeral, 0),
        ],
      ]) as PerStage,
    },
    routeMethods: {
      public: Object.fromEntries([
        ...STAGES.map((s) => [
          s,
          domains.reduce(
            (n, d) => n + (allowed(d.environments, s) ? d.counts.public : 0),
            0,
          ),
        ]),
        ["ephemeral", domains.reduce((n, d) => n + d.counts.public, 0)],
      ]) as PerStage,
      private: Object.fromEntries([
        ...STAGES.map((s) => [
          s,
          domains.reduce(
            (n, d) => n + (allowed(d.environments, s) ? d.counts.private : 0),
            0,
          ),
        ]),
        ["ephemeral", domains.reduce((n, d) => n + d.counts.private, 0)],
      ]) as PerStage,
    },
    domainsWithPublicRoutes: Object.fromEntries([
      ...STAGES.map((s) => [
        s,
        domains.filter((d) => allowed(d.environments, s) && d.counts.public > 0)
          .length,
      ]),
      ["ephemeral", domains.filter((d) => d.counts.public > 0).length],
    ]) as PerStage,
  };

  // Alarms come from the CDK constructs rather than a config, so they are read from
  // the source itself — see extractAlarms.
  const alarms = extractAlarms(root, alarmConstructs);

  return {
    generatedFrom: builtFrom(project),
    domains,
    gateways,
    totals,
    alarms,
  };
}

export const derivation: Derivation = {
  files: [
    "scripts/derive/flex.ts",
    "scripts/lib/extractAlarms.ts",
    "scripts/lib/architectureTypes.ts",
  ],
  inputs: ["domainConfigs", "gatewayConfigs", "alarmConstructs"],
  derive,
  summary: (facts) => {
    const f = facts as unknown as ArchitectureFacts;
    return (
      `${JSON.stringify(f.totals, null, 1)}\n` +
      `${String(f.alarms?.length ?? 0)} alarms`
    );
  },
};
