// workspace administration shell messages are owned by this bounded feature catalogue.
import { defineCatalog } from "../types";

export const workspaceAdminCatalog = defineCatalog(
  {
    "workspaceAdmin.scope": "Workspace",
    "workspaceAdmin.members": "Members",
    "workspaceAdmin.access": "Database access",
    "workspaceAdmin.providers": "Providers",
    "workspaceAdmin.lifecycle": "Backups & deletion",
    "workspaceAdmin.account": "Account",
    "workspaceAdmin.manage": "Manage workspace",
    "workspaceAdmin.newWorkspace": "New workspace",
    "workspaceAdmin.roleViewer": "View only",
    "workspaceAdmin.roleAnalyst": "Read only",
    "workspaceAdmin.roleEditor": "Read / write",
    "workspaceAdmin.roleAdmin": "Admin",
    "workspaceAdmin.roleOwner": "Owner",
    "workspaceAdmin.loading": "Loading…",
    "workspaceAdmin.retry": "Try again",
    "workspaceAdmin.requestFailed": "The workspace service could not complete the request.",
    "workspaceAdmin.sessionExpired":
      "Your workspace session has ended. Sign in again from the account menu.",
    "workspaceAdmin.timeout":
      "The workspace service did not respond in time. Check the current state before trying again.",
    "workspaceAdmin.unreachable":
      "Could not reach the workspace service. Check your network connection and try again.",
  },
  {
    "workspaceAdmin.scope": "워크스페이스",
    "workspaceAdmin.members": "구성원",
    "workspaceAdmin.access": "DB 접근 권한",
    "workspaceAdmin.providers": "공급자",
    "workspaceAdmin.lifecycle": "백업 및 삭제",
    "workspaceAdmin.account": "계정",
    "workspaceAdmin.manage": "워크스페이스 관리",
    "workspaceAdmin.newWorkspace": "새 워크스페이스",
    "workspaceAdmin.roleViewer": "보기 전용",
    "workspaceAdmin.roleAnalyst": "읽기 전용",
    "workspaceAdmin.roleEditor": "읽기 / 쓰기",
    "workspaceAdmin.roleAdmin": "관리자",
    "workspaceAdmin.roleOwner": "소유자",
    "workspaceAdmin.loading": "불러오는 중…",
    "workspaceAdmin.retry": "다시 시도",
    "workspaceAdmin.requestFailed": "워크스페이스 서비스가 요청을 처리하지 못했습니다.",
    "workspaceAdmin.sessionExpired":
      "워크스페이스 세션이 끝났습니다. 계정 메뉴에서 다시 로그인하세요.",
    "workspaceAdmin.timeout":
      "워크스페이스 서비스가 제시간에 응답하지 않았습니다. 현재 상태를 확인한 뒤 다시 시도하세요.",
    "workspaceAdmin.unreachable":
      "워크스페이스 서비스에 연결하지 못했습니다. 네트워크 연결을 확인하고 다시 시도하세요.",
  },
);
