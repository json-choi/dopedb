// Public landing route owns language resolution, metadata, structured data, and section composition.
import type { Metadata } from "next";
import { HomeActionSections } from "./HomeActionSections";
import { HomeAccessSections } from "./HomeAccessSections";
import { HomeFooter, HomeHeader } from "./HomeChrome";
import {
  downloadUrls,
  homeCopy,
  repoUrl,
  siteUrl,
  type Lang,
} from "./homeContent";

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function normalizeLang(value: string | string[] | undefined): Lang {
  const lang = Array.isArray(value) ? value[0] : value;
  return lang === "ko" ? "ko" : "en";
}
async function resolveLang(searchParams: HomeProps["searchParams"]): Promise<Lang> {
  const params = searchParams ? await searchParams : {};
  return normalizeLang(params.lang);
}
export async function generateMetadata({ searchParams }: HomeProps): Promise<Metadata> {
  const lang = await resolveLang(searchParams);
  const languageAlternates = {
    "en-US": "/",
    "ko-KR": "/ko",
    "x-default": "/",
  };

  if (lang === "ko") {
    const title = "DopeDB(도프디비) - 팀과 AI Agent를 위한 DB 접근 워크스페이스";
    const description =
      "팀은 DB 인증정보 대신 연결과 정책을 공유하고, Codex와 Claude는 한 Project에서 선택한 리소스의 로컬 권한 경계 안에서 일합니다.";

    return {
      title: { absolute: title },
      description,
      keywords: [
        "도프디비",
        "DopeDB",
        "팀 데이터베이스 워크스페이스",
        "공유 데이터베이스 접근",
        "AI Agent 데이터베이스 접근",
        "Neon 데이터베이스 접근",
        "비밀값 없는 연결",
      ],
      alternates: {
        canonical: "/ko",
        languages: languageAlternates,
      },
      openGraph: {
        title,
        description,
        url: `${siteUrl}/ko`,
        siteName: "DopeDB(도프디비)",
        locale: "ko_KR",
        type: "website",
        images: [
          {
            url: "/dopedb-desktop-0.4.21-ko.png",
            width: 2400,
            height: 1600,
            alt: "Demo SQLite 주문 테이블·컬럼·외래 키를 보여주는 실제 DopeDB 0.4.21 화면",
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: ["/dopedb-desktop-0.4.21-ko.png"],
      },
    };
  }

  return {
    alternates: {
      canonical: "/",
      languages: languageAlternates,
    },
  };
}

export default async function Home({ searchParams }: HomeProps) {
  const lang = await resolveLang(searchParams);
  const c = homeCopy[lang];

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    url: siteUrl,
    name: "DopeDB",
    alternateName: "도프디비",
    inLanguage: ["en", "ko"],
  };

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "DopeDB",
    alternateName: "도프디비",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS, Windows",
    description: c.jsonDescription,
    url: siteUrl,
    downloadUrl: [downloadUrls.windows, downloadUrls.macApple, downloadUrls.macIntel],
    codeRepository: repoUrl,
    image: `${siteUrl}${c.product.imageSrc}`,
    license: `${repoUrl}/blob/main/LICENSE`,
    inLanguage: lang,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };

  return (
    <main className="tw:overflow-clip tw:bg-night tw:text-cream" lang={lang}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <a
        className="tw:fixed tw:top-3 tw:left-3 tw:z-50 tw:-translate-y-24 tw:bg-signal tw:px-4 tw:py-3 tw:font-mono tw:text-xs tw:font-semibold tw:text-night tw:uppercase tw:focus:translate-y-0"
        href="#content"
      >
        {c.nav.skip}
      </a>

      <HomeHeader c={c} lang={lang} />

      <div id="content">
        <HomeAccessSections c={c} lang={lang} />
        <HomeActionSections c={c} />
      </div>

      <HomeFooter c={c} lang={lang} />
    </main>
  );
}
