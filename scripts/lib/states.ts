/**
 * Reading and validating a project's planned states.
 *
 * This lives apart from the build because the build is not the only thing that needs it:
 * the review export walks the same changes, and the state editor validates with exactly
 * these functions rather than a second opinion about the same rules. A second opinion is
 * the failure mode worth designing out — an editor that accepts what the build refuses is
 * worse than no editor, because it teaches you the wrong format with a green tick.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { View } from "../buildArchitectureExplorer.ts";
import type {
  Decision,
  Mode,
  StateManifest,
  StateOverlay,
  Step,
} from "./composeStates.js";
import {
  chainProblems,
  composeChain,
  LEVELS,
  STATUSES,
} from "./composeStates.js";
import { DOCS_ROOT, STATES_ROOT } from "./paths.js";
import type { Project } from "./projects.js";

/**
 * Where one project's planned states are read from and written to, or null when this build
 * has none. Never inside this repository: it is public, and a states/ directory here would
 * publish every proposal with the as-is. So one found here stops the build rather than
 * being read — the fix is to move it to architecture-docs-states, not to delete the check.
 */
export function statesDir(
  project: Pick<Project, "id" | "modelDir">,
  root: string | null = STATES_ROOT,
): string | null {
  const inRepo = path.join(project.modelDir, "..", "states");
  if (existsSync(inRepo))
    throw new Error(
      `${path.relative(DOCS_ROOT, inRepo)}/ exists, and this repository is public. Planned ` +
        `states live in govuk-once/architecture-docs-states — move it there and build with ` +
        `ARCH_STATES_DIR pointing at that repository's states/.`,
    );
  return root ? path.join(root, project.id) : null;
}

/** Everything one project's states/ directory holds. */
export interface States {
  list: StateManifest[];
  overlays: Record<string, Record<string, StateOverlay>>;
  decisions: Record<string, Decision>;
}

/**
 * Proposals laid over the as-is: <ARCH_STATES_DIR>/<id>/<state>/state.json names the state,
 * and each <view>.json beside it is what that state does to one view — what it retires,
 * what it changes, what it adds. The build composes them into `byState` and the page
 * carries that, so the overlays are the only thing anyone edits and the composition is
 * gated like the as-is. `list` comes back sorted by `order`, which `chainTo` relies on.
 */
export function loadStates(project: Project): States {
  const dir = statesDir(project);
  if (!dir || !existsSync(dir))
    return { list: [], overlays: {}, decisions: {} };
  /* Where a planned change was argued. A state is a proposal, not a derivation, so this is
     the only thing standing between it and an assertion. */
  const register = path.join(dir, "decisions.json");
  const decisions: Record<string, Decision> = existsSync(register)
    ? (JSON.parse(readFileSync(register, "utf8")) as Record<string, Decision>)
    : {};
  const list: StateManifest[] = [];
  const overlays: Record<string, Record<string, StateOverlay>> = {};
  for (const id of readdirSync(dir)) {
    const sdir = path.join(dir, id);
    if (!statSync(sdir).isDirectory()) continue;
    const manifest = path.join(sdir, "state.json");
    if (!existsSync(manifest)) continue;
    list.push(JSON.parse(readFileSync(manifest, "utf8")) as StateManifest);
    overlays[id] = {};
    for (const f of readdirSync(sdir))
      if (f.endsWith(".json") && f !== "state.json")
        overlays[id][f.replace(/\.json$/, "")] = JSON.parse(
          readFileSync(path.join(sdir, f), "utf8"),
        ) as StateOverlay;
  }
  list.sort((a, b) => a.order - b.order);
  return { list, overlays, decisions };
}

/** Every planned change, in words, with what it cites. One walk, because the citation gate
 *  and the decisions view both need exactly this and two walks would drift. */
