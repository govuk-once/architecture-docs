/**
 * The small part of Confluence Cloud's REST API the review page needs, and the one rule
 * that sits on top of it: publish only when the page would change.
 *
 * A page update makes a new version and notifies everyone watching it. The review page
 * exists to get those people's attention, so republishing an identical page after every
 * merge would spend it. The body and the pictures are hashed together and the hash is kept
 * as a content property on the page; a run whose hash matches stops before writing.
 *
 * `fetch` is injected so the whole flow can be tested against a fake, and so nothing here
 * ever holds a credential — the caller builds the header once.
 */
import { createHash } from "node:crypto";

export interface Site {
  /** e.g. https://example.atlassian.net/wiki */
  base: string;
  /** Basic auth from the account email and an API token. */
  auth: string;
  fetch?: typeof fetch;
}

export interface Attachment {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface Draft {
  space: string;
  title: string;
  /** Storage-format HTML. */
  body: string;
  attachments: Attachment[];
  /**
   * Where the page is created, on the first run only: a page id, or a path of titles like
   * "Architecture / FLEX / Reviews", resolved in the space and created where missing.
   */
  parent?: string;
}

export interface PageRef {
  id: string;
  version: number;
  url: string;
}

const PROPERTY = "architecture-docs";

const headers = (site: Site, extra: Record<string, string> = {}) => ({
  Authorization: `Basic ${site.auth}`,
  Accept: "application/json",
  ...extra,
});

async function call<T>(
  site: Site,
  method: string,
  path: string,
  init: {
    json?: unknown;
    form?: FormData;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const doFetch = site.fetch ?? fetch;
  const res = await doFetch(`${site.base}/rest/api${path}`, {
    method,
    headers: headers(site, {
      ...(init.json !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.headers ?? {}),
    }),
    body: init.json !== undefined ? JSON.stringify(init.json) : init.form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const detail = text ? `: ${text.slice(0, 300)}` : "";
    throw new Error(
      `Confluence ${method} ${path} → ${String(res.status)} ${res.statusText}${detail}`,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** What a run would do, and did. */
export interface Outcome {
  action: "unchanged" | "created" | "updated" | "would-create" | "would-update";
  page?: PageRef;
  attachments: { name: string; action: "added" | "replaced" | "kept" }[];
  /** Pages on the parent path that did not exist and were (or would be) made. */
  madeParents: string[];
  hash: string;
}

/** One hash over everything the page shows, so a changed picture counts as a change. */
export const hashOf = (body: string, attachments: Attachment[]) => {
  const h = createHash("sha256").update(body);
  for (const a of [...attachments].sort((x, y) => x.name.localeCompare(y.name)))
    h.update(a.name).update(a.bytes);
  return h.digest("hex");
};

const pageUrl = (site: Site, space: string, id: string) =>
  `${site.base}/spaces/${space}/pages/${id}`;

interface Found {
  results: { id: string; version: { number: number } }[];
}

/** The page by title in the space, if it exists. */
export async function findPage(
  site: Site,
  space: string,
  title: string,
): Promise<PageRef | null> {
  const q = new URLSearchParams({ spaceKey: space, title, expand: "version" });
  const found = await call<Found>(site, "GET", `/content?${q.toString()}`);
  const hit = found.results[0];
  return hit
    ? {
        id: hit.id,
        version: hit.version.number,
        url: pageUrl(site, space, hit.id),
      }
    : null;
}

/** The hash recorded on the page by the last run, if any. */
export async function recordedHash(
  site: Site,
  id: string,
): Promise<string | null> {
  try {
    const p = await call<{ value?: { hash?: string } }>(
      site,
      "GET",
      `/content/${id}/property/${PROPERTY}`,
    );
    return p.value?.hash ?? null;
  } catch (err) {
    if (String(err).includes("→ 404")) return null;
    throw err;
  }
}

/**
 * The page a path of titles names, creating what is missing on the way. Titles are unique
 * within a space, so each segment is found by title alone and placed under the one before
 * it only when it has to be made. A bare id is returned as it is.
 */
export async function ensureParent(
  site: Site,
  space: string,
  parent: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ id: string | null; made: string[] }> {
  if (/^\d+$/.test(parent.trim())) return { id: parent.trim(), made: [] };
  const titles = parent
    .split("/")
    .map((t) => t.trim())
    .filter(Boolean);
  let above: string | null = null;
  const made: string[] = [];
  for (const title of titles) {
    const found = await findPage(site, space, title);
    if (found) {
      above = found.id;
      continue;
    }
    made.push(title);
    if (opts.dryRun) continue;
    const page = await call<{ id: string }>(site, "POST", "/content", {
      json: {
        type: "page",
        title,
        space: { key: space },
        ...(above ? { ancestors: [{ id: above }] } : {}),
        body: { storage: { value: "", representation: "storage" } },
      },
    });
    above = page.id;
  }
  return { id: above, made };
}

/**
 * Create or update the page, put the pictures on it, and record the hash. Returns what
 * happened. With `dryRun` it reads everything and writes nothing.
 */
export async function publish(
  site: Site,
  draft: Draft,
  opts: {
    force?: boolean;
    dryRun?: boolean;
    note?: Record<string, string>;
  } = {},
): Promise<Outcome> {
  const hash = hashOf(draft.body, draft.attachments);
  const existing = await findPage(site, draft.space, draft.title);
  if (existing && !opts.force) {
    const last = await recordedHash(site, existing.id);
    if (last === hash)
      return {
        action: "unchanged",
        page: existing,
        attachments: [],
        madeParents: [],
        hash,
      };
  }
  /* Only a page being created needs a parent; one that exists stays where it was put. */
  const parent =
    !existing && draft.parent
      ? await ensureParent(site, draft.space, draft.parent, {
          dryRun: opts.dryRun,
        })
      : { id: null, made: [] };
  if (opts.dryRun)
    return {
      action: existing ? "would-update" : "would-create",
      page: existing ?? undefined,
      attachments: draft.attachments.map((a) => ({
        name: a.name,
        action: "added",
      })),
      madeParents: parent.made,
      hash,
    };

  const storage = { storage: { value: draft.body, representation: "storage" } };
  let page: PageRef;
  if (existing) {
    const next = existing.version + 1;
    await call(site, "PUT", `/content/${existing.id}`, {
      json: {
        id: existing.id,
        type: "page",
        title: draft.title,
        version: { number: next },
        body: storage,
      },
    });
    page = { ...existing, version: next };
  } else {
    const made = await call<{ id: string }>(site, "POST", "/content", {
      json: {
        type: "page",
        title: draft.title,
        space: { key: draft.space },
        ...(parent.id ? { ancestors: [{ id: parent.id }] } : {}),
        body: storage,
      },
    });
    page = {
      id: made.id,
      version: 1,
      url: pageUrl(site, draft.space, made.id),
    };
  }

  /* Pictures: by file name, replaced in place so the page's references stay valid. */
  const had = await call<{ results: { id: string; title: string }[] }>(
    site,
    "GET",
    `/content/${page.id}/child/attachment?limit=200`,
  );
  const attachments: Outcome["attachments"] = [];
  for (const a of draft.attachments) {
    const form = new FormData();
    form.append("file", new Blob([a.bytes], { type: "image/png" }), a.name);
    form.append("minorEdit", "true");
    const prior = had.results.find((r) => r.title === a.name);
    await call(
      site,
      "POST",
      prior
        ? `/content/${page.id}/child/attachment/${prior.id}/data`
        : `/content/${page.id}/child/attachment`,
      { form, headers: { "X-Atlassian-Token": "nocheck" } },
    );
    attachments.push({ name: a.name, action: prior ? "replaced" : "added" });
  }

  /* The hash last, so a run that failed halfway republishes next time. */
  const propPath = `/content/${page.id}/property/${PROPERTY}`;
  const prop = await call<{ version?: { number: number } } | undefined>(
    site,
    "GET",
    propPath,
  ).catch(() => undefined);
  const value = { hash, ...(opts.note ?? {}) };
  if (prop?.version)
    await call(site, "PUT", propPath, {
      json: {
        key: PROPERTY,
        value,
        version: { number: prop.version.number + 1 },
      },
    });
  else
    await call(site, "POST", `/content/${page.id}/property`, {
      json: { key: PROPERTY, value },
    });

  return {
    action: existing ? "updated" : "created",
    page,
    attachments,
    madeParents: parent.made,
    hash,
  };
}
