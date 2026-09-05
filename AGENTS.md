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
pnpm synth     # run each CDK app per stage: the CloudFormation the counts are read from
pnpm build     # derive the facts, validate the models, assemble every page and the index
```

`pnpm synth` is the one command here that executes a documented repository. `sync` and
`build` never do. It runs exactly the `synth.command` in each project's config — the CDK
app itself, per stage, with no credentials: a context lookup the machine cannot make
becomes a dummy value, which is right for counting resources by type. Read what it writes.
The templates under `cdk.out/<stage>/` in the checkout are the deployed truth, fully
expanded, with nothing to reason through — a construct instantiated in a loop is one line
of source and many resources in a template. When you author or re-read a model, read the
template for the stack, not only the stack.

Both steps do only the work the source has actually made stale. Every derivation records
the commit it read in `projects/<id>/derived/architecture-source.json` as `derived`, and the
next run measures against it: `sync` reinstalls the checkout only when a dependency manifest
moved in the range, and `build` re-derives only when the commit, the deriving code, the
count definitions or the facts file itself changed. `pnpm facts --force` and
`pnpm sync --install` override that; CI ignores the recorded state entirely, because
re-deriving and diffing is the whole point of the run.

`pnpm sync` is what makes this repository self-contained: it pulls the sources it documents
rather than assuming checkouts are already beside it. Each is disposable — gitignored,
hard-reset on every sync so it can never carry local edits, and removed by `pnpm clean`.
Where each comes from is declared in the `source` block of its `project.config.json`,
nowhere else.

The install inside a checkout is not optional the first time: `pnpm synth` runs the CDK app,
so its dependencies have to resolve. After that the install is repeated only when a manifest
moved in the range; `pnpm sync --install` forces it if a checkout ever looks wrong. A sync
keeps `cdk.out` so the templates survive it; `pnpm synth` always rewrites them.

## Authoring the model

The diagrams and the data beside them — `projects/<id>/model/*.c4`, `views.json`,
`resources.json` — are written by reading the source, and today that reading is done by a
coding agent run **on a local machine, in this repository, with this file as its brief**.
Not in CI: authoring needs the checkout under `.sources/`, the templates `pnpm synth` writes
into it, and the current model, and it produces a diff a person then reviews. CI only ever
checks and publishes what was committed.

The loop, whether the reader is a person or an agent:

1. **Get the evidence.** `pnpm sync <id>` for the source, `pnpm synth <id>` for the
   CloudFormation, `pnpm drift <id>` for the list of commits since the last build and
   which of the files the model cites are among them. That list is the reading; start there.
2. **Read the template before the stack.** `cdk.out/<stage>/<stack>.template.json` is what
   deploys — loops unrolled, L2 constructs expanded, every alarm threshold resolved. Read the
   stack source for _why_, the template for _what_. Read every file `drift` names, in full.
3. **Edit the model, and cite as you go.** A changed or new claim carries a `link` to the
   file that proves it; a table carries `code`; a countable number carries `from` or
   `derived` so the build gates it rather than you. Keep each fact on one tab — see
   [`projects/README.md`](projects/README.md) for the scope rules and the metadata contract.
   Before placing a box, read [`projects/CANVAS.md`](projects/CANVAS.md): flow runs top to
   bottom, connected boxes are adjacent, controls live in a side column, and the canvas
   grows before a label shrinks.
4. **Let the build argue back.** `pnpm build`, `pnpm check`, `pnpm lint`, `pnpm tsc`,
   `pnpm test`. A count the model states that the templates contradict fails here, naming
   the row, the stage and both numbers. Fix the model, or — if the template is right and the
   claim was wrong — say so in the commit.
5. **Hand over a diff, not a page.** The model files and the regenerated
   `derived/` files are what gets reviewed. The
   reviewer's question for every changed line is the one this repository is built on: which
   file proves it, and does it still?

6. **Say the reading is done.** `pnpm drift <id> --mark-read` records the checkout's commit
   as `read` in `derived/architecture-source.json`. That is the only thing that advances it
   — a build advances `derived`, never `read` — so the next `drift` starts from where the
   reading stopped, whatever has been built in between. Run it only when every file `drift`
   listed has actually been read.

What an agent must not do: restate an existing claim because it reads well, describe a
resource from the stack source when the template disagrees, or mark a commit read whose
cited files it has not read. The verification pass that found 80 wrong claims in 1,091 found
them in prose that was fluent and plausible; plausibility is what an agent produces by
default, and it is not evidence.

## Checking for drift

Each project's `derived/architecture-facts.json` is committed. That is the automated half
of the drift mechanism:

```bash
pnpm sync && pnpm build && git diff --stat -- 'projects/*/derived/architecture-facts.json'
```

A non-empty diff means a number the source declares has changed. What the diff says
determines the work:

| The diff shows            | What changed over there             | What to do here                          |
| ------------------------- | ----------------------------------- | ---------------------------------------- |
| Route or domain counts    | A route, domain or gateway          | Update the resource rows the build names |
| An alarm added or removed | Any alarm construct in the CDK app  | Update the Delivery alarm table          |
| Nothing                   | Nothing that these docs derive from | Still read on — see below                |

An empty diff is **not** proof the docs are current. Only ten resource counts and the
nineteen alarm kinds are derived; everything else is prose written by reading the code. A rewrite
of a CDK stack changes no number here and can still make a paragraph false.

So there is a second half, and it is the one that finds those:

```bash
pnpm drift
```

It reads the commit each project's model was last **read** up to — `read` in
`derived/architecture-source.json` — and lists what has landed in that source since: which
of those commits touch the CDK app the counts come from, and which touch a file the explorer
**cites**, naming every claim that rests on it. That list is the reading, and there is no
substitute for doing it. `drift` never fails a build; a reading list that could fail CI
would get suppressed rather than read.

It prints a third list, and that one is not a reading list. **New and uncited** is the
source files the range adds that no claim names — grouped under the nearest directory the
model does cite from, so a new sibling of something documented stands out from noise. These
cannot have gone stale, because nothing claims them yet; the question they ask is the
opposite one, and it is the only question the citations cannot pose:

> Does this deserve a box, and which tab's story is now incomplete without it?

Most of the time the answer is no — a helper, a config, a new test util. Occasionally it is
a whole new domain, and nothing else in this repository will tell you. Answer it explicitly
before `--mark-read`, and say in the commit which additions you looked at and left out.

The state file records two commits because they answer two different questions. `derived`
is where the facts were computed from; a build advances it freely. `read` is how far the
cited files have been re-read; only `pnpm drift <id> --mark-read` advances it. So the order
of `build` and `drift` no longer matters, and `pnpm drift <id> --since <sha>` still asks
about any range if you need one.

## The gates have tests, and the tests have to fail

Every rule the build refuses and every number the render check counts is covered by
`scripts/buildArchitectureExplorer.test.ts` and `scripts/checkArchitectureExplorer.test.ts`.
The first is pure and fast; the second builds small SVG fixtures and measures them in
Chromium, because `getBBox` and `getPointAtLength` return nothing useful outside a browser.

A gate that stops catching things fails nothing, and looks exactly like a gate with nothing
to catch. So when you add one:

- give it a fixture it **must** reject and one it **must not** — a rule tested only against
  something that passes is a rule you have not tested
- break the rule in the source and watch the test fail before you believe it. Every counter
  in there was confirmed that way

`projects/_template` is covered too, in `scripts/lib/projects.test.ts`: no site config
lists it, so nothing builds it, and the claim it carries — that a second architecture is
config rather than TypeScript — would otherwise be found broken by the first person to
rely on it.

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
facts, an alarm table that no longer matches the synthesised templates, a reference table with no
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

If you changed `scripts/derive/cloudformation.ts`, or a project's `derive.counts` or `synth`
block, run `pnpm facts --force` as well. All three are hashed into
`derived/architecture-source.json`, so a change re-derives on the next run regardless; run
it now so any diff it produces is in front of you rather than in front of the reviewer.

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
  `derived/` directory is the exception: generated _and_ committed, because that is what
  makes drift a reviewable diff and what gives the next run a commit to measure against.
  Nothing under `derived/` is edited by hand.
- **New packages are quarantined for seven days** by `minimumReleaseAge` in
  `pnpm-workspace.yaml`. If an install fails for a fresh release, that is why — pick an older
  version rather than lowering the setting.

## CI

[`.github/workflows/build.yml`](.github/workflows/build.yml) runs on every pull request, on
every push to `main`, on a weekday schedule, and by hand. Every run checks each documented
source out beside this repository, installs it, synthesises it, rebuilds — never from the
recorded state, always from the templates — and fails if any committed
`derived/architecture-facts.json` no longer matches. On a pull request that means someone
changed a model without rebuilding; on the scheduled run it means a source moved and the
docs have not caught up. It then prints the `pnpm drift` reading list without failing on it,
runs the render check, lint, typecheck and tests, and publishes `site/` to Pages from
`main`.

Things that are the workflow's, not the scripts':

- **One checkout step per project**, written out rather than generated — a workflow cannot
  loop `actions/checkout`, and a private source needs a token with `Contents: read` on it;
  the default `GITHUB_TOKEN` cannot read another repository. FLEX is public and needs none.
- **Pages must use the GitHub Actions source**, not a branch: `site/` is gitignored, so a
  branch-based build would publish nothing.
- **The `github-pages` environment only lets the default branch deploy** by default. A
  manual publish from any other branch — `workflow_dispatch` with `deploy: true` — is
  refused before its first step until that branch is added to the environment's allowed
  list. The job then has no log, which is the tell.
- **Synth needs no credentials** as long as every context lookup the app makes degrades to a
  dummy, which counting by resource type tolerates. An app that hard-fails on a lookup
  needs a stub `cdk.context.json` written into the checkout before synth.

## Adding an architecture

Six things, and nothing else. The build, the renderer, the checks, the export and the index
all read config, so none of them changes:

1. `projects/<id>/project.config.json` — copy FLEX's and rewrite it. `source` names the
   repository to document and where its checkout lands.
2. `projects/<id>/model/` — the LikeC4 model. This is the work, and the only part that is
   judgement rather than transformation. Start from `projects/_template/`, the smallest
   model that builds; [`projects/README.md`](projects/README.md) sets out what it requires
   and the order to grow it in.
3. A `--legend-<colour>` token in `explorer/theme.css` for any colour its kinds name that is
   not already there. The build says so if you miss one.
4. A `synth` block saying how to run its CDK app, and `derive.counts` saying what to count
   in the templates — both JSON, no TypeScript. Or no `derive` block at all, if nothing is
   worth gating: then leave `from` off every resource and `derived` off every table, and
   maintain those numbers by hand like any other prose.
5. A checkout step in `.github/workflows/build.yml`. A workflow cannot loop
   `actions/checkout`, and a private repository needs its own token.
6. `<id>` in the `projects` array of `explorer.config.json`, which is also the order the
   index lists them in. Remove it from `planned` if it was there.

An architecture the site intends to cover and has not read yet goes in `planned` instead: it
gets a card saying plainly that nothing has been read from its repository, and `seenFrom`
names the project whose model the description came from — a description of UDP written while
reading FLEX is evidence about FLEX, not about UDP.
