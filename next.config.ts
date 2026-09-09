import type { NextConfig } from "next";

/**
 * The app is served under ironically.ai/collabspace via a rewrite from the
 * ironically.ai Vercel project, so every route and asset lives under this base
 * path. It is deliberately unlisted for now: no-index headers on every response.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/collabspace";

const nextConfig: NextConfig = {
  basePath: BASE_PATH,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
    ];
  },
};

export default nextConfig;
