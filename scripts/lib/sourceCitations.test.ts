import { describe, expect, it } from "vitest";

import { collectCitations, globToRe } from "./sourceCitations";

describe("globToRe", () => {
  const domains = globToRe("domains/*/domain.config.ts");

  it("matches a config the glob names", () => {
    expect(domains.test("domains/udp/domain.config.ts")).toBe(true);
  });

  it("does not let * cross a directory boundary", () => {
    expect(domains.test("domains/udp/src/domain.config.ts")).toBe(false);
  });

  it("anchors, so a path that merely contains the glob does not match", () => {
    expect(domains.test("other/domains/udp/domain.config.ts")).toBe(false);
  });

  it("treats a bare directory as everything under it", () => {
    const alarms = globToRe("platform/infra/flex/src/constructs/alarms");
    expect(
      alarms.test("platform/infra/flex/src/constructs/alarms/api.ts"),
    ).toBe(true);
    // The prefix must be a whole path segment: alarms-old is a different directory.
    expect(
      alarms.test("platform/infra/flex/src/constructs/alarms-old/api.ts"),
    ).toBe(false);
  });

  it("escapes the dots rather than letting them match anything", () => {
    expect(globToRe("a.b/c").test("axb/c")).toBe(false);
  });
});

describe("collectCitations", () => {
  /** The four shapes a citation actually arrives in, nested as the model nests them. */
  const views = [
    {
      id: "network",
      nodes: [
        { id: "authfn", d: { code: [["platform.ts", "stacks/platform.ts"]] } },
      ],
      edges: [
        {
          label: "fetches JWKS",
          d: { code: [["platform.ts", "stacks/platform.ts"]] },
        },
      ],
      tables: [
        {
          name: "Egress rules",
          code: [["vpc.ts", "stacks/core/vpc.ts"]],
        },
      ],
    },
    {
      id: "resources",
      groups: [
        {
          name: "Compute",
          items: [{ id: "lambda-cr", d: { code: [["app.ts", "src/app.ts"]] } }],
        },
      ],
    },
  ];

  const found = collectCitations(views);

  it("finds every citation, wherever in the shape it sits", () => {
    expect([...found.keys()].sort()).toEqual([
      "src/app.ts",
      "stacks/core/vpc.ts",
      "stacks/platform.ts",
    ]);
  });

  it("keeps every place a file is cited from, not just the first", () => {
    expect([...(found.get("stacks/platform.ts") ?? [])].sort()).toEqual([
      "network/authfn",
      "network/fetches JWKS",
    ]);
  });

  it("builds the trail from the enclosing names", () => {
    expect([...(found.get("src/app.ts") ?? [])]).toEqual([
      "resources/Compute/lambda-cr",
    ]);
  });

  it("ignores a code entry that is not a [label, path] pair", () => {
    expect(
      collectCitations([{ id: "v", d: { code: ["bare string"] } }]).size,
    ).toBe(0);
  });
});
