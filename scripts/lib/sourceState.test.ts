import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Derivation } from "../derive/index.js";
import { builtFrom, type Project, type Source } from "./projects";
import {
  type Commit,
  derivationHash,
  hashFile,
  markRead,
  readState,
  readStates,
  type SourceState,
  staleness,
  writeStates,
} from "./sourceState";

const HEAD: Commit = {
  sha: "a".repeat(40),
  subject: "TICKET-1 feat: a thing",
  committed: "2026-09-02T09:59:18+01:00",
};

const source = (dir: string, id: string): Source => ({
  id,
  repo: `git@github.com:org/${id}.git`,
  ref: "main",
  root: `.sources/${id}`,
  url: `https://github.com/org/${id}/blob/main/`,
  dir: path.join(dir, id),
});

/**
 * A project standing in for a real one, with its facts file in a throwaway directory —
 * the skip decision hashes what was actually written, so there has to be a file.
 */
function project(ids: string[] = ["example"]): Project {
  const dir = mkdtempSync(path.join(tmpdir(), "project-"));
  return {
    id: "example",
    config: {} as Project["config"],
    sources: ids.map((id) => source(dir, id)),
    qualified: ids.length > 1,
    derive: { module: "example", inputs: { configs: "src/*.config.ts" } },
    dir,
    modelDir: path.join(dir, "model"),
    factsPath: path.join(dir, "architecture-facts.json"),
    statePath: path.join(dir, "architecture-source.json"),
    pagePath: path.join(dir, "index.html"),
    href: "example/",
  };
}

const first = (p: Project): Source => {
  const [s] = p.sources;
  if (!s) throw new Error("a test project always has a source");
  return s;
};

/** A derivation that reads one file this repository really has, so the hash is real. */
const derivation: Derivation = {
  files: ["scripts/lib/sourceState.ts"],
  inputs: ["configs"],
  derive: () => Promise.resolve({}),
  summary: () => "",
};

/** The state a successful run at HEAD would have written for one of that project's sources. */
function current(
  p: Project,
  facts = '{"domains":[]}',
  s: Source = first(p),
): SourceState {
  writeFileSync(p.factsPath, facts);
  return {
    repo: s.repo,
    ref: s.ref,
    derived: {
      sha: HEAD.sha,
      subject: HEAD.subject,
      committed: HEAD.committed,
      builtFrom: builtFrom(p),
      derivation: derivationHash(p, derivation),
      facts: hashFile(p.factsPath),
    },
    read: null,
  };
}

describe("staleness", () => {
  it("is null when the commit, the derivation and the output are all unchanged", () => {
    const p = project();
    expect(staleness(p, first(p), derivation, current(p), HEAD)).toBeNull();
  });

  it("re-derives when nothing has been recorded yet", () => {
    const p = project();
    expect(staleness(p, first(p), derivation, null, HEAD)).toMatch(
      /nothing records/,
    );
  });

  it("re-derives when the source commit moved", () => {
    const p = project();
    const c = current(p);
    const state = { ...c, derived: { ...c.derived, sha: "b".repeat(40) } };
    expect(staleness(p, first(p), derivation, state, HEAD)).toMatch(
      /the source moved/,
    );
  });

  it("re-derives when pointed at another repository or ref", () => {
    const p = project();
    const state = { ...current(p), ref: "release" };
    expect(staleness(p, first(p), derivation, state, HEAD)).toMatch(
      /now pointed at/,
    );
  });

  it("re-derives when the inputs it reads changed", () => {
    const p = project();
    const c = current(p);
    const state = {
      ...c,
      derived: { ...c.derived, builtFrom: "src/other.config.ts" },
    };
    expect(staleness(p, first(p), derivation, state, HEAD)).toMatch(/inputs/);
  });

  /* Without this, editing a deriving script and rebuilding would keep the old facts:
     the commit has not moved, so every other check passes. */
  it("re-derives when the code that derives the facts changed", () => {
    const p = project();
    const c = current(p);
    const state = {
      ...c,
      derived: { ...c.derived, derivation: "0000000000000000" },
    };
    expect(staleness(p, first(p), derivation, state, HEAD)).toMatch(
      /code that derives/,
    );
  });

  it("re-derives when the facts file is gone", () => {
    const p = project();
    const state = current(p);
    p.factsPath = `${p.factsPath}.missing`;
    expect(staleness(p, first(p), derivation, state, HEAD)).toMatch(/missing/);
  });

  /* A cache that trusts a file it did not write is how a hand-edited number survives a
     rebuild and looks derived. */
  it("re-derives when the facts file no longer matches what was derived", () => {
    const p = project();
    const state = current(p);
    writeFileSync(p.factsPath, '{"domains":[{"name":"edited"}]}');
    expect(staleness(p, first(p), derivation, state, HEAD)).toMatch(
      /no longer matches/,
    );
  });

  /* A project may legitimately have no derivation. It still records the commit its model
     was checked against, and must not be held to a facts file it never produces. */
  it("does not ask a project with no derivation for a facts file", () => {
    const p = { ...project(), derive: null };
    const s = first(p);
    const state: SourceState = {
      repo: s.repo,
      ref: s.ref,
      derived: {
        sha: HEAD.sha,
        subject: HEAD.subject,
        committed: HEAD.committed,
        builtFrom: builtFrom(p),
        derivation: derivationHash(p, null),
        facts: "",
      },
      read: null,
    };
    expect(staleness(p, s, null, state, HEAD)).toBeNull();
  });

  it("separates two projects: the same state cannot satisfy both", () => {
    const a = project();
    const b = {
      ...project(),
      sources: [{ ...first(a), repo: "git@github.com:org/other.git" }],
    };
    const state = current(a);
    expect(staleness(a, first(a), derivation, state, HEAD)).toBeNull();
    expect(staleness(b, first(b), derivation, state, HEAD)).toMatch(
      /now pointed at/,
    );
  });
});

