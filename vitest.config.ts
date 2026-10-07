import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: true,
    mockReset: true,
    restoreMocks: true,
    env: {
      SUPERMEMORY_CONTAINER_TAG_PREFIX: "user-",
      SUPERMEMORY_ENTITY_CONTEXT: "Test entity context",
    },
  },
});
