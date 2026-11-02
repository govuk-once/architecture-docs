/**
 * A proposed project's box on the index sketch: merged only when it is safe to draw, and
 * always marked, so a reader can tell what runs from what is proposed.
 */
import { describe, expect, it } from "vitest";

import {
  groupStrays,
  mergeFit,
  PROPOSED_NOTE,
  type ProposedFit,
  sketchFor,
} from "./fit.js";
import type { FitSketch } from "./paths.js";

const SITE: FitSketch = {
  title: "Overall architecture",
  note: "How the systems fit together.",
  nodes: [
    { id: "flex", project: "flex", label: "FLEX", sub: "api", col: 0, row: 0 },
    { id: "udp", project: "udp", label: "UDP", sub: "who", col: 1, row: 0 },
  ],
  edges: [{ from: "flex", to: "udp", label: "looks up", see: "udp#request" }],
};

const IDX: ProposedFit = {
  node: { label: "IdX", sub: "swaps ids", col: 1, row: 1 },
  edges: [{ from: "udp", to: "idx", label: "swaps", see: "idx#context" }],
};

describe("mergeFit", () => {
  it("adds the box and its lines, marked proposed, and says so in the note", () => {
    const fit = mergeFit(SITE, [{ id: "idx", fit: IDX }]);
    expect(fit?.nodes.at(-1)).toEqual({
      ...IDX.node,
      id: "idx",
      project: "idx",
      proposed: true,
    });
    expect(fit?.edges.at(-1)).toEqual({ ...IDX.edges[0], proposed: true });
    expect(fit?.note).toBe(`${SITE.note} ${PROPOSED_NOTE}`);
    // What was there stays exactly as it was: nothing documented is marked.
    expect(fit?.nodes.slice(0, 2)).toEqual(SITE.nodes);
    expect(fit?.edges.slice(0, 1)).toEqual(SITE.edges);
  });

  it("leaves the sketch untouched when nothing proposed brings anything", () => {
    expect(mergeFit(SITE, [])).toBe(SITE);
    expect(mergeFit(undefined, [{ id: "idx", fit: IDX }])).toBeUndefined();
  });

  it("refuses a box on a cell that is taken", () => {
    const on = { ...IDX, node: { ...IDX.node, col: 1, row: 0 } };
    expect(() => mergeFit(SITE, [{ id: "idx", fit: on }])).toThrow(
      /where udp already is/,
    );
  });

  it("refuses a box whose id the sketch already has", () => {
    expect(() => mergeFit(SITE, [{ id: "udp", fit: IDX }])).toThrow(
      /already has/,
    );
  });

  it("refuses a line that does not touch the project adding it", () => {
    const stray = {
      ...IDX,
      edges: [{ from: "flex", to: "udp", label: "x", see: "udp#request" }],
    };
    expect(() => mergeFit(SITE, [{ id: "idx", fit: stray }])).toThrow(
      /does not touch idx/,
    );
  });

  it("refuses a line to a box the sketch does not have", () => {
    const dangling = {
      ...IDX,
      edges: [{ from: "idx", to: "uns", label: "x", see: "idx#context" }],
    };
    expect(() => mergeFit(SITE, [{ id: "idx", fit: dangling }])).toThrow(
      /names a box the sketch does not have/,
    );
  });
});

describe("sketchFor", () => {
  it("takes the box from a proposed project only", () => {
    const projects = [
      { id: "idx", proposed: true, config: { fit: IDX } },
      { id: "udp", proposed: false, config: { fit: IDX } },
    ] as unknown as Parameters<typeof sketchFor>[1];
    const fit = sketchFor(SITE, projects);
    expect(fit?.nodes.map((n) => n.id)).toEqual(["flex", "udp", "idx"]);
  });
});

describe("groups", () => {
  const GROUPED: FitSketch = {
    ...SITE,
    groups: [
      { id: "connect", label: "GOV.UK Connect", members: ["flex", "udp"] },
    ],
  };

  it("lets a proposed box join a group, and leaves the site's group as it was", () => {
    const joining = { ...IDX, node: { ...IDX.node, group: "connect" } };
    const fit = mergeFit(GROUPED, [{ id: "idx", fit: joining }]);
    expect(fit?.groups?.[0]?.members).toEqual(["flex", "udp", "idx"]);
    expect(GROUPED.groups?.[0]?.members).toEqual(["flex", "udp"]);
    expect(fit?.nodes.at(-1)).not.toHaveProperty("group");
  });

  it("refuses a box joining a group the sketch does not have", () => {
    const joining = { ...IDX, node: { ...IDX.node, group: "nope" } };
    expect(() => mergeFit(GROUPED, [{ id: "idx", fit: joining }])).toThrow(
      /joins group nope/,
    );
  });

  it("finds nothing astray when every box in the area is a member", () => {
    expect(groupStrays(GROUPED)).toEqual([]);
  });

  it("names a box the area takes in without it being a member", () => {
    const wide: FitSketch = {
      ...GROUPED,
      nodes: [
        ...GROUPED.nodes,
        { id: "app", label: "App", sub: "phone", col: 0, row: 1 },
        { id: "uns", label: "UNS", sub: "push", col: 1, row: 1 },
      ],
      groups: [{ id: "connect", label: "C", members: ["flex", "uns"] }],
    };
    expect(groupStrays(wide)).toEqual([
      "udp sits inside group connect without being a member",
      "app sits inside group connect without being a member",
    ]);
  });
});
