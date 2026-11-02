/**
 * The index's sketch of how the systems fit together is written in explorer.config.json,
 * and lists only what this public site documents. A proposed architecture is read from
 * `ARCH_PROPOSED_DIR` alone, so the public config cannot name it, and a box for it there
 * would publish a proposal on a public page. So a proposed project brings its own: one box
 * and the lines it adds, in its own config, merged in only by a build that reads it.
 *
 * Everything merged is marked `proposed` and drawn dashed, and the note under the sketch
 * says so — the sketch is otherwise what is running, and a reader must be able to tell the
 * two apart without opening anything.
 */
import type { FitEdge, FitNode, FitSketch } from "./paths.js";
import type { Project } from "./projects.js";

/** What a proposed project's config may add to the sketch. */
export interface ProposedFit {
  /** `group` names a group of the site's sketch the box joins, as a member. */
  node: Omit<FitNode, "id" | "project" | "proposed"> & { group?: string };
  edges: Omit<FitEdge, "proposed">[];
}

/** Said under the sketch whenever it carries anything proposed. */
export const PROPOSED_NOTE =
  "Dashed: proposed, nothing built — its page says which decision each part rests on.";

/**
 * The site's sketch with each proposed project's box and lines added. Pure, so the rules
 * are tested without a build: a box on a cell that is taken, a second box with the same
 * id, or a line that does not touch the project adding it is refused, never redrawn.
 */
export function mergeFit(
  site: FitSketch | undefined,
  proposed: { id: string; fit: ProposedFit }[],
): FitSketch | undefined {
  if (!site || !proposed.length) return site;
  const nodes: FitNode[] = [...site.nodes];
  const groups = (site.groups ?? []).map((g) => ({
    ...g,
    members: [...g.members],
  }));
  for (const { id, fit } of proposed) {
    if (nodes.some((n) => n.id === id))
      throw new Error(
        `${id}: its fit box takes the id ${id}, which the sketch already has`,
      );
    const on = nodes.find(
      (n) => n.col === fit.node.col && n.row === fit.node.row,
    );
    if (on)
      throw new Error(
        `${id}: its fit box sits on col ${String(fit.node.col)}, row ` +
          `${String(fit.node.row)}, where ${on.id} already is`,
      );
    const { group, ...node } = fit.node;
    if (group !== undefined) {
      const g = groups.find((x) => x.id === group);
      if (!g)
        throw new Error(
          `${id}: its fit box joins group ${group}, which the sketch does not have`,
        );
      g.members.push(id);
    }
    nodes.push({ ...node, id, project: id, proposed: true });
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: FitEdge[] = [...site.edges];
  for (const { id, fit } of proposed)
    for (const e of fit.edges) {
      if (e.from !== id && e.to !== id)
        throw new Error(
          `${id}: fit line ${e.from} → ${e.to} does not touch ${id} — a proposed ` +
            `project adds only its own lines`,
        );
      if (!ids.has(e.from) || !ids.has(e.to))
        throw new Error(
          `${id}: fit line ${e.from} → ${e.to} names a box the sketch does not have`,
        );
      edges.push({ ...e, proposed: true });
    }
  return {
    ...site,
    nodes,
    edges,
    groups,
    note: `${site.note} ${PROPOSED_NOTE}`,
  };
}

/** The grid cells a group's area spans: every cell between its outermost members. */
export function groupCells(
  nodes: FitNode[],
  members: string[],
): { col0: number; col1: number; row0: number; row1: number } {
  const of = nodes.filter((n) => members.includes(n.id));
  const cols = of.map((n) => n.col);
  const rows = of.map((n) => n.row);
  return {
    col0: Math.min(...cols),
    col1: Math.max(...cols),
    row0: Math.min(...rows),
    row1: Math.max(...rows),
  };
}

/**
 * Every box a group's area would take in without it being a member — refused, because a
 * box inside the area reads as belonging to the programme whatever the config says.
 */
export function groupStrays(sketch: FitSketch): string[] {
  const out: string[] = [];
  for (const g of sketch.groups ?? []) {
    const c = groupCells(sketch.nodes, g.members);
    for (const n of sketch.nodes)
      if (
        !g.members.includes(n.id) &&
        n.col >= c.col0 &&
        n.col <= c.col1 &&
        n.row >= c.row0 &&
        n.row <= c.row1
      )
        out.push(`${n.id} sits inside group ${g.id} without being a member`);
  }
  return out;
}

/** The sketch a build draws: the site's, plus every proposed project among `projects`. */
export function sketchFor(
  site: FitSketch | undefined,
  projects: Pick<Project, "id" | "proposed" | "config">[],
): FitSketch | undefined {
  return mergeFit(
    site,
    projects.flatMap((p) =>
      p.proposed && p.config.fit ? [{ id: p.id, fit: p.config.fit }] : [],
    ),
  );
}
