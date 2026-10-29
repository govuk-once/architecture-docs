/**
 * The architecture, as one page: what the explorer shows, view by view, with the picture
 * and the words the model gives each view. Not a copy of the explorer — the reference
 * tables and the detail behind every box stay on the live page, which this links to —
 * but enough that someone who will never click a tab knows what the system is.
 *
 * Pure, so it can be tested on a fixture and built without a browser.
 */
import type { View } from "../buildArchitectureExplorer.js";
import type { SiteConfig } from "./paths.js";
import type { Project } from "./projects.js";
import type { States } from "./states.js";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/* The explorer's rule for a note: escaped, then the three inline tags it allows put back.
   Storage format accepts the same three, so a note reads on both pages the same way. */
const rich = (s: string) =>
  esc(s).replace(/&lt;(\/?)(b|code|i)&gt;/g, "<$1$2>");

export const overviewPicture = (view: View) => `overview-${view.id}.png`;

/** The diagrams, in the explorer's tab order; reference tabs are listed, not drawn. */
export function overviewPage(
  project: Project,
  views: View[],
  states: Pick<States, "list">,
  liveUrl: string,
  image: (file: string) => string,
  reviewTitle: string,
): string {
  const ordered = [...views].sort((a, b) => a.order - b.order);
  const diagrams = ordered.filter((v) => v.nodes);
  const references = ordered.filter((v) => !v.nodes);
  const c = project.config;
  return [
    `<p><strong>${esc(c.tagline)}.</strong> ${esc(c.blurb)}</p>`,
    `<p>This page is generated from the architecture explorer at ` +
      `<a href="${esc(liveUrl)}">${esc(liveUrl)}</a>, which is derived from the code and rebuilt ` +
      `against it on every merge; the explorer holds the detail behind every box and line. ` +
      `Do not edit this page — edit the model and it is rewritten.</p>`,
    ...diagrams.flatMap((v) => [
      `<h2>${esc(v.name)}</h2>`,
      v.audience ? `<p><em>For ${esc(v.audience)}.</em></p>` : "",
      `<p>${esc(v.blurb)}</p>`,
      image(overviewPicture(v)),
      v.note ? `<p>${rich(v.note)}</p>` : "",
      `<p><a href="${esc(liveUrl)}#tab=${esc(v.id)}">Open ${esc(v.name)} in the explorer</a></p>`,
    ]),
    references.length
      ? [
          `<h2>Reference</h2>`,
          `<ul>${references
            .map(
              (v) =>
                `<li><a href="${esc(liveUrl)}#tab=${esc(v.id)}">${esc(v.name)}</a> — ${esc(v.blurb)}</li>`,
            )
            .join("")}</ul>`,
        ].join("\n")
      : "",
    states.list.length
      ? [
          `<h2>Planned states</h2>`,
          `<p>What is proposed next, each state a step from the one before. The changes, the ` +
            `pictures and the questions they rest on are on the page <em>${esc(reviewTitle)}</em>, ` +
            `which is where to comment.</p>`,
          `<ul>${states.list
            .map(
              (st) =>
                `<li><strong>${esc(st.label)}</strong> — ${esc(st.blurb)}</li>`,
            )
            .join("")}</ul>`,
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** One documented architecture, as the index describes it. */
export interface IndexEntry {
  name: string;
  tagline: string;
  blurb: string;
  /** The live explorer page. */
  url: string;
  /** The title of its own page in Confluence. */
  pageTitle: string;
}

/** The index's picture: how the documented systems call one another. */
export const indexPicture = "index-fit.png";

/**
 * The index over the projects, as one page: what the site is, the sketch of how the
 * systems fit together, and one entry per architecture pointing at its explorer and at
 * its own page. The parent of the overview pages, when they are published by hand.
 */
export function indexPage(
  site: Pick<SiteConfig, "tagline" | "blurb" | "footer" | "fit">,
  entries: IndexEntry[],
  liveUrl: string,
  image: (file: string) => string,
): string {
  return [
    `<p><strong>${esc(site.tagline)}.</strong> ${esc(site.blurb)}</p>`,
    `<p>This page is generated from the architecture explorer at ` +
      `<a href="${esc(liveUrl)}">${esc(liveUrl)}</a>, which is derived from the code and rebuilt ` +
      `against it on every merge. Do not edit this page — edit the model and it is rewritten.</p>`,
    ...(site.fit
      ? [
          `<h2>${esc(site.fit.title)}</h2>`,
          image(indexPicture),
          `<p>${esc(site.fit.note)}</p>`,
        ]
      : []),
    `<h2>The architectures</h2>`,
    ...entries.flatMap((e) => [
      `<h3>${esc(e.name)}</h3>`,
      `<p><em>${esc(e.tagline)}.</em> ${esc(e.blurb)}</p>`,
      `<p>Its page here is <em>${esc(e.pageTitle)}</em>; the explorer is at ` +
        `<a href="${esc(e.url)}">${esc(e.url)}</a>.</p>`,
    ]),
    `<p>${esc(site.footer)}</p>`,
  ].join("\n");
}
