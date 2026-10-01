/**
 * The overview page on a two-view fixture: diagrams drawn in tab order with their words,
 * reference tabs listed, states pointed at the review page.
 */
import { describe, expect, it } from "vitest";

import type { View } from "../buildArchitectureExplorer.js";
import { overviewPage, overviewPicture } from "./overviewText.js";
import type { Project } from "./projects.js";

const project = {
  id: "flex",
  config: { name: "FLEX", tagline: "Fast", blurb: "The API layer." },
} as unknown as Project;
const views = [
  {
    id: "res",
    name: "Resources",
    order: 9,
    blurb: "Everything deployed.",
    note: "",
    type: "doc",
    groups: [],
  },
  {
    id: "ctx",
    name: "Context",
    order: 1,
    blurb: "Who talks to it.",
    note: "One <b>region</b> & <script>x</script>.",
    audience: "everyone",
    nodes: [],
    w: 1,
    h: 1,
  },
] as unknown as View[];
const S1 = {
  id: "s1",
  name: "S1",
  label: "S1 · First",
  order: 1,
  blurb: "A step.",
};

describe("overviewPage", () => {
  const html = overviewPage(
    project,
    views,
    { list: [S1] },
    "https://x/flex/",
    (f) => `[${f}]`,
    "FLEX — planned states",
  );

  it("draws diagrams in order with audience, blurb, picture, note and a link", () => {
    expect(html).toContain("<h2>Context</h2>");
    expect(html).toContain("<em>For everyone.</em>");
    expect(html).toContain("[overview-ctx.png]");
    /* A note keeps the inline tags the explorer allows and nothing else. */
    expect(html).toContain(
      "<p>One <b>region</b> &amp; &lt;script&gt;x&lt;/script&gt;.</p>",
    );
    expect(html).toContain('href="https://x/flex/#tab=ctx"');
    expect(overviewPicture(views[1] as View)).toBe("overview-ctx.png");
  });

  it("lists reference tabs instead of drawing them", () => {
    expect(html).not.toContain("[overview-res.png]");
    expect(html).toContain("<h2>Reference</h2>");
    expect(html).toContain("Resources</a> — Everything deployed.");
  });

  it("points at the review page for the states", () => {
    expect(html).toContain("<h2>Planned states</h2>");
    expect(html).toContain("<strong>S1 · First</strong> — A step.");
    expect(html).toContain("<em>FLEX — planned states</em>");
  });

  it("says nothing about states when there are none", () => {
    const none = overviewPage(
      project,
      views,
      { list: [] },
      "https://x/flex/",
      (f) => f,
      "r",
    );
    expect(none).not.toContain("Planned states");
  });
});
