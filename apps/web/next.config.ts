import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @botfolio/shared ships raw .ts (main: src/index.ts), so Next has to compile it.
  transpilePackages: ["@botfolio/shared"],
  // pnpm monorepo: trace files from the repo root so workspace packages are included in the Vercel output.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // The card route reads its fonts with fs at runtime; make sure they ship with the function.
  outputFileTracingIncludes: { "/api/card/[cardId]": ["./app/api/card/fonts/*.ttf"] },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
