# The renderer

Shared by every project, and it knows about none of them. Everything specific to one
architecture arrives as data the build injects above `app.js`; everything specific to the
site arrives the same way on the index page. That is what makes a second architecture a
directory under [`../projects/`](../projects/) rather than a fork of this one.

| File         | What it is                                                                    |
| ------------ | ----------------------------------------------------------------------------- |
| `theme.css`  | Colour, type and the page reset. Inlined first on every page the build writes |
| `styles.css` | The explorer's own layout: header, canvas, inspector, reference tables        |
| `shell.html` | The explorer's markup                                                         |
| `app.js`     | Renderer, edge routing, pan/zoom, inspector, stage selector                   |
| `icons.svg`  | AWS service icons as `<symbol>` defs, inlined whole so a page stays one file  |
| `index.html` | The frame of the index page over the projects, and its theme toggle           |
| `index.css`  | The index page's layout                                                       |

Nothing here is served directly. [`../scripts/buildArchitectureExplorer.ts`](../scripts/buildArchitectureExplorer.ts)
inlines it into `site/<id>/index.html` for each project and `site/index.html` for the index,
because a page has to stay single-file: it is opened straight off disk and published as a
shareable artifact, and neither can fetch a sibling file.

Two things are deliberately not per project:

- **The colour palette** is in `theme.css`, so every page of the site is the same site. A
  project's config picks colours from it by name and the build fails if one does not
  resolve — see [`../projects/README.md`](../projects/README.md).
- **The theme choice** is stored under one key every page shares, so choosing dark on the
  index or on one project's page holds on every other. The build injects that key, so the
  explorer and the index cannot disagree about it.

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

`checkArchitectureExplorer.ts` renders every tab in both shapes — 390x844 and 844x390 —
and fails on sideways scroll, an element wider than its box, one anchored under the sheet
handle, a tab strip that wraps instead of scrolling, or a header taking more than half the
viewport. It then works the details panel in both shapes — closed on
load, opened by a tap, closed again by the handle and by Escape, and, where the panel is
a column, actually handing its width back when it closes. The controls menu is worked
wherever the header cannot seat the control row.

`app.js` is written compactly because it is inlined verbatim into a document where bytes
count, and it reads globals the build injects above it. It is excluded from eslint for both
reasons.
