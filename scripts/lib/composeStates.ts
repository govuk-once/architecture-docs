/**
 * A planned state is what the system looks like once every step up to it has happened.
 *
 * States are cumulative, because change is: the repo split S1 makes is still there at S2,
 * and a view that shows S2 as "today plus S2's own delta" is a system that never exists.
 * So an overlay says what ITS step does — against the state before it, which is also how
 * the source material tags things — and a state's view is every overlay up to and including
 * its own, applied in order. A step can undo an earlier one; it retires what it undoes, and
 * the accumulated result simply lacks it.
 *
 * The diff a reader sees is still against today, which is the question a reviewer actually
 * asks. But it is COMPUTED by comparing the composed state with the as-is, never declared.
 * A declared diff is a second description of the same fact and drifts from the composition
 * it claims to describe; a computed one cannot.
 *
 * Composition happens here, at build time, rather than in the renderer, so that the future
 * and diff views are gated by the same geometry rules as the as-is. A layout only a person
 * ever sees is a layout nothing checks.
 */
import type {
  Detail,
  Edge,
  Plane,
  Table,
  View,
  ViewNode,
  Zone,
} from "../buildArchitectureExplorer.ts";

/** Where a box sits, when a step moves one an earlier state already drew. */
interface Geom {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/**
 * Where a box sits, said the way a person thinks about it. Roughly a quarter of every
 * overlay was arithmetic against the advances in CANVAS.md — the only interesting line of a
 * box declaration was its first one. A slot names the zone and the cell; the build sizes the
 * box from its own label, sizes the column from the widest box in it, and grows the zone to
 * hold the lot. Explicit x/y/w/h still wins, for the cases a grid cannot express.
 */
interface Slot {
  zone?: string;
  row?: number;
  col?: number;
}

/**
 * One decision, as the register records it.
 *
 * The as-is is derived from code and gated against it; a planned state is not derived from
 * anything — it is a proposal, and the only thing that makes it reviewable rather than an
 * assertion is a pointer to where it was decided.
 *
 * A POINTER, deliberately. The GOV.UK ADR framework asks an ADR for `context`, `decision`
 * and `consequences`, and those are the body of the record — they belong in the record. Copy
 * them here and there are two of them, which is the failure this whole repo exists to
 * prevent. What the register holds is what a reader needs to weigh a citation without
 * leaving the page: what it is called, whether anyone has actually decided it, who owns
 * that, and where to read the rest.
 *
 * @see https://www.gov.uk/government/publications/architectural-decision-record-framework
 */
export interface Decision {
  title: string;
  /** What kind of record it is: ADR, RFC, board question, gate. */
  kind: string;
  /** What it is about, so a reader can find every decision on one theme at once. */
  category: string;
  /**
   * The framework's approval level: who settles a decision of this scope. Naming it is what
   * turns "someone should decide this" into "this is the architecture board's to take".
   */
  level?: (typeof LEVELS)[number];
  /**
   * The framework requires a status and does not say what the values are, so these are ours.
   * `open` is the one that matters: it means nothing has been decided, and anything resting
   * on it is resting on a question.
   */
  status?: (typeof STATUSES)[number];
  date?: string;
  /** "Links to supporting documents", per the framework. Plural, because they usually are. */
  links?: { title: string; url: string }[];
  /** The decision that replaced this one. Kept so a citation to it still resolves. */
  supersededBy?: string;
}

/** The four scopes the framework defines, in the order it defines them. */
export const LEVELS = [
  "Team and working group",
  "Cross-team and programme",
  "Department-wide and strategic",
  "Cross-government and national",
] as const;

/** `open` is not a decision. Everything after it is. */
export const STATUSES = [
  "open",
  "proposed",
  "accepted",
  "rejected",
  "superseded",
] as const;

/** Ids into the register. Every change may cite as many as apply. */
export type Why = string[];

/**
 * What a step does to a reference table it inherits, named by the table's own title.
 *
 * A row is named by its key: the text of its first `key` cells, markup stripped, joined with
 * " · " — one cell unless a table's first column repeats. A changed row is restated whole,
 * because a table row is read across, and a patch to one cell of it would leave a reviewer
 * reconstructing the rest.
 */
export interface TablePatch {
  /** Replaces the table's note, when what it says has changed too. */
  note?: string;
  /** How many leading cells name a row. One, unless the first column repeats. */
  key?: number;
  retiredRows?: Record<string, Why>;
  changedRows?: Record<string, { cells: string[]; why?: Why }>;
  newRows?: { cells: string[]; why?: Why }[];
  why?: Why;
}

/** A reference table a step adds. Its rows may each cite their own decision. */
export interface NewTable {
  name: string;
  cols: string[];
  note?: string;
  rows: { cells: string[]; why?: Why }[];
  why?: Why;
}

export interface StateOverlay {
  state: string;
  view: string;
  /** Replaces the state's own blurb under the view header, when this view needs its own. */
  note?: string;
  /** Cited by anything in this file that does not cite something of its own. */
  why?: Why;
  retired?: Record<string, Why>;
  retiredZones?: Record<string, Why>;
  /** Boxes this step alters. Geometry may move too. */
  changed?: Record<
    string,
    Geom &
      Slot & {
        label?: string;
        sub?: string;
        /* What a box is, as well as what it is called: a state that turns a Lambda into a
           cross-account call has changed its type, not only its label. */
        type?: string;
        tech?: string;
        role?: string;
        plane?: Plane;
        facts?: string[];
        /**
         * The inventory rows this box deploys once the step is taken, replacing today's.
         * An empty list drops the badge: today's count would describe something else.
         */
        resources?: string[];
        why?: Why;
      }
  >;
  /** Boxes that only move. Repositioning is not a change of substance, so it is not marked. */
  moved?: Record<string, Geom & Slot>;
  /**
   * Lines this step alters or takes away, keyed "from to" — the pair a line is identified
   * by. A line goes on its own when either end goes; these are for a line whose ends stay.
   */
  changedEdges?: Record<
    string,
    {
      label?: string;
      dir?: string;
      style?: string;
      protocol?: string;
      auth?: string;
      carries?: string;
      why?: Why;
    }
  >;
  retiredEdges?: Record<string, Why>;
  zones?: Record<string, Geom & { label?: string; why?: Why }>;
  /**
   * `w` and `h` may be left out, and the zone is grown to hold whatever it is given.
   * `hard` draws it as a dashed boundary rather than a filled ground, as the as-is does.
   */
  newZones?: {
    id: string;
    label: string;
    x: number;
    y: number;
    w?: number;
    h?: number;
    hard?: boolean;
    type?: string;
    tech?: string;
    role?: string;
    why?: Why;
  }[];
  /** Either x/y/w/h, or a slot. A slot sizes the box from its own label. */
  newNodes?: (Geom &
    Slot & {
      id: string;
      label: string;
      sub?: string;
      kind: string;
      /** As the as-is uses it. Defaults to the request path. */
      plane?: Plane;
      type?: string;
      tech?: string;
      role?: string;
      /** A sprite symbol, when the type does not imply one. */
      icon?: string;
      facts?: string[];
      /** Inventory rows it deploys, when they are already in this project's inventory. */
      resources?: string[];
      why?: Why;
    })[];
  /**
   * `dir: "both"` draws it as a two-way relationship. `style: "dash"` needs the view to say
   * what dashed means there, which is why `dashMeans` is on this file too — a dashed edge
   * with nothing explaining it is a build failure a state could not otherwise repair.
   */
  newEdges?: {
    from: string;
    to: string;
    label?: string;
    dir?: string;
    style?: string;
    protocol?: string;
    auth?: string;
    carries?: string;
    why?: Why;
  }[];
  /** What a dashed line means on this view, when this step draws one. */
  dashMeans?: string;
  /**
   * Reference tables, keyed by title. A table is as much a claim about the architecture as
   * a box, and a state that redraws the boxes over today's tables contradicts itself one
   * scroll down.
   */
  tables?: Record<string, TablePatch>;
  newTables?: NewTable[];
  retiredTables?: Record<string, Why>;
}

export interface StateManifest {
  id: string;
  name: string;
  label: string;
  order: number;
  blurb: string;
  /** Cited by anything in this state that cites nothing of its own. */
  why?: Why;
  /**
   * Views this state deliberately leaves alone. Without it, a view no state has touched can
   * only say "not modelled", which reads the same whether the state was considered here and
   * found to change nothing or whether nobody has got to it yet. Those are different facts.
   */
  unchanged?: string[];
}

/** One step of the chain: a state, and what its own overlay does to this view. */
export interface Step {
  st: StateManifest;
  ov?: StateOverlay;
}

export type Mode = "future" | "changes";
/** What a state does to a box, a zone or a line, versus today. */
export type Lifecycle = "new" | "changed" | "retired";

const geom = <T extends object>(box: T, from: Geom | undefined): T => {
  if (!from) return box;
  const out = { ...box } as T & Geom;
  for (const k of ["x", "y", "w", "h"] as const)
    if (from[k] !== undefined) out[k] = from[k];
  return out;
};

/** What a line says: its words, its direction, its style, and the three facts it carries. */
const edgeSubstance = (e: Edge) =>
  JSON.stringify([
    e.label,
    e.dir,
    e.style,
    e.d.protocol,
    e.d.auth,
    e.d.carries,
  ]);

/** What a box says, ignoring where it sits. Moving a box is not a change of substance. */
const substance = (n: ViewNode) =>
  JSON.stringify([
    n.label,
    n.sub,
    n.kind,
    n.plane,
    { ...n.d, lifecycle: 0, why: 0 },
  ]);
const edgeKey = (e: Edge) => `${e.from} ${e.to}`;

/** What a row is called: the text of its first `n` cells, markup stripped. */
export const rowKey = (row: string[], n = 1) =>
  row
    .slice(0, n)
    .map((c) => c.replace(/<[^>]+>/g, "").trim())
    .join(" · ");
/* The keys of every row, with a repeat told apart by its place — the alarm table names a
   source in its first column and repeats it per alarm. A step may not address a repeated key,
   but the diff still has to line today's rows up with the state's by position. */
const rowKeys = (rows: string[][], n: number) => {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const k = rowKey(r, n);
    const at = (seen.get(k) ?? 0) + 1;
    seen.set(k, at);
    return at === 1 ? k : `${k} #${String(at)}`;
  });
};
/* Where a table's and a row's citations are recorded, beside the ids of boxes and the pairs
   of lines — prefixed so that a table titled like a box can never take its citation. */
