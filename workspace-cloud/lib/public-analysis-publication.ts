//! One integrity-checked, rate-limited read path for public Analysis Articles.

import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "./db";
import { consumeRateLimit } from "./rate-limit";
import { workspaceAnalysisPublication } from "./schema";
import { parseAnalysisPublicSnapshot } from "./workspace-analysis-publications";
import { canonicalHash } from "./workspace-versioning";

const SLUG = /^[a-z0-9][a-z0-9-]{7,127}$/;

export async function consumePublicAnalysisBudget(clientKey: string) {
  return await consumeRateLimit({
    namespace: "public-analysis",
    discriminator: clientKey,
    limit: 120,
  });
}

export async function loadPublicAnalysisPublication(slug: string) {
  if (!SLUG.test(slug)) return null;
  const publication = await db.query.workspaceAnalysisPublication.findFirst({
    where: and(
      eq(workspaceAnalysisPublication.slug, slug),
      isNull(workspaceAnalysisPublication.revokedAt),
    ),
  });
  if (!publication || canonicalHash(publication.snapshot) !== publication.snapshotHash) {
    return null;
  }
  try {
    return {
      ...publication,
      article: parseAnalysisPublicSnapshot(publication.snapshot),
    };
  } catch {
    return null;
  }
}
