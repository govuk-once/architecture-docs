# GOV.UK Once architecture

**→ [govuk-once.github.io/architecture-docs](https://govuk-once.github.io/architecture-docs/)**

The architectures of the GOV.UK Once platforms, each documented as one interactive page and
derived from that platform's own code rather than from prior design documents.

| Architecture             | State                                               |
| ------------------------ | --------------------------------------------------- |
| **FLEX** — `/flex/`      | Documented, nine tabs, rebuilt on every merge       |
| **GOV.UK App** — `/app/` | Documented, nine tabs, read from four repositories  |
| **UDP** — `/udp/`        | Documented, nine tabs, synthesised from its CDK app |
| **UNS**                  | Planned. Listed on the index, nothing read from it  |

Each lives in a separate repository. This one holds the models, the pipeline that renders
them, and the checks that keep them honest; it reads those repositories and never writes to
them.

## FLEX

Nine tabs, in three groups. Every box, line and zone is clickable; resource counts update
when you switch stage, and the state selector lays a proposed architecture over the one the
code describes.

| Tab              | Group         | Who it is for                                                    |
| ---------------- | ------------- | ---------------------------------------------------------------- |
| **Context**      | Architecture  | Anyone new to FLEX, including non-engineers                      |
| **Request path** | Architecture  | On-call, and anyone tracing a live request                       |
| **Containers**   | Architecture  | Platform engineers, and anyone reviewing a change                |
| **Components**   | Architecture  | Domain teams — this is the part you write                        |
| **Network**      | Cross-cutting | Platform engineers, and network or security review               |
| **Security**     | Cross-cutting | Security review, assurance and threat modelling                  |
| **Delivery**     | Cross-cutting | Platform engineers and on-call                                   |
| **Resources**    | Reference     | Cost, audit and incident scoping — the detail behind every badge |
| **Decisions**    | Reference     | Anyone reviewing a proposed change — what each rests on          |

## GOV.UK App

Nine tabs, read from four repositories: the iOS and Android apps in `govuk-once`, and the
backend and the remote config in `alphagov`. Every citation names the repository it is from —
`ios:`, `android:`, `backend:` or `config:` — and the build refuses one that names none, or
that links into any other repository. The backend's two SAM templates are counted per
environment by evaluating their Conditions, so the resource counts change with the stage.

| Tab                 | Group         | Who it is for                                                    |
| ------------------- | ------------- | ---------------------------------------------------------------- |
| **Context**         | Architecture  | Anyone new to the GOV.UK App, including non-engineers            |
| **Sign-in path**    | Architecture  | On-call, and anyone tracing a sign-in                            |
| **Account linking** | Architecture  | Anyone tracing a DVLA link, and anyone reviewing it              |
| **Containers**      | Architecture  | Backend engineers, and anyone reviewing a change to the backend  |
| **Components**      | Architecture  | Backend and app engineers — the code, not the infrastructure     |
| **Inside the app**  | Architecture  | App engineers, and anyone asking what the app calls and when     |
| **Security**        | Cross-cutting | Security review, assurance and threat modelling                  |
| **Delivery**        | Cross-cutting | Anyone shipping a change, and on-call                            |
| **Resources**       | Reference     | Cost, audit and incident scoping — the detail behind every badge |

## How the documentation is kept true

The diagrams are written by reading the code and are checked against it on every merge, but
the reading is done here, on a machine, by a coding agent — not in CI. Your part of the loop:

1. **Clone this repository** and `pnpm install`. That is the whole setup; the agent pulls
   the source it documents into `.sources/` itself.
2. **Ask the agent to check and update a project** — `AGENTS.md` is its brief. It fetches the
   source, synthesises the CloudFormation, lists what changed since the model was last read,
   re-reads those files, edits the model, and runs the build and checks. The ask matters:
   a vague one gets a plausible rewrite, a precise one gets the reading. Use these.

   To bring an existing project up to date:

   > Read `AGENTS.md` and follow "Authoring the model" for `flex`. Sync and synth the
   > source, run `pnpm drift flex`, and re-read every file it lists against the claims that
   > cite it. Change a claim only where the template or the cited file contradicts it, cite
   > what you change, run the five checks, and finish with `pnpm drift flex --mark-read`.
   > Tell me what changed, what you left alone, and anything you could not prove.

   To add an architecture:

   > Read `AGENTS.md` and follow "Adding an architecture" for `<id>`, whose source is
   > `<repository url>`. Start from `projects/_template/`. Work out how its CDK app
   > synthesises and declare it in the config, then author the model tab by tab from the
   > templates and the code, citing every claim. Add the checkout step to
   > `.github/workflows/build.yml`, and tell me if the repository is private.

   To re-verify everything, treating nothing as already correct:

   > Read `AGENTS.md`. Re-verify every claim in `projects/flex` against the current
   > templates and source as if the model were new. Report every claim you could not prove
   > from a file, with the file you expected to prove it.

3. **Look at the result**: `pnpm serve` builds and serves the site at
   `http://localhost:4321`, the index at `/` and each project one level down.
4. **Review the diff** with one question per changed line: which file proves it, and does it
   still? Fluent prose is not evidence — an earlier draft of FLEX had 80 wrong claims in
   1,091, every one plausible.
5. **Commit and open a pull request.** CI rebuilds from the source, fails if anything the
   model states disagrees with what actually deploys, and publishes to Pages on merge to
   `main`.

## What is yours to do

The agent cannot take these off you:

- **Commit the derived files with the model.** `projects/<id>/derived/` holds the counts
  the build read from the templates and the record of which commit they came from and which
  commit was read up to. They are generated, but committed, so that a change in the source
  is a reviewable diff here. CI fails if they are stale.
- **Say when the reading is done.** `pnpm drift <id>` lists what to re-read;
  `pnpm drift <id> --mark-read` records that it has been. Nothing else advances that
  record — not a build, not a sync — so run it only when the reading has actually happened.
- **Decide the architecture.** The as-is is derived from code; a **planned state** is not
  derived from anything, and the agent may not invent one. A state is somebody's proposal,
  every change in it cites an entry in the decision register, and the build refuses a
  citation the register does not hold. What the agent can do is write one down, lay it out
  and check it.
- **For a new project**: a checkout step per repository in `.github/workflows/build.yml`, a
  token for any that is private, and Pages set to the GitHub Actions source. Everything else is
  config the agent writes.

## Proposing a change to an architecture

Alongside what the code does today, a project may carry planned states — S1, S2, S3 — each
a step from the one before, so the picture at S3 is every step up to it and not a delta from
today that never existed. Pick one and the diagram becomes the system as it would stand;
turn on **Changes** and every difference from today is marked, with what it retires listed
beneath.

Every planned change cites a decision, and the register follows the
[GOV.UK Architectural Decision Record framework](https://www.gov.uk/government/publications/architectural-decision-record-framework/architectural-decision-record-framework):
what it is called, its status, which of the framework's four approval levels settles it, and
where to read the record. The build counts what rests on nothing and what rests only on
questions still open — because a state that looks decided and is not is the thing worth
knowing before a review.

A published page has nowhere to leave a comment, so `pnpm review` writes the states out for
Confluence — `export/<id>/page.html`, a browser preview beside it, and one PNG per state and
view drawn from the built page: the open questions first, then each state view by view,
with the diagram as the page draws it and what the step does in sentences that use the words
on the diagram.
Comments happen there; the repo stays the source of truth, and a comment that changes
something comes back as a decision and a pull request. Once a project names its Confluence
space, CI publishes two pages after each build of `main`, when they have changed: an
architecture overview — every diagram with its words and its picture — and the review page
beneath it.
[`projects/STATES.md`](projects/STATES.md) is the whole workflow.

The states are JSON files, and `pnpm editor` is the way to write them without learning the
format: the same local server with a visual editor at `/editor/`, where a state is a canvas
you place boxes on and a panel that asks for what each box needs. It runs the build's own
gates before it saves, puts right the faults that are arithmetic — a box too narrow for its
label, one over a boundary's edge, two on top of each other — when you press Fix, and shows
the file diff before it writes. It binds loopback, writes only under
`projects/<id>/states/`, and never reaches the published site.

The gates say a layout is not wrong: nothing overlaps, nothing hangs over an edge, every
label fits. [`projects/CANVAS.md`](projects/CANVAS.md) says what looks right, and nothing
checks that. So a state you have arranged by hand gets one more step before the pull
request: ask the agent to arrange it. The editor's Save dialog offers the prompt when the
draft placed or resized something by hand; it reads, in short:

> Read `projects/CANVAS.md` and `projects/STATES.md`. Arrange the layout in
> `projects/flex/states/s2/containers.json` so it follows the canvas rules: change positions
> and sizes only, never what a box or a line says or cites, and keep every box on the side of
> a boundary it is on now. Then run `pnpm build` and `pnpm check` and fix what they report.

## Not for indexing

The pages are public because GitHub Pages is, not because they are meant to be found: they
describe a live system in detail. Every page carries a `robots` meta tag asking not to be
indexed, archived or quoted, and `robots.txt` at the site root disallows every crawler, with
the ones that feed models named individually since not all of them honour the wildcard. The
render check fails a build that drops either. These are requests, not walls — a public URL
is public — so the link is shared, not published.

The wall, when one is wanted, is a password. Set `SITE_PASSWORD` on the `github-pages`
environment and the deploy job seals every page behind it before uploading: what Pages
serves is a small page that asks for the password and decrypts the real one in the browser
(AES-256-GCM, key from PBKDF2). A crawler, a cache or anyone without the password gets the
form and an opaque blob. Remove the secret and the next deploy publishes plainly. It is one
shared password, remembered per browser tab, changed only by deploying again — it keeps the
content from the public, not from a colleague who has moved on.

## What it costs to keep up to date

Measured against twelve weeks of FLEX: 10 commits a week, of which 22 files are ones the
model cites or the CDK app synthesises. Those are the only ones re-read, which is what
makes a weekly run cheap — `pnpm drift` turns 87 changed files into 22 worth reading.

| Run                                             | × / yr |   Tokens |
| ----------------------------------------------- | -----: | -------: |
| Weekly — nothing documented moved               |     21 |      40k |
| Weekly — a count drifts, and some prose with it |     23 |     110k |
| Weekly — one change lands across several claims |      8 |     250k |
| Quarterly — a sweep of `libs/` for new concepts |      4 |     200k |
|                                                 | **56** | **6.2M** |

At list prices with prompt caching, that is about **$20 a year on Sonnet and $95 on Opus**.
Sonnet weekly and Opus for the quarterly sweep costs roughly $35 and is the better split:
the weekly run is mechanical and the gates check it, while the sweep is a judgement about
whether a new concept deserves a box.

The sweep is what keeps the Components tab honest. A claim can only cite a file that
existed when it was written, so a new library or a whole new domain moves nothing cited and
derives no different count — 68% of changed library source over those twelve weeks was
invisible to the citation net. `pnpm drift` names those additions now, grouped under the
nearest place the model does cite from, which turns "you cannot know" into a short list;
the sweep is where you decide which of them deserve a box.

The mix of run types is an estimate. The commit rates, file counts and diff sizes are
measured, and the script that measured them is a `git log` away from being run again.

## Where the rest is

- [`AGENTS.md`](AGENTS.md) — the loop, the commands, the rules, CI, and how to add an
  architecture. Written for the agent; read it to understand the process.
- [`projects/README.md`](projects/README.md) — the model contract: what a project directory
  holds, the metadata every node carries, tab order, scope rules, every gate the build
  enforces, and how to start a model from nothing.
- [`projects/CANVAS.md`](projects/CANVAS.md) — the canvas design rules: how to lay out a
  view so it reads, and every geometry number the build and the render check enforce.
- [`projects/STATES.md`](projects/STATES.md) — proposing a change: how a planned state is
  authored, what it must cite, how the states compose, and the review loop through
  Confluence and back.
- [`explorer/README.md`](explorer/README.md) — the renderer, which knows about no project.
