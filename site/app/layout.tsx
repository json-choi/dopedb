import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { headers } from "next/headers";
import { IBM_Plex_Mono } from "next/font/google";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

const siteUrl = "https://dopedb.dev";

const monoFont = IBM_Plex_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-mono-loaded",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "DopeDB",
  title: {
    default: "DopeDB - Shared database access for teams and AI agents",
    template: "%s - DopeDB",
  },
  description:
    "An open-source database workspace where teams share access without sharing credentials, and Codex or Claude works inside one connection-pinned local boundary.",
  keywords: [
    "DopeDB",
    "도프디비",
    "shared database workspace",
    "team database access",
    "AI agent database access",
    "managed database credentials",
    "secretless connections",
    "connection-pinned agent",
  ],
  authors: [{ name: "Jaesong Choi", url: "https://github.com/json-choi" }],
  creator: "Jaesong Choi",
  publisher: "DopeDB",
  category: "Developer Tools",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: "DopeDB - Share database access without sharing credentials",
    description:
      "A shared database access workspace with member-specific credentials and connection-pinned Codex or Claude sessions.",
    url: siteUrl,
    siteName: "DopeDB",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/dopedb-desktop.png",
        width: 2400,
        height: 1536,
        alt: "DopeDB Desktop showing the bundled Demo SQLite orders table",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "DopeDB - Shared database access",
    description:
      "Share a database connection and policy while credentials stay personal and every Agent stays pinned to exact authority.",
    images: ["/dopedb-desktop.png"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const lang = (await headers()).get("x-site-lang") === "ko" ? "ko" : "en";

  return (
    <html
      className={monoFont.variable}
      lang={lang}
    >
      <body className="tw:min-h-[100dvh] tw:bg-paper tw:text-ink tw:antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