const tableKey = (name: string) => `table:${name}`;
const tableRowKey = (name: string, key: string) => `row:${name}:${key}`;

/** Append, or replace in place if this id is already drawn. */
const put = <T extends { id: string }>(list: T[], item: T): T[] => {
  const at = list.findIndex((x) => x.id === item.id);
  if (at < 0) return [...list, item];
  const out = [...list];
  out[at] = item;
  return out;
};

/** The same, for edges, which are identified by the pair they join. */
const putEdge = (list: Edge[], e: Edge): Edge[] => {
  const at = list.findIndex((x) => edgeKey(x) === edgeKey(e));
  if (at < 0) return [...list, e];
  const out = [...list];
  out[at] = e;
  return out;
};

/** CANVAS.md's advances, so a box is sized from what it says rather than from a guess. */
export const widthFor = (label: string, sub = "") =>
  Math.max(
    176,
    Math.ceil(label.length * 7.0) + 22,
    Math.ceil(sub.length * 6.7) + 22,
  );

/* Room for the zone label at the top, and enough at the sides that a box never looks
   welded to the edge. Gutters are the smallest that still read as a gap. */
export const PAD_X = 24,
  PAD_TOP = 50,
  PAD_BOTTOM = 22,
  GUTTER_X = 14,
  GUTTER_Y = 20;
