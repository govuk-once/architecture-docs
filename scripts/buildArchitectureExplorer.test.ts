/**
 * The hard geometry rules from projects/CANVAS.md — the ones the build refuses outright.
 *
 * They were only ever exercised by running the build against FLEX, which proves they pass
 * on one model and nothing about whether they still fire. A gate that stops catching
 * things fails nothing and looks exactly like a gate that has nothing to catch, so each
 * rule here is given something it must reject and something it must not.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkGeometry,
  checkSourceCitations,
  type View,
  type ViewNode,
} from "./buildArchitectureExplorer.js";
import type { Source } from "./lib/projects.js";

const KINDS = new Set(["flex", "aws"]);

const box = (over: Partial<ViewNode> = {}): ViewNode => ({
  id: "n1",
  label: "A box",
  sub: "",
  x: 0,
  y: 0,
  w: 200,
  h: 60,
  kind: "flex",
  plane: "request",
  d: { facts: [] },
  ...over,
});

const view = (over: Partial<View> = {}): View =>
  ({ id: "v", name: "V", nodes: [], zones: [], edges: [], ...over }) as View;

const run = (v: View) => checkGeometry([v], KINDS);
const complains = (v: View, about: string) =>
  run(v).some((p) => p.includes(about));

describe("checkGeometry", () => {
  it("passes a view that breaks no rule", () => {
    expect(run(view({ nodes: [box()] }))).toEqual([]);
  });

  it("refuses a box below the 176 minimum width", () => {
    expect(complains(view({ nodes: [box({ w: 175 })] }), "below the 176")).toBe(
      true,
    );
    expect(complains(view({ nodes: [box({ w: 176 })] }), "below the 176")).toBe(
      false,
    );
  });

  it("refuses a label that will not fit its box", () => {
    // 200 - 22 = 178px available, at the 7.0px advance the rule designs to.
    const fits = "x".repeat(Math.floor(178 / 7.0));
    expect(
      complains(view({ nodes: [box({ label: fits })] }), "overflows"),
    ).toBe(false);
    expect(
      complains(view({ nodes: [box({ label: fits + "xx" })] }), "overflows"),
    ).toBe(true);
  });

  it("refuses a sub-label that will not fit, at the wider mono advance", () => {
    const fits = "y".repeat(Math.floor(178 / 6.7));
    expect(complains(view({ nodes: [box({ sub: fits })] }), 'sub "')).toBe(
      false,
    );
    expect(
      complains(view({ nodes: [box({ sub: fits + "yy" })] }), 'sub "'),
    ).toBe(true);
  });

  it("refuses a sub that only repeats the label", () => {
    expect(
      complains(
        view({ nodes: [box({ label: "Same", sub: " Same " })] }),
        "repeats",
      ),
    ).toBe(true);
  });

  it("refuses a box with no ownership, and one with an ownership the project never declared", () => {
    expect(
      complains(view({ nodes: [box({ kind: "" })] }), "no ownership"),
    ).toBe(true);
    expect(
      complains(view({ nodes: [box({ kind: "azure" })] }), "unknown kind"),
    ).toBe(true);
  });

  it("refuses an unknown plane", () => {
    // Cast, because the type forbids this and the model does not: views arrive as JSON,
    // so the runtime check is the only one that ever sees a value like this.
    const bad = box({ plane: "sideways" as ViewNode["plane"] });
    expect(complains(view({ nodes: [bad] }), "unknown plane")).toBe(true);
  });

  it("refuses two boxes that overlap, and allows two that only touch", () => {
    const a = box({ id: "a", x: 0, w: 200 });
    expect(
      complains(view({ nodes: [a, box({ id: "b", x: 199 })] }), "overlap"),
    ).toBe(true);
    expect(
      complains(view({ nodes: [a, box({ id: "b", x: 200 })] }), "overlap"),
    ).toBe(false);
  });

  it("refuses a zone label wider than its zone", () => {
    const zone = { ...box({ id: "z", w: 300 }), hard: false };
    const fits = "z".repeat(Math.floor((300 - 22) / 8.32));
    expect(
      complains(view({ zones: [{ ...zone, label: fits }] }), "zone label"),
    ).toBe(false);
    expect(
      complains(
        view({ zones: [{ ...zone, label: fits + "zz" }] }),
        "zone label",
      ),
    ).toBe(true);
  });

  it("refuses a box straddling a zone edge — containment is the claim a zone makes", () => {
    const zone = {
      ...box({ id: "z", x: 0, y: 0, w: 400, h: 200, label: "Z" }),
      hard: false,
    };
    const inside = box({ id: "in", x: 10, y: 10, w: 200, h: 60 });
    const across = box({ id: "out", x: 300, y: 10, w: 200, h: 60 });
    const clear = box({ id: "far", x: 500, y: 10, w: 200, h: 60 });
    expect(
      complains(view({ zones: [zone], nodes: [inside] }), "straddles"),
    ).toBe(false);
    expect(
      complains(view({ zones: [zone], nodes: [across] }), "straddles"),
    ).toBe(true);
    expect(
      complains(view({ zones: [zone], nodes: [clear] }), "straddles"),
    ).toBe(false);
  });

  it("refuses an edge naming a node that does not exist", () => {
    const v = view({
      nodes: [box({ id: "a" })],
      edges: [
        {
          from: "a",
          to: "ghost",
          label: "",
          dir: null,
          style: null,
          d: { facts: [] },
        },
      ],
    });
    expect(complains(v, 'edge to unknown node "ghost"')).toBe(true);
  });

  it("reports every view it is given, not just the first", () => {
    const bad = view({ id: "second", nodes: [box({ w: 100 })] });
    expect(
      checkGeometry([view(), bad], KINDS).some((p) => p.startsWith("second/")),
    ).toBe(true);
  });
});

/**
 * Every citation has to land on a file that exists, in a repository the project reads.
 * The checkouts are real directories, because existence on disk is the whole claim.
 */
