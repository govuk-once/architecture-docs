/**
 * What a chain of planned states does to the as-is, and what it must not do to it.
 *
 * Two rules carry the whole design and each is easy to break silently. States are
 * cumulative — a later state shows what an earlier one built, unless it explicitly takes it
 * away — and the diff is computed from that composition rather than declared, so it cannot
 * describe a change the composition does not actually make. Each is given something it must
 * do and something it must leave alone.
 */
import { describe, expect, it } from "vitest";

import type { View, ViewNode } from "../buildArchitectureExplorer.js";
import {
  chainProblems,
  composeChain,
  type StateManifest,
  type StateOverlay,
  type Step,
} from "./composeStates.js";

const state = (id: string, order: number): StateManifest => ({
  id,
  name: id.toUpperCase(),
  label: `${id.toUpperCase()} · Later`,
  order,
  blurb: `the shape at ${id}`,
  why: [`${id}-decision`],
});
const S1 = state("s1", 1);
const S2 = state("s2", 2);

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

const base = (over: Partial<View> = {}): View =>
  ({
    id: "containers",
    name: "Containers",
    w: 1000,
    h: 800,
    nodes: [box({ id: "keep" }), box({ id: "goes", x: 300 })],
    zones: [
      {
        id: "z",
        label: "Zone",
        x: 0,
        y: 0,
        w: 600,
        h: 200,
        hard: false,
        d: { facts: [] },
      },
    ],
    edges: [
      {
        from: "keep",
        to: "goes",
        label: "e",
        dir: null,
        style: null,
        d: { facts: [] },
      },
    ],
    placement: { keep: ["r1"], goes: ["r2"] },
    ...over,
  }) as View;

const ov = (over: Partial<StateOverlay> = {}): StateOverlay => ({
  state: "s1",
  view: "containers",
  ...over,
});
const fresh = (id: string, over = {}) => ({
  id,
  label: id,
  kind: "flex",
  x: 700,
  y: 600,
  w: 200,
  h: 60,
  ...over,
});

/** The chain as the build assembles it: every state up to the one being shown. */
const chain = (...steps: [StateManifest, StateOverlay?][]): Step[] =>
  steps.map(([st, o]) => ({ st, ov: o }));

const ids = (v: View) => (v.nodes ?? []).map((n) => n.id);
const byId = (v: View, id: string): ViewNode => {
  const found = (v.nodes ?? []).find((n) => n.id === id);
  if (!found) throw new Error(`no box "${id}" in the composed view`);
  return found;
};
const marked = (v: View) =>
  Object.fromEntries(
    (v.nodes ?? [])
      .filter((n) => n.d.lifecycle)
      .map((n) => [n.id, n.d.lifecycle]),
  );