/* An auto-sized zone with nothing in it yet. Room for one box and the label, so it reads
   as a boundary waiting for contents rather than as a box that lost its text. */
export const EMPTY_ZONE_W = 320,
  EMPTY_ZONE_H = 160;

/**
 * Place every slotted box in a zone, and grow the zone to hold them.
 *
 * Re-run after each step, over every slot the chain has assigned so far, so a later state
 * adding a row to a zone an earlier one filled reflows the whole grid instead of landing on
 * top of it. Columns take the width of the widest box in them; rows the height of the
 * tallest. A zone whose author gave no `w`/`h` is sized to its contents and to its own label.
 */
function layoutSlots(
  zones: Zone[],
  nodes: ViewNode[],
  slots: Map<string, Slot>,
  autoSized: Set<string>,
) {
  const byZone = new Map<string, ViewNode[]>();
  for (const n of nodes) {
    const s = slots.get(n.id);
    if (!s?.zone) continue;
    byZone.set(s.zone, [...(byZone.get(s.zone) ?? []), n]);
  }
  for (const [zoneId, members] of byZone) {
    const zi = zones.findIndex((z) => z.id === zoneId);
    if (zi < 0) continue;
    const zone = zones[zi];
    if (!zone) continue;
    const at = (n: ViewNode) => slots.get(n.id) ?? {};
    const cols = Math.max(...members.map((n) => at(n).col ?? 1));
    const rows = Math.max(...members.map((n) => at(n).row ?? 1));
    const colW: number[] = [];
    for (let c = 1; c <= cols; c++)
      colW.push(
        Math.max(
          176,
          ...members.filter((n) => (at(n).col ?? 1) === c).map((n) => n.w),
        ),
      );
    const rowH: number[] = [];
    for (let r = 1; r <= rows; r++)
      rowH.push(
        Math.max(
          52,
          ...members.filter((n) => (at(n).row ?? 1) === r).map((n) => n.h),
        ),
      );
    const sum = (a: number[], upto: number, gutter: number) =>
      a.slice(0, upto).reduce((t, v) => t + v + gutter, 0);
    for (const n of members) {
      const s = at(n);
      Object.assign(n, {
        x: zone.x + PAD_X + sum(colW, (s.col ?? 1) - 1, GUTTER_X),
        y: zone.y + PAD_TOP + sum(rowH, (s.row ?? 1) - 1, GUTTER_Y),
      });
    }
    /* Never smaller than it was empty: a boundary that hugs its one box reads as a box
       with a border, and the next drop would land outside it. */
    if (autoSized.has(zoneId))
      zones[zi] = {
        ...zone,
        w: Math.max(
          EMPTY_ZONE_W,
          PAD_X * 2 + sum(colW, cols, GUTTER_X) - GUTTER_X,
          Math.ceil(zone.label.length * 8.32) + 32,
        ),
        h: Math.max(
          EMPTY_ZONE_H,
          PAD_TOP + sum(rowH, rows, GUTTER_Y) - GUTTER_Y + PAD_BOTTOM,
        ),
      };
  }
}