describe("checkSourceCitations", () => {
  function checkouts(ids: string[]): Source[] {
    const root = mkdtempSync(path.join(tmpdir(), "cite-"));
    return ids.map((id) => {
      const dir = path.join(root, id);
      mkdirSync(path.join(dir, ".git"), { recursive: true });
      mkdirSync(path.join(dir, "src"));
      writeFileSync(path.join(dir, "src", "real.ts"), "");
      return {
        id,
        repo: `git@github.com:org/${id}.git`,
        ref: "main",
        root: `.sources/${id}`,
        url: `https://github.com/org/${id}/blob/main/`,
        dir,
      };
    });
  }
  const one = { id: "one", qualified: false, sources: checkouts(["one"]) };
  const several = {
    id: "app",
    qualified: true,
    sources: checkouts(["ios", "android"]),
  };
  /** A view whose one box cites `rel`, the way the loader hands a link over. */
  const citing = (rel: string) => [
    { id: "v", nodes: [{ id: "n", d: { code: [["label", rel]] } }] },
  ];
  const problems = (p: typeof one, rel: string) =>
    checkSourceCitations(p, citing(rel));

  it("passes a citation to a file that exists, with one source or several", () => {
    expect(problems(one, "src/real.ts")).toEqual([]);
    expect(problems(several, "ios:src/real.ts")).toEqual([]);
  });

  it("refuses a citation to a file that does not exist", () => {
    expect(problems(one, "src/gone.ts")).toEqual([
      "v/n: cites src/gone.ts, which does not exist",
    ]);
  });

  it("refuses a path that names no source, when the project reads several", () => {
    expect(problems(several, "src/real.ts")[0]).toMatch(/names no source/);
    expect(problems(several, "web:src/real.ts")[0]).toMatch(/names no source/);
  });

  /* The case the old loader let through: this path exists in the checkout it would have
     been checked against, and says nothing about the repository it links to. */
  it("refuses a link into a repository the project does not read", () => {
    expect(
      problems(one, "https://github.com/org/other/blob/main/src/real.ts")[0],
    ).toMatch(/no repository this project reads/);
  });

  it("refuses a path that climbs out of its checkout into another", () => {
    expect(problems(several, "android:../ios/src/real.ts")[0]).toMatch(
      /outside its checkout/,
    );
  });

  it("reports a missing checkout once, rather than every path in it", () => {
    const gone = { id: "gone", qualified: false, sources: checkouts(["gone"]) };
    const [s] = gone.sources;
    if (s) rmSync(path.join(s.dir, ".git"), { recursive: true });
    const found = checkSourceCitations(gone, [
      ...citing("src/real.ts"),
      ...citing("src/other.ts"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/pnpm sync gone/);
  });
});
