import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/{api,worker}/**/*.test.ts",
      "tests/{integration,contract,mobile}/**/*.test.ts",
    ],
    // Integration files share one deterministic PostgreSQL dataset and exercise
    // revocation/concurrency. Running files in parallel invalidates one another's
    // sessions and makes the result scheduling-dependent.
    fileParallelism: false,
    coverage: { provider: "v8" },
    poolOptions: { forks: { singleFork: true } },
  },
});
