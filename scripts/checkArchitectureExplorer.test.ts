/**
 * The soft-geometry and placement counters, against hand-built SVG.
 *
 * These read `getBBox` and `getPointAtLength`, so they need a real engine — jsdom returns
 * zeros for all of it and would let every one of these pass while measuring nothing. The
 * fixtures are deliberately tiny: one rule, one thing it must count, one thing it must
 * not. Every counter here was verified once by breaking the FLEX build by hand, which is
 * not a thing anyone will do again.
 */
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { measure, namelessIcons } from "./checkArchitectureExplorer.js";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  // tsx compiles with esbuild's keepNames, which wraps functions in a __name() helper
  // that does not exist inside the page.
  await page.addInitScript(
    "globalThis.__name = globalThis.__name || ((f) => f);",
  );
  await page.goto("about:blank");
}, 60_000);

afterAll(async () => {
  await browser.close();
});

/** A box, with its label, at a known place. */
const node = (
  id: string,
  x: number,
  y: number,
  w = 200,
  h = 60,
  label = "",
) => `
  <g class="node" aria-label="${id}">
    <rect class="box" x="${String(x)}" y="${String(y)}" width="${String(w)}" height="${String(h)}"></rect>
    ${label ? `<text class="t" x="${String(x + 16)}" y="${String(y + 24)}">${label}</text>` : ""}
  </g>`;

/** A straight line between two points, named for the boxes it joins. */
const edge = (
  label: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) => `
  <g class="edge" aria-label="${label}">
    <path class="line" d="M${String(x1)} ${String(y1)} L${String(x2)} ${String(y2)}"></path>
  </g>`;

const zone = (id: string, x: number, y: number, w: number, h: number) => `
  <g class="zone" aria-label="${id}"><rect x="${String(x)}" y="${String(y)}" width="${String(w)}" height="${String(h)}"></rect></g>`;

async function measured(body: string) {
  await page.setContent(`
    <div id="doc" hidden></div>
    <svg id="svg" width="900" height="700" viewBox="0 0 900 700"><g id="root">${body}</g></svg>`);
  return page.evaluate(measure);
}

describe("measure — placement rules 1, 3 and 5", () => {
  it("counts nothing on a view that follows them", async () => {
    // Two boxes in one column, the line straight down between them.
    const r = await measured(
      node("A", 100, 40) +
        node("B", 100, 300) +
        edge("A to B", 200, 100, 200, 300),
    );
    expect(r).toMatchObject({
      upward: [],
      diagonal: [],
      tail: [],
      cross: [],
      over: [],
    });
    expect(r.nodes).toBe(2);
  });

  it("counts an edge that has to run upward (rule 1)", async () => {
    const r = await measured(
      node("A", 100, 300) +
        node("B", 100, 40) +
        edge("A to B", 200, 300, 200, 100),
    );
    expect(r.upward).toEqual(["A to B"]);
    expect(r.diagonal).toEqual([]);
  });

  it("counts an edge whose boxes share neither a row nor a column (rule 3)", async () => {
    // 300px right and 240px down: clear of each other in both axes.
    const r = await measured(
      node("A", 40, 40) +
        node("B", 440, 340) +
        edge("A to B", 240, 100, 540, 340),
    );
    expect(r.diagonal).toEqual(["A to B"]);
  });

  it("forgives an edge that misses alignment by less than the tolerance", async () => {
    // 20px of vertical clearance — not quite aligned, but not across the canvas either.
    const r = await measured(
      node("A", 40, 40) +
        node("B", 440, 120) +
        edge("A to B", 240, 100, 540, 120),
    );
    expect(r.diagonal).toEqual([]);
  });

  it("counts a zone that runs on past its last box (rule 5)", async () => {
    const tail = await measured(
      zone("Z", 20, 20, 400, 300) + node("A", 40, 40),
    );
    expect(tail.tail).toHaveLength(1);
    expect(tail.tail[0]).toContain("Z");
    const snug = await measured(
      zone("Z", 20, 20, 400, 120) + node("A", 40, 40),
    );
    expect(snug.tail).toEqual([]);
  });
});

describe("measure — soft geometry", () => {
  it("counts a line clipping a box it does not connect", async () => {
    const r = await measured(
      node("A", 40, 40) +
        node("B", 40, 400) +
        node("Middle", 40, 200) +
        edge("A to B", 140, 100, 140, 400),
    );
    expect(r.cross).toEqual(["A to B"]);
  });

  it("does not count a line clipping a box it does connect", async () => {
    const r = await measured(
      node("A", 40, 40) +
        node("B", 40, 200) +
        edge("A to B", 140, 100, 140, 260),
    );
    expect(r.cross).toEqual([]);
  });

  it("counts label text that runs past its box, with the 10px margin", async () => {
    // The text starts 16px in and is far wider than the 200px box.
    const r = await measured(
      node("A", 40, 40, 200, 60, "a label far too long for this box"),
    );
    expect(r.over).toHaveLength(1);
    const ok = await measured(node("A", 40, 40, 200, 60, "short"));
    expect(ok.over).toEqual([]);
  });
});

describe("namelessIcons", () => {
  it("names a button that shows only an icon and carries no accessible name", async () => {
    await page.setContent(`
      <button id="named" aria-label="Fit to view"><svg></svg></button>
      <button id="titled" title="Download"><svg></svg></button>
      <button id="worded">Fit</button>
      <button id="bare"><svg></svg></button>`);
    const found = await page.evaluate(namelessIcons);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("#bare");
  });
});
