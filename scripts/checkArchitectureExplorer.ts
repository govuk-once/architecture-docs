/**
 * Renders the built pages in a real browser and checks what static validation cannot
 * see: whether text fits, whether edges cross boxes they have nothing to do with,
 * whether labels sit on top of each other, and whether every clickable thing actually
 * opens something. Every project's explorer, and the index over them.
 *
 *   pnpm check          every project, and the index
 *   pnpm check flex     one of them, and the index
 *
 * Playwright is a devDependency of this repository, but its browser binaries are not in
 * the lockfile. If the import or the binary is missing the script says so and exits 0
 * rather than failing a build over a dev tool that has not been installed yet:
 *
 *   pnpm exec playwright install chromium
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { ConsoleMessage, Page } from "playwright";

import { DOCS_ROOT, SITE_INDEX } from "./lib/paths.js";
import { type Project, selectProjects } from "./lib/projects.js";

/**
 * Two classes of problem.
 *
 * HARD — always a defect, never acceptable: text that does not fit its box, a
 * clickable thing that opens an empty panel, a tab that has lost its audience line,
 * any console or page error.
 *
 * SOFT — a line clipping a box it is unrelated to, a label sitting on a box, two
 * labels touching. On dense views a handful are unavoidable without hand-routing
 * every edge. This is a ratchet, not a target: it may fall, never rise. If a change
 * genuinely needs a higher budget, raise it deliberately and say why in the commit.
 *
 * The ratchet is per project — `softBudget` in its config, and zero when it says nothing.
 * A single number across the whole site would rise the moment a project was added, and
 * would let one project's improvement hide another's regression, which is the one thing a
 * ratchet exists to stop.
 */
const softBudget = (project: Project) => project.config.softBudget ?? 0;
const placementBudget = (project: Project) =>
  project.config.placementBudget ?? 0;

/** Type-only, so it is erased at runtime and the import below stays optional. */
type ChromiumLauncher = typeof import("playwright").chromium;

async function loadChromium(): Promise<ChromiumLauncher | null> {
  try {
    return (await import("playwright")).chromium;
  } catch {
    return null;
  }
}

