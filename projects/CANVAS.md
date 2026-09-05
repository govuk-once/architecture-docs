# Canvas design rules

How to lay out a view so it reads, and so the build accepts it. Read this before placing a
box. It exists because the first draft of a 25-box whole-picture view had seven crossings
and three lines arcing over the top of the canvas, and every one of them came from a
placement decision, not from the content.

The build measures geometry twice: statically in `pnpm build`, which refuses the page, and
in a browser in `pnpm check`, which counts what only rendering can see. The numbers below
are those gates.

## What the build refuses

| Rule                                  | Number                              | Why                                                      |
| ------------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| Minimum box width                     | 176                                 | Anything narrower cannot hold a label and a badge        |
| Label fits                            | characters × 7.0 ≤ width − 22       | IBM Plex Sans 13px on Linux Chromium, the wider platform |
| Sub-label fits                        | characters × 6.7 ≤ width − 22       | IBM Plex Mono 10.5px, fixed advance                      |
| Zone label fits                       | characters × 8.32 ≤ zone width − 22 | Mono 11px with 0.12em tracking                           |
| Boxes never overlap                   | exact rectangles                    |                                                          |
| A box never straddles a zone edge     | fully inside or fully outside       | Containment is the claim a zone makes                    |
| Every edge names two existing boxes   |                                     |                                                          |
| Every box has `ownership`             | one of the project's `kinds`        | Who owns a box is the thing a reader must not get wrong  |
| Every view has `group` and `audience` |                                     |                                                          |

Widths that work: 176 fits a 22-character label; 200 fits 25; 262 fits 34; 282 fits 37;
330 fits 44. Write the sub-label to the box, not the box to the sub-label — a sub is one
qualifier, not a sentence.

## What the render check counts

Soft geometry: a line clipping a box it does not connect, a label sitting on a box, two
labels touching. `softBudget` in the project's config is a ratchet: it may fall, never
rise, and when the check reports fewer than the budget, lower the budget to lock it in.
Zero is achievable on a 29-box view and is the target; a budget above zero is a debt with
a reason in the commit.

## Rules for placement

1. **Flow runs top to bottom.** The caller at the top, the edge below it, ingress below
   that, the internals below that, the parties reached at the bottom or the side. A line
   that has to go up is a placement error unless it is a return path.

2. **Connected boxes are adjacent.** For every edge, ask what sits between its two ends.
   The answer must be nothing. If a third box is in the way, move the third box.

3. **An edge's endpoints share a column or a row.** Vertical or horizontal, never a
   diagonal across the canvas. Put the box a line lands on directly beneath, or directly
   beside, the box it leaves. The private API sits above the endpoints because that edge
   is vertical; the App sits above CloudFront because that edge is vertical.

4. **Cross-cutting controls live in a side column, outside every flow.** A permissions
   boundary, secrets, keys, logs — things that bound every box rather than sit on one
   path — go in a column at the edge of the canvas with short dashed edges to their
   nearest neighbour only. A column of controls placed _between_ two connected regions
   makes every line between those regions cross it. That was the seven-crossing draft.

5. **One zone per owner, and a zone ends at its last box.** Two owners never share a
   column: GOV.UK Once systems and third parties are different zones, placed where the
   edges that reach them land — third parties under the NAT column they are reached
   through, sibling systems beside the endpoints that reach them. A zone drawn taller than
   its content invites a line through its empty tail.

6. **A row is a hop.** Ingress is one row: Web ACL → public API → authorizer, in the order
   a request meets them, so the edges between them are short horizontals. A second row
   under it holds what hangs off that row — the development-only stub, the canary.

7. **Drop an edge whose fact is already on the box.** A line must carry `protocol`, `auth`
   and `carries` and be worth a click. The canary calls the public URL every five minutes:
   that is a fact on the canary, not a line across the whole canvas.

8. **Let the canvas grow.** `w` and `h` in `views.json` are yours; the page fits to view.
   A crowded canvas with crossings is worse than a large one without. Never shorten a
   label to make a box fit the space it happens to have — widen the box, then the zone.

9. **Number the zones a reader must cross in order**, and nothing else. `1 · Edge`, then
   the account, then the VPC, then the identity column, so the reading order survives in
   the zone titles when the layout is topological rather than a sequence of bands.

## The loop

```
edit model/*.c4 → pnpm build          static gates; fix every line it prints
               → pnpm check          soft geometry; read the crossings it names
               → screenshot the tab  and look — an arc over the top, a line through
                                     an empty zone, a label on a title are visible
               → move boxes, never text
               → repeat until the check names nothing on the tab
```

Take the screenshot at the view's own size: a 2040×1460 canvas in a 1400-pixel window
is unreadable and hides exactly what you are checking. `pnpm check` prints the first
three of each kind of defect; when it names one, move the box a line has to cross rather
than the line's endpoints.

## Anti-patterns, each seen once

- The caller placed beside its target in the same row: every edge to it arcs over the
  top of the canvas.
- A control column between the VPC and the parties it reaches: every VPC→outside edge
  crosses it.
- Two kinds of outside party in one column: the internet-bound edge runs along the
  bottom of the canvas to get there.
- A decorative edge from a box in one corner to a box in the opposite corner: it crosses
  everything, and says nothing the box does not.
- A zone stretched to the container's bottom with its boxes at the top: a line through
  its empty half looks like a line through the zone's contents.
