import { fileURLToPath } from "node:url";

const scriptPolicy = process.env.NODE_ENV === "production"
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
const clarityEnabled = /^[a-z0-9]+$/.test(process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID ?? "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: fileURLToPath(new URL(process.env.NEXT_PRIVATE_STANDALONE === "true" ? "." : "..", import.meta.url)),
  experimental: {
    useTypeScriptCli: true,
  },
  poweredByHeader: false,
  turbopack: { root: fileURLToPath(new URL("..", import.meta.url)) },
  async rewrites() {
    return [
      {
        source: "/ko",
        destination: "/",
      },
      {
        source: "/ko/:path*",
        destination: "/:path*",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `${scriptPolicy}${clarityEnabled ? " https://www.clarity.ms https://scripts.clarity.ms" : ""}`,
              "style-src 'self' 'unsafe-inline'",
              `img-src 'self' data: https://lh3.googleusercontent.com${clarityEnabled ? " https://*.clarity.ms" : ""}`,
              "font-src 'self'",
              `connect-src 'self'${clarityEnabled ? " https://*.clarity.ms" : ""}`,
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "object-src 'none'",
            ].join("; "),
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
