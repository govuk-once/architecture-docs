# The renderer

Shared by every project, and it knows about none of them. Everything specific to one
architecture arrives as data the build injects above `app.js`; everything specific to the
site arrives the same way on the index page. That is what makes a second architecture a
directory under [`../projects/`](../projects/) rather than a fork of this one.

| File          | What it is                                                                    |
| ------------- | ----------------------------------------------------------------------------- |
| `theme.css`   | Colour, type and the page reset. Inlined first on every page the build writes |
| `styles.css`  | The explorer's own layout: header, canvas, inspector, reference tables        |
| `shell.html`  | The explorer's markup                                                         |
| `app.js`      | Renderer, edge routing, pan/zoom, inspector, stage selector                   |
| `icons.svg`   | AWS service icons as `<symbol>` defs, inlined whole so a page stays one file  |
| `index.html`  | The frame of the index page over the projects, and its theme toggle           |
| `index.css`   | The index page's layout                                                       |
| `fonts/`      | The two typefaces, subset and committed; `pnpm fonts` refetches them          |
| `favicon.svg` | The tab icon, inlined as a data URI                                           |

Nothing here is served directly. [`../scripts/buildArchitectureExplorer.ts`](../scripts/buildArchitectureExplorer.ts)
inlines it into `site/<id>/index.html` for each project and `site/index.html` for the index,
because a page has to stay single-file: it is opened straight off disk and published as a
shareable artifact, and neither can fetch a sibling file.

Single-file means it, now. The page used to fetch IBM Plex from Google on every open —
five third-party requests, which made a page opened off disk depend on the network, sent
every reader of a public government page to a third party, and left anyone offline reading
fallback metrics, which is the very thing the geometry gates measure. The faces are
committed under `fonts/`, subset by `pnpm fonts` to the characters the site renders, and
inlined as base64. It is not part of the build and never runs from one: a build that
reaches for the network is a build that fails on a train. (`pnpm sync` reaches for it too,
to clone the sources — that is a different loop, run when a source moves.)

Subsetting costs one thing, and the build checks it: a model reaching for a glyph outside
the set would render a blank box, so `checkGlyphs` compares every string in the model
against the manifest and names the character, its code point, and what to do about it.

Sans is one variable face covering 400-700 in 31KB; Mono has no variable build, so it is
three static weights. Together about 52KB, against 139KB for seven static faces.

Two things are deliberately not per project:

- **The colour palette** is in `theme.css`, so every page of the site is the same site. A
  project's config picks colours from it by name and the build fails if one does not
  resolve — see [`../projects/README.md`](../projects/README.md).
- **The theme choice** is stored under one key every page shares, so choosing dark on the
  index or on one project's page holds on every other. The build injects that key, so the
  explorer and the index cannot disagree about it.

## Reachable without a mouse or a screen

Every box and every line is a `tabindex="0"` control with a role and a label, so the
diagram is operable from a keyboard — and a skip link jumps past the forty stops that
creates. The tab strip is one stop, with the arrows moving inside it and Enter choosing.

`pnpm check` runs axe-core over both colour schemes and both kinds of view, on the WCAG
2.2 AA rule set. It is a floor rather than a verdict: it can tell that a label exists, not
that it reads well.

Two things it cannot see, kept right by hand:

- **Headings step down**: the project title is the page's one `h1`, the details panel and
  a reference view's title are `h2`, its sections `h3`.
- **The panel is not a live region.** It runs to 500-odd characters and announcing all of
  it on every click is not help. A one-line `role="status"` says what was selected and
  that the panel moved; the panel is there to read when the reader chooses.

## On a phone

The same markup, restructured entirely in CSS at 760px, because two layouts would be two
things to keep true rather than one. What changes:

- **The details panel becomes a bottom sheet** — out of flow, closed to a 50px handle, and
  raised by tapping a box, a line or a reference row. A phone has no room for a permanent
  372px column, and a reader who has not tapped anything has nothing to read in it.
