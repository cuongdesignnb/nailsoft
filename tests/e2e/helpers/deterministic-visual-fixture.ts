import { test as base } from "@playwright/test";

/**
 * Visual evidence must not change because the browser crossed midnight while
 * a suite was running. API timestamps remain server-owned; this only freezes
 * browser-rendered relative/current-date labels before the first navigation.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.clock.install({ time: new Date("2026-08-22T12:00:00Z") });
    await use(page);
  },
});

export { expect } from "@playwright/test";
