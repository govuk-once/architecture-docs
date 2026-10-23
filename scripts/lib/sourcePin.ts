/**
 * A pinned source: the ref `pnpm sync` checks a source out at, when an environment
 * variable names one instead of the project's config.
 *
 * The config tracks a branch, and CI re-derives against wherever that branch is, which is
 * what makes drift visible. A build that has to publish, though, cannot wait for three
 * repositories to stop moving: a pin names the commit the model was read at, so the site
 * says what has been read, and the schedule over the branch still reports what has not.
 *
 * `ARCH_SOURCE_REF_FLEX` pins a project's one source; `ARCH_SOURCE_REF_APP_IOS` pins one
 * of several. Ids are upper-cased with `-` as `_`. An empty value is no pin. The value is a
 * full commit sha: git fetches a commit by its whole name and refuses an abbreviation, and
 * the refusal — "couldn't find remote ref" — reads like a typo in the repository, not the pin.
 */
export function pinEnvName(projectId: string, sourceId: string): string {
  const up = (s: string) => s.toUpperCase().replaceAll("-", "_");
  return sourceId === projectId
    ? `ARCH_SOURCE_REF_${up(projectId)}`
    : `ARCH_SOURCE_REF_${up(projectId)}_${up(sourceId)}`;
}

export function pinnedRef(
  projectId: string,
  sourceId: string,
  env: Record<string, string | undefined> = process.env,
): { name: string; ref: string } | null {
  const name = pinEnvName(projectId, sourceId);
  const ref = env[name]?.trim();
  if (!ref) return null;
  if (!/^[0-9a-f]{40}$/i.test(ref))
    throw new Error(
      `${name} is "${ref}", which is not a full commit sha — git fetches a commit by its whole 40-character name`,
    );
  return { name, ref };
}
