/**
 * Which files in the source repository these docs make a claim about.
 *
 * Every claim in the explorer names the files that prove it — a LikeC4 `link` on an
 * element or a relationship, a `code` array on a reference table or an inventory row.
 * Read back out, those citations turn a list of files that changed over there into a list
 * of claims to re-read over here, which is what `pnpm drift` prints.
 */

/**
 * A `source` glob from explorer.config.json, as a regex over repository-relative paths.
 *
 * Matched against the paths in a diff rather than walked on disk, because a file deleted
 * in the range still has to be recognised as one these docs read. `alarmConstructs` names
 * a directory, so a bare glob matches the directory and everything under it.
 */
export function globToRe(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, String.raw`\$&`);
  const body = escaped.replace(/\*\*|\*/g, (m) =>
    m === "**" ? ".*" : "[^/]*",
  );
  return new RegExp(`^${body}(/|$)`);
}

/**
 * Every cited path in the loaded model, mapped to the places that cite it.
 *
 * The views are walked rather than read field by field, because citations sit in four
 * different places today and a fifth should not silently go unnoticed here. The trail is
 * built from whichever of `id`, `name` or `label` an enclosing object has, so a path
 * comes back reading `resources/Compute · AWS Lambda/lambda-cr` rather than as an
 * anonymous hit somewhere in the model.
 */
export function collectCitations(views: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const walk = (node: unknown, where: string) => {
    if (Array.isArray(node)) {
      for (const v of node) walk(v, where);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const o = node as Record<string, unknown>;
    const named = [o.id, o.name, o.label].find(
      (v) => typeof v === "string" && v.trim() !== "",
    );
    const here =
      typeof named === "string" && named !== where
        ? [where, named].filter(Boolean).join("/")
        : where;
    for (const [k, v] of Object.entries(o)) {
      if (k !== "code") {
        walk(v, here);
        continue;
      }
      if (!Array.isArray(v)) continue;
      // A citation is a [label, repository-relative path] pair.
      for (const pair of v as unknown[]) {
        const rel = Array.isArray(pair) ? (pair as unknown[])[1] : undefined;
        if (typeof rel !== "string") continue;
        const at = out.get(rel) ?? new Set<string>();
        at.add(here || "model");
        out.set(rel, at);
      }
    }
  };
  walk(views, "");
  return out;
}
