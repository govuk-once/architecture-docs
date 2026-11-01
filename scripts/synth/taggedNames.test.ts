/**
 * The generator lists what the templates tag, by explicit name, and nothing else: an
 * untagged resource is not the pipeline's to alarm, and a tagged one with no plain name
 * would have left a hole in the list the pipeline never has.
 */
import { describe, expect, it } from "vitest";

import { generatedPath, taggedNames } from "./taggedNames.js";

const OPTIONS = {
  tag: { Monitor: "true" },
  shape: {
    lambdaNames: { type: "AWS::Lambda::Function", name: "FunctionName" },
    tableNames: { type: "AWS::DynamoDB::Table", name: "TableName" },
  },
};
const fn = (name: unknown, tags?: Record<string, string>) => ({
  Type: "AWS::Lambda::Function",
  Properties: {
    FunctionName: name,
    Tags: tags && Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
  },
});
const table = (name: string, tags?: Record<string, string>) => ({
  Type: "AWS::DynamoDB::Table",
  Properties: {
    TableName: name,
    Tags: tags && Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
  },
});

describe("taggedNames", () => {
  it("lists the tagged resources of each wanted type by name, sorted, across templates", () => {
    const out = taggedNames(
      [
        {
          file: "main.template.json",
          body: {
            Resources: {
              B: fn("postData-dev", { Monitor: "true", Other: "x" }),
              A: fn("getData-dev", { Monitor: "true" }),
              Quiet: fn("health-dev", { Monitor: "false" }),
              Untagged: fn("purge-dev"),
              T: table("udp-data-dev", { Monitor: "true" }),
              Bucket: {
                Type: "AWS::S3::Bucket",
                Properties: { Tags: [{ Key: "Monitor", Value: "true" }] },
              },
            },
          },
        },
        {
          file: "sar.template.json",
          body: { Resources: { S: fn("createSar-dev", { Monitor: "true" }) } },
        },
      ],
      OPTIONS,
    );
    expect(JSON.parse(out)).toEqual({
      lambdaNames: ["createSar-dev", "getData-dev", "postData-dev"],
      tableNames: ["udp-data-dev"],
    });
  });

  it("refuses a tagged resource whose name is not a plain string", () => {
    expect(() =>
      taggedNames(
        [
          {
            file: "main.template.json",
            body: {
              Resources: {
                J: fn({ "Fn::Join": ["-", ["a", "b"]] }, { Monitor: "true" }),
              },
            },
          },
        ],
        OPTIONS,
      ),
    ).toThrow(
      /main.template.json: J is tagged but its FunctionName is not a plain string/,
    );
  });

  it("needs a tag and a shape", () => {
    expect(() => taggedNames([], { tag: { Monitor: "true" } })).toThrow(
      /needs a tag/,
    );
  });
});

describe("generatedPath", () => {
  it("keeps a generated file inside the checkout", () => {
    expect(generatedPath("/c", "cdk/.generated/x.json")).toBe(
      "/c/cdk/.generated/x.json",
    );
    expect(() => generatedPath("/c", "../x.json")).toThrow(
      /outside the checkout/,
    );
    expect(() => generatedPath("/c", "/etc/x")).toThrow(/outside the checkout/);
  });
});