export function planned(states: Pick<States, "list" | "overlays">) {
  const out: {
    st: StateManifest;
    view: string;
    what: string;
    why: string[];
  }[] = [];
  for (const st of states.list)
    for (const [view, ov] of Object.entries(states.overlays[st.id] ?? {})) {
      const fallback = ov.why ?? st.why ?? [];
      const add = (what: string, why: string[] | undefined) =>
        out.push({ st, view, what, why: why?.length ? why : fallback });
      for (const [id, why] of Object.entries(ov.retired ?? {}))
        add(`retires ${id}`, why);
      for (const [id, why] of Object.entries(ov.retiredZones ?? {}))
        add(`retires the ${id} zone`, why);
      for (const [id, c] of Object.entries(ov.changed ?? {}))
        add(`changes ${c.label ?? id}`, c.why);
      for (const [id, z] of Object.entries(ov.zones ?? {}))
        add(`resizes the ${id} zone`, z.why);
      for (const z of ov.newZones ?? []) add(`adds the ${z.label} zone`, z.why);
      for (const n of ov.newNodes ?? []) add(`adds ${n.label}`, n.why);
      for (const e of ov.newEdges ?? [])
        add(`adds the line ${e.from} to ${e.to}`, e.why);
      for (const [key, e] of Object.entries(ov.changedEdges ?? {}))
        add(`changes the line ${key.replace(" ", " to ")}`, e.why);
      for (const [key, why] of Object.entries(ov.retiredEdges ?? {}))
        add(`retires the line ${key.replace(" ", " to ")}`, why);
    }
  return out;
}

/**
 * What each state accounts for, and what it does not. Printed by the build so the gaps in a
 * planned architecture are a line in the terminal rather than something a reader has to
 * find by clicking every tab.
 */
export function stateCoverage(
  views: View[],
  states: Pick<States, "list" | "overlays">,
) {
  const diagrams = views.filter((v) => v.type !== "doc");
  const reached = new Set<string>();
  return states.list.map((st) => {
    for (const id of Object.keys(states.overlays[st.id] ?? {})) reached.add(id);
    /* Cumulative: what this state shows, not only what its own step wrote. */
    const modelled = [...reached];
    const declared = (st.unchanged ?? []).filter(
      (id) => !modelled.includes(id) && diagrams.some((v) => v.id === id),
    );
    const missing = diagrams
      .filter((v) => !modelled.includes(v.id) && !declared.includes(v.id))
      .map((v) => v.name);
    return { st, modelled, declared, missing, total: diagrams.length };
  });
}

/**
 * A citation that resolves to nothing is worse than none: it looks like an argument and is
 * not one. And a change with no citation at all is not forbidden — some of these states were
 * compiled from discussion that predates any ADR — but it is counted, so the number can be
 * driven down and cannot quietly grow.
 */
