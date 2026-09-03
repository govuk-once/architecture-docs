# Projects — the architectures this site documents

One directory per architecture. Everything in `projects/<id>/` belongs to that one
architecture; everything in [`../explorer/`](../explorer/) is the renderer, and knows about
none of them. This file is the contract for what goes in a project directory. **Read it
before changing a view** — whether you are a person or an agent working on someone's behalf.

```
projects/
  flex/
    project.config.json        what this architecture is called, and where its source is
    model/*.c4                 the diagrams, as a LikeC4 model — the source
    model/views.json           tab order, audience, reference tables
    model/resources.json       the inventory
    architecture-facts.json    derived from the source, committed
    architecture-source.json   the source commit those were derived from, committed
```

Each builds to `site/<id>/index.html`, with an index over them at `site/index.html`. The
built pages are gitignored, because a 410KB generated blob makes for meaningless diffs. CI
builds them and publishes `site/` to GitHub Pages on every merge to `main`; locally,
`pnpm serve` builds them for you.

`architecture-facts.json` **is** committed, at 24KB for FLEX, for two reasons: a config
change that moves the route counts becomes a reviewable diff, and the build validates the
diagram's own counts against it — 9 route/domain counts, 36 assertions across the four
stages. Add a route and forget the diagram, and the build tells you the row, the stage and
both numbers. The other 73 counts come from CDK code rather than domain config and are
still verified by hand.

## Adding a project

1. `projects/<id>/` with a `project.config.json` — copy FLEX's and rewrite it. `source`
   names the repository to document; `derive` is optional, and says which module in
   [`../scripts/derive/`](../scripts/derive/) turns that source into facts.
2. `projects/<id>/model/` with a `specification.c4`, a `.c4` per tab, `views.json` and
   whatever the inventory view reads.
3. Add `<id>` to `projects` in [`../explorer.config.json`](../explorer.config.json), and
   remove it from `planned` if it was there.
4. Add a checkout step for its repository to
   [`../.github/workflows/build.yml`](../.github/workflows/build.yml).

Nothing else changes. The build, the renderer, the checks, the export and the index all
read the config.

---

## The rule that matters most

**Never carry a claim forward on trust. Read the code that proves it, every time.**

A verification pass over an earlier draft checked 1,091 claims in this explorer against the
repository and found **80** wrong or misleading — including five asserted on six tabs each.
Every one of them looked plausible. Plausibility is not evidence.

So: when you write a fact, cite the file that proves it in that item's `code` array. When you
edit an existing fact, re-verify it against those files rather than assuming the last author
was right. This applies no matter who the last author was.

---

## Build

```bash
pnpm build
```

That runs two steps:

1. **`pnpm facts`** runs each project's declared derivation and writes that project's
   `architecture-facts.json`. FLEX's — [`scripts/derive/flex.ts`](../scripts/derive/flex.ts)
   — loads the domain and gateway configs, the same files the CDK app reads, for route
   counts per domain, per stage, per access tier, service gateway routes and resources, and
   the domain dependency graph. It also parses the alarm constructs for every CloudWatch
   alarm, its threshold, its evaluation windows and the topic it reaches. Alarms have no
   config to import, so they are read from the TypeScript AST — see
   [`scripts/lib/extractAlarms.ts`](../scripts/lib/extractAlarms.ts). Which files it reads
   are declared in the project's `derive.inputs`, not spelled out in the scripts. A project
   with no `derive` block simply has no generated facts.
2. **`scripts/buildArchitectureExplorer.ts`** validates each project's view files and
   assembles them with the styles, markup and renderer into `site/<id>/index.html`, then
   writes the index over them.

Step 1 is skipped when nothing it reads has moved: the FLEX commit, a hash of the deriving
scripts and a hash of the output are recorded in `../architecture-source.json`, and all three
have to still match. `pnpm facts --force` derives regardless, and CI always does. `pnpm drift`
turns the same recorded commit into the list of cited files that have changed since — the
claims worth re-reading.

### Never hand-write a number

If a count in a view disagrees with `architecture-facts.json`, **the view is wrong**. If the
generated file looks wrong, the config is the bug — not the diagram.

A resource row says where its own count comes from, with a `from` field beside the `n` it
governs — `"from": "totals.routeMethods.public"`, a dotted path into the generated facts.
The build resolves it and fails when the two disagree. Keeping the claim and its source in
the same object means a renamed or deleted row takes its mapping with it.

