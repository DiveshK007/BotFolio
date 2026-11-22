import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @botfolio/shared ships raw .ts (main: src/index.ts), so Next has to compile it.
  transpilePackages: ["@botfolio/shared"],
  // pnpm monorepo: trace files from the repo root so workspace packages are included in the Vercel output.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
