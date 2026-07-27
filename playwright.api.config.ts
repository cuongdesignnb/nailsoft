import { defineConfig } from "@playwright/test";

// API-only authenticated suites run after CI has started the API/Worker. Keeping
// this separate avoids starting browser-facing Next.js servers for contract flows.
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  reporter: "line",
});
