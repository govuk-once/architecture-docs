/**
 * The publish flow against a fake Confluence: what it asks, what it writes, and above all
 * when it declines to write.
 */
import { describe, expect, it } from "vitest";

import { type Attachment, hashOf, publish, type Site } from "./confluence.js";

const png = (s: string): Attachment => ({
  name: `${s}.png`,
  bytes: new TextEncoder().encode(s),
});

/** A fake site: canned answers by method and path, and a log of every call. */
function fakeSite(
  answers: Record<string, unknown>,
  opts: { fail?: string[] } = {},
) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const site: Site = {
    base: "https://x.atlassian.net/wiki",
    auth: "abc",
    fetch: (url: string | URL | Request, init?: RequestInit) => {
      let href: string;
      if (typeof url === "string") href = url;
      else if (url instanceof URL) href = url.href;
      else href = url.url;
      const path = href.replace("https://x.atlassian.net/wiki/rest/api", "");
      const method = init?.method ?? "GET";
      const key = `${method} ${path.split("?")[0] ?? ""}`;
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as unknown)
          : init?.body;
      calls.push({ method, path, body });
      if (opts.fail?.includes(key))
        return Promise.resolve(
          new Response("nope", { status: 404, statusText: "Not Found" }),
        );
      const answer = answers[key];
      return Promise.resolve(
        new Response(JSON.stringify(answer ?? {}), { status: 200 }),
      );
    },
  };
  return { site, calls };
}

const draft = {
  space: "ONCE",
  title: "FLEX — planned states",
  body: "<p>hello</p>",
  attachments: [png("s1-delivery")],
};

describe("publish", () => {
  it("creates the page, attaches the pictures, and records the hash", async () => {
    const { site, calls } = fakeSite({
      "GET /content": { results: [] },
      "POST /content": { id: "42" },
      "GET /content/42/child/attachment": { results: [] },
      "POST /content/42/child/attachment": {},
      "POST /content/42/property": {},
    });
    const out = await publish(
      site,
      { ...draft, parent: "7" },
      { note: { commit: "abc" } },
    );
    expect(out.action).toBe("created");
    expect(out.page?.url).toBe(
      "https://x.atlassian.net/wiki/spaces/ONCE/pages/42",
    );
    expect(out.attachments).toEqual([
      { name: "s1-delivery.png", action: "added" },
    ]);
    const create = calls.find(
      (c) => c.method === "POST" && c.path === "/content",
    );
    expect(create?.body).toMatchObject({
      title: draft.title,
      space: { key: "ONCE" },
      ancestors: [{ id: "7" }],
      body: { storage: { value: "<p>hello</p>", representation: "storage" } },
    });
    const prop = calls.find((c) => c.path === "/content/42/property");
    expect(prop?.body).toMatchObject({
      key: "architecture-docs",
      value: { hash: out.hash, commit: "abc" },
    });
  });

  it("declines to write when the recorded hash matches", async () => {
    const hash = hashOf(draft.body, draft.attachments);
    const { site, calls } = fakeSite({
      "GET /content": { results: [{ id: "42", version: { number: 3 } }] },
      "GET /content/42/property/architecture-docs": { value: { hash } },
    });
    const out = await publish(site, draft);
    expect(out.action).toBe("unchanged");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("updates in place, bumping the version and replacing a picture by name", async () => {
    const { site, calls } = fakeSite({
      "GET /content": { results: [{ id: "42", version: { number: 3 } }] },
      "GET /content/42/property/architecture-docs": {
        value: { hash: "old" },
        version: { number: 1 },
      },
      "PUT /content/42": {},
      "GET /content/42/child/attachment": {
        results: [{ id: "a1", title: "s1-delivery.png" }],
      },
      "POST /content/42/child/attachment/a1/data": {},
      "PUT /content/42/property/architecture-docs": {},
    });
    const out = await publish(site, draft);
    expect(out.action).toBe("updated");
    expect(out.page?.version).toBe(4);
    expect(out.attachments).toEqual([
      { name: "s1-delivery.png", action: "replaced" },
    ]);
    const put = calls.find(
      (c) => c.method === "PUT" && c.path === "/content/42",
    );
    expect(put?.body).toMatchObject({ version: { number: 4 } });
    const prop = calls.find(
      (c) =>
        c.method === "PUT" && c.path.endsWith("/property/architecture-docs"),
    );
    expect(prop?.body).toMatchObject({ version: { number: 2 } });
  });

  it("treats a page with no recorded hash as changed, and a dry run writes nothing", async () => {
    const { site, calls } = fakeSite(
      { "GET /content": { results: [{ id: "42", version: { number: 3 } }] } },
      { fail: ["GET /content/42/property/architecture-docs"] },
    );
    const out = await publish(site, draft, { dryRun: true });
    expect(out.action).toBe("would-update");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("places a new page under a path of titles, making what is missing", async () => {
    /* "Architecture" exists as page 1; "FLEX" and "Reviews" do not. */
    let next = 10;
    const { site, calls } = fakeSite({
      "POST /content/42/property": {},
      "GET /content/42/child/attachment": { results: [] },
    });
    const byTitle: Record<string, { id: string; version: { number: number } }> =
      {
        Architecture: { id: "1", version: { number: 1 } },
      };
    site.fetch = (url: string | URL | Request, init?: RequestInit) => {
      let href: string;
      if (typeof url === "string") href = url;
      else if (url instanceof URL) href = url.href;
      else href = url.url;
      const u = new URL(href);
      const path = u.pathname.replace("/wiki/rest/api", "");
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as {
              title?: string;
              ancestors?: { id: string }[];
            })
          : undefined;
      calls.push({ method, path, body });
      const reply = (v: unknown) =>
        Promise.resolve(new Response(JSON.stringify(v)));
      if (method === "GET" && path === "/content") {
        const hit = byTitle[u.searchParams.get("title") ?? ""];
        return reply({ results: hit ? [hit] : [] });
      }
      if (method === "POST" && path === "/content")
        return reply({
          id: body?.title === draft.title ? "42" : String(next++),
        });
      if (method === "GET" && path.endsWith("/child/attachment"))
        return reply({ results: [] });
      return reply({});
    };
    const out = await publish(site, {
      ...draft,
      parent: "Architecture / FLEX / Reviews",
    });
    expect(out.action).toBe("created");
    expect(out.madeParents).toEqual(["FLEX", "Reviews"]);
    const creates = calls.filter(
      (c) => c.method === "POST" && c.path === "/content",
    );
    expect(creates.map((c) => (c.body as { title: string }).title)).toEqual([
      "FLEX",
      "Reviews",
      draft.title,
    ]);
    /* FLEX under Architecture (1), Reviews under FLEX (10), the page under Reviews (11). */
    expect(
      creates.map(
        (c) => (c.body as { ancestors?: { id: string }[] }).ancestors?.[0]?.id,
      ),
    ).toEqual(["1", "10", "11"]);
  });

  it("hashes the pictures as well as the body", () => {
    const a = hashOf("<p>x</p>", [png("one")]);
    expect(hashOf("<p>x</p>", [png("two")])).not.toBe(a);
    expect(hashOf("<p>x</p>", [png("one")])).toBe(a);
  });
});
