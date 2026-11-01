/**
 * The names of the resources a template tags, grouped as a file the app will read.
 *
 * UDP's monitoring stack alarms whatever carries `Monitor=true` in the deployed account:
 * its pipeline asks the Resource Groups Tagging API and writes the names to a gitignored
 * file the stack then loads. The same tag is on the same resources in the templates the
 * app synthesises, each with the explicit name it would deploy under, so the file can be
 * read from there — and nothing deployed can carry the tag that the templates do not.
 *
 * Options, from the project's config:
 *   tag     { "Monitor": "true" }                             every key must match
 *   shape   { "lambdaNames": { "type": "AWS::Lambda::Function", "name": "FunctionName" } }
 *           one array per key, of that property's value on every tagged resource of that type
 *
 * A tagged resource of a wanted type whose name is not a plain string is refused rather
 * than guessed at: the pipeline would have seen a real name, and a count made from a
 * list with a hole in it is not the count.
 */
import { isAbsolute, join, relative } from "node:path";

export interface TaggedNamesOptions {
  tag: Record<string, string>;
  shape: Record<string, { type: string; name: string }>;
}

interface Resource {
  Type?: string;
  Properties?: Record<string, unknown>;
}

const tagsOf = (r: Resource): Record<string, string> => {
  const tags = r.Properties?.Tags;
  if (!Array.isArray(tags)) return {};
  return Object.fromEntries(
    (tags as { Key?: unknown; Value?: unknown }[])
      .filter((t) => typeof t.Key === "string" && typeof t.Value === "string")
      .map((t) => [t.Key as string, t.Value as string]),
  );
};

export function taggedNames(
  templates: { file: string; body: unknown }[],
  options: unknown,
): string {
  const o = options as Partial<TaggedNamesOptions>;
  if (!o.tag || !o.shape || !Object.keys(o.shape).length)
    throw new Error("taggedNames needs a tag to match and a shape to fill");
  const out: Record<string, string[]> = Object.fromEntries(
    Object.keys(o.shape).map((k) => [k, []]),
  );
  for (const { file, body } of templates) {
    const resources =
      (body as { Resources?: Record<string, Resource> }).Resources ?? {};
    for (const [logicalId, r] of Object.entries(resources)) {
      const tags = tagsOf(r);
      if (!Object.entries(o.tag).every(([k, v]) => tags[k] === v)) continue;
      for (const [key, want] of Object.entries(o.shape)) {
        if (r.Type !== want.type) continue;
        const name = r.Properties?.[want.name];
        if (typeof name !== "string")
          throw new Error(
            `${file}: ${logicalId} is tagged but its ${want.name} is not a plain string, so it cannot be listed as its pipeline would`,
          );
        out[key]?.push(name);
      }
    }
  }
  for (const list of Object.values(out)) list.sort();
  return JSON.stringify(out, null, 2) + "\n";
}

/** The generators a `synth.generated` input may name. */
export const GENERATORS: Record<
  string,
  (templates: { file: string; body: unknown }[], options: unknown) => string
> = { taggedNames };

/** A generated file's absolute path, refused unless it lands inside the checkout. */
export function generatedPath(root: string, file: string): string {
  const abs = join(root, file);
  const rel = relative(root, abs);
  if (isAbsolute(file) || !rel || rel.startsWith("..") || isAbsolute(rel))
    throw new Error(`generated "${file}" is outside the checkout`);
  return abs;
}
