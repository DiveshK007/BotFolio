import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // tsconfig says jsx: "preserve" for Next, so tell Vite to compile it for tests.
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["**/*.test.ts", "**/*.test.tsx"], exclude: ["node_modules/**", ".next/**"], environment: "node" },
});
