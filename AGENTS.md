# Working in this repository

This repository documents the architectures of the GOV.UK Once platforms, each of which
lives elsewhere. It holds a LikeC4 model per platform, the pipeline that renders each into an
interactive page, an index over them, and the checks that keep model and code in step. It
reads those repositories and never writes to them.

Today that is **FLEX**, the **GOV.UK App** and **UDP**, with UNS listed as planned. One
directory per architecture under `projects/`; one renderer in `explorer/` that knows about
none of them. Every command below takes an optional project id and acts on all of them when
you give none. FLEX and UDP are each read from one repository; the GOV.UK App from four.

This file is for anyone — person or coding agent — making changes here. It is a router and an
operating manual: it says how to run the loop, and where the real instructions live.

## The loop

Clone this repository, then:

```bash
pnpm install
pnpm sync      # clone or fetch each source into .sources/, and install what needs it
pnpm synth     # run each CDK app per stage: the CloudFormation the counts are read from
pnpm build     # derive the facts, validate the models, assemble every page and the index
pnpm check     # render every page in a browser and measure what only rendering can see
pnpm review    # export the planned states for comment, where people can actually comment
pnpm editor    # serve the site with the state editor at /editor/ — local, writes states/ only
pnpm overview  # export the architecture overview page, one per project
pnpm confluence  # put the overview and the review page in Confluence; CI runs it after each build of main
pnpm encrypt-site  # seal site/ behind SITE_PASSWORD; the deploy job runs it when the secret is set
```

`pnpm synth` is the one command here that executes a documented repository. `sync` and
`build` never do. It runs exactly the `synth.command` in each project's config — the CDK
app itself, per stage, with no credentials: a context lookup the machine cannot make
becomes a dummy value, or the answer cached in the source's committed `cdk.context.json`,
which is right for counting resources by type. Where the app needs the source's own build
first — UDP loads every function from `build/` — `synth.prepare` names that build, and it
runs once before the stages. Read what it writes.
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
Where each comes from is declared in the `source` block of its `project.config.json` — or
`sources`, for a project read from more than one repository — and nowhere else.

The install inside a checkout is not optional the first time: `pnpm synth` runs the CDK app,
so its dependencies have to resolve. After that the install is repeated only when a manifest
moved in the range; `pnpm sync --install` forces it if a checkout ever looks wrong. A sync
keeps `cdk.out` so the templates survive it; `pnpm synth` always rewrites them.

Only the checkout `synth` runs in is ever installed. The GOV.UK App's four are read and never
installed: two are Swift and Kotlin, and its SAM templates are counted as written, with each
stage's `parameters` deciding which `Condition` holds there.

## What is yours, and what is not

The as-is is yours. You read the source, you write the model, you cite the file, and every
gate in this repository exists to stop you asserting something the code does not do.

**Planned states are not yours.** `projects/<id>/states/` holds proposed architectures, and
a proposal is somebody's — it comes out of a board, an RFC, an ADR, a decision somebody is
answerable for. You may be asked to write one down, lay it out, or check it; you may not
invent one, and you may not decide what a state should contain because it would make the
diagram tidier. If an overlay needs a change nobody has argued for, say so and stop.

The line is enforced as well as stated: every planned change cites an entry in
`states/decisions.json`, the build refuses a citation the register does not hold, and it
counts the changes resting only on questions still open. See
[`projects/STATES.md`](projects/STATES.md) for the whole workflow.

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

An empty diff is **not** proof the docs are current. Only the resource counts the config
declares — 28 for FLEX — and the nineteen alarm kinds are derived; everything else is prose
written by reading the code. A rewrite of a CDK stack changes no number here and can still
make a paragraph false.

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
The planned-state rules — composition, the fold, the declarations, what autofix may and may
not move — are covered by the tests beside `scripts/lib/states.ts`, `composeStates.ts` and
`autofix.ts`, and the review wording by the one beside `reviewText.ts`.

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
citation, any citation — on a box, a line, a table or an inventory row — pointing at a file that
no longer exists, a citation that names no repository the project reads or links into one it
does not list, text that will not fit its box,
overlapping boxes, a box straddling a zone edge, an edge to a node that does not exist, a box
with no `ownership`, a sub-label that repeats its label, a dashed edge on a view that never says
what dashed means, a kind naming a colour the theme lacks, a character the embedded fonts do
not carry, a raw `<` that would swallow a label, or JSON that is not prettier-formatted.

