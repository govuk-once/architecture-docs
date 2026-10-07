/**
 * What is sealed opens with the password and with nothing else — checked with Web Crypto,
 * the same API the wrapper uses in the browser, so the two ends are known to agree.
 */
import { webcrypto } from "node:crypto";

import { describe, expect, it } from "vitest";

import { encryptPage, ROUNDS, seal, type Sealed } from "./encryptPage.js";

const bytes = (b64: string) => Uint8Array.from(Buffer.from(b64, "base64"));

async function open(sealed: Sealed, password: string): Promise<string> {
  const raw = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await webcrypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: bytes(sealed.salt),
      iterations: ROUNDS,
      hash: "SHA-256",
    },
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plain = await webcrypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes(sealed.iv) },
    key,
    bytes(sealed.data),
  );
  return new TextDecoder().decode(plain);
}

describe("seal", () => {
  const html = "<!doctype html><title>x</title><p>the diagram ✓</p>";

  it("opens with the password, through Web Crypto", async () => {
    expect(await open(seal(html, "correct horse"), "correct horse")).toBe(html);
  });

  it("refuses any other password rather than returning noise", async () => {
    await expect(
      open(seal(html, "correct horse"), "correct hors"),
    ).rejects.toThrow();
  });

  it("seals the same page differently each time", () => {
    const a = seal(html, "p"),
      b = seal(html, "p");
    expect(a.salt).not.toBe(b.salt);
    expect(a.data).not.toBe(b.data);
  });
});

describe("encryptPage", () => {
  it("is a page that carries the sealed blob and none of the words", () => {
    const html = "<p>Federated Logic and Events eXchange</p>";
    const out = encryptPage(html, "p", "FLEX");
    expect(out).toContain('<meta name="robots" content="noindex');
    expect(out).toContain('id="sealed"');
    expect(out).not.toContain("Federated");
    const sealed = JSON.parse(
      /<script id="sealed" type="application\/json">(.*?)<\/script>/s.exec(
        out,
      )?.[1] ?? "{}",
    ) as Sealed;
    expect(sealed.data.length).toBeGreaterThan(0);
  });
});
