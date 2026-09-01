// safety messages are owned by this bounded feature catalogue.
import { defineCatalog } from "../types";

export const safetyCatalog = defineCatalog(
  {
    "safety.accessLevel": "Database access",
    "safety.accessLevelHint":
      "Choose the highest operation class this connection may propose. Each level includes the levels before it, and every mutation still needs exact approval.",
    "safety.accessRead": "Read only",
    "safety.accessWrite": "Data changes",
    "safety.accessSchema": "Schema changes",
    "safety.apply": "Apply safety settings",
    "safety.applying": "Applying...",
    "safety.autoRunReads": "Auto-run reads",
    "safety.autoRunReadsHint":
      "Run read-only SELECTs without a manual approve.",
    "safety.body":
      "This is the only Desktop control for read, data-change, and schema-change authority on this connection. Run approves SQL you authored; Agent proposals still require an explicit approval.",
    "safety.execPreviewRowLimit": "Exec-preview row limit",
    "safety.execPreviewRowLimitHint":
      "Skip execute-preview above this estimate (L3 gate).",
    "safety.explainPreview": "EXPLAIN preview",
    "safety.explainPreviewHint": "Show the plan / row estimate before running.",
    "safety.guardrails": "Guardrails",
    "safety.limits": "Limits",
    "safety.loading": "Loading safety settings...",
    "safety.loadFailed": "Safety settings could not be loaded. {error}",
    "safety.maxRows": "Max rows",
    "safety.maxRowsHint": "Row cap applied to read result sets.",
    "safety.memberLocalReadOnlyHint":
      "Member-local credentials are read-only. Workspace writes require a managed connection and an administrator-enabled write policy.",
    "safety.memberLocalSchemaUnavailable":
      "Schema changes are unavailable for member-local credentials. Configure managed access, then return to this Safety screen.",
    "safety.modeReadOnly": "Agent-safe read mode",
    "safety.modeSharedReadOnly": "Workspace read-only",
    "safety.modeSchemaChanges": "Schema changes allowed",
    "safety.modeWorkspaceWrites": "Workspace writes allowed",
    "safety.modeWrites": "Writes allowed",
    "safety.noUnsavedChanges": "Current settings are applied.",
    "safety.appliedWithSchemaUnavailable":
      "The selected read/data-change level is applied. Schema changes remain unavailable for the reason shown above.",
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
    "safety.saved": "Safety settings saved",
    "safety.refreshFailed":
      "The saved safety settings are still shown, but they could not be refreshed. {error}",
    "safety.sharedWritesHint":
      "A workspace administrator sets the maximum DB authority. This device switch can narrow an allowed write grant but cannot broaden it.",
    "safety.sharedWritesManagerHint":
      "One Apply updates the workspace mutation ceiling and this device gate together. Data and schema changes still use separate short-lived credentials.",
    "safety.mutationsEngineUnavailable":
      "This engine is read-only in DopeDB, so data and schema changes are unavailable.",
    "safety.schemaProviderUnavailable":
      "Managed schema changes currently require a Neon PostgreSQL connection. Other providers remain available for read and data-change access.",
    "safety.schemaRequiresManage":
      "Schema changes require the exact manage grant for this connection. A connection manager can choose the level here; there is no second permission screen.",
    "safety.workspacePolicyRollbackFailed":
      "The device stayed read-only, but the workspace write policy could not be rolled back. Retry with this switch off. {error}",
    "safety.title": "Safety settings",
    "safety.unsavedChanges":
      "Not applied yet. Apply to update this device and, for a managed connection, the workspace ceiling together.",
  },
  {
    "safety.accessLevel": "데이터베이스 접근",
    "safety.accessLevelHint":
      "이 연결에서 제안할 수 있는 가장 높은 작업 범위를 선택합니다. 상위 단계는 이전 단계를 포함하며 모든 변경은 여전히 정확한 승인이 필요합니다.",
    "safety.accessRead": "읽기 전용",
    "safety.accessWrite": "데이터 변경",
    "safety.accessSchema": "스키마 변경",
    "safety.apply": "안전 설정 적용",
    "safety.applying": "적용 중...",
    "safety.autoRunReads": "읽기 자동 실행",
    "safety.autoRunReadsHint": "읽기 전용 SELECT를 수동 승인 없이 실행합니다.",
    "safety.body":
      "이 연결의 읽기·데이터 변경·스키마 변경 권한을 제어하는 유일한 Desktop 화면입니다. 직접 작성한 SQL은 실행 동작이 승인이고, Agent 제안은 별도 승인이 필요합니다.",
    "safety.execPreviewRowLimit": "실행 미리보기 행 제한",
    "safety.execPreviewRowLimitHint":
      "예상 행 수가 이 값을 넘으면 실행 미리보기를 건너뜁니다 (L3 게이트).",
    "safety.explainPreview": "EXPLAIN 미리보기",
    "safety.explainPreviewHint": "실행 전 플랜과 행 추정치를 보여줍니다.",
    "safety.guardrails": "가드레일",
    "safety.limits": "제한값",
    "safety.loading": "안전 설정을 불러오는 중...",
    "safety.loadFailed": "안전 설정을 불러오지 못했습니다. {error}",
    "safety.maxRows": "최대 행 수",
    "safety.maxRowsHint": "읽기 결과 집합에 적용되는 행 수 제한입니다.",
    "safety.memberLocalReadOnlyHint":
      "구성원 로컬 자격 증명 연결은 읽기 전용입니다. 워크스페이스 쓰기는 관리형 연결과 관리자가 활성화한 쓰기 정책이 필요합니다.",
    "safety.memberLocalSchemaUnavailable":
      "구성원 로컬 자격 증명에서는 스키마 변경을 사용할 수 없습니다. 관리형 접근을 구성한 뒤 이 안전 화면으로 돌아오세요.",
    "safety.modeReadOnly": "에이전트 안전 읽기 모드",
    "safety.modeSharedReadOnly": "워크스페이스 읽기 전용",
    "safety.modeSchemaChanges": "스키마 변경 허용",
    "safety.modeWorkspaceWrites": "워크스페이스 쓰기 허용",
    "safety.modeWrites": "쓰기 허용",
    "safety.noUnsavedChanges": "현재 설정이 적용되어 있습니다.",
    "safety.appliedWithSchemaUnavailable":
      "선택한 읽기·데이터 변경 단계는 적용됐습니다. 위에 표시된 이유로 스키마 변경은 계속 사용할 수 없습니다.",
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
    "safety.saved": "안전 설정이 저장되었습니다",
    "safety.refreshFailed":
      "저장된 안전 설정을 계속 표시하지만 새로고침하지 못했습니다. {error}",
    "safety.sharedWritesHint":
      "워크스페이스 관리자가 DB 권한의 상한을 정합니다. 이 기기의 스위치는 허용된 쓰기 권한을 좁힐 수 있지만 더 넓힐 수는 없습니다.",
    "safety.sharedWritesManagerHint":
      "한 번의 적용으로 워크스페이스 변경 상한과 이 기기의 gate를 함께 갱신합니다. 데이터 변경과 스키마 변경에는 서로 다른 단기 자격 증명을 사용합니다.",
    "safety.mutationsEngineUnavailable":
      "이 엔진은 DopeDB에서 읽기 전용이므로 데이터 변경과 스키마 변경을 사용할 수 없습니다.",
    "safety.schemaProviderUnavailable":
      "관리형 스키마 변경은 현재 Neon PostgreSQL 연결에서 지원합니다. 다른 공급자는 읽기와 데이터 변경을 계속 사용할 수 있습니다.",
    "safety.schemaRequiresManage":
      "스키마 변경에는 이 연결의 정확한 관리 권한이 필요합니다. 연결 관리자가 이 화면에서 단계를 선택하며 별도의 권한 화면은 없습니다.",
    "safety.workspacePolicyRollbackFailed":
      "이 기기는 읽기 전용으로 유지됐지만 워크스페이스 쓰기 정책을 되돌리지 못했습니다. 스위치를 끈 상태로 다시 저장하세요. {error}",
    "safety.title": "안전 설정",
    "safety.unsavedChanges":
      "아직 적용되지 않았습니다. 적용을 누르면 이 기기와 관리형 연결의 워크스페이스 상한을 함께 갱신합니다.",
  },
);