describe("composeChain", () => {
  it("leaves the as-is alone when no step says anything", () => {
    const out = composeChain(base(), chain([S1]), S1, "future");
    expect(ids(out)).toEqual(["keep", "goes"]);
    expect(marked(out)).toEqual({});
  });

  it("carries an earlier state's work into a later one", () => {
    const c = chain([S1, ov({ newNodes: [fresh("built")] })], [S2]);
    const out = composeChain(base(), c, S2, "future");
    expect(ids(out)).toContain("built");
  });

  it("lets a later state take back what an earlier one built", () => {
    const c = chain(
      [S1, ov({ newNodes: [fresh("built")] })],
      [S2, ov({ state: "s2", retired: { built: [] } })],
    );
    expect(ids(composeChain(base(), c, S2, "future"))).not.toContain("built");
    /* And versus today it never existed, so the diff says nothing about it. */
    expect(marked(composeChain(base(), c, S2, "changes"))).toEqual({});
  });

  it("drops a retired box from the future and strikes it in the diff", () => {
    const c = chain([S1, ov({ retired: { goes: [] } })]);
    expect(ids(composeChain(base(), c, S1, "future"))).toEqual(["keep"]);
    const diff = composeChain(base(), c, S1, "changes");
    expect(marked(diff)).toEqual({ goes: "retired" });
    // Moved below everything the state keeps, into its own strip.
    expect(byId(diff, "goes").y).toBeGreaterThan(base().h ?? 0);
    expect((diff.zones ?? []).some((z) => z.id === "retired")).toBe(true);
  });

  it("takes an edge out with the box it pointed at", () => {
    const c = chain([S1, ov({ retired: { goes: [] } })]);
    for (const mode of ["future", "changes"] as const)
      expect(composeChain(base(), c, S1, mode).edges).toHaveLength(0);
  });

  it("drops the resource badges of a box it retires, and keeps the rest", () => {
    const c = chain([S1, ov({ retired: { goes: [] } })]);
    expect(composeChain(base(), c, S1, "future").placement).toEqual({
      keep: ["r1"],
    });
  });

  it("moves a survivor in both modes — the diff is the future layout", () => {
    const c = chain([S1, ov({ moved: { keep: { x: 700, y: 400 } } })]);
    for (const mode of ["future", "changes"] as const)
      expect(byId(composeChain(base(), c, S1, mode), "keep").x).toBe(700);
  });

  it("does not call a box changed just because it moved", () => {
    const c = chain([S1, ov({ moved: { keep: { x: 700 } } })]);
    expect(marked(composeChain(base(), c, S1, "changes"))).toEqual({});
  });

  it("lets a changed box carry its own geometry over a move", () => {
    const c = chain([
      S1,
      ov({
        moved: { keep: { x: 700, y: 400 } },
        changed: { keep: { x: 900, label: "Renamed", facts: ["and why"] } },
      }),
    ]);
    const out = byId(composeChain(base(), c, S1, "future"), "keep");
    expect([out.x, out.y]).toEqual([900, 400]);
    expect(out.label).toBe("Renamed");
    expect(out.d.facts).toEqual(["and why"]);
  });

  it("marks a change only in the diff, and cites the step answerable for it", () => {
    const c = chain([S1, ov({ changed: { keep: { label: "Renamed" } } })]);
    expect(
      byId(composeChain(base(), c, S1, "future"), "keep").d.lifecycle,
    ).toBeUndefined();
    const diff = byId(composeChain(base(), c, S1, "changes"), "keep");
    expect(diff.d.lifecycle).toBe("changed");
    expect(diff.d.why).toEqual(["s1-decision"]);
    // The rename still shows: a diff that hides the change it is marking is no use.
    expect(diff.label).toBe("Renamed");
  });

  it("blames the later step when two of them touch the same box", () => {
    const c = chain(
      [S1, ov({ changed: { keep: { label: "First" } } })],
      [S2, ov({ state: "s2", changed: { keep: { label: "Second" } } })],
    );
    const out = byId(composeChain(base(), c, S2, "changes"), "keep");
    expect(out.label).toBe("Second");
    expect(out.d.why).toEqual(["s2-decision"]);
  });

  it("adds what a step introduces, and marks it new against today", () => {
    const c = chain([
      S1,
      ov({
        newNodes: [fresh("brought")],
        newEdges: [{ from: "keep", to: "brought", label: "new wire" }],
      }),
    ]);
    for (const mode of ["future", "changes"] as const) {
      const out = composeChain(base(), c, S1, mode);
      expect(ids(out)).toContain("brought");
      expect(out.edges).toHaveLength(2);
    }
    expect(marked(composeChain(base(), c, S1, "changes"))).toEqual({
      brought: "new",
    });
  });

  it("grows the canvas to hold what it added", () => {
    const c = chain([
      S1,
      ov({ newNodes: [fresh("far", { x: 1400, y: 900 })] }),
    ]);
    const out = composeChain(base(), c, S1, "future");
    expect(out.w).toBe(1640);
    expect(out.h).toBe(1000);
  });

  it("says whose step a view is showing, even when it is not this one's", () => {
    const own = composeChain(
      base(),
      chain([S1, ov({ note: "the short version" })]),
      S1,
      "future",
    );
    expect(own.stateNote).toBe("S1 · Later — the short version");

    const inherited = composeChain(
      base(),
      chain([S1, ov({ newNodes: [fresh("built")] })], [S2]),
      S2,
      "future",
    );
    expect(inherited.stateNote).toContain("unchanged since S1");
  });
});

describe("chainProblems", () => {
  const one = (o: Partial<StateOverlay>) =>
    chainProblems(base(), chain([S1, ov(o)]));

  it("says nothing about an overlay that names what is there", () => {
    expect(
      one({ retired: { goes: [] }, changed: { keep: { label: "Renamed" } } }),
    ).toEqual([]);
  });

  it("names a reference the as-is no longer has", () => {
    expect(one({ retired: { "renamed-away": [] } })[0]).toContain(
      'retires "renamed-away"',
    );
    expect(one({ changed: { gone: {} } })[0]).toContain('changes "gone"');
    expect(one({ moved: { gone: { x: 1 } } })[0]).toContain('moves "gone"');
    expect(one({ retiredZones: { nozone: [] } })[0]).toContain(
      'retires zone "nozone"',
    );
    expect(one({ zones: { nozone: { h: 10 } } })[0]).toContain(
      'patches zone "nozone"',
    );
  });

  it("names a line drawn to a box that is not there", () => {
    expect(one({ newEdges: [{ from: "keep", to: "nowhere" }] })[0]).toContain(
      'draws a line to "nowhere"',
    );
  });

  it("judges each step against the view as it stands then, not against today", () => {
    /* S2 acting on what S1 built is right; S2 acting on what S1 retired is not. */
    expect(
      chainProblems(
        base(),
        chain(
          [S1, ov({ newNodes: [fresh("built")] })],
          [S2, ov({ state: "s2", retired: { built: [] } })],
        ),
      ),
    ).toEqual([]);
    const stale = chainProblems(
      base(),
      chain(
        [S1, ov({ retired: { goes: [] } })],
        [S2, ov({ state: "s2", changed: { goes: { label: "back?" } } })],
      ),
    );
    expect(stale[0]).toContain("states/s2/containers.json");
    expect(stale[0]).toContain('changes "goes"');
  });
});

