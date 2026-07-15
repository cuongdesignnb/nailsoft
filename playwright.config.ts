import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3000" },
  webServer: [
    {
      command: "node scripts/start-e2e-services.mjs",
      url: "http://127.0.0.1:3001/v1/health",
      reuseExistingServer: true,
      timeout: 120000,
    },
    {
      command:
        "node apps/admin-web/node_modules/next/dist/bin/next dev apps/admin-web -p 3000",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: true,
      timeout: 120000,
    },
    {
      command:
        "node apps/booking-web/node_modules/next/dist/bin/next dev apps/booking-web -p 3002",
      url: "http://127.0.0.1:3002",
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
});