async function main() {
  const projects = selectProjects(process.argv.slice(2));
  const missing = projects
    .filter((p) => !existsSync(p.pagePath))
    .map((p) => path.relative(DOCS_ROOT, p.pagePath));
  if (!existsSync(SITE_INDEX))
    missing.push(path.relative(DOCS_ROOT, SITE_INDEX));
  if (missing.length) {
    console.error(`No ${missing.join(", ")} — run pnpm build first.`);
    process.exit(1);
  }
  const chromium = await loadChromium();
  if (!chromium) {
    console.log("Render checks skipped: playwright is not installed.");
    console.log(
      "  pnpm add -Dw playwright && pnpm exec playwright install chromium",
    );
    console.log("Static validation still ran as part of pnpm build.");
    return;
  }

  const browser = await chromium.launch();
  /** One row per page checked, so the verdict is given per project and then overall. */
  const scores = new Map<
    string,
    {
      hard: number;
      soft: number;
      budget: number;
      place: number;
      placeBudget: number;
    }
  >();
  const score = (id: string) => {
    const at = scores.get(id) ?? {
      hard: 0,
      soft: 0,
      budget: 0,
      place: 0,
      placeBudget: 0,
    };
    scores.set(id, at);
    return at;
  };

  /**
   * The index is the site's front door and carries no diagram, so it gets the checks that
   * apply to any page — it renders, it has no console errors, and every card that looks
   * like a link is one — rather than the geometry pass.
   */
  async function checkIndex(): Promise<void> {
    const index = score("index");
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    page.on("console", (m: ConsoleMessage) => {
      if (m.type() === "error") errors.push("console: " + m.text());
    });
    await page.goto("file://" + SITE_INDEX);
    const seen = await page.evaluate(() => ({
      cards: document.querySelectorAll(".card").length,
      links: [...document.querySelectorAll("a.card")].map(
        (a) => a.getAttribute("href") ?? "",
      ),
      planned: document.querySelectorAll(".card.planned").length,
      themed: !!document.getElementById("themetoggle")?.textContent.trim(),
    }));
    const dead = seen.links.filter(
      (href) =>
        !existsSync(path.join(path.dirname(SITE_INDEX), href, "index.html")),
    );
    console.log(
      `[index] ${String(seen.cards)} cards · ${String(seen.links.length)} link to a built page · ` +
        `${String(seen.planned)} planned · theme toggle ${seen.themed ? "renders" : "BLANK"}`,
    );
    if (!seen.cards) {
      console.log("  FAIL — the index lists nothing");
      index.hard++;
    }
    if (dead.length) {
      console.log(
        `  FAIL — card links to a page that was not built: ${dead.join(", ")}`,
      );
      index.hard += dead.length;
    }
    if (!seen.themed) index.hard++;
    const unique = [...new Set(errors)];
    if (unique.length) {
      console.log(`[index] ERRORS:\n  ${unique.slice(0, 4).join("\n  ")}`);
      index.hard += unique.length;
    }
    await page.close();
  }

  /**
   * The same page on a phone. Every gate above this one measures the SVG canvas, so none
   * of them can see the HTML around it — which is how a legend entry once grew wider than
   * the panel and pushed the whole inspector sideways with every check still passing.
   *
   * These are the defects that only exist at a narrow width: the page scrolling
   * sideways, a control running past the viewport, a panel wider than its column, and a
   * tab strip that wraps into rows instead of scrolling. All hard — none of them is ever
   * acceptable, and none is a judgement call.
   *
   * It then works the phone chrome, which exists nowhere else: the details sheet and the
   * controls menu are the only parts of this page that are reachable at 390px and
   * unreachable at 1680px, so a check that only measured widths would let either of them
   * stop opening without a word.
   */
  async function checkMobile(
    project: Project,
    shape: { label: string; width: number; height: number },
  ): Promise<void> {
    const tally = score(project.id);
    const page = await browser.newPage({
      viewport: { width: shape.width, height: shape.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    page.on("console", (m: ConsoleMessage) => {
      if (m.type() === "error") errors.push("console: " + m.text());
    });
    await page.goto("file://" + project.pagePath);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);

    const tabs: string[] = await page.locator(".tab").allTextContents();
    const bad: string[] = [];
    for (const tab of tabs) {
      await page.click(`.tab:has-text("${tab}")`);
      await page.waitForTimeout(250);
      /*
       * Where the panel collapses to a rail, changing tabs closes it, and a closed rail
       * clips its contents on purpose — measuring that reports a 145px header inside a
       * 28px box as overflow, which is the feature working. What has to fit is the panel
       * open, since that is the only state a reader sees it in.
       */
      if (
        await page.evaluate(() => {
          const a = document.querySelector("aside");
          return !!a && a.getBoundingClientRect().width < 60;
        })
      )
        await page.click("#sheetgrip").catch(() => undefined);
      await page.waitForTimeout(250);
      for (const problem of await page.evaluate(measureNarrow))
        bad.push(`${tab}: ${problem}`);
    }
    console.log(
      `  ${shape.label.padEnd(13)}${String(tabs.length).padStart(3)} tabs · ` +
        (bad.length
          ? `${String(bad.length)} defect(s)`
          : "no overflow, tabs scroll"),
    );
    for (const line of bad.slice(0, 4)) console.log(`      ${line}`);
    tally.hard += bad.length;

    const nameless =
      shape.width < 500 ? await page.evaluate(namelessIcons) : [];
    if (nameless.length || shape.width < 500)
      console.log(
        `  ${"icon controls".padEnd(13)}    ` +
          (nameless.length
            ? `${String(nameless.length)} with no accessible name`
            : "every icon-only control carries its name"),
      );
    for (const line of nameless) console.log(`      ${line}`);
    tally.hard += nameless.length;

    // The sheet and the menu exist only where the narrow layout does. In landscape the
    // panel is a column and there is no menu to open, so working them there tests nothing.
    // The panel exists in both shapes — a sheet in portrait, a rail in landscape — so it
    // is checked in both. The menu exists only where the header cannot seat the controls.
    const broken = await panelChecks(page);
    console.log(
      `  ${"details panel".padEnd(13)}    ` +
        (broken.length
          ? `${String(broken.length)} defect(s)`
          : "closed on load, opens on tap, handle and escape close it"),
    );
    for (const line of broken) console.log(`      ${line}`);
    tally.hard += broken.length;

    const hasMenu = await page.evaluate(() => {
      const h = document.querySelector(".hbtns");
      return h ? getComputedStyle(h).display !== "none" : false;
    });
    if (hasMenu) {
      const menu = await menuChecks(page);
      console.log(
        `  ${"controls menu".padEnd(13)}    ` +
          (menu.length
            ? `${String(menu.length)} defect(s)`
            : "opens, holds every control, dismisses on a tap away"),
      );
      for (const line of menu) console.log(`      ${line}`);
      tally.hard += menu.length;
    }

    const unique = [...new Set(errors)];
    if (unique.length) {
      console.log(
        `  [mobile] ERRORS:\n    ${unique.slice(0, 3).join("\n    ")}`,
      );
      tally.hard += unique.length;
    }
    await page.close();
  }

  async function checkExplorer(project: Project): Promise<void> {
    const PAGE = project.pagePath;
    const tally = score(project.id);
    tally.budget = softBudget(project);
    tally.placeBudget = placementBudget(project);
    console.log(`\n${project.id}: ${path.relative(DOCS_ROOT, PAGE)}`);
    for (const colorScheme of ["light", "dark"] as const) {
      const page = await browser.newPage({
        viewport: { width: 1680, height: 950 },
        colorScheme,
      });
      // tsx compiles with esbuild's keepNames, which wraps functions in a __name() helper.
      // That helper does not exist inside the page, so serialised callbacks throw without it.
      // Passed as a raw string so it is not itself compiled.
      await page.addInitScript(
        "globalThis.__name = globalThis.__name || ((f) => f);",
      );
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      page.on("console", (m: ConsoleMessage) => {
        if (m.type() === "error") errors.push("console: " + m.text());
      });
      await page.goto("file://" + PAGE);
      /*
       * Every text measurement below depends on IBM Plex, which the page pulls from
       * Google Fonts. A fixed timeout is enough on a warm cache and not enough on a cold
       * one, so CI measured fallback metrics and reported overflow that does not exist.
       * Wait for font loading to settle, then confirm the faces are actually usable.
       */
      await page.evaluate(() => document.fonts.ready);
      const fontsLoaded = await page.evaluate(
        () =>
          document.fonts.check('11px "IBM Plex Mono"') &&
          document.fonts.check('13px "IBM Plex Sans"'),
      );
      if (!fontsLoaded)
        console.log(
          "IBM Plex unavailable — geometry not checked. The build's static text-fit gate still applies.",
        );
      await page.waitForTimeout(800);

      const tabs: string[] = await page.locator(".tab").allTextContents();
      if (colorScheme === "light")
        console.log(`${String(tabs.length)} tabs: ${tabs.join(" · ")}\n`);

      for (const tab of tabs) {
        await page.click(`.tab:has-text("${tab}")`);
        await page.waitForTimeout(400);
        const r = await page.evaluate(measure);
        if (colorScheme !== "light") continue;
        if (r.doc) {
          console.log(
            `  ${tab.padEnd(13)} reference view · ${String(r.groups)} sections · ${String(r.rows)} rows`,
          );
          continue;
        }
        /* Overflow measured against fallback metrics is noise; the build checks text fit
         statically from the real advances, so nothing goes unchecked here. */
        if (fontsLoaded) tally.hard += r.over.length;
        /* Same reasoning as overflow: every geometry number here is measured from rendered
         text, so without the real faces none of it means anything. */
        if (fontsLoaded)
          tally.soft += r.cross.length + r.onBox.length + r.clash.length;
        tally.place += r.upward.length + r.diagonal.length + r.tail.length;
        console.log(
          `  ${tab.padEnd(13)}${String(r.nodes).padStart(3)} boxes ${String(r.edges).padStart(3)} lines` +
            ` · overflow ${String(r.over.length)} · crossings ${String(r.cross.length)}` +
            ` · label-on-box ${String(r.onBox.length)} · label-clash ${String(r.clash.length)}` +
            ` · up ${String(r.upward.length)} · diagonal ${String(r.diagonal.length)}` +
            ` · zone-tail ${String(r.tail.length)}`,
        );
        for (const [label, list] of [
          ["overflow", fontsLoaded ? r.over : []],
          ["crossing", r.cross],
          ["on box", r.onBox],
          ["clash", r.clash],
          ["upward", r.upward],
          ["diagonal", r.diagonal],
          ["zone tail", r.tail],
        ] as const)
          if (list.length)
            console.log(`      ${label}: ${list.slice(0, 3).join(" | ")}`);
      }

      const audit = await page.evaluate(auditTargets);
      console.log(
        `[${colorScheme}] ${String(audit.n)} clickable targets · ` +
          (audit.empty.length
            ? `EMPTY INSPECTOR: ${audit.empty.slice(0, 4).join(", ")}`
            : "all open a populated inspector") +
          (audit.noAudience.length
            ? ` · MISSING AUDIENCE: ${audit.noAudience.join(", ")}`
            : " · audience shown on every tab"),
      );
      tally.hard += audit.empty.length + audit.noAudience.length;

      /* Both schemes, because contrast is the failure axe finds most of and it is a
         property of the palette in use, not of the markup. */
      const a11y: string[] = [];
      /* The first and the last tab: between them a canvas view and a reference view,
         which are the two ways the stage renders. */
      const names: string[] = await page.locator(".tab").allTextContents();
      for (const tab of [names[0], names[names.length - 1]]) {
        if (!tab) continue;
        await page.click(`.tab:has-text("${tab}")`);
        await page.waitForTimeout(300);
        for (const v of await axeViolations(page)) a11y.push(`${tab}: ${v}`);
      }
      const seen = [...new Set(a11y)];
      console.log(
        `[${colorScheme}] ` +
          (seen.length
            ? `WCAG 2.2 AA: ${String(seen.length)} violation type(s)`
            : "WCAG 2.2 AA clean (axe-core)"),
      );
      for (const line of seen.slice(0, 5)) console.log(`  ${line}`);
      tally.hard += seen.length;

      const unique = [...new Set(errors)];
      if (unique.length) {
        console.log(
          `[${colorScheme}] ERRORS:\n  ${unique.slice(0, 4).join("\n  ")}`,
        );
        tally.hard += unique.length;
      } else console.log(`[${colorScheme}] no console or page errors`);
      await page.close();
    }
  }

  for (const project of projects) {
    await checkExplorer(project);
    // Portrait and landscape are two layouts, not one layout at two sizes: the first is
    // narrow with height to spare, the second is short with width to spare, and each was
    // broken at a point the other could not have found.
    for (const shape of PHONES) await checkMobile(project, shape);
  }
  await checkIndex();

  await browser.close();

  console.log("");
  let failed = 0;
  for (const [id, { hard, soft, budget, place, placeBudget }] of scores) {
    const over = soft > budget || place > placeBudget;
    console.log(
      `${id.padEnd(12)} hard ${String(hard)} · soft ${String(soft)} of ${String(budget)}` +
        (placeBudget || place
          ? ` · placement ${String(place)} of ${String(placeBudget)}`
          : ""),
    );
    if (hard)
      console.log(
        `  FAIL — ${String(hard)} hard defect(s). Text must fit, every target must ` +
          `open, every tab keeps its audience, no errors.`,
      );
    else if (soft > budget)
      console.log(
        `  FAIL — soft geometry rose to ${String(soft)}, above the ${String(budget)} ` +
          `ratchet. Fix the layout, or raise softBudget in ` +
          `projects/${id}/project.config.json deliberately and say why.`,
      );
    else if (place > placeBudget)
      console.log(
        `  FAIL — placement rose to ${String(place)}, above the ${String(placeBudget)} ` +
          `ratchet. See projects/CANVAS.md rules 1, 3 and 5, or raise placementBudget in ` +
          `projects/${id}/project.config.json deliberately and say why.`,
      );
    else if (soft < budget)
      console.log(
        `  PASS — and soft geometry improved; lower softBudget to ${String(soft)} to lock it in.`,
      );
    else if (place < placeBudget)
      console.log(
        `  PASS — and placement improved; lower placementBudget to ${String(place)} to lock it in.`,
      );
    if (hard || over) failed++;
  }
  console.log(failed ? `\nFAIL — ${String(failed)} page(s)` : "\nPASS");
  process.exit(failed ? 1 : 0);
}

/** Runs inside the page. Geometry is measured, never eyeballed. */
function measure() {
  if (document.getElementById("doc")?.hidden === false)
    return {
      doc: true,
      rows: document.querySelectorAll(".row").length,
      groups: document.querySelectorAll(".grp").length,
      nodes: 0,
      edges: 0,
      over: [] as string[],
      cross: [] as string[],
      onBox: [] as string[],
      clash: [] as string[],
      upward: [] as string[],
      diagonal: [] as string[],
      tail: [] as string[],
    };
  const nodes = [...document.querySelectorAll("#root .node")];
  const boxes = nodes.map((g) => ({
    id: g.getAttribute("aria-label") ?? "",
    r: (g.querySelector(".box") as SVGGraphicsElement).getBBox(),
  }));
  const over: string[] = [];
  nodes.forEach((g) => {
    const b = (g.querySelector(".box") as SVGGraphicsElement).getBBox();
    g.querySelectorAll(".t,.s").forEach((t) => {
      const bb = (t as SVGGraphicsElement).getBBox();
      /*
       * 10px, not the margin that merely avoids a visible collision. The same text is a
       * few pixels wider on another font stack, and a box that clears its edge by 6px
       * here can overflow on CI's — which is exactly what one did, passing locally and
       * failing the deploy. The margin has to absorb that difference or the check only
       * describes this machine.
       */
      if (bb.x + bb.width > b.x + b.width - 10)
        over.push(`${g.getAttribute("aria-label") ?? ""} · ${t.textContent}`);
    });
  });
  /*
   * Placement rules 1, 3 and 5 from projects/CANVAS.md, which until now were prose an
   * author was trusted to have followed:
   *
   *   1. flow runs top to bottom — a line that has to go up is a placement error
   *   3. an edge's endpoints share a column or a row, never a diagonal across the canvas
   *   5. a zone ends at its last box — a tall empty tail invites a line through it
   *
   * Measured off the drawn path rather than the model, so what is counted is what a
   * reader sees. The 24px tolerance on a diagonal is the difference between "not quite
   * aligned" and "across the canvas"; the rule objects to the second.
   */
  const upward: string[] = [];
  const diagonal: string[] = [];
  const rects = [...document.querySelectorAll("#root .node")].map((g) =>
    (g.querySelector(".box") as SVGGraphicsElement).getBBox(),
  );
  /*
   * Which boxes an edge joins, found from where its path starts and ends: a route leaves
   * one box's perimeter and arrives at another's. The rule is about where the boxes sit,
   * not where the line happens to enter them — a route may leave a side and arrive at a
   * top while the two boxes still share a column, and that is not what rule 3 objects to.
   */
  const nearest = (pt: DOMPoint) => {
    let best: DOMRect | null = null;
    let bestD = Infinity;
    for (const r of rects) {
      const dx = Math.max(r.x - pt.x, 0, pt.x - (r.x + r.width));
      const dy = Math.max(r.y - pt.y, 0, pt.y - (r.y + r.height));
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return bestD <= 900 ? best : null;
  };
  document.querySelectorAll("#root .edge .line").forEach((p) => {
    const el = p as SVGPathElement;
    const len = el.getTotalLength();
    if (!len) return;
    const a = nearest(el.getPointAtLength(0));
    const b = nearest(el.getPointAtLength(len));
    if (!a || !b || a === b) return;
    const label = el.closest(".edge")?.getAttribute("aria-label") ?? "";
    if (b.y + b.height / 2 < a.y + a.height / 2 - 8) upward.push(label);
    const gapX = Math.max(
      0,
      Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width),
    );
    const gapY = Math.max(
      0,
      Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height),
    );
    if (gapX > 24 && gapY > 24) diagonal.push(label);
  });

  const tail: string[] = [];
  document.querySelectorAll("#root .zone").forEach((z) => {
    const zb = (
      z.querySelector("rect") as SVGGraphicsElement | null
    )?.getBBox();
    if (!zb) return;
    let bottom = -Infinity;
    for (const g of document.querySelectorAll("#root .node")) {
      const nb = (g.querySelector(".box") as SVGGraphicsElement).getBBox();
      if (
        nb.x >= zb.x &&
        nb.y >= zb.y &&
        nb.x + nb.width <= zb.x + zb.width &&
        nb.y + nb.height <= zb.y + zb.height
      )
        bottom = Math.max(bottom, nb.y + nb.height);
    }
    if (bottom > -Infinity && zb.y + zb.height - bottom > 60)
      tail.push(
        `${z.getAttribute("aria-label") ?? ""} runs ` +
          `${String(Math.round(zb.y + zb.height - bottom))}px past its last box`,
      );
  });

  const cross = new Set<string>();
  document.querySelectorAll("#root .edge .line").forEach((p) => {
    const el = p as SVGPathElement;
    const label = el.closest(".edge")?.getAttribute("aria-label") ?? "";
    const len = el.getTotalLength();
    for (let i = 1; i < len; i += 6) {
      const pt = el.getPointAtLength(i);
      for (const bx of boxes) {
        if (label.includes(bx.id)) continue;
        if (
          pt.x > bx.r.x + 2 &&
          pt.x < bx.r.x + bx.r.width - 2 &&
          pt.y > bx.r.y + 2 &&
          pt.y < bx.r.y + bx.r.height - 2
        ) {
          cross.add(label);
          i = len;
          break;
        }
      }
    }
  });
  const area = (a: DOMRect, b: DOMRect) =>
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const labels = [...document.querySelectorAll("#root .edgelbl")].map((g) => ({
    t: g.querySelector(".lbl")?.textContent ?? "",
    r: (g.querySelector(".lblbg") as SVGGraphicsElement).getBBox(),
  }));
  const onBox: string[] = [];
  labels.forEach((l) => {
    for (const bx of boxes)
      if (area(l.r, bx.r) > 60) {
        onBox.push(l.t);
        break;
      }
  });
  const clash: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i];
    if (!a) continue;
    for (let j = i + 1; j < labels.length; j++) {
      const b = labels[j];
      if (b && area(a.r, b.r) > 40) clash.push(`${a.t} ✕ ${b.t}`);
    }
  }
  return {
    doc: false,
    rows: 0,
    groups: 0,
    nodes: nodes.length,
    edges: document.querySelectorAll("#root .edge").length,
    over,
    cross: [...cross],
    onBox,
    clash,
    upward,
    diagonal,
    tail,
  };
}

