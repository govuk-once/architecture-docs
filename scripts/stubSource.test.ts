/**
 * A stub is a package the install cannot reach, replaced by one that does nothing. The
 * override that points pnpm at it is edited into the source's own workspace file, so what
 * that file already says has to survive — and a stand-in named for the wrong package would
 * resolve nothing, so it is refused before anything is copied.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import type { Project, Source } from "./lib/projects.js";
import { applyStubs, stubsOf, withOverride } from "./stubSource.js";

describe("withOverride", () => {
  it("adds an overrides block to a workspace file that has none, keeping the rest", () => {
    const out = withOverride(
      "packages:\n  - libs/*\n\nblockExoticSubdeps: true # keep\n",
      "@org/tag",
      "link:.arch-stubs/org-tag",
    );
    expect(parse(out)).toEqual({
      packages: ["libs/*"],
      blockExoticSubdeps: true,
      overrides: { "@org/tag": "link:.arch-stubs/org-tag" },
    });
    expect(out).toContain("# keep");
  });

  it("merges into overrides already there, and starts from nothing", () => {
    const out = withOverride(
      "overrides:\n  left: 1.0.0\n",
      "@org/tag",
      "link:x",
    );
    expect(parse(out)).toEqual({
      overrides: { left: "1.0.0", "@org/tag": "link:x" },
    });
    expect(parse(withOverride("", "@org/tag", "link:x"))).toEqual({
      overrides: { "@org/tag": "link:x" },
    });
  });
});

describe("applyStubs", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "stubs-"));
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function project(name: string): { project: Project; source: Source } {
    const dir = path.join(tmp, "project");
    const stub = path.join(dir, "stubs", "org-tag");
    mkdirSync(stub, { recursive: true });
    writeFileSync(
      path.join(stub, "package.json"),
      JSON.stringify({ name, version: "1.0.0" }),
    );
    writeFileSync(path.join(stub, "index.js"), "module.exports = {};");
    const checkout = path.join(tmp, "checkout");
    mkdirSync(path.join(checkout, ".git"), { recursive: true });
    writeFileSync(
      path.join(checkout, "pnpm-workspace.yaml"),
      "packages:\n  - cdk/*\n",
    );
    const source: Source = {
      id: "src",
      repo: "git@github.com:org/one.git",
      ref: "main",
      root: "checkout",
      dir: checkout,
      url: "https://github.com/org/one/blob/main/",
    };
    const p = {
      id: "p",
      dir,
      sources: [source],
      qualified: false,
      config: {
        synth: {
          cwd: "cdk",
          command: ["x"],
          env: {},
          output: "o",
          stubs: [
            { package: "@org/tag", dir: "stubs/org-tag", why: "private" },
          ],
        },
      },
    } as unknown as Project;
    return { project: p, source };
  }

  it("copies the stand-in into the checkout and points pnpm at it", () => {
    const { project: p, source } = project("@org/tag");
    expect(applyStubs(p, source)).toEqual(["@org/tag"]);
    expect(
      readFileSync(
        path.join(source.dir, ".arch-stubs", "org-tag", "index.js"),
        "utf8",
      ),
    ).toBe("module.exports = {};");
    expect(
      parse(readFileSync(path.join(source.dir, "pnpm-workspace.yaml"), "utf8")),
    ).toEqual({
      packages: ["cdk/*"],
      overrides: { "@org/tag": "link:.arch-stubs/org-tag" },
    });
  });

  it("refuses a stand-in named for a different package", () => {
    const { project: p } = project("@org/other");
    expect(() => stubsOf(p)).toThrow(/named "@org\/other", not "@org\/tag"/);
  });
});
