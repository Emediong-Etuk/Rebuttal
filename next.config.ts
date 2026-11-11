import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The toolkit bundles its own ai/zod copies and uses axios; keep it out of the server bundle.
  serverExternalPackages: ["@paypal/agent-toolkit", "postgres"],
  poweredByHeader: false,
};

export default nextConfig;