/**
 * Runs inside the page at a phone width. Returns a problem per defect, empty when clean.
 */
/**
 * Works the two controls that only exist on a phone, and says what did not respond.
 *
 * Written as a sequence of real interactions rather than a look at the stylesheet
 * because what matters is whether a reader can get the panel open and shut again — a
 * rule that is present but outranked reads as correct and behaves as broken.
 *
 * Runs on the first tab only. These are page chrome, identical on every view, so
 * repeating it eight times would cost eight times as long to learn the same thing.
 */
/**
 * Every control that shows only an icon has to carry its name somewhere a screen reader
 * can reach. This is the exact thing that breaks silently: swapping a word for a glyph
 * looks finished, and the button is simply unusable without sight of it.
 */
function namelessIcons(): string[] {
  const out: string[] = [];
  for (const b of document.querySelectorAll("button")) {
    if (b.textContent.trim()) continue;
    const name = b.getAttribute("aria-label") ?? b.getAttribute("title") ?? "";
    if (!name.trim())
      out.push(
        `${b.id ? "#" + b.id : b.className} shows only an icon and has no name`,
      );
  }
  return out;
}

/** The two shapes a phone actually presents. Widths chosen at the common device sizes. */
const PHONES = [
  { label: "portrait 390", width: 390, height: 844 },
  { label: "landscape 844", width: 844, height: 390 },
] as const;

