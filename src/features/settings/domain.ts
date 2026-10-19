// Settings navigation is application state shared by the shell and the modal screen.
// Keeping the section identity outside `screens/` prevents feature state from
// depending on a presentation entry point.
import type { I18nKey } from "../../lib/i18n";

export type SettingsSection =
  | "agent-tools"
  | "advanced"
  | "cli"
  | "safety"
  | "connection"
  | "updates"
  | "language"
  | "appearance"
  | "account";

// Both Settings and Action Search index the same supported concepts in either locale.
export const settingsSearchKeywords: Record<SettingsSection, string> = {
  "agent-tools": "agent codex claude tools account login 에이전트 도구 설치 플러그인 스킬 계정 로그인",
  advanced: "advanced debug debugging diagnostics logs bug report developer 디버깅 진단 로그 버그 제보 고급",
  cli: "command line terminal path cli 명령줄 터미널 경로",
  safety: "read only write approval policy audit schema 읽기 전용 쓰기 권한 승인 정책 감사 스키마 안전",
  connection: "connection database host port credentials environment dev prod staging 연결 데이터베이스 주소 자격 증명 환경 개발 운영",
  updates: "version release upgrade update 버전 릴리스 업그레이드 업데이트",
  language: "locale korean english language 언어 한국어 영어",
  appearance: "theme appearance light dark system 테마 화면 라이트 다크 시스템",
  account: "account sessions devices sign out deletion 계정 세션 기기 로그아웃 삭제 예약",
};

export type SettingsScope = "application" | "agents" | "account" | "dataSource";

// The one ordered list of Settings sections. The Settings dialog rail and Action
// Search both derive their entries from it so a new section cannot be missed by one.
export const settingsSections: ReadonlyArray<{
  id: SettingsSection;
  label: I18nKey;
  group: SettingsScope;
  needsConnection?: true;
  needsAccount?: true;
}> = [
  { id: "agent-tools", label: "settings.agentTools", group: "agents" },
  { id: "advanced", label: "settings.advanced", group: "application" },
  { id: "cli", label: "settings.cli", group: "agents" },
  { id: "appearance", label: "settings.appearance", group: "application" },
  { id: "language", label: "settings.languageTitle", group: "application" },
  { id: "updates", label: "settings.updates", group: "application" },
  { id: "account", label: "workspaceAdmin.account", group: "account", needsAccount: true },
  { id: "connection", label: "settings.connectionEnvironment", group: "dataSource", needsConnection: true },
  { id: "safety", label: "settings.safety", group: "dataSource", needsConnection: true },
];
