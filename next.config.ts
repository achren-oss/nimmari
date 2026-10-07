import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // chromium-min downloads the binary at runtime; puppeteer-core has heavy
  // dynamic requires that confuse the bundler. Externalize both.
  serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
};

export default nextConfig;
