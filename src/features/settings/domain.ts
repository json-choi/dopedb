// Settings navigation is application state shared by the shell and the modal screen.
// Keeping the section identity outside `screens/` prevents feature state from
// depending on a presentation entry point.
export type SettingsSection =
  | "agent-tools"
  | "advanced"
  | "cli"
  | "privacy"
  | "safety"
  | "updates"
  | "language"
  | "appearance"
  | "account"
  | "workspace-members"
  | "workspace-access"
  | "workspace-providers"
  | "workspace-lifecycle";

// Both Settings and Action Search index the same supported concepts in either locale.
export const settingsSearchKeywords: Record<SettingsSection, string> = {
  "agent-tools": "agent codex claude tools 에이전트 도구 설치 플러그인 스킬",
  advanced: "advanced debug debugging diagnostics logs bug report developer 디버깅 진단 로그 버그 제보 고급",
  cli: "command line terminal path cli 명령줄 터미널 경로",
  privacy: "privacy analytics telemetry consent 개인정보 분석 통계 동의",
  safety: "read only write approval policy audit schema 읽기 전용 쓰기 권한 승인 정책 감사 스키마 안전",
  updates: "version release upgrade update 버전 릴리스 업그레이드 업데이트",
  language: "locale korean english language 언어 한국어 영어",
  appearance: "theme appearance light dark system 테마 화면 라이트 다크 시스템",
  account: "account sessions devices sign out deletion 계정 세션 기기 로그아웃 삭제 예약",
  "workspace-members": "members invite invitation role team 구성원 초대 역할 팀",
  "workspace-access": "database access grant team read conflict 데이터베이스 접근 권한 팀 읽기 충돌",
  "workspace-providers": "provider planetscale neon google cloud sql vault branch import 공급자 브랜치 가져오기 관리형",
  "workspace-lifecycle": "backup restore key rotation retention delete workspace 백업 복원 키 회전 보존 삭제 워크스페이스",
};
