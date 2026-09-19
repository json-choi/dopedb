import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Brand } from "../../components/Brand";
import {
  consumePublicAnalysisBudget,
  loadPublicAnalysisPublication,
} from "../../../lib/public-analysis-publication";
import { forwardedClientKey } from "../../../lib/rate-limit";
import { getWorkspaceLocale } from "../../../lib/workspace-locale-server";
import { workspaceSiteUrl } from "../../../lib/workspace-site";
import { articleSharingCopy } from "../../../features/articleSharing/copy";
import { formatPublicationInstant, PublicAnalysisArticle } from "./PublicAnalysisArticle";

// A publication slug is revocable access, not an immutable asset URL. Always
// ask the database for its current revocation state and never prerender it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Next's server contract scopes React.cache to one request and explicitly uses it
// to deduplicate ORM reads shared by generateMetadata and the page. Keep budget
// consumption inside this memoized boundary so one HTML request consumes one unit.
const publication = cache(async (slug: string, clientKey: string) => {
  if (!await consumePublicAnalysisBudget(clientKey)) return { kind: "rate_limited" as const };
  const result = await loadPublicAnalysisPublication(slug);
  return result ? { kind: "found" as const, result } : { kind: "not_found" as const };
});

async function requestedPublication(slug: string) {
  const clientKey = forwardedClientKey(await headers());
  return await publication(slug, clientKey);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getWorkspaceLocale();
  const copy = articleSharingCopy[locale];
  const loaded = await requestedPublication(slug);
  if (loaded.kind !== "found") return { title: copy.unavailableTitle, robots: { index: false } };
  const { result } = loaded;
  const index = result.visibility === "public" && result.article.searchIndexable;
  // The sibling `opengraph-image.png` is the generated brand card; Next merges it
  // into this `openGraph` object because it declares no `images` of its own, and
  // metadataBase is what turns that relative route into the absolute URL a
  // crawler can fetch. The card carries no query, result, or workspace text.
  return {
    metadataBase: new URL(workspaceSiteUrl),
    title: `${result.article.title} · DopeDB`,
    description: copy.publicationDescription,
    robots: { index, follow: index },
    openGraph: {
      type: "article",
      title: result.article.title,
      description: copy.publicationDescription,
      publishedTime: result.publishedAt.toISOString(),
    },
  };
}

export default async function AnalysisPublicationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const locale = await getWorkspaceLocale();
  const copy = articleSharingCopy[locale];
  const loaded = await requestedPublication(slug);
  if (loaded.kind !== "found") notFound();
  const { result } = loaded;
  return (
    <>
      <header className="tw:relative tw:z-[1] tw:border-b tw:border-border tw:bg-surface/90 tw:backdrop-blur-xl">
        <div className="tw:mx-auto tw:flex tw:min-h-control-lg tw:w-full tw:max-w-[1440px] tw:items-center tw:justify-between tw:px-6 tw:py-3 tw:max-[640px]:px-4">
          <Brand destination="marketing" />
          <span className="tw:font-mono tw:text-2xs tw:text-muted-foreground">
            {copy.publicationResult}
          </span>
        </div>
      </header>
      <main id="main-content" className="tw:relative tw:z-[1] tw:mx-auto tw:w-full tw:max-w-[1440px] tw:px-6 tw:py-12 tw:max-[640px]:px-4 tw:max-[640px]:py-8">
        <PublicAnalysisArticle article={result.article} locale={locale} />
      </main>
      <footer className="tw:relative tw:z-[1] tw:mx-auto tw:flex tw:w-full tw:max-w-[1440px] tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-t tw:border-border tw:px-6 tw:py-6 tw:text-2xs tw:text-muted-foreground tw:max-[640px]:px-4">
        <span>
          {copy.published} <time dateTime={result.publishedAt.toISOString()}>
            {formatPublicationInstant(result.publishedAt, locale)}
          </time>
        </span>
        <code>{result.snapshotHash}</code>
      </footer>
    </>
  );
}
