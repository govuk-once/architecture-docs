/**
 * Fetches the two typefaces the explorer uses, subset to the characters it renders, and
 * writes them into explorer/fonts/ to be committed and inlined by the build.
 *
 *   pnpm fonts
 *
 * The page is meant to be opened straight off disk and published as a shareable artifact,
 * and until now it asked Google for its fonts on every open — five third-party requests
 * from a public page documenting a government platform, and fallback metrics for anybody
 * offline, which is the very thing the geometry gates measure.
 *
 * Subsetting is done by Google rather than locally, through the `text=` parameter, so this
 * needs no font toolchain. IBM Plex Sans has a variable build covering 400-700 in one
 * 30KB face; IBM Plex Mono has none, so its three weights are fetched separately. The
 * whole set is about 50KB, against 139KB for seven static faces.
 *
 * Run this when CHARSET changes or to take an upstream font revision. It is not part of
 * the build: a build that reaches the network is a build that fails on a train.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { inDocs } from "./lib/paths.js";

/**
 * What the faces have to carry. Printable ASCII, plus every non-ASCII character the models
 * use — the arrows and middots the diagrams are full of, the currency and maths signs the
 * resource tables reach for. Deliberately wider than what is used today: the alternative
 * is a model edit rendering a glyph nobody has, and `pnpm check` verifies the coverage.
 */
export const CHARSET =
  Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) =>
    String.fromCharCode(0x20 + i),
  ).join("") + "—·…–→←↔▸✓×÷≥≤≠±°£€™®©’‘“”§¶†‡•∞≈¬⌀";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Google serves woff2 only to a browser that says it can take it. */
async function css(family: string): Promise<string> {
  const url =
    `https://fonts.googleapis.com/css2?family=${family}` +
    `&text=${encodeURIComponent(CHARSET)}`;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${url} — ${String(r.status)}`);
  return r.text();
}

interface Face {
  family: string;
  weight: string;
  file: string;
}

async function fetchFamily(
  query: string,
  name: string,
  slug: string,
): Promise<Face[]> {
  const sheet = await css(query);
  const blocks = [
    ...sheet.matchAll(
      /font-weight:\s*([\d ]+);[\s\S]*?src:\s*url\(([^)]+)\)\s*format\('woff2'\)/g,
    ),
  ];
  if (!blocks.length) throw new Error(`no woff2 faces for ${query}`);
  const out: Face[] = [];
  for (const [, weight = "", url = ""] of blocks) {
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const file = `${slug}-${weight.replace(/\s+/g, "-")}.woff2`;
    writeFileSync(inDocs("explorer", "fonts", file), buf);
    out.push({ family: name, weight, file });
    console.log(
      `  ${name} ${weight.padEnd(9)} ${(buf.length / 1024).toFixed(1).padStart(6)} KB  ${file}`,
    );
  }
  return out;
}

mkdirSync(inDocs("explorer", "fonts"), { recursive: true });
const faces = [
  // One variable face covers every weight the site asks of Plex Sans.
  ...(await fetchFamily(
    "IBM+Plex+Sans:wght@400..700",
    "IBM Plex Sans",
    "plex-sans",
  )),
  // Plex Mono has no variable build, so its three weights come as three faces.
  ...(await fetchFamily(
    "IBM+Plex+Mono:wght@400;500;600",
    "IBM Plex Mono",
    "plex-mono",
  )),
];
writeFileSync(
  inDocs("explorer", "fonts", "fonts.json"),
  JSON.stringify({ charset: CHARSET, faces }, null, 2) + "\n",
);
console.log(
  `  wrote ${String(faces.length)} face(s) and a manifest to explorer/fonts/`,
);