export function checkCitations(states: States) {
  const problems: string[] = [];
  /*
   * The framework asks for a status and an owner and does not fix the words, so these are
   * ours and they are checked — a register whose vocabulary drifts stops being a register.
   * @see https://www.gov.uk/government/publications/architectural-decision-record-framework
   */
  for (const [id, d] of Object.entries(states.decisions)) {
    const where = `states/decisions.json: ${id}`;
    if (d.status && !(STATUSES as readonly string[]).includes(d.status))
      problems.push(
        `${where} has status "${d.status}" — one of ${STATUSES.join(", ")}`,
      );
    if (d.level && !(LEVELS as readonly string[]).includes(d.level))
      problems.push(
        `${where} has level "${d.level}" — one of ${LEVELS.join("; ")}`,
      );
    if (d.supersededBy && !(d.supersededBy in states.decisions))
      problems.push(
        `${where} is superseded by "${d.supersededBy}", which the register does not hold`,
      );
    for (const l of d.links ?? [])
      if (!/^https?:\/\//.test(l.url))
        problems.push(`${where} links to "${l.url}", which is not a URL`);
  }
  let uncited = 0;
  /* A change resting on a question nobody has answered is the single most useful thing this
     register can tell a reviewer, so it is counted separately from one resting on nothing. */
  let unsettled = 0;
  for (const c of planned(states)) {
    if (!c.why.length) {
      uncited++;
      continue;
    }
    let settled = false;
    for (const id of c.why) {
      const d = states.decisions[id];
      if (!d)
        problems.push(
          `states/${c.st.id}/${c.view}.json: ${c.what} cites "${id}", which is not in states/decisions.json`,
        );
      else if (d.status && d.status !== "open") settled = true;
    }
    if (!settled) unsettled++;
  }
  return { problems, uncited, unsettled };
}

/**
 * A state may declare a view unchanged or change it, not both. The declaration is a claim
 * that nothing moves there; an overlay is proof that something does. Left standing, the
 * page would badge the tab "unchanged" over a view it draws differently.
 */
export function checkDeclarations(
  states: Pick<States, "list" | "overlays">,
): string[] {
  const problems: string[] = [];
  for (const st of states.list)
    for (const viewId of st.unchanged ?? [])
      if ((states.overlays[st.id] ?? {})[viewId])
        problems.push(
          `states/${st.id}/state.json declares "${viewId}" unchanged, but states/${st.id}/${viewId}.json changes it — drop one`,
        );
  return problems;
}

/** What each state declares it leaves alone, keyed by state, as the page carries it. */
export const unchangedByState = (list: StateManifest[]) =>
  Object.fromEntries(list.map((st) => [st.id, st.unchanged ?? []]));

/**
 * Every state up to and including `at`, each with whatever its own overlay says about this
 * view. No sort: `loadStates` and the editor's `withEdits` both hand the list over sorted.
 */
export const chainTo = (
  states: Pick<States, "list" | "overlays">,
  at: StateManifest,
  viewId: string,
): Step[] =>
  states.list
    .filter((s) => s.order <= at.order)
    .map((s) => ({ st: s, ov: states.overlays[s.id]?.[viewId] }));

/**
 * Every planned view the page can show. A state composes not only the views its own overlay
 * touches but every view any earlier state touched, because those changes are still in
 * force — a state that shows Delivery as "not modelled" when S1 rebuilt it is lying by
 * omission. `byState` is what the renderer switches between; `labelled` is the same views
 * with ids that name the state and mode, so a geometry failure in a future layout reads as
 * `containers@s3·future/router` rather than as a problem with the as-is — and `foldComposed`
 * then says each such failure once.
 */
export function composeAll(
  views: View[],
  states: Pick<States, "list" | "overlays">,
) {
  const byState: Record<string, Record<string, Record<string, View>>> = {};
  const labelled: View[] = [];
  const problems: string[] = [];
  const reached = new Set<string>();
  for (const st of states.list) {
    for (const viewId of Object.keys(states.overlays[st.id] ?? {})) {
      if (!views.some((v) => v.id === viewId))
        throw new Error(
          `states/${st.id}/${viewId}.json: no view "${viewId}" to overlay`,
        );
      reached.add(viewId);
    }
    const perView: Record<string, Record<string, View>> = {};
    byState[st.id] = perView;
    for (const viewId of reached) {
      const base = views.find((v) => v.id === viewId);
      if (!base) continue;
      const chain = chainTo(states, st, viewId);
      problems.push(...chainProblems(base, chain));
      const modes: Record<string, View> = {};
      for (const mode of ["future", "changes"] as Mode[]) {
        const v = composeChain(base, chain, st, mode);
        modes[mode] = v;
        labelled.push({ ...v, id: `${viewId}@${st.id}·${mode}` });
      }
      perView[viewId] = modes;
    }
  }
  return { byState, labelled, problems: [...new Set(problems)] };
}

/**
 * One line per fault, not one per place the fault shows.
 *
 * A composed view is checked in both modes and at every later state, so a box left
 * straddling its zone in S1 came back ten times — two modes, three states, and the two
 * overlaps it also caused. The author fixes it once, in one file. The report says it once,
 * names the state where it first appears, and lists the later states it is still in force
 * at, so nobody goes looking for a fault in S3 that S3 only inherited. The mode survives
 * only when a fault is in one mode alone: the retired strip exists only under Changes, so
 * that can genuinely happen.
 */
export function foldComposed(problems: string[]): string[] {
  interface Fault {
    view: string;
    id: string;
    rest: string;
    at: Map<string, Set<Mode>>;
  }
  const faults = new Map<string, Fault>();
  const out: (string | Fault)[] = [];
  for (const p of problems) {
    const m = /^([\w-]+)@([\w-]+)·(future|changes)(\/[^:\s]+)?:(.*)$/s.exec(p);
    if (!m) {
      out.push(p);
      continue;
    }
    const [, view = "", state = "", mode = "", id = "", rest = ""] = m;
    const key = `${view}${id}:${rest}`;
    let f = faults.get(key);
    if (!f) {
      f = { view, id, rest, at: new Map() };
      faults.set(key, f);
      out.push(f);
    }
    let modes = f.at.get(state);
    if (!modes) f.at.set(state, (modes = new Set()));
    modes.add(mode as Mode);
  }
  return out.map((o) => {
    if (typeof o === "string") return o;
    const [first = "", ...later] = [...o.at.keys()];
    const modes = [...(o.at.get(first) ?? [])];
    const mode = modes.length === 1 ? `·${modes[0] ?? ""}` : "";
    const also = later.length ? ` — also at ${later.join(", ")}` : "";
    return `${o.view}@${first}${mode}${o.id}:${o.rest}${also}`;
  });
}
