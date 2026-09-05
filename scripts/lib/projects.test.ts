/**
 * The starting point for a new architecture has to still be one.
 *
 * `projects/_template` is listed in no site config, so no build, check or CI step ever
 * touches it — the claim it carries ("a second architecture is config, not TypeScript")
 * would be found broken by the first person to rely on it, months after whatever broke it.
 */
import { describe, expect, it } from "vitest";

import { checkGeometry } from "../buildArchitectureExplorer.js";
import { loadLikeC4Views } from "./loadLikeC4Views.js";
import { toProject } from "./projects.js";

describe("projects/_template", () => {
  const project = toProject("_template");

  it("reads as a valid project, config and all", () => {
    expect(project.id).toBe("_template");
    expect(project.config.kinds.length).toBeGreaterThan(0);
    expect(project.config.stages.length).toBeGreaterThan(0);
  });

  it("has a model LikeC4 can parse", async () => {
    const views = await loadLikeC4Views(project.modelDir);
    expect(views.length).toBeGreaterThan(0);
    for (const v of views) {
      expect(v.name, `${v.id} needs a name`).toBeTruthy();
      expect(v.audience, `${v.id} needs an audience`).toBeTruthy();
    }
  });

  it("breaks none of the rules it is an example of", async () => {
    const views = await loadLikeC4Views(project.modelDir);
    const kinds = new Set(project.config.kinds.map((k) => k.id));
    expect(checkGeometry(views as never, kinds)).toEqual([]);
  });
});