describe("slots", () => {
  const grid = (...cells: [string, number, number][]) =>
    chain([
      S1,
      ov({
        newZones: [{ id: "band", label: "Band", x: 100, y: 500 }],
        newNodes: cells.map(([id, row, col]) => ({
          id,
          label: id,
          kind: "flex",
          zone: "band",
          row,
          col,
        })),
      }),
    ]);

  it("places a box from its zone and cell, and sizes it from its label", () => {
    const out = composeChain(
      base(),
      grid(["a", 1, 1], ["b", 1, 2]),
      S1,
      "future",
    );
    const a = byId(out, "a"),
      b = byId(out, "b");
    expect(a.y).toBe(b.y);
    expect(b.x).toBeGreaterThan(a.x);
    expect(a.w).toBe(176); // the floor, for a short label
  });

  it("widens a column to its widest box, and keeps the column straight", () => {
    const c = chain([
      S1,
      ov({
        newZones: [{ id: "band", label: "Band", x: 100, y: 500 }],
        newNodes: [
          {
            id: "short",
            label: "s",
            kind: "flex",
            zone: "band",
            row: 1,
            col: 1,
          },
          {
            id: "long",
            label: "a considerably longer label than that one",
            kind: "flex",
            zone: "band",
            row: 2,
            col: 1,
          },
          {
            id: "next",
            label: "n",
            kind: "flex",
            zone: "band",
            row: 1,
            col: 2,
          },
        ],
      }),
    ]);
    const out = composeChain(base(), c, S1, "future");
    expect(byId(out, "long").w).toBeGreaterThan(176);
    expect(byId(out, "short").x).toBe(byId(out, "long").x);
    // The second column clears the widest box in the first, not the box beside it.
    expect(byId(out, "next").x).toBeGreaterThan(
      byId(out, "long").x + byId(out, "long").w,
    );
  });

  it("grows a zone with no size of its own to hold what it is given", () => {
    const one = composeChain(base(), grid(["a", 1, 1]), S1, "future");
    const many = composeChain(
      base(),
      grid(["a", 1, 1], ["b", 2, 1], ["c", 3, 1]),
      S1,
      "future",
    );
    const h = (v: View) => (v.zones ?? []).find((z) => z.id === "band")?.h ?? 0;
    expect(h(many)).toBeGreaterThan(h(one));
    // And every box it holds is inside it, which is what the geometry gate demands.
    for (const id of ["a", "b", "c"]) {
      const n = byId(many, id);
      const z = (many.zones ?? []).find((x) => x.id === "band");
      expect(n.x).toBeGreaterThanOrEqual(z?.x ?? 0);
      expect(n.y + n.h).toBeLessThanOrEqual((z?.y ?? 0) + (z?.h ?? 0));
    }
  });

  it("reflows the grid when a later state adds a row to it", () => {
    const c = chain(
      [
        S1,
        ov({
          newZones: [{ id: "band", label: "Band", x: 100, y: 500 }],
          newNodes: [
            { id: "a", label: "a", kind: "flex", zone: "band", row: 1, col: 1 },
          ],
        }),
      ],
      [
        S2,
        ov({
          state: "s2",
          newNodes: [
            { id: "b", label: "b", kind: "flex", zone: "band", row: 2, col: 1 },
          ],
        }),
      ],
    );
    const out = composeChain(base(), c, S2, "future");
    expect(byId(out, "b").y).toBeGreaterThan(byId(out, "a").y);
    const z = (out.zones ?? []).find((x) => x.id === "band");
    expect(byId(out, "b").y + byId(out, "b").h).toBeLessThanOrEqual(
      (z?.y ?? 0) + (z?.h ?? 0),
    );
  });

  it("lets explicit coordinates win, for what a grid cannot say", () => {
    const c = chain([
      S1,
      ov({
        newZones: [
          { id: "band", label: "Band", x: 100, y: 500, w: 900, h: 300 },
        ],
        newNodes: [
          {
            id: "exact",
            label: "exact",
            kind: "flex",
            x: 640,
            y: 610,
            w: 220,
            h: 70,
          },
        ],
      }),
    ]);
    const out = byId(composeChain(base(), c, S1, "future"), "exact");
    expect([out.x, out.y, out.w, out.h]).toEqual([640, 610, 220, 70]);
  });
});

