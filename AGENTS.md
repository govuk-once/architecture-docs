# Working in this repository

This repository documents the architecture of **FLEX**, which lives elsewhere. It holds a
LikeC4 model, the pipeline that renders it into an interactive page, and the checks that keep
the two in step. It reads the source repository and never writes to it.

This file is for anyone — person or coding agent — making changes here. It is a router and an
operating manual: it says how to run the loop, and where the real instructions live.

## The loop

Clone this repository, then:

```bash
pnpm install
pnpm sync      # clone or fetch the source repository into .sources/, and install it
pnpm build     # derive the facts, validate the model, assemble the page
```

`pnpm sync` is what makes this repository self-contained: it pulls the source it documents
rather than assuming a checkout is already beside it. The checkout is disposable — it is
gitignored, hard-reset on every sync so it can never carry local edits, and removed by
`pnpm clean`. Where it comes from is declared in the `source` block of
`explorer/explorer.config.json`, nowhere else.

The install inside that checkout is not optional. The domain and gateway configs are
**imported as modules** — the same files the CDK app reads, which is why the counts can be
trusted — so their dependencies have to resolve. The alarm constructs are read as text and
parsed, and need nothing.

## Checking for drift

`architecture-facts.json` is committed. That is the whole drift mechanism:

```bash
pnpm sync && pnpm build && git diff --stat architecture-facts.json
```

A non-empty diff means the source moved. What the diff says determines the work:

| The diff shows            | What changed over there             | What to do here                          |
| ------------------------- | ----------------------------------- | ---------------------------------------- |
| Route or domain counts    | A route, domain or gateway          | Update the resource rows the build names |
| An alarm added or removed | `constructs/alarms/`                | Update the Delivery alarm table          |
| Nothing                   | Nothing that these docs derive from | Still read on — see below                |

An empty diff is **not** proof the docs are current. Only ten resource counts and the
eighteen alarms are derived; everything else is prose written by reading the code. A rewrite
of a CDK stack changes no number here and can still make a paragraph false.

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
of the files I cite have changed, and is what I said about them still true":

```bash
git -C .sources/flex log --oneline <last-known-sha>..HEAD
git -C .sources/flex diff --name-only <last-known-sha>..HEAD
```

Cross-reference that list against the citations. A cited file that changed is a claim to
re-read; a cited file that moved fails the build already.

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

## Cleaning up

```bash
pnpm clean     # remove .sources/ entirely
```

Do this when finished, or leave it: `.sources/` is gitignored and the next `pnpm sync` fetches
and hard-resets it anyway. Never commit anything from inside it, and never edit it — it is a
read-only view of somebody else's repository.

## Before you change a view

Read **[`explorer/README.md`](explorer/README.md)**. It is the contract: the node properties,
the metadata this explorer adds on top of C4, the tab-order rationale, the scope rules that
keep a fact on exactly one tab, every gate the build enforces, and the known defects in the
source that the diagrams must not paper over.

## Conventions

- **Commit messages** are `TICKET-000 type: description`, matching the source repository's
  convention — e.g. `FLEX-464 docs: correct the alarm thresholds`.
- **Do not commit generated files.** `site/` and `.sources/` are gitignored.
  `architecture-facts.json` is the exception: it is generated _and_ committed, because that is
  what makes drift a reviewable diff.
- **New packages are quarantined for seven days** by `minimumReleaseAge` in
  `pnpm-workspace.yaml`. If an install fails for a fresh release, that is why — pick an older
  version rather than lowering the setting.

## Documenting more than one repository

Today `explorer/explorer.config.json` declares a single `source`. Adding UDP, UNS or anything
else means turning that into a list, and the shape is already most of the way there:

- `source` becomes `projects[]`, each with its own `repo`, `ref`, `root` and globs, and its
  own model directory. `scripts/lib/paths.ts` is the only file that resolves those paths, so
  it is the only one that has to learn about the list.
- `pnpm sync` already takes its repository from config and would loop.
- `architectureFacts.ts` is the one piece that is genuinely per-project: it reads FLEX's exact
  config schema. Another repository needs its own derivation, or none — the checks skip when
  nothing declares a source.
- The site gains an index listing the architectures, and each project builds to its own page
  under `site/`.

Do not build that until there is a second repository to document. One project modelled as a
list of one is harder to read than one project.
