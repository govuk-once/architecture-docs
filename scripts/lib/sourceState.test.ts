import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Derivation } from "../derive/index.js";
import { builtFrom, type Project } from "./projects";
import {
  type Commit,
  derivationHash,
  hashFile,
  markRead,
  readState,
  type SourceState,
  staleness,
  writeState,
} from "./sourceState";

const HEAD: Commit = {
  sha: "a".repeat(40),
  subject: "TICKET-1 feat: a thing",
  committed: "2026-09-02T09:59:18+01:00",
};

/**
 * A project standing in for a real one, with its facts file in a throwaway directory —
 * the skip decision hashes what was actually written, so there has to be a file.
 */
function project(): Project {
  const dir = mkdtempSync(path.join(tmpdir(), "project-"));
  return {
    id: "example",
    config: {} as Project["config"],
    source: {
      repo: "git@github.com:org/example.git",
      ref: "main",
      root: ".sources/example",
    },
    derive: { module: "example", inputs: { configs: "src/*.config.ts" } },
    dir,
    modelDir: path.join(dir, "model"),
    factsPath: path.join(dir, "architecture-facts.json"),
    statePath: path.join(dir, "architecture-source.json"),
    sourceRoot: path.join(dir, "source"),
    pagePath: path.join(dir, "index.html"),
    href: "example/",
  };
}

/** A derivation that reads one file this repository really has, so the hash is real. */
const derivation: Derivation = {
  files: ["scripts/lib/sourceState.ts"],
  inputs: ["configs"],
  derive: () => Promise.resolve({}),
  summary: () => "",
};

/** The state a successful run at HEAD would have written for that project. */
function current(p: Project, facts = '{"domains":[]}'): SourceState {
  writeFileSync(p.factsPath, facts);
  return {
    repo: p.source.repo,
    ref: p.source.ref,
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
    expect(staleness(p, derivation, current(p), HEAD)).toBeNull();
  });

  it("re-derives when nothing has been recorded yet", () => {
    const p = project();
    expect(staleness(p, derivation, null, HEAD)).toMatch(/nothing records/);
  });

  it("re-derives when the source commit moved", () => {
    const p = project();
    const c = current(p);
    const state = { ...c, derived: { ...c.derived, sha: "b".repeat(40) } };
    expect(staleness(p, derivation, state, HEAD)).toMatch(/the source moved/);
  });

  it("re-derives when pointed at another repository or ref", () => {
    const p = project();
    const state = { ...current(p), ref: "release" };
    expect(staleness(p, derivation, state, HEAD)).toMatch(/now pointed at/);
  });

  it("re-derives when the inputs it reads changed", () => {
    const p = project();
    const c = current(p);
    const state = {
      ...c,
      derived: { ...c.derived, builtFrom: "src/other.config.ts" },
    };
    expect(staleness(p, derivation, state, HEAD)).toMatch(/inputs/);
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
    expect(staleness(p, derivation, state, HEAD)).toMatch(/code that derives/);
  });

  it("re-derives when the facts file is gone", () => {
    const p = project();
    const state = current(p);
    p.factsPath = `${p.factsPath}.missing`;
    expect(staleness(p, derivation, state, HEAD)).toMatch(/missing/);
  });

  /* A cache that trusts a file it did not write is how a hand-edited number survives a
     rebuild and looks derived. */
  it("re-derives when the facts file no longer matches what was derived", () => {
    const p = project();
    const state = current(p);
    writeFileSync(p.factsPath, '{"domains":[{"name":"edited"}]}');
    expect(staleness(p, derivation, state, HEAD)).toMatch(/no longer matches/);
  });

  /* A project may legitimately have no derivation. It still records the commit its model
     was checked against, and must not be held to a facts file it never produces. */
  it("does not ask a project with no derivation for a facts file", () => {
    const p = { ...project(), derive: null };
    const state: SourceState = {
      repo: p.source.repo,
      ref: p.source.ref,
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
    expect(staleness(p, null, state, HEAD)).toBeNull();
  });

  it("separates two projects: the same state cannot satisfy both", () => {
    const a = project();
    const b = {
      ...project(),
      source: { ...a.source, repo: "git@github.com:org/other.git" },
    };
    const state = current(a);
    expect(staleness(a, derivation, state, HEAD)).toBeNull();
    expect(staleness(b, derivation, state, HEAD)).toMatch(/now pointed at/);
  });
});

describe("the two commits", () => {
  it("reads a state file of the old one-commit shape as no record at all", () => {
    const p = project();
    writeFileSync(
      p.statePath,
      JSON.stringify({ repo: p.source.repo, ref: "main", sha: HEAD.sha }),
    );
    expect(readState(p)).toBeNull();
  });

  /* Deriving is not reading: a re-derivation must leave `read` exactly where it was. */
  it("markRead advances read and leaves derived alone", async () => {
    const p = project();
    await writeState(p, current(p));
    const later: Commit = {
      sha: "c".repeat(40),
      subject: "later",
      committed: "2026-09-04T00:00:00Z",
    };
    const next = await markRead(p, later);
    expect(next.read).toEqual(later);
    expect(next.derived.sha).toBe(HEAD.sha);
    expect(readState(p)?.read?.sha).toBe(later.sha);
  });

  it("refuses to mark anything read before anything has been derived", async () => {
    const p = project();
    await expect(markRead(p, HEAD)).rejects.toThrow(/pnpm facts/);
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