/**
 * An auto-sized zone holds what is put in it by hand as well as what the grid places: any
 * hand-placed box that overlaps the zone pulls its edge out to contain it, with the same
 * padding the grid leaves. Repeated until nothing more is pulled in, because growing can
 * reach a box that was just outside — bounded, since each pass adds at least one box.
 */
function growAround(
  zones: Zone[],
  nodes: ViewNode[],
  byHand: Set<string>,
  autoSized: Set<string>,
) {
  const hand = nodes.filter((n) => byHand.has(n.id));
  for (let pass = 0; pass < hand.length + 1; pass++) {
    let grew = false;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (!z || !autoSized.has(z.id)) continue;
      const overlapping = hand.filter(
        (n) =>
          n.x < z.x + z.w &&
          n.x + n.w > z.x &&
          n.y < z.y + z.h &&
          n.y + n.h > z.y,
      );
      if (!overlapping.length) continue;
      const right = Math.max(
        z.x + z.w,
        ...overlapping.map((n) => n.x + n.w + PAD_X),
      );
      const bottom = Math.max(
        z.y + z.h,
        ...overlapping.map((n) => n.y + n.h + PAD_BOTTOM),
      );
      if (right === z.x + z.w && bottom === z.y + z.h) continue;
      zones[i] = { ...z, w: right - z.x, h: bottom - z.y };
      grew = true;
    }
    if (!grew) break;
  }
}

/**
 * Every overlay up to and including this state, applied in order. `why` records the last
 * step that touched each id, so the inspector can say which state is answerable for it.
 */
