// safety messages are owned by this bounded feature catalogue.
import { defineCatalog } from "../types";

export const safetyCatalog = defineCatalog(
  {
    "safety.accessLevel": "Database permissions",
    "safety.accessLevelHint":
      "Permissions are cumulative in this Safety gate: reading is the baseline, and schema changes require data changes. Workspace grants and database credentials still set the outer limit. Every mutation still needs exact approval.",
    "safety.accessRead": "Read data",
    "safety.accessReadHint":
      "This Safety gate does not block read queries. Workspace grants and database credentials still determine what can be read; turn off Auto-run reads to review each query first.",
    "safety.accessWrite": "Data changes",
    "safety.accessWriteHint":
      "Allow INSERT, UPDATE, and DELETE proposals. Every data change still requires exact approval.",
    "safety.accessSchema": "Schema changes",
    "safety.accessSchemaHint":
      "Allow CREATE, ALTER, DROP, and other DDL proposals. Data changes must be enabled first, and every schema change still requires exact approval.",
    "safety.apply": "Apply permissions",
    "safety.applying": "Applying...",
    "safety.autoRunReads": "Auto-run reads",
    "safety.autoRunReadsHint":
      "Run read-only SELECTs without a manual approve.",
    "safety.body":
      "Review the Safety permissions applied to this connection. A checked box never widens its workspace grant or database credential. Data and schema changes are explicit device opt-ins. Run approves SQL you authored; Agent proposals still require explicit approval.",
    "safety.execPreviewRowLimit": "Estimated-row review threshold",
    "safety.execPreviewRowLimitHint":
      "When the database reports an estimated row count above this value, add an extra-review warning. This value neither skips the preview nor approves execution.",
    "safety.explainPreview": "Query impact preview (EXPLAIN)",
    "safety.explainPreviewHint":
      "Before a read or data change runs, request its plan without executing the statement. When available, show the estimated rows or processing size. Schema changes are reviewed directly instead.",
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
    "safety.noUnsavedChanges": "Current settings are applied.",
    "safety.appliedWithSchemaUnavailable":
      "The selected read and data-change permissions are applied. Schema changes remain unavailable for the reason shown above.",
    "safety.appliedReadOnlyWithSchemaUnavailable":
      "Read-only access is applied. Data changes are off, and schema changes remain unavailable for the reason shown above.",
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
      "Turn on permissions only within the maximum granted to your account. Ask a connection manager to broaden that maximum.",
    "safety.sharedWritesManagerHint":
      "Use these cumulative checkboxes for this connection. Apply updates the workspace ceiling and this device's gate together; there is no second write setting.",
    "safety.mutationsEngineUnavailable":
      "This engine is read-only in DopeDB, so data and schema changes are unavailable.",
    "safety.schemaProviderUnavailable":
      "Managed schema changes require a Neon or GCP Cloud SQL PostgreSQL connection. Other providers remain available for read and data-change access.",
    "safety.schemaRequiresManage":
      "Schema changes require the exact manage grant for this connection. A connection manager can enable the permission here; there is no second permission screen.",
    "safety.workspacePolicyRollbackFailed":
      "The device stayed read-only, but the workspace write policy could not be rolled back. Retry with Data changes unchecked. {error}",
    "safety.title": "Safety settings",
    "safety.unsavedChanges":
      "Not applied yet. Apply to save the selected permissions for this connection.",
  },
  {
    "safety.accessLevel": "데이터베이스 권한",
    "safety.accessLevelHint":
      "이 Safety 게이트의 권한은 누적됩니다. 데이터 읽기가 기본이며 스키마 변경에는 데이터 변경 권한이 필요합니다. 실제 허용 범위는 워크스페이스 권한과 DB 자격 증명을 넘을 수 없고, 모든 변경은 정확한 승인을 거칩니다.",
    "safety.accessRead": "데이터 읽기",
    "safety.accessReadHint":
      "이 Safety 게이트는 읽기 쿼리를 막지 않습니다. 실제로 읽을 수 있는 범위는 워크스페이스 권한과 DB 자격 증명이 정하며, 쿼리마다 먼저 검토하려면 읽기 자동 실행을 끄세요.",
    "safety.accessWrite": "데이터 변경",
    "safety.accessWriteHint":
      "INSERT, UPDATE, DELETE 제안을 허용합니다. 모든 데이터 변경은 여전히 정확한 승인을 거칩니다.",
    "safety.accessSchema": "스키마 변경",
    "safety.accessSchemaHint":
      "CREATE, ALTER, DROP 등 DDL 제안을 허용합니다. 먼저 데이터 변경을 켜야 하며 모든 스키마 변경은 여전히 정확한 승인을 거칩니다.",
    "safety.apply": "권한 적용",
    "safety.applying": "적용 중...",
    "safety.autoRunReads": "읽기 자동 실행",
    "safety.autoRunReadsHint": "읽기 전용 SELECT를 수동 승인 없이 실행합니다.",
    "safety.body":
      "이 연결에 적용할 Safety 권한을 확인합니다. 체크한 항목도 워크스페이스 권한이나 DB 자격 증명 범위를 넓히지는 않습니다. 데이터 및 스키마 변경은 이 기기에서 명시적으로 허용해야 합니다. 직접 작성한 SQL은 실행 동작이 승인이고, Agent 제안은 별도 승인이 필요합니다.",
    "safety.execPreviewRowLimit": "예상 행 검토 기준",
    "safety.execPreviewRowLimitHint":
      "데이터베이스가 알려준 예상 행 수가 이 값을 넘으면 추가 검토 경고를 표시합니다. 이 값은 미리보기를 건너뛰거나 실행을 승인하지 않습니다.",
    "safety.explainPreview": "쿼리 영향 미리보기 (EXPLAIN)",
    "safety.explainPreviewHint":
      "읽기나 데이터 변경을 실행하기 전에 SQL을 실제로 실행하지 않고 실행 계획을 요청합니다. 가능한 경우 예상 행 수나 처리량을 보여주며, 스키마 변경은 문장을 직접 검토합니다.",
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
    "safety.noUnsavedChanges": "현재 설정이 적용되어 있습니다.",
    "safety.appliedWithSchemaUnavailable":
      "선택한 읽기·데이터 변경 권한은 적용됐습니다. 위에 표시된 이유로 스키마 변경은 계속 사용할 수 없습니다.",
    "safety.appliedReadOnlyWithSchemaUnavailable":
      "읽기 전용 접근이 적용됐습니다. 데이터 변경은 꺼져 있고, 위에 표시된 이유로 스키마 변경은 계속 사용할 수 없습니다.",
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
      "현재 계정에 부여된 최대 범위 안에서 필요한 권한만 켤 수 있습니다. 범위를 넓히려면 연결 관리자에게 요청하세요.",
    "safety.sharedWritesManagerHint":
      "이 연결의 누적 권한을 체크박스로 설정합니다. 적용하면 워크스페이스 상한과 이 기기의 게이트에 함께 반영되며 두 번째 쓰기 설정은 없습니다.",
    "safety.mutationsEngineUnavailable":
      "이 엔진은 DopeDB에서 읽기 전용이므로 데이터 변경과 스키마 변경을 사용할 수 없습니다.",
    "safety.schemaProviderUnavailable":
      "관리형 스키마 변경은 Neon 또는 GCP Cloud SQL PostgreSQL 연결에서 지원합니다. 다른 공급자는 읽기와 데이터 변경을 계속 사용할 수 있습니다.",
    "safety.schemaRequiresManage":
      "스키마 변경에는 이 연결의 정확한 관리 권한이 필요합니다. 연결 관리자가 이 화면에서 권한을 켤 수 있으며 별도의 권한 화면은 없습니다.",
    "safety.workspacePolicyRollbackFailed":
      "이 기기는 읽기 전용으로 유지됐지만 워크스페이스 쓰기 정책을 되돌리지 못했습니다. 데이터 변경 체크를 해제한 상태로 다시 저장하세요. {error}",
    "safety.title": "안전 설정",
    "safety.unsavedChanges":
      "아직 적용되지 않았습니다. 적용하면 선택한 권한이 이 연결에 저장됩니다.",
  },
);
