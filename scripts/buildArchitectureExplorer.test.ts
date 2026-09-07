/**
 * The hard geometry rules from projects/CANVAS.md — the ones the build refuses outright.
 *
 * They were only ever exercised by running the build against FLEX, which proves they pass
 * on one model and nothing about whether they still fire. A gate that stops catching
 * things fails nothing and looks exactly like a gate that has nothing to catch, so each
 * rule here is given something it must reject and something it must not.
 */
import { describe, expect, it } from "vitest";

import {
  checkGeometry,
  type View,
  type ViewNode,
} from "./buildArchitectureExplorer.js";

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
