// Workspace management navigation identity, shared by the shell route, the Workspace
// management dialog and Action Search. This module alone decides which sections a role
// sees and in what order. Account is an application Settings section
// reached through `requestAccountSettings`, not a section here.
import type { I18nKey } from "../../lib/i18n";
import type { WorkspaceAdminScope } from "./domain";

export type WorkspaceAdminSection =
  | "workspace-members"
  | "workspace-providers"
  | "workspace-lifecycle";

export type WorkspaceAdminSectionDefinition = Readonly<{
  id: WorkspaceAdminSection;
  label: I18nKey;
  /** Both locales, so the dialog and Action Search index the same concepts. */
  keywords: string;
  ownerOnly: boolean;
}>;

const SECTIONS: readonly WorkspaceAdminSectionDefinition[] = [
  {
    id: "workspace-members",
    label: "workspaceAdmin.members",
    keywords: "members invite invitation role team 구성원 초대 역할 팀",
    ownerOnly: false,
  },
  {
    id: "workspace-providers",
    label: "workspaceAdmin.providers",
    keywords:
      "provider account planetscale neon google cloud sql vault branch repair managed reauthorize 공급자 계정 브랜치 복구 관리형 재승인",
    ownerOnly: false,
  },
  {
    id: "workspace-lifecycle",
    label: "workspaceAdmin.lifecycle",
    keywords: "backup restore key rotation retention delete workspace 백업 복원 키 회전 보존 삭제 워크스페이스",
    ownerOnly: true,
  },
];

/**
 * Sections the member's role can run, in display order: none without management
 * authority, and backups & deletion for owners only. Callers show no disabled
 * placeholder for the rest.
 */
export function workspaceAdminSectionsFor(
  scope: Pick<WorkspaceAdminScope, "canManage" | "isOwner"> | null,
): readonly WorkspaceAdminSectionDefinition[] {
  if (!scope?.canManage) return [];
  return SECTIONS.filter((section) => !section.ownerOnly || scope.isOwner);
}
