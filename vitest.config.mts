import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const env = { ...loadEnv("test", process.cwd(), ""), ...process.env };
const TEST_DB = env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/omnicanal_test";
process.env.TEST_DATABASE_URL = TEST_DB; // lo usa vitest.setup.ts

export default defineConfig({
  resolve: { alias: { "@": path.dirname(fileURLToPath(import.meta.url)) } },
  test: {
    env: { DATABASE_URL: TEST_DB, OTP_SECRET: "test-secret" },
    globalSetup: "./vitest.setup.ts",
    fileParallelism: false,
  },
});
