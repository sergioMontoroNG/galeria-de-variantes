import { defineConfig } from "vitest/config";

// Deliberately separate from vite.config.ts: that one wires up the
// react-router app (dev server, HMR, Shopify host detection) which has
// nothing to do with running unit tests against the theme/admin extensions.
export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  test: {
    environment: "jsdom",
    include: ["extensions/**/*.test.{js,jsx,ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
