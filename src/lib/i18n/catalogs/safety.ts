// safety messages are owned by this bounded feature catalogue.
import { defineCatalog } from "../types";

export const safetyCatalog = defineCatalog(
  {
    "safety.allowWrites": "Allow writes",
    "safety.allowWritesHint": "Master gate for the write path (off by default).",
    "safety.autoRunReads": "Auto-run reads",
    "safety.autoRunReadsHint":
      "Run read-only SELECTs without a manual approve.",
    "safety.body":
      "This connection's database policy. Reads can move quickly; writes stay visible and gated.",
    "safety.connectionWritePolicyRequired":
      "This data source's write policy is off. Enable Allow write operations under Data Source Options before opening the local safety gate.",
    "safety.execPreviewRowLimit": "Exec-preview row limit",
    "safety.execPreviewRowLimitHint":
      "Skip execute-preview above this estimate (L3 gate).",
    "safety.explainPreview": "EXPLAIN preview",
    "safety.explainPreviewHint":
      "Fetch the plan / row estimate before running. Off sends no EXPLAIN on any connection, including production, so SQL Explain returns no plan and no row-threshold caution is raised.",
    "safety.guardrails": "Guardrails",
    "safety.limits": "Limits",
    "safety.loadFailed": "Could not load safety settings: {error}",
    "safety.loading": "Loading safety settings...",
    "safety.maxRows": "Max rows",
    "safety.maxRowsHint": "Row cap applied to read result sets.",
    "safety.memberLocalReadOnlyHint":
      "Member-local credentials are read-only. Workspace writes require a managed connection and an administrator-enabled write policy.",
    "safety.modeReadOnly": "Agent-safe read mode",
    "safety.modeSharedReadOnly": "Workspace read-only",
    "safety.modeWorkspaceWrites": "Workspace writes allowed",
    "safety.modeWrites": "Writes allowed",
    "safety.monitoringAdminHint":
      "This account may need a DBA to grant the role. You can still try or copy the fixed SQL.",
    "safety.monitoringApproveApply": "Approve exact change",
    "safety.monitoringBasicHint":
      "No PostgreSQL role setup is needed; Agent planning uses the aggregate signals this engine provides.",
    "safety.monitoringBody":
      "Lets Agent planning check aggregate connection pressure, long-running work, and lock waits before a query runs. Other sessions' SQL text is never sent to the agent.",
    "safety.monitoringCopied": "Grant SQL copied",
    "safety.monitoringCopyFailed": "Could not copy the grant SQL",
    "safety.monitoringCopyGrant": "Copy grant SQL",
    "safety.monitoringCoverageBasic": "Basic",
    "safety.monitoringCoverageFull": "Full coverage",
    "safety.monitoringCoverageLimited": "Limited",
    "safety.monitoringEnable": "Enable pg_monitor",
    "safety.monitoringEnableConfirm": "Grant pg_monitor to this database user?",
    "safety.monitoringEnabled": "PostgreSQL monitoring access enabled",
    "safety.monitoringError": "Could not check monitoring access: {error}",
    "safety.monitoringFullHint":
      "pg_monitor is enabled, so Agent planning can check aggregate server activity.",
    "safety.monitoringLimitedHint":
      "Agent planning has limited visibility until pg_monitor is granted.",
    "safety.monitoringReviewGrant": "Review pg_monitor grant",
    "safety.monitoringReviewRevoke": "Review pg_monitor removal",
    "safety.monitoringRevoke": "Remove pg_monitor",
    "safety.monitoringRevokeConfirm": "Remove pg_monitor from this database user?",
    "safety.monitoringRevoked": "PostgreSQL monitoring access removed",
    "safety.monitoringRoleUnavailable":
      "This PostgreSQL server does not expose the built-in pg_monitor role.",
    "safety.monitoringTitle": "Agent monitoring access",
    "safety.monitoringUser": "Database user",
    "safety.monitoringWorking": "Applying...",
    "safety.openConnectionOptions": "Open Data Source Options",
    "safety.saved": "Safety settings saved",
    "safety.sharedWritesHint":
      "A workspace administrator controls this DB policy. When enabled, it remains effective for members with an Editor, Admin, or Owner role and a use grant; short-lived credentials rotate automatically.",
    "safety.title": "Safety settings",
  },
  {
    "safety.allowWrites": "쓰기 허용",
    "safety.allowWritesHint": "쓰기 경로의 마스터 게이트입니다. 기본값은 꺼짐입니다.",
    "safety.autoRunReads": "읽기 자동 실행",
    "safety.autoRunReadsHint": "읽기 전용 SELECT를 수동 승인 없이 실행합니다.",
    "safety.body":
      "이 연결의 데이터베이스 정책입니다. 읽기는 빠르게 흐르게 두고, 쓰기는 보이는 승인 흐름 뒤에 둡니다.",
    "safety.connectionWritePolicyRequired":
      "이 데이터 소스의 쓰기 정책이 꺼져 있습니다. 로컬 안전 게이트를 열기 전에 데이터 소스 옵션에서 ‘쓰기 작업 허용’을 켜세요.",
    "safety.execPreviewRowLimit": "실행 미리보기 행 제한",
    "safety.execPreviewRowLimitHint":
      "예상 행 수가 이 값을 넘으면 실행 미리보기를 건너뜁니다 (L3 게이트).",
    "safety.explainPreview": "EXPLAIN 미리보기",
    "safety.explainPreviewHint":
      "실행 전 플랜과 행 추정치를 가져옵니다. 끄면 운영을 포함한 모든 연결에서 EXPLAIN을 보내지 않으므로 SQL Explain이 플랜을 반환하지 않고 예상 행 수 주의도 생성되지 않습니다.",
    "safety.guardrails": "가드레일",
    "safety.limits": "제한값",
    "safety.loadFailed": "안전 설정을 불러오지 못했습니다: {error}",
    "safety.loading": "안전 설정을 불러오는 중...",
    "safety.maxRows": "최대 행 수",
    "safety.maxRowsHint": "읽기 결과 집합에 적용되는 행 수 제한입니다.",
    "safety.memberLocalReadOnlyHint":
      "구성원 로컬 자격 증명 연결은 읽기 전용입니다. 워크스페이스 쓰기는 관리형 연결과 관리자가 활성화한 쓰기 정책이 필요합니다.",
    "safety.modeReadOnly": "에이전트 안전 읽기 모드",
    "safety.modeSharedReadOnly": "워크스페이스 읽기 전용",
    "safety.modeWorkspaceWrites": "워크스페이스 쓰기 허용",
    "safety.modeWrites": "쓰기 허용",
    "safety.monitoringAdminHint":
      "이 계정은 역할 부여에 DBA 권한이 필요할 수 있습니다. 버튼을 시도하거나 고정 SQL을 복사할 수 있습니다.",
    "safety.monitoringApproveApply": "정확한 변경 승인",
    "safety.monitoringBasicHint":
      "PostgreSQL 역할 설정 없이 이 엔진이 제공하는 집계 상태를 Agent가 확인합니다.",
    "safety.monitoringBody":
      "Agent가 쿼리 실행 전에 연결 부하, 장기 실행 작업, 락 대기를 집계해 확인합니다. 다른 세션의 SQL 원문은 Agent로 보내지 않습니다.",
    "safety.monitoringCopied": "권한 SQL을 복사했습니다",
    "safety.monitoringCopyFailed": "권한 SQL을 복사하지 못했습니다",
    "safety.monitoringCopyGrant": "권한 SQL 복사",
    "safety.monitoringCoverageBasic": "기본",
    "safety.monitoringCoverageFull": "전체 확인",
    "safety.monitoringCoverageLimited": "제한됨",
    "safety.monitoringEnable": "pg_monitor 활성화",
    "safety.monitoringEnableConfirm": "이 DB 사용자에게 pg_monitor 역할을 부여할까요?",
    "safety.monitoringEnabled": "PostgreSQL 모니터링 접근을 활성화했습니다",
    "safety.monitoringError": "모니터링 접근을 확인하지 못했습니다: {error}",
    "safety.monitoringFullHint":
      "pg_monitor가 활성화되어 Agent가 서버 활동 집계를 확인할 수 있습니다.",
    "safety.monitoringLimitedHint":
      "pg_monitor를 부여하기 전까지 Agent가 확인할 수 있는 상태 정보가 제한됩니다.",
    "safety.monitoringReviewGrant": "pg_monitor 부여 검토",
    "safety.monitoringReviewRevoke": "pg_monitor 제거 검토",
    "safety.monitoringRevoke": "pg_monitor 제거",
    "safety.monitoringRevokeConfirm": "이 DB 사용자에게서 pg_monitor 역할을 제거할까요?",
    "safety.monitoringRevoked": "PostgreSQL 모니터링 접근을 제거했습니다",
    "safety.monitoringRoleUnavailable":
      "이 PostgreSQL 서버에는 기본 제공 pg_monitor 역할이 없습니다.",
    "safety.monitoringTitle": "Agent 모니터링 접근",
    "safety.monitoringUser": "DB 사용자",
    "safety.monitoringWorking": "적용 중...",
    "safety.openConnectionOptions": "데이터 소스 옵션 열기",
    "safety.saved": "안전 설정이 저장되었습니다",
    "safety.sharedWritesHint":
      "이 DB 정책은 워크스페이스 관리자가 정합니다. 쓰기를 허용하면 사용 권한이 있는 에디터·관리자·소유자에게 역할이 유지되는 동안 적용되고 단기 자격증명은 자동 회전합니다.",
    "safety.title": "안전 설정",
  },
);
