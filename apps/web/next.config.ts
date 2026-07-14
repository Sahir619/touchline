import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // Consume the shared workspace package as TypeScript source (no build step).
  transpilePackages: ["@touchline/shared"],
  // Pin the monorepo root so Turbopack doesn't mis-infer it from sibling lockfiles.
  turbopack: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
  },
};

export default nextConfig;
