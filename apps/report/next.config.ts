import type { NextConfig } from "next";

const config: NextConfig = {
  // Los paquetes del monorepo se publican como TypeScript sin compilar (D-003).
  transpilePackages: ["@paridad/core"],
  // Playwright genera el PDF en el servidor; no debe empaquetarse.
  serverExternalPackages: ["playwright", "playwright-core"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