function accumulate(base: View, chain: Step[]) {
  let zones: Zone[] = [...(base.zones ?? [])];
  let nodes: ViewNode[] = [...(base.nodes ?? [])];
  let edges: Edge[] = [...(base.edges ?? [])];
  let tables: Table[] = (base.tables ?? []).map((t) => ({ ...t }));
  /* How many cells name a row, per table: one unless a step says otherwise. Kept for the
     diff, which has to name today's rows the same way the steps named them. */
  const keyCols = new Map<string, number>();
  const why = new Map<string, Why>();
  const problems: string[] = [];
  const slots = new Map<string, Slot>();
  const autoSized = new Set<string>();
  /* Boxes a step put somewhere by hand — coordinates, not a slot. An auto-sized zone
     grows to hold these when they overlap it, as it grows around its grid. */
  const byHand = new Set<string>();
  let lastTouch: Step | undefined;

  for (const step of chain) {
    const ov = step.ov;
    if (!ov) continue;
    lastTouch = step;
    /* The nearest citation wins: the change's own, else the file's, else the state's. A
       change that cites nothing is recorded as citing nothing, which is what the uncited
       ratchet counts — never silently attributed to something it did not come from. */
    const fallback = ov.why ?? step.st.why ?? [];
    const note = (id: string, cited?: Why) =>
      why.set(id, cited?.length ? cited : fallback);

    /*
     * An overlay names the as-is by id, so it rots the moment the model renames a box —
     * silently, because a retirement of something that is not there removes nothing and a
     * patch to something that is not there patches nothing. The consequence surfaces later
     * as a layout that looks wrong for no stated reason, which is the worst kind of failure
     * to debug. Every reference is checked here, against the view as it stands when this
     * step applies rather than against today, because a step may legitimately act on what
     * an earlier one built.
     */
    const where = `states/${step.st.id}/${ov.view}.json`;
    const nodeIds = new Set(nodes.map((n) => n.id));
    const zoneIds = new Set(zones.map((z) => z.id));
    const check = (
      ids: Iterable<string>,
      verb: string,
      known: Set<string>,
      what: string,
    ) => {
      for (const id of ids)
        if (!known.has(id))
          problems.push(
            `${where}: ${verb} "${id}", which is not ${what} at that point`,
          );
    };
    check(
      Object.keys(ov.retired ?? {}),
      "retires",
      nodeIds,
      "a box in the view",
    );
    check(
      Object.keys(ov.retiredZones ?? {}),
      "retires zone",
      zoneIds,
      "a zone in the view",
    );
    check(
      Object.keys(ov.changed ?? {}),
      "changes",
      nodeIds,
      "a box in the view",
    );
    check(Object.keys(ov.moved ?? {}), "moves", nodeIds, "a box in the view");
    const edgeIds = new Set(edges.map(edgeKey));
    check(
      Object.keys(ov.changedEdges ?? {}),
      "changes the line",
      edgeIds,
      "a line in the view",
    );
    check(
      Object.keys(ov.retiredEdges ?? {}),
      "retires the line",
      edgeIds,
      "a line in the view",
    );
    check(
      Object.keys(ov.zones ?? {}),
      "patches zone",
      zoneIds,
      "a zone in the view",
    );
    /* A slot naming a zone that is not there placed the box at the origin and said nothing
       — the same silent failure as a stale id, and found the same way: by someone typing a
       name that used to be right. */
    const zoneWillExist = new Set([
      ...zoneIds,
      ...(ov.newZones ?? []).map((z) => z.id),
    ]);
    for (const [id, s] of [
      ...(ov.newNodes ?? []).map((n) => [n.id, n] as const),
      ...Object.entries(ov.moved ?? {}),
      ...Object.entries(ov.changed ?? {}),
    ])
      if (s.zone && !zoneWillExist.has(s.zone))
        problems.push(
          `${where}: puts "${id}" in zone "${s.zone}", which is not a zone in the view at that point`,
        );

    const retired = new Set(Object.keys(ov.retired ?? {}));
    const retiredZones = new Set(Object.keys(ov.retiredZones ?? {}));
    for (const [id, cited] of Object.entries(ov.retired ?? {})) note(id, cited);
    for (const [id, cited] of Object.entries(ov.retiredZones ?? {}))
      note(id, cited);

    zones = zones
      .filter((z) => !retiredZones.has(z.id))
      .map((z) => {
        const zp = (ov.zones ?? {})[z.id];
        if (!zp) return z;
        note(z.id, zp.why);
        return { ...geom(z, zp), ...(zp.label ? { label: zp.label } : {}) };
      });
    /* A later step may redefine what an earlier one introduced — S3 re-places the control
       plane S2 built rather than adding a second copy of it — so an id that already exists
       is replaced in place, not appended. */
    for (const z of ov.newZones ?? []) {
      note(z.id, z.why);
      /* No w or h means "hold whatever I put in you" — the grid decides both. */
      if (z.w === undefined || z.h === undefined) autoSized.add(z.id);
      else autoSized.delete(z.id);
      zones = put(zones, {
        ...z,
        w: z.w ?? EMPTY_ZONE_W,
        h: z.h ?? EMPTY_ZONE_H,
        hard: z.hard ?? false,
        d: { type: z.type, tech: z.tech, role: z.role, facts: [] },
      });
    }

    nodes = nodes
      .filter((n) => !retired.has(n.id))
      .map((n) => {
        const patch = (ov.changed ?? {})[n.id];
        const move = (ov.moved ?? {})[n.id];
        if (!patch && !move) return n;
        note(n.id, patch?.why);
        for (const s of [move, patch])
          if (s?.zone) {
            slots.set(n.id, { zone: s.zone, row: s.row, col: s.col });
            byHand.delete(n.id);
          } else if (s?.x !== undefined || s?.y !== undefined) {
            slots.delete(n.id);
            byHand.add(n.id);
          }
        const placed = geom(n, { ...move, ...patch });
        if (!patch) return placed;
        return {
          ...placed,
          label: patch.label ?? n.label,
          sub: patch.sub !== undefined ? patch.sub : n.sub,
          plane: patch.plane ?? n.plane,
          d: {
            ...n.d,
            type: patch.type ?? n.d.type,
            tech: patch.tech ?? n.d.tech,
            role: patch.role ?? n.d.role,
            facts: [...n.d.facts, ...(patch.facts ?? [])],
          },
        };
      });
    for (const n of ov.newNodes ?? []) {
      note(n.id, n.why);
      if (n.zone) {
        slots.set(n.id, { zone: n.zone, row: n.row, col: n.col });
        byHand.delete(n.id);
      } else if (n.x !== undefined) {
        slots.delete(n.id);
        byHand.add(n.id);
      }
      nodes = put(nodes, {
        id: n.id,
        label: n.label,
        sub: n.sub ?? "",
        x: n.x ?? 0,
        y: n.y ?? 0,
        w: n.w ?? widthFor(n.label, n.sub),
        h: n.h ?? 52,
        kind: n.kind,
        plane: n.plane ?? "request",
        icon: n.icon,
        d: { type: n.type, tech: n.tech, role: n.role, facts: n.facts ?? [] },
      });
    }

    // An edge whose end has gone goes with it, whichever step removed the end.
    const present = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => present.has(e.from) && present.has(e.to));
    /* A line taken away, or altered, while both its ends stay. */
    for (const [key, cited] of Object.entries(ov.retiredEdges ?? {}))
      note(key, cited);
    const retiredEdges = new Set(Object.keys(ov.retiredEdges ?? {}));
    edges = edges
      .filter((e) => !retiredEdges.has(edgeKey(e)))
      .map((e) => {
        const patch = (ov.changedEdges ?? {})[edgeKey(e)];
        if (!patch) return e;
        note(edgeKey(e), patch.why);
        return {
          ...e,
          label: patch.label ?? e.label,
          dir: patch.dir !== undefined ? patch.dir : e.dir,
          style: patch.style !== undefined ? patch.style : e.style,
          d: {
            ...e.d,
            protocol: patch.protocol ?? e.d.protocol,
            auth: patch.auth ?? e.d.auth,
            carries: patch.carries ?? e.d.carries,
          },
        };
      });
    for (const e of ov.newEdges ?? []) {
      note(`${e.from} ${e.to}`, e.why);
      for (const end of [e.from, e.to])
        if (!present.has(end))
          problems.push(
            `${where}: draws a line to "${end}", which is not a box in the view at that point`,
          );
      edges = putEdge(edges, {
        from: e.from,
        to: e.to,
        label: e.label ?? "",
        dir: e.dir ?? null,
        style: e.style ?? null,
        d: {
          protocol: e.protocol,
          auth: e.auth,
          carries: e.carries,
          facts: [],
        },
      });
    }
    tables = applyTables(tables, ov, where, keyCols, note, problems);
    for (const id of retired) slots.delete(id);
    layoutSlots(zones, nodes, slots, autoSized);
    growAround(zones, nodes, byHand, autoSized);
  }
  return {
    zones,
    nodes,
    edges,
    tables,
    keyCols,
    why,
    lastTouch,
    problems,
  };
}

