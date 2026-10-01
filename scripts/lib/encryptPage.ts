/**
 * A page that asks for a password before it exists.
 *
 * GitHub Pages serves whatever it is given to whoever asks, and the pages describe a live
 * system in detail. So what it is given is ciphertext: the page encrypted with a key
 * derived from a password, wrapped in a small page that asks for the password and
 * decrypts in the browser. What the host holds, a crawler fetches, or a cache keeps is
 * the wrapper and an opaque blob.
 *
 * AES-256-GCM under a key from PBKDF2-SHA256, 600,000 rounds, a fresh salt and nonce per
 * page — all of it in Web Crypto on the way back, so the wrapper carries no library. GCM
 * authenticates, which is what turns a wrong password into a clean "no" rather than a
 * page of noise. This is one shared password with no idea who holds it, changed only by
 * deploying again; it keeps the content from the public, not from a colleague who leaves.
 */
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

export const ROUNDS = 600_000;

export interface Sealed {
  salt: string;
  iv: string;
  data: string;
}

/** The page's bytes, sealed. Base64 throughout, since it travels inside HTML. */
export function seal(html: string, password: string): Sealed {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, ROUNDS, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(html, "utf8"), cipher.final()]);
  /* Web Crypto expects the tag appended to the ciphertext, which is how it decrypts. */
  const data = Buffer.concat([body, cipher.getAuthTag()]);
  return {
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    data: data.toString("base64"),
  };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The wrapper: a form, the sealed page, and the few lines that open it. */
export function encryptPage(
  html: string,
  password: string,
  title = "This page is protected",
): string {
  const sealed = seal(html, password);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive, noimageindex, nosnippet">
<title>${esc(title)}</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:#f4f7fa;color:#16212e}
  @media(prefers-color-scheme:dark){body{background:#0d151e;color:#e8eef5}}
  form{width:min(360px,calc(100vw - 32px));padding:24px;border:1px solid #cbd5e1;border-radius:12px;background:#fff}
  @media(prefers-color-scheme:dark){form{background:#121b26;border-color:#33465a}}
  h1{margin:0 0 6px;font-size:17px}
  p{margin:0 0 14px;font-size:13px;color:#6b7b8d}
  input{width:100%;box-sizing:border-box;font:inherit;padding:8px 10px;border:1px solid #cbd5e1;border-radius:7px;background:inherit;color:inherit}
  button{margin-top:12px;font:inherit;font-weight:600;padding:8px 16px;border-radius:7px;border:1px solid #1d4ed8;background:#1d4ed8;color:#fff;cursor:pointer}
  .no{margin:10px 0 0;color:#b42318;font-size:13px}
</style>
</head>
<body>
<form id="f" hidden>
  <h1>${esc(title)}</h1>
  <p>Enter the password you were given to open it.</p>
  <label for="pw" style="position:absolute;left:-9999px">Password</label>
  <input id="pw" type="password" autocomplete="current-password" autofocus>
  <button type="submit">Open</button>
  <p class="no" id="no" hidden>That is not the password.</p>
</form>
<script id="sealed" type="application/json">${JSON.stringify(sealed)}</script>
<script>
(() => {
  const sealed = JSON.parse(document.getElementById("sealed").textContent);
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const KEY = "site-password";
  const form = document.getElementById("f"), pw = document.getElementById("pw"), no = document.getElementById("no");
  async function open(password) {
    const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: bytes(sealed.salt), iterations: ${String(ROUNDS)}, hash: "SHA-256" },
      raw, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(sealed.iv) }, key, bytes(sealed.data));
    const html = new TextDecoder().decode(plain);
    /* Remembered for this tab only, so the next page on the site opens without asking
       again and closing the tab forgets it. */
    try { sessionStorage.setItem(KEY, password); } catch {}
    document.open(); document.write(html); document.close();
  }
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault(); no.hidden = true;
    try { await open(pw.value); } catch { no.hidden = false; pw.select(); }
  });
  let remembered = null;
  try { remembered = sessionStorage.getItem(KEY); } catch {}
  if (remembered) open(remembered).catch(() => { form.hidden = false; });
  else form.hidden = false;
})();
</script>
</body>
</html>
`;
}
