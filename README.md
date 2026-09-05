# GOV.UK Once architecture

**→ [govuk-once.github.io/architecture-docs](https://govuk-once.github.io/architecture-docs/)**

The architectures of the GOV.UK Once platforms, each documented as one interactive page and
derived from that platform's own code rather than from prior design documents.

| Architecture        | State                                                |
| ------------------- | ---------------------------------------------------- |
| **FLEX** — `/flex/` | Documented, nine tabs, rebuilt on every merge        |
| **UDP**, **UNS**    | Planned. Listed on the index, nothing read from them |

Each lives in a separate repository. This one holds the models, the pipeline that renders
them, and the checks that keep them honest; it reads those repositories and never writes to
them.

## FLEX

Nine tabs, in three groups. Every box, line and zone is clickable; resource counts update
when you switch stage.

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
- **For a new project**: a checkout step in `.github/workflows/build.yml`, a token if the
  repository is private, and Pages set to the GitHub Actions source. Everything else is
  config the agent writes.

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

The sweep is not optional. `pnpm drift` reports files the model already cites and anything
under the CDK app — a new library concept is in neither, so nothing will tell you the
Components tab has quietly gone incomplete. Over those twelve weeks, 68% of changed library
source files were invisible to it.

The mix of run types is an estimate. The commit rates, file counts and diff sizes are
measured, and the script that measured them is a `git log` away from being run again.

## Where the rest is

- [`AGENTS.md`](AGENTS.md) — the loop, the commands, the rules, CI, and how to add an
  architecture. Written for the agent; read it to understand the process.
- [`projects/README.md`](projects/README.md) — the model contract: what a project directory
  holds, the metadata every node carries, tab order, scope rules, every gate the build
  enforces, and how to start a model from nothing.
- [`explorer/README.md`](explorer/README.md) — the renderer, which knows about no project.