/**
 * One step's tables. Checked the way boxes are, against the tables as they stand when the
 * step applies: a table renamed in the model, or a row whose key changed, would otherwise be
 * a patch that patches nothing, and the page would show today's row under a state that
 * claims to have changed it.
 */
function applyTables(
  tables: Table[],
  ov: StateOverlay,
  where: string,
  keyCols: Map<string, number>,
  note: (id: string, cited?: Why) => void,
  problems: string[],
): Table[] {
  const names = new Set(tables.map((t) => t.name));
  for (const name of [
    ...Object.keys(ov.retiredTables ?? {}),
    ...Object.keys(ov.tables ?? {}),
  ])
    if (!names.has(name))
      problems.push(
        `${where}: changes the table "${name}", which is not a table in the view at that point`,
      );
  for (const [name, cited] of Object.entries(ov.retiredTables ?? {}))
    note(tableKey(name), cited);
  let out = tables.filter((t) => !(ov.retiredTables ?? {})[t.name]);

  out = out.map((t) => {
    const patch = (ov.tables ?? {})[t.name];
    if (!patch) return t;
    if (patch.key !== undefined) keyCols.set(t.name, patch.key);
    const n = keyCols.get(t.name) ?? 1;
    note(tableKey(t.name), patch.why);
    const fallback = patch.why;
    const keys = t.rows.map((r) => rowKey(r, n));
    /* A key two rows share names neither of them. */
    const named = [
      ...Object.keys(patch.retiredRows ?? {}),
      ...Object.keys(patch.changedRows ?? {}),
    ];
    for (const k of new Set(named)) {
      const times = keys.filter((x) => x === k).length;
      if (times > 1)
        problems.push(
          `${where}: "${t.name}" has ${String(times)} rows named "${k}" — set key to more cells`,
        );
    }
    const width = (cells: string[], what: string) => {
      if (cells.length !== t.cols.length)
        problems.push(
          `${where}: ${what} in "${t.name}" has ${String(cells.length)} cells, but the table has ${String(t.cols.length)} columns`,
        );
    };
    for (const k of named)
      if (!keys.includes(k))
        problems.push(
          `${where}: changes the row "${k}" of "${t.name}", which is not a row at that point`,
        );
    const rows: string[][] = [];
    t.rows.forEach((r, i) => {
      const k = keys[i] ?? "";
      if ((patch.retiredRows ?? {})[k]) {
        note(tableRowKey(t.name, k), patch.retiredRows?.[k] ?? fallback);
        return;
      }
      const c = (patch.changedRows ?? {})[k];
      if (!c) {
        rows.push(r);
        return;
      }
      width(c.cells, `the row "${k}"`);
      /* A changed row may rename itself; its citation follows the name it now has. */
      note(tableRowKey(t.name, rowKey(c.cells, n)), c.why ?? fallback);
      rows.push(c.cells);
    });
    for (const r of patch.newRows ?? []) {
      const k = rowKey(r.cells, n);
      width(r.cells, `the new row "${k}"`);
      if (rows.some((x) => rowKey(x, n) === k))
        problems.push(
          `${where}: adds the row "${k}" to "${t.name}", which already has one by that name`,
        );
      note(tableRowKey(t.name, k), r.why ?? fallback);
      rows.push(r.cells);
    }
    return {
      ...t,
      rows,
      ...(patch.note !== undefined ? { note: patch.note } : {}),
    };
  });

  for (const nt of ov.newTables ?? []) {
    if (out.some((t) => t.name === nt.name))
      problems.push(
        `${where}: adds the table "${nt.name}", which the view already has`,
      );
    note(tableKey(nt.name), nt.why);
    for (const r of nt.rows) {
      if (r.cells.length !== nt.cols.length)
        problems.push(
          `${where}: a row of the new table "${nt.name}" has ${String(r.cells.length)} cells, but it has ${String(nt.cols.length)} columns`,
        );
      note(tableRowKey(nt.name, rowKey(r.cells, 1)), r.why ?? nt.why);
    }
    out = [
      ...out.filter((t) => t.name !== nt.name),
      {
        name: nt.name,
        cols: nt.cols,
        rows: nt.rows.map((r) => r.cells),
        ...(nt.note !== undefined ? { note: nt.note } : {}),
      },
    ];
  }
  return out;
}

