# GOV.UK Once architecture

**→ [govuk-once.github.io/architecture-docs](https://govuk-once.github.io/architecture-docs/)**

The architectures of the GOV.UK Once platforms, each documented as one interactive page and
derived from that platform's own code rather than from prior design documents.

| Architecture        | State                                                |
| ------------------- | ---------------------------------------------------- |
| **FLEX** — `/flex/` | Documented, eight tabs, rebuilt on every merge       |
| **UDP**, **UNS**    | Planned. Listed on the index, nothing read from them |

Each lives in a separate repository. This one holds the models, the pipeline that renders
them, and the checks that keep them honest; it reads those repositories and never writes to
them.

---

## View it

Published to **[govuk-once.github.io/architecture-docs](https://govuk-once.github.io/architecture-docs/)**
on every merge to `main`: an index of the architectures, and one page each. To read it
locally, this repository pulls the sources it documents for you:

```bash
pnpm install
pnpm sync              # clone or fetch each source into .sources/, installing if deps moved
pnpm serve             # builds, then serves http://localhost:4321
pnpm drift             # what has moved in each source since these docs were built from it
pnpm clean             # remove the checkouts when you are done
```

Every command takes an optional project — `pnpm sync flex`, `pnpm build flex` — and acts on
all of them when you give none.

The checkouts under `.sources/` are disposable: gitignored, hard-reset on every sync so they
can never carry local edits, and never written to.

## FLEX

Eight tabs, in three groups. Every box, line and zone is clickable; resource counts update
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

---

## Build it

```bash
pnpm facts     # run each project's declared derivation over its source
pnpm build     # facts + validate every view + assemble every page and the index
pnpm check     # render in headless Chromium and check the geometry
```

`build` runs the facts step first, so it is the only one you normally need. It writes
`site/`, which is generated and gitignored — CI builds it and publishes from there. Each
project's `architecture-facts.json` **is** committed, so a change in its source that moves
the route counts shows up here as a reviewable diff.

### One renderer, one directory per architecture

```
explorer/              the renderer, and the index page. Knows about no project
projects/flex/         one architecture: its config, model, facts and source commit
explorer.config.json   the site: which projects it publishes, and which are planned
scripts/derive/flex.ts how FLEX's counts are derived — the one unshareable part
```

Adding an architecture is a directory under `projects/`, a line in `explorer.config.json`
and a checkout step in CI. No script learns anything new, because
[`scripts/lib/projects.ts`](scripts/lib/projects.ts) is the only place that resolves where a
project's model, facts, checkout or built page live.
[`projects/README.md`](projects/README.md) sets out what a project directory contains and
what a second one actually costs.

### It redoes only the work FLEX has actually made stale

Every build records the source commit it read, in each project's
`architecture-source.json` beside its facts:

```json
{
  "sha": "e52ee3e541a65c9368ccd36bdd18ebd5c53f2f3b",
  "subject": "FLEX-483 docs: rewrite gateways and test fixtures (#502)",
  "builtFrom": "domains/*/domain.config.ts, platform/domains/*/gateway.config.ts, …",
  "derivation": "e61681ef74f67cd2",
  "facts": "78ae7c1e09529b84"
}
```

That commit is what the next run measures against, and it buys two things:

- **`pnpm facts` re-reads nothing when nothing moved.** The skip needs the commit, the
  scripts that do the deriving, _and_ the facts file itself to all be unchanged — so
  editing `extractAlarms.ts`, or hand-editing a number into the output, re-derives rather
  than going quietly stale. `pnpm facts --force` derives regardless, and CI always does.
- **`pnpm sync` reinstalls a checkout only when that source's dependencies moved.** The
  install is the slow part of a sync and most commits touch no manifest; when one in the
  range does, it installs and says which. `pnpm sync --install` forces it.

It also makes the range explicit, which is the part no gate can do for you:

```bash
pnpm drift
```

`drift` lists the commits since the recorded one, which of them touch a config the counts
are derived from, and — the useful part — which of the files the explorer **cites** are
among them, naming every claim that rests on each. It never fails a build; it is a reading
list. Where nothing cited moved it says so, and says plainly that this is not proof the
prose is still true.

Run it **before** `pnpm build`, which advances the recorded commit as soon as it
re-derives. If a build has already run, the range is still there to ask about:
`pnpm drift flex --since <sha>` takes any commit, and because the file is committed,
`git log -p projects/flex/architecture-source.json` holds every commit that project has
been built from.

The commit is kept out of `architecture-facts.json` on purpose. That file is the drift
gate, and CI fails when a rebuild changes it; a commit hash folded into it would fire that
gate on every commit over there, including the many that change nothing here — which trains
everyone to ignore it.

### It reads FLEX through one declared contract

Everything a project reads from its source is declared in that project's
`project.config.json` — generically in `source`, and specifically in `derive`:

```json
"source": {
  "repo": "git@github.com:govuk-once/flex.git",
  "ref": "main",
  "root": ".sources/flex"
},
"derive": {
  "module": "flex",
  "inputs": {
    "domainConfigs": "domains/*/domain.config.ts",
    "gatewayConfigs": "platform/domains/*/gateway.config.ts",
    "alarmConstructs": "platform/infra/flex/src/constructs/alarms"
  }
}
```

`source` is the same three fields for every project: `repo` and `ref` are what `pnpm sync`
clones, `root` is where it lands. `derive` is not — it names a module in
[`scripts/derive/`](scripts/derive/) and hands it whatever inputs that module declares, so
FLEX's three globs are FLEX's business and another project's derivation can want something
else entirely, or nothing at all.

Nothing else knows those paths: every read resolves through
[`scripts/lib/projects.ts`](scripts/lib/projects.ts). Build without syncing first and the
error names the project and the fix rather than quietly producing an empty page. CI checks
each source out to that same path, so there is no second opinion about where it lives.

One asymmetry is worth knowing. FLEX's domain and gateway configs are **imported** as
modules — they are the same files the CDK app reads — so its checkout needs its own
dependencies installed, which `pnpm sync` does. Its alarm constructs are read as text and
parsed, so they need nothing.

### What the build refuses to produce

The build fails rather than emitting a page with a known defect: label text overflowing its
box, boxes overlapping or straddling a zone edge, an edge pointing at a node that does not
exist, a view with no stated audience, a raw `<` that would silently swallow the rest of a
label, a reference table with no source citation, a citation pointing at a file that no longer
exists, an alarm table that no longer matches the CDK constructs, and a route or domain count
that disagrees with the generated facts.

Those last few are the anti-drift gates. Add a route to a domain in FLEX, forget the diagram,
and the build names the row, the stage, the number claimed and the number the configs actually
say. Rename an alarm in `constructs/alarms/` and the Delivery table fails until it agrees. It
covers the ten route and domain counts read from the configs and all eighteen CloudWatch
alarms; counts still read from CDK code by hand — keys, subnets, endpoints — are not gated, so
they are verified by reading the stacks.

Every reference table also names the files it was transcribed from, and the build fails on a
citation pointing at a file that has moved.

---

## Change it

The diagrams are a [LikeC4](https://likec4.dev) model in
[`projects/flex/model/`](projects/flex/model/) — one `.c4` file per tab. Edit those. Never
edit the built page; it is generated and overwritten.

The model is a standard, so the same file gives three levels of detail: a plain C4 tool gets
boxes and arrows via `likec4 codegen`, `likec4 start` gets the full model with its own layout,
and this explorer adds the verified facts, hand-placed layout and per-stage counts it keeps in
`metadata`.

Authoring that model is the one step that is not automated, and deliberately so. It is the
step that requires reading the CDK stacks, the domain configs and the SDK to work out what is
actually true — judgement, not transformation. Everything downstream of it is deterministic
TypeScript that runs the same way on any machine and in CI.

| Step                           | Automated?                       |
| ------------------------------ | -------------------------------- |
| Author and verify the model    | No — this is the judgement step  |
| Derive counts from the configs | `pnpm facts` — locally and in CI |
| Validate and assemble the page | `pnpm build` — locally and in CI |
| Render and check the geometry  | `pnpm check` — locally and in CI |
| Publish to Pages               | `actions/deploy-pages` — CI only |

### Before you change a view

Read **[`projects/README.md`](projects/README.md)**. It is the contract: what a project
directory holds, the node properties, the tab-order rationale, the scope rules that keep a
fact on exactly one tab, every gate the build enforces, and the known code defects the
diagrams must not paper over. It leads with the rule that matters most:

> **Never carry a claim forward on trust.** Read the code that proves it, every time.

That rule was earned. A verification pass over an earlier draft checked 1,091 claims against
the repository and found **80** wrong or misleading — five of them repeated across six tabs
each. Every one looked plausible.

So every claim names the files that prove it: elements and relationships carry LikeC4 `link`
statements, and reference tables carry a `code` array. When you change a fact, re-verify it
against those files rather than trusting the previous author.

---

## CI

[`.github/workflows/build.yml`](.github/workflows/build.yml) checks each documented source
out beside this repository, rebuilds — never from the recorded state, always from the
configs themselves — and fails if any committed `architecture-facts.json` no longer matches.
On a pull request that means someone changed a model without rebuilding; on the scheduled
weekday run it means a source moved and these docs have not caught up. It then prints the
`pnpm drift` reading list without failing on it, runs the render check, lint, typecheck and
tests, and publishes `site/` to Pages from `main`.

There is one checkout step per project, written out rather than generated: a workflow cannot
loop `actions/checkout`, and a private source needs its own token. Adding a project means
adding one.

> Pages must be configured with **Source: GitHub Actions**, not a branch — `site/` is
> gitignored, so a branch-based build would publish nothing.
>
> No token is needed while FLEX is public. If it is ever made private, the checkout step
> needs one with `Contents: read` on it; the default `GITHUB_TOKEN` is scoped to this
> repository alone and cannot read another.
