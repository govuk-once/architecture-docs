# Working in this repository

This repository documents the architectures of the GOV.UK Once platforms, each of which
lives elsewhere. It holds a LikeC4 model per platform, the pipeline that renders each into an
interactive page, an index over them, and the checks that keep model and code in step. It
reads those repositories and never writes to them.

Today that is **FLEX**, with UDP and UNS listed as planned. One directory per architecture
under `projects/`; one renderer in `explorer/` that knows about none of them. Every command
below takes an optional project id and acts on all of them when you give none.

This file is for anyone — person or coding agent — making changes here. It is a router and an
operating manual: it says how to run the loop, and where the real instructions live.

## The loop

Clone this repository, then:

```bash
pnpm install
pnpm sync      # clone or fetch each source into .sources/, and install what needs it
pnpm build     # derive the facts, validate the models, assemble every page and the index
```

Both steps do only the work the source has actually made stale. Every build records the
commit it read in `architecture-source.json`, and the next run measures against it: `sync`
reinstalls the checkout only when a dependency manifest moved in the range, and `build`
re-derives only when the commit, the deriving scripts or the facts file itself changed.
`pnpm facts --force` and `pnpm sync --install` override that; CI ignores the recorded state
entirely, because re-deriving and diffing is the whole point of the run.

`pnpm sync` is what makes this repository self-contained: it pulls the sources it documents
rather than assuming checkouts are already beside it. Each is disposable — gitignored,
hard-reset on every sync so it can never carry local edits, and removed by `pnpm clean`.
Where each comes from is declared in the `source` block of its `project.config.json`,
nowhere else.

The install inside a checkout is not optional the first time, for a project whose derivation
imports it. FLEX's domain and gateway configs are **imported as modules** — the same files
the CDK app reads, which is why the counts can be trusted — so their dependencies have to
resolve. Its alarm constructs are read as text and parsed, and need nothing. After that the
install is repeated only when a manifest moved in the range; `pnpm sync --install` forces it
if a checkout ever looks wrong.

## Checking for drift

Each project's `architecture-facts.json` is committed. That is the automated half of the
drift mechanism:

```bash
pnpm sync && pnpm build && git diff --stat -- 'projects/*/architecture-facts.json'
```

A non-empty diff means a number the source declares has changed. What the diff says
determines the work:

| The diff shows            | What changed over there             | What to do here                          |
| ------------------------- | ----------------------------------- | ---------------------------------------- |
| Route or domain counts    | A route, domain or gateway          | Update the resource rows the build names |
| An alarm added or removed | `constructs/alarms/`                | Update the Delivery alarm table          |
| Nothing                   | Nothing that these docs derive from | Still read on — see below                |

An empty diff is **not** proof the docs are current. Only ten resource counts and the
eighteen alarms are derived; everything else is prose written by reading the code. A rewrite
of a CDK stack changes no number here and can still make a paragraph false.

So there is a second half, and it is the one that finds those:

```bash
pnpm drift
```

It reads the commit each project's facts were built from out of its
`architecture-source.json` and lists what has landed in that source since — which of those commits touch a config the counts come
from, and which touch a file the explorer **cites**, naming every claim that rests on it.
That list is the reading, and there is no substitute for doing it. `drift` never fails a
build; a reading list that could fail CI would get suppressed rather than read.

Run it **before** `pnpm build`. The build advances each recorded commit the moment it
re-derives, so the natural order is `pnpm sync`, which prints how far each source has moved,
then `pnpm drift`, then the build. After the fact, `pnpm drift <id> --since <sha>` asks about
any range, and `git log -p projects/<id>/architecture-source.json` holds every commit that
project has been built from.

## Never carry a claim forward on trust

This is the rule that matters most, and it is why this repository exists rather than a folder
of markdown. A verification pass over an earlier draft checked 1,091 claims against the source
and found **80** wrong or misleading — five of them repeated across six tabs each. Every one
looked plausible.

So: **read the code that proves a claim, every time you touch it.** Do not restate what the
previous author wrote because it reads well. Every claim names the files that prove it —
elements and relationships carry LikeC4 `link` statements, reference tables carry a `code`
array — and those citations exist so the next person can check, not so they can skip checking.

