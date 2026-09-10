import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Turbopack dev must see the shared brand graphic in ../src. The production
// webpack/OpenNext pipeline retains the site's independently packaged output root.
const buildRoot = process.env.NODE_ENV === "development" ? path.resolve(__dirname, "..") : __dirname;

const scriptPolicy = process.env.NODE_ENV === "production"
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: buildRoot,
  poweredByHeader: false,
  experimental: {
    useTypeScriptCli: true,
  },
  turbopack: {
    root: buildRoot,
  },
  async rewrites() {
    return [
      {
        source: "/ko",
        destination: "/?lang=ko",
      },
      {
        source: "/ko/privacy",
        destination: "/privacy?lang=ko",
      },
      {
        source: "/ko/terms",
        destination: "/terms?lang=ko",
      },
    ];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            scriptPolicy,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "font-src 'self'",
            "connect-src 'self'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            "object-src 'none'",
          ].join("; "),
        },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(), payment=()",
        },
      ],
    }];
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.dopedb.dev" }],
        destination: "https://dopedb.dev/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