const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

interface AxeNode {
  target: string[];
  html: string;
}
interface AxeViolation {
  id: string;
  impact: string;
  help: string;
  nodes: AxeNode[];
}

/**
 * axe-core over the rendered page, on the tags that correspond to WCAG 2.2 AA.
 *
 * It cannot judge whether a label reads well, only that one exists, so it replaces no
 * part of reading the page — but it does catch the mechanical failures reliably, and
 * every one it found here was real: text at 4.09:1 against its own background, a diagram
 * marked `role="img"` while holding forty focusable controls, and a page with no `main`.
 *
 * Run on the first canvas view and on a reference view, which between them cover both
 * ways the stage renders, in whichever colour scheme the caller is testing.
 */
async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => {
    const axe = (
      globalThis as unknown as {
        axe: {
          run: (
            c: unknown,
            o: unknown,
          ) => Promise<{ violations: AxeViolation[] }>;
        };
      }
    ).axe;
    const r = await axe.run(document, {
      resultTypes: ["violations"],
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
    return r.violations;
  });
  return found.map(
    (v) =>
      `${v.id} (${v.impact}, ${String(v.nodes.length)}x) — ${v.help}: ` +
      (v.nodes[0]?.target.join(" ") ?? ""),
  );
}

async function panelChecks(page: Page): Promise<string[]> {
  const bad: string[] = [];
  const open = () =>
    page.evaluate(() => document.body.classList.contains("sheet-open"));
  const asideWidth = () =>
    page.evaluate(() => {
      const a = document.querySelector("aside");
      return a ? Math.round(a.getBoundingClientRect().width) : 0;
    });
  /*
   * Clicking a control that is not there is exactly the defect this function exists to
   * find, so it must not be the thing that stops it looking. Playwright's default is to
   * retry for 30 seconds and then throw a stack trace, which aborts the run and every
   * project after it; a missing control is reported and the rest of the sequence
   * continues on whatever state it left behind.
   */
  const tap = async (sel: string, missing: string): Promise<boolean> => {
    try {
      await page.click(sel, { timeout: 2000 });
      await page.waitForTimeout(300);
      return true;
    } catch {
      bad.push(missing);
      return false;
    }
  };

  await tap(".tab >> nth=0", "the first tab does not respond to a tap");

  // A panel that starts open is a panel covering the diagram nobody asked it about.
  if (await open())
    bad.push("the details panel starts open — it should be closed");
  const shut = await asideWidth();
  if (await tap(".node", "no box on the first view responds to a tap")) {
    if (!(await open()))
      bad.push("tapping a box did not open the details panel");
    const label = await page.textContent("#griplabel").catch(() => null);
    if (!label || label === "Details")
      bad.push("the panel handle does not name what is open");
  }
  /*
   * Where the panel is a column rather than an overlay, closing it has to hand the width
   * back — a panel that collapses to a rail and leaves the gap behind gives the canvas
   * and the reference tables nothing, which is the entire point of collapsing it.
   */
  const overlay = await page.evaluate(() => {
    const a = document.querySelector("aside");
    return a ? getComputedStyle(a).position === "fixed" : true;
  });
  if (!overlay && (await asideWidth()) <= shut)
    bad.push(
      `the panel is ${String(shut)}px closed and ${String(await asideWidth())}px open — ` +
        `closing it returns no width to the canvas`,
    );

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  if (await open()) bad.push("escape did not close the details panel");
  if (await tap("#sheetgrip", "the panel handle is not reachable")) {
    if (!(await open())) bad.push("the panel handle does not open the panel");
    await tap("#sheetgrip", "the panel handle stopped responding");
    if (await open()) bad.push("the panel handle does not close the panel");
  }

  /*
   * The handle says the panel can move; the close button says how to put it away, and it
   * only earns its place if it is visible exactly when there is something to close.
   */
  if (await page.isVisible("#panelclose"))
    bad.push("the close button shows while the panel is already closed");
  await tap("#sheetgrip", "the panel handle stopped responding");
  if (!(await page.isVisible("#panelclose")))
    bad.push("the open panel offers no close button");
  else {
    await tap("#panelclose", "the close button is not reachable");
    if (await open()) bad.push("the close button does not close the panel");
  }
  return bad;
}