describe("the two commits", () => {
  it("reads a state file of the old one-commit shape as no record at all", () => {
    const p = project();
    writeFileSync(
      p.statePath,
      JSON.stringify({ repo: first(p).repo, ref: "main", sha: HEAD.sha }),
    );
    expect(readState(p, first(p))).toBeNull();
  });

  /* Deriving is not reading: a re-derivation must leave `read` exactly where it was. */
  it("markRead advances read and leaves derived alone", async () => {
    const p = project();
    await writeStates(p, { [first(p).id]: current(p) });
    const later: Commit = {
      sha: "c".repeat(40),
      subject: "later",
      committed: "2026-09-04T00:00:00Z",
    };
    const next = await markRead(p, first(p), later);
    expect(next.read).toEqual(later);
    expect(next.derived.sha).toBe(HEAD.sha);
    expect(readState(p, first(p))?.read?.sha).toBe(later.sha);
  });

  it("refuses to mark anything read before anything has been derived", async () => {
    const p = project();
    await expect(markRead(p, first(p), HEAD)).rejects.toThrow(/pnpm facts/);
  });
});

describe("a state per source", () => {
  /* FLEX's committed file must not change shape because another project reads more
     than one repository. */
  it("keeps a single-source file as the one state it always was", async () => {
    const p = project();
    await writeStates(p, { [first(p).id]: current(p) });
    const raw = JSON.parse(readFileSync(p.statePath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(raw.repo).toBe(first(p).repo);
    expect(raw.sources).toBeUndefined();
  });

  it("records each of several sources under its own name", async () => {
    const p = project(["ios", "android"]);
    const [ios, android] = p.sources as [Source, Source];
    await writeStates(p, {
      ios: current(p, undefined, ios),
      android: current(p, undefined, android),
    });
    const raw = JSON.parse(readFileSync(p.statePath, "utf8")) as {
      sources: Record<string, SourceState>;
    };
    expect(Object.keys(raw.sources)).toEqual(["ios", "android"]);
    expect(readStates(p).android?.repo).toBe(android.repo);
  });

  /* Reading one repository says nothing about how far another has been read. */
  it("marks one source read and leaves the others where they were", async () => {
    const p = project(["ios", "android"]);
    const [ios, android] = p.sources as [Source, Source];
    await writeStates(p, {
      ios: current(p, undefined, ios),
      android: current(p, undefined, android),
    });
    await markRead(p, ios, HEAD);
    expect(readState(p, ios)?.read?.sha).toBe(HEAD.sha);
    expect(readState(p, android)?.read).toBeNull();
  });

  it("names the source that has no record, rather than the file", () => {
    const p = project(["ios", "android"]);
    const [, android] = p.sources as [Source, Source];
    expect(staleness(p, android, derivation, null, HEAD)).toMatch(
      /no record of android/,
    );
  });
});

describe("builtFrom", () => {
  it("names the inputs a derivation was pointed at", () => {
    expect(builtFrom(project())).toBe("src/*.config.ts");
  });

  /* A changed count definition must re-derive: it is as much an input as the glob. */
  it("changes when the counts change", () => {
    const p = project();
    const before = builtFrom(p);
    p.derive = {
      module: "cloudformation",
      inputs: { configs: "src/*.config.ts" },
      counts: { fns: { type: "AWS::Lambda::Function" } },
    };
    expect(builtFrom(p)).not.toBe(before);
  });

  it("says plainly that a project with no derivation derives nothing", () => {
    expect(builtFrom({ ...project(), derive: null })).toMatch(
      /nothing derived/,
    );
  });
});