The same applies to the alarm table, which binds a column to the alarms parsed out of the CDK
constructs — see [_A table can be bound to the code_](#a-table-can-be-bound-to-the-code-not-just-cited).
Counts still read from CDK code by hand — keys, subnets, log groups — are not gated, so verify
those against the stack that creates them.

### The pipeline is deterministic

Authoring the model is a judgement step: it means reading the CDK stacks and configs to work
out what is true. Everything downstream — deriving facts, validating, assembling, rendering,
publishing — is ordinary TypeScript that runs the same way on any machine and in CI. Keep it
that way. Whatever helps you author the model, its output is a committed diff that gets
reviewed like any other.

---

## Layout

In a project directory:

| Path                   | What it is                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `model/*.c4`           | The diagrams, as a LikeC4 model. **This is the source** — see below                    |
| `model/views.json`     | Per-view presentation a LikeC4 view cannot hold: tab order, audience, reference tables |
| `model/resources.json` | The AWS inventory: 84 rows with per-stage counts. Not a diagram                        |
| `project.config.json`  | Everything specific to this architecture — see below                                   |

In [`../explorer/`](../explorer/), shared by every project:

| Path         | What it is                                                  |
| ------------ | ----------------------------------------------------------- |
| `theme.css`  | Colour, type and the reset. One definition, every page      |
| `styles.css` | The explorer's own layout: header, canvas, inspector        |
| `shell.html` | Page markup: header, canvas, inspector                      |
| `app.js`     | Renderer, edge routing, pan/zoom, inspector, stage selector |
| `icons.svg`  | AWS service icons as `<symbol>` defs — see below            |
| `index.html` | The frame of the index page over the projects               |
| `index.css`  | Its layout                                                  |

`scripts/` holds the pipeline; `scripts/lib/projects.ts` is the only place that knows where
a project's model, facts, checkout or built page live.

A page has to stay single-file: it is opened straight off disk and published as a shareable
artifact, and neither can fetch a sibling file.

---

## What belongs to this project

`project.config.json` holds everything true of one architecture rather than of the site or
of the renderer. The directory name is the id: it names the URL and prefixes exported files.

| Field              | What it does                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `name`             | Short name, on the index card                                                                                 |
| `title`, `tagline` | The browser tab and the header brand                                                                          |
| `blurb`            | One paragraph on the index card: what this architecture is                                                    |
| `repo`             | Base URL that every `code` citation links against                                                             |
| `inventoryView`    | Which view is the resource inventory — `resources` here                                                       |
| `iconLabel`        | Names the service-icon control, for readers and screen readers                                                |
| `filterHint`       | Placeholder in the Resources filter box                                                                       |
| `softBudget`       | How much soft geometry the render check allows this project — a ratchet, zero if unset                        |
| `kinds`            | The ownership kinds: `id`, `label`, and the palette `colour` each uses                                        |
| `stages`           | The stage selector: `id`, `label`, and `facts` — the name the same stage goes by in `architecture-facts.json` |
| `source`           | `repo`, `ref` and `root`: the repository this documents and where its checkout lands                          |
| `derive`           | Optional. `module` in `scripts/derive/`, and the `inputs` it reads. No block, no facts                        |

Nothing about presentation is in here — colours live in `theme.css` — and nothing that
duplicates a view: a resource's `from` sits on the resource. The build validates the file
and refuses to assemble a page from a broken one.

The site's own config, [`../explorer.config.json`](../explorer.config.json), holds only what
is true of the whole site: its title and blurb, where the site is assembled, which projects
it publishes, and which it lists as planned but not yet documented.

---

## The model is LikeC4

The diagrams are a [LikeC4](https://likec4.dev) model — a text DSL for C4-style
architecture. That was chosen so the source is a standard someone else's tools can read,
rather than a schema invented here.

```
network_authfn = platform 'Authorizer Lambda' {
  #request-path
  description 'egress tier · 10s timeout'
  technology 'FlexPrivateEgressFunction · NODEJS_24_X'
  link https://github.com/govuk-once/flex/blob/main/…/platform.ts 'stacks/platform.ts'
  metadata {
    role  'Verifies the Cognito access token in front of every public route.'
    facts [ 'It is in this tier because it fetches the JWKS over the public internet…' ]
    x '486'  y '400'  w '200'  h '62'
    ownership 'flex'
    awsIcon 'lambda'
  }
}
```

Everything above `metadata` is standard LikeC4 and any renderer understands it. Everything
inside `metadata` is ours, and every other renderer ignores it. That gives three levels of
fidelity from one file:

| Where it is read                                  | What comes out                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `likec4 codegen mermaid \| plantuml \| dot \| d2` | boxes, arrows, labels — flattened, no boundaries                         |
| `likec4 start`                                    | the full model with nesting, links and its own auto-layout               |
| This explorer                                     | all of that, plus facts, citations, hand-placed layout, counts and icons |

The build reads the model **in process** with `LikeC4.fromWorkspace`. Nothing is generated
to disk in between: a derived JSON would either be committed and drift, or be gitignored
and so never reviewed.

### What the metadata holds

Nineteen keys, and nothing else. Anything not in this table is a mistake.

| Key                         | On                   | What it does                                                                                                                           |
| --------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `x` `y` `w` `h`             | elements, boundaries | Hand-placed position and size. The layout is composed, not derived — LikeC4 auto-layouts and ignores these                             |
| `sourceId`                  | elements, boundaries | The id the explorer uses. LikeC4 identifiers are workspace-global and scoped per view, so `network_authfn` carries `sourceId 'authfn'` |
| `order`                     | everything           | The authored sequence. The model returns elements in its own order; this restores ours                                                 |
| `ownership`                 | elements             | Which `kind` from `project.config.json` — the colour and legend entry                                                                  |
| `boundary`                  | boundaries           | `hard` for a real edge (a region, the VPC), `soft` for visual grouping                                                                 |
| `awsIcon`                   | elements             | Overrides the icon derived from `type`. Named `awsIcon` because `icon` is reserved in the DSL                                          |
| `resources`                 | elements, boundaries | Ids from `resources.json` that this box contains — the count badge and the drill-down                                                  |
| `type` `tech` `role`        | elements, boundaries | The inspector's Type, Technology and description lines                                                                                 |
| `protocol` `auth` `carries` | relationships        | What a line carries and how it is authenticated                                                                                        |
| `edgeStyle` `edgeDir`       | relationships        | Dashed lines and double-headed arrows                                                                                                  |
| `facts`                     | everything           | The verified claims. An array, and the substance of the whole thing                                                                    |

### Five things the DSL will not let you do

Each of these was learned by the parser rejecting it:

- **Tags go inside the element body**, not on the declaration line.
- **`link` is a bare statement**, never wrapped in a `links { }` block.
- **Array literals reject a trailing comma.**
- **`icon` is reserved** — hence `awsIcon`.
- **`specification` is workspace-wide**, so it lives once in `specification.c4`.

And one that bites silently: **a one-element array is read back as a plain string**.
`facts [ 'only one' ]` returns `"only one"`, not `["only one"]`. The reader widens it back;
anything else consuming the model must do the same.

### Why identifiers are scoped per view

LikeC4 element identifiers are global to the workspace, so `containers_pubapi` and
`network_pubapi` are deliberately different elements. Fifteen ids appear in more than one
view and **every one carries a different label, description and set of facts** — the
authorizer is "Authorizer Lambda" on Containers, "6. Authorizer" on Request path and
"Cognito token authorizer" on Security, because each tab argues something different. One
pair is not even the same thing: `cli` is the Ink TUI on Delivery and a REST client factory
on Components.

These are not seven views of one model. They are seven models, and pretending otherwise
would either flatten the per-tab framing or silently merge two unrelated boxes.

## The element contract

Every element carries two orthogonal properties, and the build refuses a file that gets
them wrong.

**`ownership`** is who owns it — the thing a reader must not get wrong. The set is declared
in each `project.config.json`; these are FLEX's:

| `ownership` | Meaning                                                        |
| ----------- | -------------------------------------------------------------- |
| `person`    | A human role                                                   |
| `flex`      | Owned by the FLEX platform                                     |
| `govuk`     | Inside the GOV.UK Once boundary                                |
| `third`     | Outside it — another government organisation, or a third party |

**Plane** is whether it serves live traffic, carried by the `#request-path` and
`#off-request-path` tags. Ownership is carried by colour, plane by border style, so the two
never compete.

The legend reads _on the request path_ and _off the request path_, deliberately. The tag is
not a claim that these things are a control plane in the AWS sense: it also covers source
files, naming conventions, runbooks, observability and people. All thirty-nine boxes on
Delivery are off the request path, two of them human.

Each ownership colour is a `--legend-<colour>` token in `theme.css`, beside every other
theme token, because colour is presentation. The rules that use it are generic: the
renderer sets `--kind` on each node, so adding a kind means adding one token in the three
theme blocks and nothing else. The build fails if a kind has no colour, if a colour is
missing from a theme block, if a token outlives the kind it was for, or if two kinds share
one colour.

### Tab order and grouping

`order` sets the position; `group` labels the section it sits in. The build rejects a missing
group, and rejects a group split across non-adjacent tabs.

The order is by **what a reader must already know**, not by size:

| Group         | Tabs                                          | Why here                                                                                             |
| ------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Architecture  | Context, Request path, Containers, Components | The C4 zoom ladder. Request path sits second because it introduces the vocabulary Containers assumes |
| Cross-cutting | Network, Security, Delivery                   | Each cuts across every container; all three assume you have read Containers                          |
| Reference     | Resources                                     | Lookup, and the drill-down target for every badge                                                    |

Size order would put Security third (16 boxes) ahead of Containers (21) — but Security
describes controls layered on containers you have not met yet. Dependency beats complexity.

### Every tab says who it is for

Each view file carries an `audience` string, shown next to the tab's blurb. The build refuses
a view without one. It exists so a reader can skip six tabs: a domain engineer needs
Components, an on-call engineer needs Request path and Delivery, an assurance reviewer needs
Security. Keep it to one line naming a role, not a description of the content.

Zones set `hard: true` for a real boundary (a region, the VPC, an ownership edge) and
`hard: false` for a visual grouping.

### AWS service icons

Most boxes need nothing. A node whose `d.type` is a CloudFormation type —
`AWS::Lambda::Function`, `AWS::WAFv2::WebACL` — picks up the right icon on its own. That
is how the Security tab got all fourteen of its icons without a single edit.

Set `"icon": "lambda"` explicitly only where the type is not a CloudFormation string. The
Containers domain boxes are the case: their type reads `Container group · one Lambda per
route`, which no mapping can resolve, so they name the icon. An explicit `icon` always
wins over the derived one.

The mapping from CloudFormation namespace to icon lives in `SERVICE_ICON` in
`buildArchitectureExplorer.ts`, with `TYPE_ICON` overriding it for full types AWS draws
distinctly — `AWS::EC2::NatGateway` gets the NAT gateway icon rather than the generic VPC
one. It is defined in the build, not the renderer, so the unused-symbol check below sees
exactly what the page sees.

Icons appear in four places, all on the one **AWS icons** control in the header: the
diagram boxes, the Technology line of a node's panel, the Resource line of a resource's
panel, and the rows of the Resources tab. Off by default, remembered per viewer.

Placement is deliberate: the icon rides a box's **top-left corner**, mirroring the count
badge opposite. Riding the corner keeps it clear of the label, so turning icons on never
reflows text and cannot invalidate a box width.

**The icons themselves.** `icons.svg` holds every icon as a `<symbol id="i-<service>">`.
The build inlines it whole, because the page has to stay self-contained: `<use>` cannot
reach a separate file from a `file://` page, and an external reference would not survive
being published as a standalone artifact. A raster sprite is not an option either — the
page pans and zooms, and icons would blur exactly when someone is trying to read them.

The file's header records where the artwork came from: the source URL, the package
filename, and the path of every icon inside it. Each symbol is the icon's own artwork with
the XML declaration, outer `<svg>` and `<title>` dropped, and internal `id` attributes
removed because they collide once every icon shares one document. No geometry is changed.
**Adding to it means accepting AWS's terms for this repository — read them first.**

The build enforces both directions: an `icon` naming a symbol that does not exist fails,
and a symbol nothing uses fails. "Uses" counts explicit `icon` fields _and_ every type
that maps to one, across nodes, zones, edges and resource items — so an icon that only the
Resources tab needs still counts as used.

Two tabs carry no icons on purpose. **Components** describes code — `domain.config.ts`,
the Middy stack, `lookupRoute` — and not one of its boxes is an AWS service. **Context** is
the business view for non-engineers, where a single AWS logo among seven business systems
would read as an accident.

### Light and dark

Both palettes are defined in `theme.css`, and the page follows the reader's system
setting by default. The **theme control** in the header cycles system → light → dark →
system: three states rather than two, because someone who overrides the theme needs a way
back to following the system. The choice is remembered per viewer.

The dark palette is a real design, not an inversion — the kind colours have separate dark
values chosen to hold their contrast on a dark ground. If you add a colour to the palette,
give it both.

### Saving a diagram

**Save PNG** in the header writes the whole diagram at twice its natural size, named for
the view and the selected stage — `flex-containers-prod.png`. It exports everything, not
the current viewport, so pan and zoom do not matter. Icons, count badges, edge labels and
zone labels all come with it. The control hides on the Resources tab, which has no canvas.

Two limits worth knowing. Rasterising through a canvas cannot fetch webfonts, so on a
machine without IBM Plex installed the text falls back to a system face — it should still
fit, because boxes are sized for the widest metrics with slack, but it will not look
identical. And the artifact viewer blocks any download a page starts itself, so the button
is inert there; from Pages, `file://` and a local server it works.

### Placeholders, not angle brackets

Write `{stage}`, `{domain}`, `{version}`, `{proxy+}` — **never** `<stage>`. Fact text is
rendered as HTML so that `<b>` and `<code>` work, which means a literal `<stage>` is parsed
as an unknown element and silently disappears. The build fails on any other angle bracket.

### The JSON is linted like any other file

`model/views.json` and `model/resources.json` are committed files, and eslint checks JSON repo-wide with
`prettier/prettier` and `json/no-duplicate-keys`. A view that is valid JSON but badly
formatted still fails.

`pnpm build` checks the formatting itself, so you find out immediately rather
than in CI. When it complains:

```bash
pnpm exec eslint --fix projects/<id>/model/<file>.json
```

Two rules that follow from this, and matter if you are generating JSON rather than typing it:

- **Never hand-format.** Prettier collapses short arrays onto one line and has its own
  indent rules; a file written by `JSON.stringify(x, null, 2)` or by hand will not match.
  Write the file however you like, then run the `--fix` above before building.
- **`architecture-facts.json` formats itself.** The facts step runs its output
  through prettier before writing, so the committed file is lint-clean by construction.
  If you change what it emits, keep that.

---

## Scope discipline

Each tab has one job. When adding something, ask what kind of thing it is:

- **Context** — runtime only. No build, deploy or ops.
- **Containers** — things separately deployable, runnable or storable. A Web ACL is policy
  attached to a container, not a container; the VPC is network. Their effect belongs as a
  fact on the box they guard.
- **Network / Security / Delivery** — the concerns that cut across every container.
- **Resources** — the inventory, and the drill-down target for every badge.

If a fact belongs to two tabs, one owns it and the other references it. Duplicated facts
drift; several already had.

### Reference tables

A diagram view may carry a `tables` array. They render in a strip under the drawing,
**collapsed by default** — the diagram is the point, the tables are the drill-down. Opening
one is remembered while you move between tabs.

Use a table when something is genuinely tabular and would be a poor diagram: rule numbers,
retention periods, derivations, an error contract. Do not start a parallel markdown document
for it — the C4 levels, AWS inventory, request sequences and deployment topology were retired
precisely because they became second copies of these tabs and drifted.

#### Every table cites the code it came from

A table is transcribed from the repository by hand, so on its own it is a claim with nothing
behind it. `code` is therefore **required**: an array of `[label, path]` pairs naming the files
the rows were read from, rendered as links under the table and checked to exist. A table with no
`code`, or one citing a file that has moved, fails the build — a dead citation is worse than
none, because it still looks like provenance.

```json
{
  "name": "What the sanitiser removes before a log is written",
  "code": [
    ["sanitizer.ts", "libs/logging/src/sanitizer.ts"],
    ["@flex/logging", "libs/logging/src/index.ts"]
  ],
  "cols": ["Field", "Rule", "Where"],
  "rows": [["…", "…", "…"]]
}
```

#### A table can be bound to the code, not just cited

Citing proves where a row came from; it does not notice when that source changes. A table whose
rows correspond one-to-one with something derivable adds `derived`, which ties one column to an
array in `architecture-facts.json`:

```json
"derived": { "from": "alarms", "key": "id", "col": "Alarm" }
```

The build then compares the values in that column against `facts[from].map(x => x[key])` and
fails when they disagree, naming what was added or removed. The alarm table uses this: the 18
rows are held against the 18 alarms parsed out of the CDK constructs, so renaming an alarm in
`constructs/alarms/` breaks the docs build until the table is updated. Bind a table this way
whenever the underlying list is machine-readable — prose columns stay hand-written and readable,
while the identities stay honest.

---

## What the build checks

`pnpm build` exits non-zero on:

- a view file that is not valid JSON, not prettier-formatted, or sharing an `id` with another
- an `icon` with no matching symbol in `icons.svg`, or a symbol nothing uses
- a raw `<` or `>` in any string
- an unknown `kind` or `plane`, or a node narrower than 176px
- two node boxes overlapping, or a node straddling a zone edge
- text that will not fit its box
- an edge referencing a node that does not exist
- a `placement` entry naming a resource id that is not in `model/resources.json`
- a resource that no diagram places, so nothing links to it
- a derived count that disagrees with `architecture-facts.json`
- a reference table with no `code` citation, or one citing a file that does not exist
- a `derived` table whose bound column disagrees with the facts it is bound to

Pass `--lenient` to report problems without failing, while iterating.

## Checking it renders

`pnpm build` validates the data. `pnpm check` renders the built page
in Chromium, light and dark, and measures what static validation cannot see — whether text
fits, whether a line clips a box it has nothing to do with, whether two labels overlap,
whether every clickable thing opens a populated panel, and whether the audience line survives
a selection.

It splits results in two:

- **Hard** — text that does not fit, a target opening an empty panel, a tab that lost its
  audience, any console error. Always a defect, always fails.
- **Soft** — a line clipping an unrelated box, a label on a box, two labels touching. A
  handful are unavoidable on the dense views. `SOFT_BUDGET` in the script is a ratchet: it
  may fall, never rise.

The browser binary is not in the lockfile, so on a clean machine:

```bash
pnpm exec playwright install chromium
```

---

## Changing a diagram

1. Edit the relevant `model/*.c4`. That is the source; everything else is machinery.
2. `pnpm exec likec4 validate projects/<id>/model` —
   the parser is specific about what it rejects, and faster than a full build.
3. `pnpm build` — fix whatever it reports. It fails, it does not warn.
4. `pnpm check` for what static validation cannot see.
5. Open the page and check it reads well.
6. Cite the code for any claim you added or changed, as a `link` on that element.

```bash
# see the same model through LikeC4's own renderer
pnpm exec likec4 start projects/<id>/model

# open the built page
open site/flex/index.html

# emit the same page without the html/head/body wrapper, for publishing as an artifact
pnpm build --body /tmp/explorer-body.html
```

Tab order, audience and reference tables are in `model/views.json`, not the `.c4` — a
LikeC4 `view` has no metadata block. The inventory is `model/resources.json`, because 84
rows with per-stage counts is a table, not a view of a model.

## What a second architecture actually costs

The build, the renderer, the checks, the export and the index know nothing about any
project. Adding one is these things and nothing else:

1. **`projects/<id>/project.config.json`** — name, blurb, kinds, stages, repo URL, and the
   `source` block naming the repository to document and where its checkout lands.
2. **`projects/<id>/model/*.c4`** — your content, as a LikeC4 model. This is the work, and
   the part that has to be checked against code rather than assumed. Everything downstream
   of it is deterministic.
3. **A `--legend-<colour>` token in `theme.css`** for any colour your kinds name that is
   not already there, in all three theme blocks. The build tells you if you miss one.
4. **A derivation, or none.** `scripts/derive/flex.ts` cannot be reused as-is: it reads
   `domains/*/domain.config.ts` with FLEX's exact schema, which is the point — counts are
   trustworthy because they come from the same files the CDK app reads. `extractAlarms.ts`
   is closer to portable, parsing CDK constructs from the AST with no install needed, but
   still knows what a CloudWatch alarm looks like. Write your own module beside it against
   your own configs, or declare no `derive` block at all, leave `from` off every resource
   and `derived` off every table, and maintain those numbers by hand.
5. **A checkout step in `.github/workflows/build.yml`**, because a workflow cannot loop
   `actions/checkout` and a private repository needs its own token.
6. **A line in `../explorer.config.json`** — the `projects` array, which is also the order
   the index lists them in.

`icons.svg` is shared, and the build fails on a symbol nothing references, so a project
that needs a new service icon adds it there.

What you do not touch: `buildArchitectureExplorer.ts` beyond its `SERVICE_ICON` map,
`checkArchitectureExplorer.ts`, `serveArchitectureDocs.ts`, `app.js`, `theme.css` beyond a
token, or `styles.css`.

---

## Known defects the diagrams must not paper over

These are real and unfixed in the code. If you touch a tab that shows one, keep the
statement — do not quietly reword around it.

- The cross-region alarm relay has a syntax error in an inline handler, so every us-east-1
  edge alarm reaches nobody.
- `SmokeTestAlarm` has no alarm action.
- `local-council` declares gateway integrations to routes the udp gateway does not serve;
  `validate-integrations` only checks `type: "domain"`.
- No internal call path retries — `retryAttempts` is not in the integration schema.
- The Lambda environment CMK is read in a way that fails at deploy rather than synth.
