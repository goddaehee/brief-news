import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/": ["./content/news/**/*", "./db/**/*"],
  },
};

export default nextConfig;
