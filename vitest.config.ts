import type { UserConfig } from "vitest/config";

export default {
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "api/**/*.test.ts"],
  },
} satisfies UserConfig;
