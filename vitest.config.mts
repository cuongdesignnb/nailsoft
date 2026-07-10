import { defineConfig } from 'vitest/config'; export default defineConfig({test:{include:['packages/**/*.test.ts','apps/{api,worker}/**/*.test.ts'],coverage:{provider:'v8'}}});
