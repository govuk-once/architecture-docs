# FLEX Architecture

The architecture of **FLEX** documented as one interactive page, built from versioned source
in [`explorer/`](explorer/) and derived from the FLEX code itself rather than from prior
design documents.

FLEX lives in a separate repository. This one holds the model, the pipeline that renders it,
and the checks that keep it honest; it reads the FLEX source and never writes to it.

---

## View it

Published to GitHub Pages on every merge to `main`. To read it locally, this repository
pulls the source it documents for you:

```bash
pnpm install
pnpm sync              # clone or fetch FLEX into .sources/, and install it
pnpm serve             # builds, then serves http://localhost:4321
pnpm clean             # remove the checkout when you are done
```

The checkout under `.sources/` is disposable: gitignored, hard-reset on every sync so it can
never carry local edits, and never written to.

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
pnpm facts     # derive counts from the domain and gateway configs, and the alarms
pnpm build     # facts + validate every view + assemble the site
pnpm check     # render in headless Chromium and check the geometry
```

`build` runs the facts step first, so it is the only one you normally need. It writes
`site/`, which is generated and gitignored — CI builds it and publishes from there.
`architecture-facts.json` **is** committed, so a change in FLEX that moves the route counts
shows up here as a reviewable diff.

### It reads FLEX through one declared contract

Everything this repository reads from FLEX is declared in one place, the `source` block of
[`explorer/explorer.config.json`](explorer/explorer.config.json), alongside `site`, which
says where the built page is assembled:

```json
"source": {
  "repo": "git@github.com:govuk-once/flex.git",
  "ref": "main",
  "root": ".sources/flex",
  "domainConfigs": "domains/*/domain.config.ts",
  "gatewayConfigs": "platform/domains/*/gateway.config.ts",
  "alarmConstructs": "platform/infra/flex/src/constructs/alarms"
},
"site": { "root": "site", "page": "index.html" }
```

`repo` and `ref` are what `pnpm sync` clones; `root` is where it lands. Nothing else knows
those paths: every read resolves through [`scripts/lib/paths.ts`](scripts/lib/paths.ts), which
turns the two blocks into three roots — this repository, the built site, and the checkout being
documented. Build without syncing first and the error names the fix rather than quietly
producing an empty page. CI checks FLEX out to that same path, so there is no second opinion
about where it lives.

One asymmetry is worth knowing. The domain and gateway configs are **imported** as modules —
they are the same files the CDK app reads — so the checkout needs its own dependencies
installed, which `pnpm sync` does. The alarm constructs are read as text and parsed, so they
need nothing.

Documenting a second repository — UDP, UNS — means turning `source` into a list and adding an
index page over the projects. [`AGENTS.md`](AGENTS.md) sets out what that involves and why it
is not worth doing before there is a second repository.

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

The diagrams are a [LikeC4](https://likec4.dev) model in [`explorer/model/`](explorer/model/)
— one `.c4` file per tab. Edit those. Never edit the built page; it is generated and
overwritten.

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

Read **[`explorer/README.md`](explorer/README.md)**. It is the contract: the node properties,
the tab-order rationale, the scope rules that keep a fact on exactly one tab, every gate the
build enforces, and the known code defects the diagrams must not paper over. It leads with the
rule that matters most:

> **Never carry a claim forward on trust.** Read the code that proves it, every time.

That rule was earned. A verification pass over an earlier draft checked 1,091 claims against
the repository and found **80** wrong or misleading — five of them repeated across six tabs
each. Every one looked plausible.

So every claim names the files that prove it: elements and relationships carry LikeC4 `link`
statements, and reference tables carry a `code` array. When you change a fact, re-verify it
against those files rather than trusting the previous author.

---

## CI

[`.github/workflows/build.yml`](.github/workflows/build.yml) checks out FLEX beside this
repository, rebuilds, and fails if the committed `architecture-facts.json` no longer matches.
On a pull request that means someone changed the model without rebuilding; on the scheduled
weekday run it means FLEX moved and these docs have not caught up. It then runs the render
check, lint, typecheck and tests, and publishes `site/` to Pages from `main`.

> Pages must be configured with **Source: GitHub Actions**, not a branch — `site/` is
> gitignored, so a branch-based build would publish nothing.
>
> No token is needed while FLEX is public. If it is ever made private, the checkout step
> needs one with `Contents: read` on it; the default `GITHUB_TOKEN` is scoped to this
> repository alone and cannot read another.