/**
 * The tables as a state leaves them, and — under Changes — what that is against today.
 *
 * Computed, like every other difference: a row whose key today lacks is new, one whose key
 * today has but whose cells differ is changed, and today's rows the state no longer has are
 * kept in place, marked retired, so what goes can be argued with where it stood. A table
 * today lacks is new throughout; a table the state drops is listed last, retired.
 */
function diffTables(
  base: Table[],
  now: Table[],
  keyCols: Map<string, number>,
  why: Map<string, Why>,
): Table[] {
  const was = new Map(base.map((t) => [t.name, t]));
  const out: Table[] = now.map((t) => {
    const before = was.get(t.name);
    const n = keyCols.get(t.name) ?? 1;
    const rowWhy = (k: string) => why.get(tableRowKey(t.name, k));
    if (!before)
      return {
        ...t,
        lifecycle: "new" as const,
        why: why.get(tableKey(t.name)),
        marks: t.rows.map((r) => ({
          lifecycle: "new" as const,
          why: rowWhy(rowKey(r, n)),
        })),
      };
    const beforeKeys = rowKeys(before.rows, n);
    const nowKeysList = rowKeys(t.rows, n);
    const nowByKey = new Map(nowKeysList.map((k, i) => [k, t.rows[i] ?? []]));
    const rows: string[][] = [];
    const marks: Table["marks"] = [];
    const same = (a: string[], b: string[]) =>
      JSON.stringify(a) === JSON.stringify(b);
    /* Today's order first, each row where it stood — kept, changed, or struck through —
       then whatever the state adds, in the order it added it. */
    before.rows.forEach((r, i) => {
      const k = beforeKeys[i] ?? "";
      const cur = nowByKey.get(k);
      if (!cur) {
        rows.push(r);
        marks.push({ lifecycle: "retired", why: rowWhy(k) });
        return;
      }
      rows.push(cur);
      marks.push(
        same(cur, r) ? null : { lifecycle: "changed", why: rowWhy(k), was: r },
      );
    });
    const had = new Set(beforeKeys);
    t.rows.forEach((r, i) => {
      const k = nowKeysList[i] ?? "";
      if (had.has(k)) return;
      rows.push(r);
      marks.push({ lifecycle: "new", why: rowWhy(k) });
    });
    const differs =
      marks.some(Boolean) || (t.note ?? "") !== (before.note ?? "");
    return differs
      ? {
          ...t,
          rows,
          marks,
          lifecycle: "changed" as const,
          why: why.get(tableKey(t.name)),
        }
      : t;
  });
  const kept = new Set(now.map((t) => t.name));
  for (const t of base)
    if (!kept.has(t.name))
      out.push({
        ...t,
        lifecycle: "retired",
        why: why.get(tableKey(t.name)),
        marks: t.rows.map(() => ({ lifecycle: "retired" as const })),
      });
  return out;
}

/** What the chain names that is not there to be named, without composing a view. */
export function chainProblems(base: View, chain: Step[]): string[] {
  return accumulate(base, chain).problems;
}

/**
 * The composed view. `future` is the state as it would stand — no marks, because a reader
 * asking "what will this look like" is not asking "what changed". `changes` is the same
 * layout with every difference from today marked, and what the chain retires collected into
 * a strip beneath it: the retired estate cannot be drawn where it stands today, because the
 * new material is already there.
 */
