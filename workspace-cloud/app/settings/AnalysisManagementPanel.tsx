"use client";

// Settings binds route inputs to the feature-owned Analysis controller and view.
import { AnalysisManagementView } from "../../features/analysisManagement/AnalysisManagementView";
import { useAnalysisManagement } from "../../features/analysisManagement/useAnalysisManagement";

export function AnalysisManagementPanel({
  workspaceId,
  initialArticleId,
}: {
  workspaceId: string;
  initialArticleId: string | null;
}) {
  const controller = useAnalysisManagement({ workspaceId, initialArticleId });
  return <AnalysisManagementView controller={controller} />;
}
