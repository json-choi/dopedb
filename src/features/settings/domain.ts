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
  | "appearance";

// Both Settings and Action Search index the same supported concepts in either locale.
export const settingsSearchKeywords: Record<SettingsSection, string> = {
  "agent-tools": "agent codex claude tools 에이전트 도구 설치 플러그인 스킬",
  advanced: "advanced debug debugging diagnostics developer 디버깅 진단 고급",
  cli: "command line terminal path cli 명령줄 터미널 경로",
  privacy: "privacy analytics telemetry consent 개인정보 분석 통계 동의",
  safety: "read only write approval policy audit schema 읽기 전용 쓰기 권한 승인 정책 감사 스키마 안전",
  updates: "version release upgrade update 버전 릴리스 업그레이드 업데이트",
  language: "locale korean english language 언어 한국어 영어",
  appearance: "theme appearance light dark system 테마 화면 라이트 다크 시스템",
};
