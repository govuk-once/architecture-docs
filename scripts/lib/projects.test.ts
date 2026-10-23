/**
 * The starting point for a new architecture has to still be one.
 *
 * `projects/_template` is listed in no site config, so no build, check or CI step ever
 * touches it — the claim it carries ("a second architecture is config, not TypeScript")
 * would be found broken by the first person to rely on it, months after whatever broke it.
 *
 * Below it, the contract a config is held to when it reads one repository or several, and
 * the two functions that decide which checkout a citation is checked against.
 */
import { describe, expect, it } from "vitest";

import { checkGeometry } from "../buildArchitectureExplorer.js";
import { loadLikeC4Views } from "./loadLikeC4Views.js";
import {
  citationFor,
  locate,
  resolveSources,
  toProject,
  validateConfig,
} from "./projects.js";

describe("projects/_template", () => {
  const project = toProject("_template");

  it("reads as a valid project, config and all", () => {
    expect(project.id).toBe("_template");
    expect(project.config.kinds.length).toBeGreaterThan(0);
    expect(project.config.stages.length).toBeGreaterThan(0);
  });

  it("has a model LikeC4 can parse", async () => {
    const views = await loadLikeC4Views(project);
    expect(views.length).toBeGreaterThan(0);
    for (const v of views) {
      expect(v.name, `${v.id} needs a name`).toBeTruthy();
      expect(v.audience, `${v.id} needs an audience`).toBeTruthy();
    }
  });

  it("breaks none of the rules it is an example of", async () => {
    const views = await loadLikeC4Views(project);
    const kinds = new Set(project.config.kinds.map((k) => k.id));
    expect(checkGeometry(views as never, kinds)).toEqual([]);
  });
});

const BASE = {
  name: "N",
  title: "T",
  tagline: "t",
  blurb: "b",
  inventoryView: "resources",
  inventoryLabel: "AWS resources",
  iconLabel: "AWS icons",
  filterHint: "Filter",
  kinds: [{ id: "person", label: "Person", colour: "purple" }],
  stages: [{ id: "dev", label: "Dev", facts: "development" }],
};

const repo = (name: string) => ({
  repo: `git@github.com:org/${name}.git`,
  ref: "main",
  root: `.sources/app/${name}`,
  url: `https://github.com/org/${name}/blob/main/`,
});

const ONE = {
  ...BASE,
  repo: "https://github.com/org/one/blob/main/",
  source: {
    repo: "git@github.com:org/one.git",
    ref: "main",
    root: ".sources/one",
  },
};
const SEVERAL = {
  ...BASE,
  sources: { ios: repo("ios"), android: repo("android") },
};

function refuses(cfg: unknown, why: RegExp): void {
  expect(() => validateConfig("p", cfg)).toThrow(why);
}

describe("validateConfig: one source, or several", () => {
  it("accepts one source with a repo, and several with a url each", () => {
    expect(validateConfig("p", ONE).source?.root).toBe(".sources/one");
    expect(Object.keys(validateConfig("p", SEVERAL).sources ?? {})).toEqual([
      "ios",
      "android",
    ]);
  });

  it("refuses both, and neither", () => {
    refuses({ ...SEVERAL, source: ONE.source }, /both "source" and "sources"/);
    refuses(BASE, /"source" needs/);
  });

  it("refuses a source among several with no url to link its citations to", () => {
    const { url: _url, ...noUrl } = repo("ios");
    refuses({ ...SEVERAL, sources: { ios: noUrl } }, /sources\.ios needs url/);
  });

  it("refuses a url a path cannot be appended to", () => {
    refuses(
      { ...SEVERAL, sources: { ios: { ...repo("ios"), url: "https://x" } } },
      /must end in "\/"/,
    );
  });

  /* With several repositories a single base URL is a lie about all but one of them. */
  it("refuses a project-wide repo beside several sources", () => {
    refuses({ ...SEVERAL, repo: ONE.repo }, /"repo" is for a single source/);
  });

  it("refuses a source name a citation could not carry", () => {
    refuses({ ...SEVERAL, sources: { iOS: repo("ios") } }, /kebab-case/);
  });

  it("refuses two sources checked out to the same place", () => {
    refuses(
      {
        ...SEVERAL,
        sources: {
          ios: repo("ios"),
          mac: { ...repo("mac"), root: repo("ios").root },
        },
      },
      /share a root/,
    );
  });

  it("refuses a stage parameter CloudFormation could not pass", () => {
    refuses(
      {
        ...ONE,
        stages: [{ ...BASE.stages[0], parameters: { Environment: 1 } }],
      },
      /must be a string/,
    );
  });
});

/** The two parts of a project the resolvers read. */
function parts(cfg: unknown) {
  const config = validateConfig("p", cfg);
  return {
    sources: resolveSources("p", config),
    qualified: config.sources !== undefined,
  };
}

describe("locate", () => {
  const one = parts(ONE);
  const several = parts(SEVERAL);

  /* A colon is a legal character in a path; with one source nothing is parsed. */
  it("reads every path in a single-source project as that source's", () => {
    expect(locate(one, "src/a.ts")?.path).toBe("src/a.ts");
    expect(locate(one, "ios:src/a.ts")?.path).toBe("ios:src/a.ts");
  });

  it("finds the source a path names, when there are several", () => {
    const at = locate(several, "android:app/build.gradle.kts");
    expect(at?.source.id).toBe("android");
    expect(at?.path).toBe("app/build.gradle.kts");
  });

  /* There is no default source: a default is how a claim gets checked against the
     wrong repository and found true. */
  it("refuses a path that names no source, or one the project does not read", () => {
    expect(locate(several, "app/build.gradle.kts")).toBeNull();
    expect(locate(several, "web:index.ts")).toBeNull();
    expect(locate(several, "ios:")).toBeNull();
  });
});

describe("citationFor", () => {
  const one = parts(ONE);
  const several = parts(SEVERAL);

  it("turns a link into the path it cites, named by source when there are several", () => {
    expect(
      citationFor(one, "https://github.com/org/one/blob/main/src/a.ts"),
    ).toBe("src/a.ts");
    expect(
      citationFor(
        several,
        "https://github.com/org/ios/blob/main/Production/A.swift",
      ),
    ).toBe("ios:Production/A.swift");
  });

  /* The old reader stripped any GitHub blob prefix, so a link into another repository
     was checked against this one's checkout — and passed wherever the path happened to
     exist there too. */
  it("leaves a link into a repository the project does not read absolute", () => {
    const url = "https://github.com/org/other/blob/main/src/a.ts";
    expect(citationFor(one, url)).toBe(url);
    expect(citationFor(several, url)).toBe(url);
  });

  it("prefers the longest URL, so one source cannot claim another's files", () => {
    const nested = parts({
      ...BASE,
      sources: {
        mono: repo("mono"),
        docs: {
          ...repo("docs"),
          url: "https://github.com/org/mono/blob/main/docs/",
        },
      },
    });
    expect(
      citationFor(nested, "https://github.com/org/mono/blob/main/docs/a.md"),
    ).toBe("docs:a.md");
  });
});
