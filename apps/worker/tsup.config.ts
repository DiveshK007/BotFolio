import { defineConfig } from "tsup";

// Workspace packages (@botfolio/*) ship TypeScript source, so bundle them into the worker output.
// Third-party deps (viem) stay external and are installed on Render by pnpm.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@botfolio\//],
});