export function composeChain(
  base: View,
  chain: Step[],
  at: StateManifest,
  mode: Mode,
): View {
  const diff = mode === "changes";
  const acc = accumulate(base, chain);
  /* `key` is what `accumulate` recorded the citation under: the id, or the pair for a line. */
  const mark = <T extends { d: Detail }>(
    box: T,
    lc: Lifecycle,
    key: string,
  ): T =>
    diff
      ? { ...box, d: { ...box.d, lifecycle: lc, why: acc.why.get(key) } }
      : box;

  const wasNode = new Map((base.nodes ?? []).map((n) => [n.id, n]));
  const wasZone = new Map((base.zones ?? []).map((z) => [z.id, z]));
  const wasEdge = new Map((base.edges ?? []).map((e) => [edgeKey(e), e]));

  const zones = acc.zones.map((z) => {
    if (!diff) return z;
    const before = wasZone.get(z.id);
    if (!before) return mark(z, "new", z.id);
    return before.label === z.label ? z : mark(z, "changed", z.id);
  });
  const nodes = acc.nodes.map((n) => {
    if (!diff) return n;
    const before = wasNode.get(n.id);
    if (!before) return mark(n, "new", n.id);
    return substance(before) === substance(n) ? n : mark(n, "changed", n.id);
  });
  const edges = acc.edges.map((e) => {
    if (!diff) return e;
    const before = wasEdge.get(edgeKey(e));
    if (!before) return mark(e, "new", edgeKey(e));
    return edgeSubstance(before) === edgeSubstance(e)
      ? e
      : mark(e, "changed", edgeKey(e));
  });

  // A retired box keeps no resource badge: the count is what the code deploys today, and
  // this box is the argument for not deploying it.
  const here = new Set(nodes.map((n) => n.id));
  /* A line retired while both its ends stay is drawn where it was, faded, the way a
     retired box is shown in the strip: what goes has to be visible to be argued with. A
     line whose end went is not drawn — its box in the strip is the argument. */
  if (diff) {
    const still = new Set(acc.edges.map(edgeKey));
    for (const e of base.edges ?? [])
      if (!still.has(edgeKey(e)) && here.has(e.from) && here.has(e.to))
        edges.push(mark(e, "retired", edgeKey(e)));
  }
  /* A step may say what a box it changes or adds deploys, and a later step wins. Without
     this a box re-purposed by a state kept today's count, which describes the box it was. */
  const placed = new Map(Object.entries(base.placement ?? {}));
  for (const { ov } of chain) {
    for (const [id, c] of Object.entries(ov?.changed ?? {}))
      if (c.resources) placed.set(id, c.resources);
    for (const n of ov?.newNodes ?? [])
      if (n.resources) placed.set(n.id, n.resources);
  }
  const placement = Object.fromEntries(
    [...placed].filter(([box, ids]) => here.has(box) && ids.length),
  );

  const edge = (vals: number[], fallback: number) =>
    Math.max(fallback, ...vals) + 40;
  let strip = 0;
  const gone = diff ? (base.nodes ?? []).filter((n) => !here.has(n.id)) : [];
  if (gone.length) {
    const width = edge(
      [...nodes.map((n) => n.x + n.w), ...zones.map((z) => z.x + z.w)],
      base.w ?? 0,
    );
    const top =
      edge(
        [...nodes.map((n) => n.y + n.h), ...zones.map((z) => z.y + z.h)],
        base.h ?? 0,
      ) + 20;
    const pad = 24;
    let x = pad,
      y = top + 44,
      rowH = 0;
    for (const n of gone) {
      if (x + n.w > width - pad && x > pad) {
        x = pad;
        y += rowH + 18;
        rowH = 0;
      }
      nodes.push(mark({ ...n, x, y }, "retired", n.id));
      x += n.w + 18;
      rowH = Math.max(rowH, n.h);
    }
    // The hint strip is painted over the foot of the canvas, so the last row needs room
    // under it or it reads as cut off.
    strip = y + rowH + 60;
    zones.push(
      mark(
        {
          id: "retired",
          label: `Retired by ${at.name} · shown out of place`,
          x: 6,
          y: top,
          w: width - 12,
          h: y + rowH + 22 - top,
          hard: false,
          d: { facts: [] },
        },
        "retired",
        "retired",
      ),
    );
  }

  /* A view says what a dashed line means there; the last step to say so wins. */
  const dashMeans =
    chain
      .map((s) => s.ov?.dashMeans)
      .filter(Boolean)
      .at(-1) ?? base.dashMeans;
  /* Whose step this view is showing. A state that changes nothing here still shows the
     change an earlier one made, and should say so rather than claim it as its own. */
  const own = chain.find((s) => s.st.id === at.id)?.ov;
  const from = acc.lastTouch?.st;
  let note = at.blurb;
  if (own) note = own.note ?? at.blurb;
  else if (from)
    note = `unchanged since ${from.name}, which is where this view last moved.`;
  return {
    ...base,
    zones,
    nodes,
    edges,
    placement,
    w: edge(
      [...nodes.map((n) => n.x + n.w), ...zones.map((z) => z.x + z.w)],
      base.w ?? 0,
    ),
    h: Math.max(
      strip,
      edge(
        [...nodes.map((n) => n.y + n.h), ...zones.map((z) => z.y + z.h)],
        base.h ?? 0,
      ),
    ),
    dashMeans,
    ...(base.tables || acc.tables.length
      ? {
          tables: diff
            ? diffTables(base.tables ?? [], acc.tables, acc.keyCols, acc.why)
            : acc.tables,
        }
      : {}),
    stateNote: `${at.label} — ${note}`,
  };
}