/**
 * The controls menu, which exists only where the header cannot seat the control row.
 */
async function menuChecks(page: Page): Promise<string[]> {
  const bad: string[] = [];
  const menuOpen = () =>
    page.evaluate(() =>
      document.querySelector("header")?.classList.contains("menu-open"),
    );
  /*
   * Closed first. Checking only the open state is what let a cross sit on top of the bars
   * in every state get published: both glyphs live in the button, and the rule hiding the
   * wrong one has to outrank `.btn.ico svg`, which is easy to lose by a single element in
   * the selector and impossible to see from the open state alone.
   */
  if (await page.isVisible(".menubtn .i-close"))
    bad.push("the closed menu button already shows a close glyph");
  if (!(await page.isVisible(".menubtn .i-menu")))
    bad.push("the closed menu button does not show the menu glyph");

  try {
    await page.click("#menubtn", { timeout: 2000 });
    await page.waitForTimeout(250);
  } catch {
    bad.push("the menu button is not reachable");
    return bad;
  }
  if (!(await menuOpen())) bad.push("the menu button did not open the menu");
  // Open, the button that opened it is the way to shut it, and has to look like it.
  if (!(await page.isVisible(".menubtn .i-close")))
    bad.push("the open menu button does not show a close glyph");
  if (await page.isVisible(".menubtn .i-menu"))
    bad.push("the open menu button still shows the menu glyph");
  if (
    (await page.getAttribute("#menubtn", "aria-label")) ===
    "Display and export options"
  )
    bad.push("the menu button shows a cross but is still named as the opener");
  // Every control in it has to be hittable, or the menu is decorative.
  for (const id of ["#icontoggle", "#themetoggle", "#savepng"])
    if (!(await page.isVisible(id)))
      bad.push(`${id} is not reachable in the menu`);
  /*
   * A toggle has to say which way it is set, and say it the same way whether or not it
   * was the last thing touched. A touch screen has no pointer to move away, so :hover
   * stays on whatever was tapped — and these hover rules said what the pressed state
   * says, which left the AWS icons button looking switched on immediately after being
   * switched off. Two things are wrong in that picture and both are checked: the look
   * must not depend on having just been tapped, and the two settings must differ.
   */
  const look = () =>
    page.evaluate(() => {
      const e = document.getElementById("icontoggle");
      if (!e) return "";
      const c = getComputedStyle(e);
      return `${c.backgroundColor}|${c.color}|${c.borderColor}`;
    });
  const settle = async () => {
    await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur(),
    );
    await page.mouse.move(6, 500);
    await page.waitForTimeout(200);
  };
  await page.click("#icontoggle", { timeout: 2000 });
  await page.waitForTimeout(200);
  const onTapped = await look();
  await settle();
  const onSettled = await look();
  if (onTapped !== onSettled)
    bad.push("the icons toggle looks different for having just been tapped");
  await page.click("#icontoggle", { timeout: 2000 });
  await page.waitForTimeout(200);
  const offTapped = await look();
  await settle();
  const offSettled = await look();
  if (offTapped !== offSettled)
    bad.push("the icons toggle looks different for having just been tapped");
  if (onSettled === offSettled)
    bad.push("the icons toggle looks identical switched on and off");
  // Both readings said "on" because they shared two of the three; one is not enough.
  if (
    onSettled.split("|").filter((v, i) => v !== offSettled.split("|")[i])
      .length < 2
  )
    bad.push("on and off differ in only one of fill, text and edge");

  // A menu that only closes by its own button is one people leave over the diagram.
  await page.click("#stage", { position: { x: 190, y: 90 }, timeout: 2000 });
  await page.waitForTimeout(250);
  if (await menuOpen()) bad.push("tapping away did not dismiss the menu");
  // Fit is the way back from a pinch gone wrong, so it stays out of the menu.
  if (!(await page.isVisible("#fitm")))
    bad.push("Fit is not in reach on the header row");
  return bad;
}

