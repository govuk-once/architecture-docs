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

`app.js` is written compactly because it is inlined verbatim into a document where bytes
count, and it reads globals the build injects above it. It is excluded from eslint for both
reasons.
