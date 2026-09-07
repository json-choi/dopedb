import { notFound } from "next/navigation";
import { isUuid } from "../../../../lib/http";
import { HandoffPage } from "../../../../features/articleSharing/HandoffPage";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function Page({ params }: { params: Promise<{ workspaceId: string; articleId: string }> }) {
  const scope = await params;
  if (!isUuid(scope.workspaceId) || !isUuid(scope.articleId)) notFound();
  return <HandoffPage scope={scope} />;
}