When the source has moved, the useful question is not "does the build still pass" but "which
of the files I cite have changed, and is what I said about them still true". `pnpm drift`
answers exactly that, and answers it against the recorded commit rather than one you have to
remember. A cited file that changed is a claim to re-read; a cited file that moved fails the
build already.

## What the build refuses to produce

`pnpm build` exits non-zero — it does not warn — on a count that disagrees with the derived
facts, an alarm table that no longer matches the constructs, a reference table with no
citation, a citation pointing at a file that no longer exists, text that will not fit its box,
overlapping boxes, a box straddling a zone edge, an edge to a node that does not exist, a view
with no stated audience, a raw `<` that would swallow a label, or JSON that is not
prettier-formatted.

`pnpm check` then renders the page in headless Chromium, light and dark, and measures what
static validation cannot see. Run both.

## Verify your work

```bash
pnpm build     # includes the facts step
pnpm check     # render checks
pnpm lint
pnpm tsc
pnpm test
```

Run all five before proposing a change. The JSON is linted like anything else — eslint checks
it with `prettier/prettier` — so run `pnpm exec eslint --fix` on a file you hand-edit.

If you changed anything a derivation is built from — the files a module in
`scripts/derive/` lists in its `files` — run `pnpm facts --force` as well. Those files are
hashed into `architecture-source.json`, so a change to one re-derives on the next run
regardless; run it now so any diff it produces is in front of you rather than in front of the
reviewer.

## Cleaning up

```bash
pnpm clean     # remove .sources/ entirely
```

Do this when finished, or leave it: `.sources/` is gitignored and the next `pnpm sync` fetches
and hard-resets it anyway. Never commit anything from inside it, and never edit it — it is a
read-only view of somebody else's repository.

## Before you change a view

Read **[`projects/README.md`](projects/README.md)**. It is the contract: what a project
directory holds, the node properties, the metadata this explorer adds on top of C4, the
tab-order rationale, the scope rules that keep a fact on exactly one tab, every gate the
build enforces, and the known defects in the source that the diagrams must not paper over.
[`explorer/README.md`](explorer/README.md) covers the renderer, which is shared and knows
about no project.

## Conventions

- **Commit messages** are `TICKET-000 type: description`, matching the source repository's
  convention — e.g. `FLEX-464 docs: correct the alarm thresholds`.
- **Do not commit generated files.** `site/` and `.sources/` are gitignored. Each project's
  `architecture-facts.json` and `architecture-source.json` are the exceptions: both are
  generated _and_ committed, because that is what makes drift a reviewable diff and what
  gives the next run a commit to measure against.
- **New packages are quarantined for seven days** by `minimumReleaseAge` in
  `pnpm-workspace.yaml`. If an install fails for a fresh release, that is why — pick an older
  version rather than lowering the setting.

## Adding an architecture

Six things, and nothing else. The build, the renderer, the checks, the export and the index
all read config, so none of them changes:

1. `projects/<id>/project.config.json` — copy FLEX's and rewrite it. `source` names the
   repository; `derive` is optional and says which module in `scripts/derive/` turns that
   source into facts.
2. `projects/<id>/model/` — the LikeC4 model. This is the work, and the only part that is
   judgement rather than transformation.
3. A `--legend-<colour>` token in `explorer/theme.css` for any colour its kinds name that is
   not already there. The build says so if you miss one.
4. `scripts/derive/<module>.ts` if its counts are derivable, or no `derive` block at all if
   they are not — then leave `from` off every resource and `derived` off every table, and
   maintain those numbers by hand like any other prose.
5. A checkout step in `.github/workflows/build.yml`. A workflow cannot loop
   `actions/checkout`, and a private repository needs its own token.
6. `<id>` in the `projects` array of `explorer.config.json`, which is also the order the
   index lists them in. Remove it from `planned` if it was there.

An architecture the site intends to cover and has not read yet goes in `planned` instead: it
gets a card saying plainly that nothing has been read from its repository, and `seenFrom`
names the project whose model the description came from — a description of UDP written while
reading FLEX is evidence about FLEX, not about UDP.
