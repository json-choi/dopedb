import type { ConnectionProfile } from "../connections/domain";
import type { CatalogLoadIssue } from "./catalogDomain";

export type WorkspaceDialogState = {
  connection: ConnectionProfile;
};

export type CatalogExplorerState = {
  scopeKey: string;
  wanted: Set<string>;
  refreshErrors: Record<string, CatalogLoadIssue>;
  openConnections: Set<string>;
  refreshingId: string | null;
  deletingId: string | null;
  collapsedSections: Set<string>;
  objectSectionsOpen: Set<string>;
  showRowCounts: boolean;
  openMenuId: string | null;
  workspaceDialog: WorkspaceDialogState | null;
};
