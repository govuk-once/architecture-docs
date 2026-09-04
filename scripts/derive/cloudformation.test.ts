import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { CountSpec, Project } from "../lib/projects";
import { derivation, internal } from "./cloudformation";

/** A checkout with synthesised templates for two stages, in a throwaway directory. */
function checkout(templates: Record<string, Record<string, object>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "cfn-"));
  for (const [rel, resources] of Object.entries(templates)) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ Resources: resources }));
  }
  return root;
}

const res = (Type: string, cdkPath?: string, Properties?: object) => ({
  Type,
  ...(Properties ? { Properties } : {}),
  ...(cdkPath ? { Metadata: { "aws:cdk:path": cdkPath } } : {}),
});

function project(root: string, counts: Record<string, CountSpec>): Project {
  const stages = [
    { id: "dev", label: "Dev", facts: "development", synth: "development" },
    { id: "prod", label: "Prod", facts: "production", synth: "production" },
  ];
  return {
    id: "t",
    config: { stages } as Project["config"],
    source: { repo: "x", ref: "main", root: "." },
    derive: {
      module: "cloudformation",
      inputs: { templates: "cdk.out/{id}/*.template.json" },
      counts,
    },
    dir: root,
    modelDir: root,
    factsPath: path.join(root, "f.json"),
    statePath: path.join(root, "s.json"),
    sourceRoot: root,
    pagePath: path.join(root, "index.html"),
    href: "t/",
  };
}

const fixture = () =>
  checkout({
    "cdk.out/dev/development-alpha.template.json": {
      FnA1: res("AWS::Lambda::Function"),
      FnA2: res("AWS::Lambda::Function"),
      PublicRootGet: res("AWS::ApiGateway::Method"),
      PrivateRootGet: res("AWS::ApiGateway::Method"),
      Auth: res("AWS::ApiGateway::Authorizer"),
      FnA1Alarm: res(
        "AWS::CloudWatch::Alarm",
        "development-alpha/FnA1/FnA1Alarm/ErrorRate/Resource",
        {
          Threshold: 1,
          AlarmActions: [{ Ref: "CriticalTopic" }],
        },
      ),
      FnA2Alarm: res(
        "AWS::CloudWatch::Alarm",
        "development-alpha/FnA2/FnA2Alarm/ErrorRate/Resource",
        {
          Threshold: 1,
          AlarmActions: [{ Ref: "CriticalTopic" }],
        },
      ),
    },
    "cdk.out/dev/development-beta.template.json": {
      FnB1: res("AWS::Lambda::Function"),
      PublicRootGet: res("AWS::ApiGateway::Method"),
    },
    "cdk.out/dev/development-FlexPlatform.template.json": {
      Health: res("AWS::ApiGateway::Method"),
      Gw5xx: res(
        "AWS::CloudWatch::Alarm",
        "development-FlexPlatform/GatewayAlarms/5xxErrorRate/Resource",
        {
          Threshold: 5,
          AlarmActions: [{ Ref: "SsmParameterValuecritical" }],
        },
      ),
    },
    "cdk.out/prod/production-alpha.template.json": {
      FnA1: res("AWS::Lambda::Function"),
      Auth: res("AWS::ApiGateway::Authorizer"),
    },
  });

describe("cloudformation derivation", () => {
  it("counts a type per stage, scoped by template and logical id", async () => {
    const facts = await derivation.derive(
      project(fixture(), {
        publicRoutes: {
          type: "AWS::ApiGateway::Method",
          template: "^{stage}-(?!Flex)",
          logicalId: "^PublicRoot",
        },
      }),
    );
    expect((facts.counts as Record<string, unknown>).publicRoutes).toEqual({
      development: 2,
      production: 0,
    });
  });

  it("emits one record per matching template with perTemplate, zero where absent", async () => {
    const facts = await derivation.derive(
      project(fixture(), {
        fns: {
          type: "AWS::Lambda::Function",
          perTemplate: "^{stage}-(?<name>(?!Flex)[a-z]+)$",
        },
      }),
    );
    expect((facts.counts as Record<string, unknown>).fns).toEqual({
      alpha: { development: 2, production: 1 },
      beta: { development: 1, production: 0 },
    });
  });

  it("counts templates containing a match rather than the matches", async () => {
    const facts = await derivation.derive(
      project(fixture(), {
        withAuth: {
          type: "AWS::ApiGateway::Authorizer",
          templatesContaining: true,
        },
      }),
    );
    expect((facts.counts as Record<string, unknown>).withAuth).toEqual({
      development: 1,
      production: 1,
    });
  });

  /* Alarms are one construct per function, so instances multiply; the table wants kinds. */
  it("collapses instances to distinct constructs, scoped by alias, capturing properties", async () => {
    const facts = await derivation.derive(
      project(fixture(), {
        alarms: {
          type: "AWS::CloudWatch::Alarm",
          distinctBy: "construct",
          scopeAliases: { "^GatewayAlarms$": "API Gateway", Alarm$: "Lambda" },
          capture: ["Threshold", "AlarmActions"],
        },
      }),
    );
    expect((facts.counts as Record<string, unknown>).alarms).toEqual([
      {
        scope: "API Gateway",
        id: "5xxErrorRate",
        stages: ["development"],
        Threshold: "5",
        AlarmActions: "SsmParameterValuecritical",
      },
      {
        scope: "Lambda",
        id: "ErrorRate",
        stages: ["development"],
        Threshold: "1",
        AlarmActions: "CriticalTopic",
      },
    ]);
  });

  it("refuses to emit zeros for a stage whose templates are missing", async () => {
    const root = checkout({
      "cdk.out/dev/development-alpha.template.json": {},
    });
    await expect(
      derivation.derive(
        project(root, { n: { type: "AWS::Lambda::Function" } }),
      ),
    ).rejects.toThrow(/pnpm synth t/);
  });

  it("is deterministic across runs", async () => {
    const p = project(fixture(), {
      alarms: {
        type: "AWS::CloudWatch::Alarm",
        distinctBy: "construct",
        capture: ["Threshold"],
      },
      fns: {
        type: "AWS::Lambda::Function",
        perTemplate: "^{stage}-(?<name>[a-z]+)$",
      },
    });
    expect(JSON.stringify(await derivation.derive(p))).toBe(
      JSON.stringify(await derivation.derive(p)),
    );
  });
});

describe("internal", () => {
  it("names a construct from its CDK path, falling back to the hashless logical id", () => {
    expect(
      internal.construct("X", {
        Type: "T",
        Metadata: { "aws:cdk:path": "s/Parent/Child/Resource" },
      }),
    ).toEqual({ id: "Child", scope: "Parent" });
    expect(
      internal.construct("GatewayAlarms5xxErrorRate9CA27D28", { Type: "T" }),
    ).toEqual({ id: "GatewayAlarms5xxErrorRate", scope: "" });
  });
  it("renders references by name and scalars as strings", () => {
    expect(internal.render({ Ref: "Topic" })).toBe("Topic");
    expect(internal.render({ "Fn::ImportValue": "x" })).toBe("x");
    expect(internal.render([{ Ref: "A" }, { Ref: "B" }])).toBe("A, B");
    expect(internal.render(3)).toBe("3");
    expect(internal.render(undefined)).toBe("");
  });
  it("fills {stage} and {id}", () => {
    expect(
      internal.fill("cdk.out/{id}/{stage}-x", {
        id: "dev",
        synth: "development",
      }),
    ).toBe("cdk.out/dev/development-x");
  });
});
