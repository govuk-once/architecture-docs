import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    /*
     * `.sources/` holds checkouts of the repositories this explorer documents. They are other
     * people's repositories that happen to sit inside this one, so every tool that globs has
     * to be told to stay out — without this, `pnpm test` runs FLEX's entire suite.
     */
    exclude: ["**/node_modules/**", ".sources/**", "site/**"],
  },
});
