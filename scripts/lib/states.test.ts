/**
 * The build's report over composed views, folded to one line per fault.
 *
 * The same fault is found in both modes and at every later state, because every later
 * state inherits it. Ten lines for one misplaced box taught the author to read none of
 * them. The fold has to keep everything that distinguishes faults and drop only what
 * repeats them.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { View } from "../buildArchitectureExplorer.js";
import type { StateManifest, StateOverlay } from "./composeStates.js";
import {
  checkDeclarations,
  composeAll,
  foldComposed,
  statesDir,
} from "./states.js";

describe("foldComposed", () => {
  it("says a fault once, at the state it first appears, and where it is still in force", () => {
    const folded = foldComposed([
      "context@s1·future: onelogin straddles the edge of zone govukonce",
      "context@s1·changes: onelogin straddles the edge of zone govukonce",
      "context@s2·future: onelogin straddles the edge of zone govukonce",
      "context@s2·changes: onelogin straddles the edge of zone govukonce",
      "context@s3·future: onelogin straddles the edge of zone govukonce",
      "context@s3·changes: onelogin straddles the edge of zone govukonce",
    ]);
    expect(folded).toEqual([
      "context@s1: onelogin straddles the edge of zone govukonce — also at s2, s3",
    ]);
  });

  it("keeps faults apart by view and by element", () => {
    const folded = foldComposed([
      "context@s1·future: boxes onelogin and udp overlap",
      "context@s1·changes: boxes onelogin and udp overlap",
      "context@s1·future: boxes onelogin and uns overlap",
      "context@s1·changes: boxes onelogin and uns overlap",
      "containers@s1·future/router: width 120 is below the 176 minimum",
      "containers@s1·changes/router: width 120 is below the 176 minimum",
    ]);
    expect(folded).toEqual([
      "context@s1: boxes onelogin and udp overlap",
      "context@s1: boxes onelogin and uns overlap",
      "containers@s1/router: width 120 is below the 176 minimum",
    ]);
  });

  it("names the mode only when a fault is in one mode alone", () => {
    expect(
      foldComposed([
        'containers@s2·changes/gone: label "Gone for good" overflows 176px',
      ]),
    ).toEqual([
      'containers@s2·changes/gone: label "Gone for good" overflows 176px',
    ]);
  });

  it("leaves lines that are not about a composed view alone, in place", () => {
    const folded = foldComposed([
      'states/s1/context.json: retires "x", which is not a box in the view at that point',
      "context@s1·future: boxes a and b overlap",
      "context@s1·changes: boxes a and b overlap",
      "projects/flex: inventoryView is not one of its views",
    ]);
    expect(folded).toEqual([
      'states/s1/context.json: retires "x", which is not a box in the view at that point',
      "context@s1: boxes a and b overlap",
      "projects/flex: inventoryView is not one of its views",
    ]);
  });
});

describe("checkDeclarations", () => {
  const st = { id: "s1", name: "S1", label: "S1", order: 1, blurb: "" };
  it("refuses a view that is both declared unchanged and overlaid", () => {
    expect(
      checkDeclarations({
        list: [{ ...st, unchanged: ["context"] }],
        overlays: { s1: { context: { state: "s1", view: "context" } } },
      }),
    ).toEqual([
      'states/s1/state.json declares "context" unchanged, but states/s1/context.json changes it — drop one',
    ]);
  });
  it("accepts a declaration with no overlay, and an overlay with no declaration", () => {
    expect(
      checkDeclarations({
        list: [{ ...st, unchanged: ["context"] }],
        overlays: { s1: { delivery: { state: "s1", view: "delivery" } } },
      }),
    ).toEqual([]);
  });
});

describe("composeAll", () => {
  const state = (id: string, order: number): StateManifest => ({
    id,
    name: id.toUpperCase(),
    label: `${id.toUpperCase()} · Later`,
    order,
    blurb: `the shape at ${id}`,
  });
  const base = (id: string): View => ({
    id,
    name: id,
    order: 1,
    blurb: "",
    note: "",
    w: 1000,
    h: 800,
    nodes: [
      {
        id: "keep",
        label: "A box",
        sub: "",
        x: 0,
        y: 0,
        w: 200,
        h: 60,
        kind: "flex",
        plane: "request",
        d: { facts: [] },
      },
    ],
    zones: [],
    edges: [],
    placement: {},
  });
  const ov = (state: string, view: string): StateOverlay => ({
    state,
    view,
    newNodes: [{ id: "built", label: "built", kind: "flex", x: 700, y: 600 }],
  });

  it("composes every view an earlier state touched, at every later state", () => {
    const out = composeAll([base("containers"), base("context")], {
      list: [state("s1", 1), state("s2", 2)],
      overlays: { s1: { containers: ov("s1", "containers") }, s2: {} },
    });
    /* S2 says nothing about Containers, but S1's work is still in force there. */
    expect(out.byState.s2?.containers).toBeDefined();
    expect(out.labelled.map((v) => v.id)).toEqual([
      "containers@s1·future",
      "containers@s1·changes",
      "containers@s2·future",
      "containers@s2·changes",
    ]);
    expect(out.problems).toEqual([]);
  });

  it("refuses an overlay on a view that does not exist", () => {
    expect(() =>
      composeAll([base("containers")], {
        list: [state("s1", 1)],
        overlays: { s1: { delivery: ov("s1", "delivery") } },
      }),
    ).toThrow('states/s1/delivery.json: no view "delivery" to overlay');
  });
});

/* This repository is public and the states are not. The lookup is the one place that could
   read a proposal into the public build, so it is pinned: nothing without a root, never a
   states/ directory beside the model. */
describe("statesDir", () => {
  const scratch = () => mkdtempSync(path.join(tmpdir(), "states-dir-"));

  it("is null when no states root is set, so the public build has none", () => {
    const dir = scratch();
    try {
      expect(
        statesDir({ id: "flex", modelDir: path.join(dir, "model") }, null),
      ).toBeNull();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("is the project's own directory under the states root", () => {
    const dir = scratch();
    try {
      expect(
        statesDir(
          { id: "flex", modelDir: path.join(dir, "model") },
          "/private/states",
        ),
      ).toBe(path.join("/private/states", "flex"));
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("stops the build when states/ sits beside the model in this repository", () => {
    const dir = scratch();
    try {
      mkdirSync(path.join(dir, "states"));
      expect(() =>
        statesDir(
          { id: "flex", modelDir: path.join(dir, "model") },
          "/private/states",
        ),
      ).toThrow("this repository is public");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