describe("slots that name nothing", () => {
  it("names a slot whose zone is not there", () => {
    const bad = chainProblems(
      base(),
      chain([
        S1,
        ov({
          newNodes: [
            {
              id: "lost",
              label: "lost",
              kind: "flex",
              zone: "nowhere",
              row: 1,
              col: 1,
            },
          ],
        }),
      ]),
    );
    expect(bad[0]).toContain('puts "lost" in zone "nowhere"');
  });

  it("accepts a slot naming a zone the same step adds", () => {
    expect(
      chainProblems(
        base(),
        chain([
          S1,
          ov({
            newZones: [{ id: "band", label: "Band", x: 10, y: 10 }],
            newNodes: [
              {
                id: "held",
                label: "held",
                kind: "flex",
                zone: "band",
                row: 1,
                col: 1,
              },
            ],
          }),
        ]),
      ),
    ).toEqual([]);
  });
});

describe("lines a step alters or takes away", () => {
  const key = "keep goes";

  it("patches what a line says and marks it changed against today", () => {
    const c = chain([
      S1,
      ov({
        changedEdges: {
          [key]: { label: "renamed", protocol: "HTTPS", why: ["s1-decision"] },
        },
      }),
    ]);
    const out = composeChain(base(), c, S1, "changes");
    const e = out.edges?.find((x) => `${x.from} ${x.to}` === key);
    expect(e?.label).toBe("renamed");
    expect(e?.d.protocol).toBe("HTTPS");
    expect(e?.d.lifecycle).toBe("changed");
    expect(e?.d.why).toEqual(["s1-decision"]);
  });

  it("takes a line away while both ends stay, and shows it retired in the diff", () => {
    const c = chain([S1, ov({ retiredEdges: { [key]: ["s1-decision"] } })]);
    expect(composeChain(base(), c, S1, "future").edges).toHaveLength(0);
    const shown = composeChain(base(), c, S1, "changes").edges ?? [];
    expect(shown).toHaveLength(1);
    expect(shown[0]?.d.lifecycle).toBe("retired");
    expect(shown[0]?.d.why).toEqual(["s1-decision"]);
  });

  it("refuses a line that is not there at that step", () => {
    const c = chain([
      S1,
      ov({ changedEdges: { "keep nowhere": { label: "x" } } }),
    ]);
    expect(chainProblems(base(), c)[0]).toContain(
      'changes the line "keep nowhere", which is not a line in the view at that point',
    );
    const c2 = chain([
      S1,
      ov({ retired: { goes: [] } }),
      /* S2 retires a line whose end S1 already took: gone with the box, not there to retire. */
    ]);
    const c3 = chain(
      [S1, ov({ retired: { goes: [] } })],
      [S2, ov({ state: "s2", retiredEdges: { [key]: [] } })],
    );
    expect(chainProblems(base(), c2)).toEqual([]);
    expect(chainProblems(base(), c3)[0]).toContain("retires the line");
  });
});

describe("an auto-sized zone and what is put in it by hand", () => {
  it("grows to hold a hand-placed box that overlaps it", () => {
    const c = chain([
      S1,
      ov({
        newZones: [{ id: "t", label: "T", x: 700, y: 0 }],
        newNodes: [
          { id: "n", label: "N", kind: "flex", x: 900, y: 100, w: 200, h: 60 },
        ],
      }),
    ]);
    const out = composeChain(base(), c, S1, "future");
    const t = out.zones?.find((z) => z.id === "t");
    expect(t).toBeDefined();
    expect((t?.x ?? 0) + (t?.w ?? 0)).toBeGreaterThanOrEqual(900 + 200 + 24);
    expect((t?.y ?? 0) + (t?.h ?? 0)).toBeGreaterThanOrEqual(100 + 60 + 22);
  });

  it("does not grow for a box that does not touch it, nor for one the as-is placed", () => {
    const c = chain([
      S1,
      ov({
        newZones: [{ id: "t", label: "T", x: 700, y: 0 }],
        newNodes: [
          { id: "n", label: "N", kind: "flex", x: 1200, y: 400, w: 200, h: 60 },
        ],
      }),
    ]);
    const t = composeChain(base(), c, S1, "future").zones?.find(
      (z) => z.id === "t",
    );
    expect(t?.w).toBe(320);
    expect(t?.h).toBe(160);
  });
});