function measureNarrow(): string[] {
  const out: string[] = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > window.innerWidth + 1)
    out.push(
      `page scrolls sideways — ${String(doc.scrollWidth)}px of content in ${String(window.innerWidth)}px`,
    );
  /* A panel whose content is wider than the panel drags the layout with it. */
  for (const sel of ["#insp", "#viewhdr", ".legend", "header", ".doc"]) {
    const el = document.querySelector(sel);
    if (el && el.scrollWidth > el.clientWidth + 1)
      out.push(
        `${sel} overflows — ${String(el.scrollWidth)}px in ${String(el.clientWidth)}px`,
      );
  }
  /* The tab strip is meant to scroll; if a tab wraps, the rows get taller instead. */
  /*
   * Anything anchored to the stage floor is anchored under the sheet handle unless it is
   * lifted, and a control the handle covers takes the tap instead of it — which is how
   * the reference tables strip came to be drawn off the bottom of every canvas view with
   * no gate saying a word. Occlusion, not overflow, so it needs its own measurement.
   */
  const sheet = document.querySelector("aside");
  if (sheet && getComputedStyle(sheet).position === "fixed") {
    const top = sheet.getBoundingClientRect().top;
    for (const sel of ["#tables", ".hint", ".tbl-head"]) {
      const el: HTMLElement | null = document.querySelector(sel);
      if (!el || el.hidden || !el.getClientRects().length) continue;
      const box = el.getBoundingClientRect();
      if (box.bottom > top + 1)
        out.push(
          `${sel} is ${String(Math.round(box.bottom - top))}px under the details sheet — ` +
            `lift it clear of the handle`,
        );
    }
  }

  /*
   * A landscape phone is short, not narrow, and every rule above it keys off width — so
   * the wide layout was served into a 390px-tall viewport, where the title wrapped to
   * seven lines and the header alone took 202px of it. Past half the viewport the page
   * is more chrome than content, whatever the width says.
   */
  const head = document.querySelector("header");
  if (head && head.getBoundingClientRect().height > window.innerHeight / 2)
    out.push(
      `the header takes ${String(Math.round(head.getBoundingClientRect().height))}px ` +
        `of ${String(window.innerHeight)}px — more than half the viewport is chrome`,
    );

  const heights = new Set(
    [...document.querySelectorAll(".tab")].map((t) =>
      Math.round(t.getBoundingClientRect().height),
    ),
  );
  if (heights.size > 1)
    out.push(
      `tabs wrap instead of scrolling — heights ${[...heights].join(", ")}`,
    );
  return out;
}

/** Clicks every target on every tab and checks the panel actually fills. */
async function auditTargets() {
  const empty: string[] = [],
    noAudience: string[] = [];
  let n = 0;
  for (const tab of [...document.querySelectorAll(".tab")]) {
    (tab as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 90));
    const targets = [
      ...document.querySelectorAll(
        "#root .node, #root .zone.clickable, #root .edge, .row",
      ),
    ];
    for (const el of targets) {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      n++;
      const title = document.querySelector(".insp-title");
      if (!title || !title.textContent.trim())
        empty.push(
          `${tab.textContent}: ${(el.getAttribute("aria-label") || "").slice(0, 40)}`,
        );
      // the audience line must survive a selection, not only the idle panel
      if (!document.querySelector(".audience"))
        noAudience.push(tab.textContent);
    }
  }
  return { n, empty, noAudience: [...new Set(noAudience)] };
}

await main();
