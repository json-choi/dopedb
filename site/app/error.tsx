"use client";

// The public site's render boundary. It reports only that the page failed: the
// thrown error, its message, and its digest stay on the server. Language comes
// from the URL for the same reason as not-found.tsx.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const copy = {
  en: {
    eyebrow: "DopeDB · Page error",
    title: "This page could not be displayed",
    description:
      "Something failed while rendering the page. The failure detail stays on the server and is not shown here.",
    retry: "Try again",
    home: "Go to the DopeDB home page",
  },
  ko: {
    eyebrow: "DopeDB · 페이지 오류",
    title: "이 페이지를 표시하지 못했습니다",
    description:
      "페이지를 그리는 중 문제가 발생했습니다. 실패 상세는 서버에 남으며 이 화면에는 표시하지 않습니다.",
    retry: "다시 시도",
    home: "DopeDB 홈으로 가기",
  },
} as const;

export default function SiteError({ reset }: { reset: () => void }) {
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
            <button
              type="button"
              onClick={reset}
              className="tw:inline-flex tw:items-center tw:rounded-sm tw:border tw:border-line tw:bg-paper-raised tw:px-3 tw:py-2 tw:text-sm tw:font-semibold tw:text-ink-soft"
            >
              {text.retry}
            </button>
            <Link
              href={homeHref}
              prefetch={false}
              className="tw:inline-flex tw:items-center tw:rounded-sm tw:border tw:border-line tw:px-3 tw:py-2 tw:text-sm tw:font-semibold tw:text-ink-soft"
            >
              {text.home}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
