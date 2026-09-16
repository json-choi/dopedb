"use client";

// The public site's terminal page for an address it does not serve. A typo, a
// stale link, and a share that was withdrawn all read the same here, so the
// page never reports whether anything exists at the requested address. The site
// resolves language from the URL rather than a header, because middleware runs
// only on the known routes and never on an unmatched one.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const copy = {
  en: {
    eyebrow: "DopeDB · Page not found",
    title: "This address is not served here",
    description:
      "The link may be mistyped, out of date, or no longer shared with you. DopeDB does not report whether anything exists at this address.",
    home: "Go to the DopeDB home page",
  },
  ko: {
    eyebrow: "DopeDB · 페이지 없음",
    title: "이 주소는 여기에서 제공하지 않습니다",
    description:
      "주소가 잘못되었거나, 오래된 링크이거나, 더 이상 공유되지 않는 링크일 수 있습니다. DopeDB는 이 주소에 무언가가 있는지 알려 주지 않습니다.",
    home: "DopeDB 홈으로 가기",
  },
} as const;

export default function SiteNotFound() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lang = pathname === "/ko"
    || pathname.startsWith("/ko/")
    || searchParams.get("lang") === "ko"
    ? "ko"
    : "en";
  const text = copy[lang];
  const homeHref = lang === "ko" ? "/ko" : "/";

  return (
    <main
      lang={lang}
      className="tw:grid tw:min-h-[100dvh] tw:bg-paper tw:px-4 tw:py-6 tw:text-ink tw:sm:px-6 tw:sm:py-10"
    >
      <div className="tw:mx-auto tw:grid tw:w-full tw:max-w-[920px] tw:grid-rows-[auto_minmax(0,1fr)]">
        <nav
          aria-label={lang === "ko" ? "사이트 탐색" : "Site navigation"}
          className="tw:flex tw:items-center tw:border-b tw:border-line tw:pb-5"
        >
          <Link
            href={homeHref}
            prefetch={false}
            className="tw:font-bold tw:text-ink"
          >
            DopeDB
          </Link>
        </nav>
        <div className="tw:grid tw:max-w-[720px] tw:content-center tw:py-16">
          <p className="tw:text-xs tw:font-bold tw:tracking-[0.08em] tw:text-brand-emphasis tw:uppercase">
            {text.eyebrow}
          </p>
          <h1 className="tw:mt-4 tw:text-4xl tw:leading-tight tw:font-extrabold tw:tracking-[-0.03em] tw:sm:text-5xl">
            {text.title}
          </h1>
          <p className="tw:mt-5 tw:text-base tw:leading-7 tw:text-ink-soft">
            {text.description}
          </p>
          <div className="tw:mt-8 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            <Link
              href={homeHref}
              prefetch={false}
              className="tw:inline-flex tw:items-center tw:rounded-sm tw:border tw:border-line tw:bg-paper-raised tw:px-3 tw:py-2 tw:text-sm tw:font-semibold tw:text-ink-soft"
            >
              {text.home}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
