import { defineConfig } from "tsup";

// The replay logic lives in the worker (@botfolio/worker/runner), so a replay runs the worker's own gate().
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  noExternal: [/^@botfolio\//],
  banner: { js: "#!/usr/bin/env node" },
});
