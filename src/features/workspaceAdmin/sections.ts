// Workspace management navigation identity, shared by the shell route, the Workspace
// management dialog and Action Search. This module alone decides which sections a role
// sees and in what order. Account stays an application Settings section; panels may
// still ask for it, and the shell answers by opening Settings.
import type { I18nKey } from "../../lib/i18n";
import type { WorkspaceAdminScope } from "./domain";

export type WorkspaceAdminSection =
  | "workspace-members"
  | "workspace-access"
  | "workspace-providers"
  | "workspace-lifecycle";

/** Where an administration panel or request may send the person next. */
export type WorkspaceAdminDestination = WorkspaceAdminSection | "account";

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
    id: "workspace-access",
    label: "workspaceAdmin.access",
    keywords: "database access grant team read conflict 데이터베이스 접근 권한 팀 읽기 충돌",
    ownerOnly: false,
  },
  {
    id: "workspace-providers",
    label: "workspaceAdmin.providers",
    keywords:
      "provider planetscale neon google cloud sql vault branch import add shared database 공급자 브랜치 가져오기 관리형 공유 DB 추가",
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