A planned state adds its own refusals: an overlay file named for a view the model does not
have, an overlay naming a box the view does not have at that step, a line drawn to an
endpoint that is not there, a view a state declares unchanged and also overlays, a citation
the decision register does not hold, a status or approval level outside the vocabulary, a
dangling `supersededBy`, a relative link, and every geometry rule above applied again to the
composed future and diff views. A fault in a composed view is reported once, at the state
where it first appears, with the later states it is still in force at after the dash —
`— also at s2, s3` — because those states only inherit it and the fix is in the first one's
file. Two things it counts rather than refuses, and prints on every run: planned changes
that cite nothing, and planned changes resting only on questions still open; beside them,
one line per state saying which views it models and which it has not reached yet.

`pnpm check` then renders the page in headless Chromium, light and dark, and measures what
static validation cannot see — a tab that has lost its audience line among it, and every
planned state, in both its future and its diff, against their own two ratchets. Run both.

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

## Arranging a planned state

A person arranges a state in the editor and the gates accept it; then they ask you to
arrange it. That request has a narrow meaning. Read [`projects/CANVAS.md`](projects/CANVAS.md)
and [`projects/STATES.md`](projects/STATES.md), then edit only geometry in the named overlay:
`x`, `y`, `w`, `h`, and slots (`zone`, `row`, `col`) where a box would sit better on a
zone's grid than by hand. Never change a label, a sub, a fact, a citation, a line, or which
side of a boundary a box is on — those are the author's claims, and a layout pass that
touches them has changed the proposal. Prefer slots to coordinates inside a zone; keep
reading order left to right along the request path; leave the as-is where it is unless the
state's own additions force a move. Run `pnpm build` and `pnpm check` after, and fix what
they report rather than widening a budget.

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
source out into `.sources/`, where `pnpm sync` puts it, installs it, synthesises it, prints
the `pnpm drift` reading list without failing on it — before the build, because the build
advances the recorded commit — then rebuilds, never from the recorded state, always from the
templates, and fails if any committed `derived/architecture-facts.json` no longer matches.
On a pull request that means someone changed a model without rebuilding; on the scheduled
run it means a source moved and the docs have not caught up. It then runs the render check,
lint, typecheck and tests, and publishes `site/` to Pages from `main`.

The planned-state gates need no step of their own: `pnpm build` composes and refuses, and
`pnpm check` sweeps every state in both modes against its own two ratchets. `pnpm review` is
not run in CI — it writes a review copy for a person to paste into Confluence, and it writes
into gitignored `export/`.

A scheduled run that fails opens an issue titled _Scheduled build is failing_, comments on
it rather than opening another on each further failure, and closes it when a scheduled run
passes again. The schedule is the only thing that notices a source moving between manual
runs, and a schedule that fails silently is one nobody notices failing — it did, for a week,
over a checkout step that still asked for a token for a repository that had gone public.

Things that are the workflow's, not the scripts':

- **One checkout step per source repository**, written out rather than generated — a
  workflow cannot loop `actions/checkout`, and a private source needs a token with
  `Contents: read` on it; the default `GITHUB_TOKEN` cannot read another repository. FLEX and
  all four of the GOV.UK App's repositories are public and need none.
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
   repository to document and where its checkout lands. An architecture read from several
   repositories declares `sources` instead, each named and with the `url` its citations link
   against — the GOV.UK App's is the worked example. Every citation in such a project then
   names its source, `ios:Production/…`, and the build refuses one that names none or links
   into a repository the config does not list: with four checkouts, a path that could be in
   any of them is a claim nobody can check.
2. `projects/<id>/model/` — the LikeC4 model. This is the work, and the only part that is
   judgement rather than transformation. Start from `projects/_template/`, the smallest
   model that builds; [`projects/README.md`](projects/README.md) sets out what it requires
   and the order to grow it in.
3. A `--legend-<colour>` token in `explorer/theme.css` for any colour its kinds name that is
   not already there. The build says so if you miss one.
4. A `synth` block saying how to run its CDK app, and `derive.counts` saying what to count
   in the templates — both JSON, no TypeScript. A SAM or CloudFormation template is read as
   written and needs no `synth`: give each stage the `parameters` it deploys with, and each
   resource's `Condition` is evaluated for that stage — a condition that cannot be evaluated
   fails the derivation rather than being guessed at. Or no `derive` block at all, if nothing
   is worth gating: then leave `from` off every resource and `derived` off every table, and
   maintain those numbers by hand like any other prose.
5. A checkout step per repository in `.github/workflows/build.yml`. A workflow cannot loop
   `actions/checkout`, and a private repository needs its own token.
6. `<id>` in the `projects` array of `explorer.config.json`, which is also the order the
   index lists them in. Remove it from `planned` if it was there.

An architecture the site intends to cover and has not read yet goes in `planned` instead: it
gets a card saying plainly that nothing has been read from its repository, and `seenFrom`
names the project whose model the description came from — a description of UDP written while
reading FLEX is evidence about FLEX, not about UDP.