- **Display and export move behind a menu button.** They are settings, reached once. Zoom
  goes with them and then hides: pinch is the gesture a phone reader already has. **Fit
  stays on the header row** — it is the way back from a pinch gone wrong, and burying it is
  the one thing a phone reader cannot afford.
- **The stage picker keeps its own row and is never hidden.** It changes every number on
  the page, so a reader who cannot see which stage they are on is misreading the diagram
  rather than merely inconvenienced.
- **Tab group labels go**, and reference rows stack their tags onto a second line.
- **The stage picker uses each stage's id** — `DEV`, `STG`, `PROD`, `EPH` — because
  "Development" and "Ephemeral PR" set the width of the whole picker to say what three
  letters say. No extra config: the short form is the id a project already declares.
- **An open panel carries a close button** at its top right. The handle says the panel can
  move; this says how to put it away.
- **The stage floor moves up by the height of the handle.** Everything anchored to it —
  the reference tables strip, the pan hint — is anchored to a floor the sheet now covers.
  Opened, the tables take the larger share of the stage rather than the smaller one.

## Between a phone and a desk

From 761px to 1080px — a tablet in portrait, or a browser window somebody has resized —
the panel is a 300px column beside the canvas rather than the 372px one a wide screen
gets, and nothing is stacked. It used to stack, which bought the canvas the full width
and cost the panel its place on the screen: at 917x544 it began at 447px with 97px left
to be read through. The canvas pans and zooms and can afford to be narrower; the panel
cannot afford to be off-screen.

The header at these widths uses the short stage names, and the title and strapline
truncate rather than wrap: at 768px the row wanted 791px in 728 and took 202px of the
screen before a box was drawn.

## Turned sideways

Landscape is **short, not narrow**, and the two want opposite answers — so it keys off
`max-height`, not width:

- **The panel stays a column, and collapses to a rail down the right edge.** Closed by
  default, opened by tapping a box or the rail itself — the same events that raise the
  sheet in portrait, so there is one behaviour drawn two ways rather than two behaviours.
  Closed, the canvas and the reference tables get the full width. A column costs width,
  which a landscape phone has plenty of; a sheet costs height, which it has none of.
  Below 761px there is no room for the column, so the sheet stays and only the header
  compresses.
- **The panel scrolls as one piece, header included.** Everywhere else the view header is
  pinned and only the body scrolls, which is right when there is height to spare. Here it
  cost 214px of a 314px panel — 68% spent on a legend and an audience line, leaving 100px
  to read 1000px of content through. The rail and the close button anchor to the shell
  rather than the panel, which is what keeps them still while the rest moves.
- **The header collapses to one row** — strapline gone, stage picker inline, tighter
  padding. Without this the wide layout was served into a 390px-tall viewport: the title
  wrapped to seven lines and the header alone took 202px of the 390.

The narrow rules sit at the foot of `styles.css` on purpose: they have to beat later
sections written for the wide layout, and at equal specificity the last rule wins.

`checkArchitectureExplorer.ts` renders every tab in four shapes — 390x844, 844x390,
768x1024 and 917x544 — and fails on sideways scroll, an element wider than its box, one
anchored under the sheet handle, a tab strip that wraps instead of scrolling, a header
taking more than half the viewport, or a details panel with under 160px of the window to
be read through where it is not deliberately tucked away. Where the panel collapses it
then works it — closed on load, opened by a tap, closed again by the handle, by Escape
and by the close button, and, where the panel is a column, actually handing its width
back when it closes. The controls menu is worked wherever the header cannot seat the
control row. Every layout bug so far has been at a seam between two rules rather than in
the middle of one, and every one was clean at 1440: that is why there are four shapes and
not one.

`app.js` is written compactly because it is inlined verbatim into a document where bytes
count, and it reads globals the build injects above it. It is excluded from eslint for both
reasons.
