// sql messages are owned by this bounded feature catalogue.
import { defineCatalog } from "../types";

export const sqlCatalog = defineCatalog(
  {
    "sql.affected": "{count} affected",
    "sql.cancel": "Cancel query",
    "sql.cancelled": "Query cancelled.",
    "sql.capped": "capped at {count} rows - add LIMIT to see more",
    "sql.committed": "script committed (one transaction)",
    "sql.documentTitle": "SQL document title",
    "sql.errorContext": "Error context",
    "sql.errorKind": "Kind",
    "sql.errorMessage": "Message",
    "sql.errorPosition": "Position",
    "sql.errorPositionAt": "Line {line}, column {column}",
    "sql.errorTitle": "Query error",
    "sql.writeBlock.requiredPermission": "Required permission",
    "sql.writeBlock.permissionDeviceSafety": "Connection access level",
    "sql.writeBlock.guidanceDeviceSafety":
      "Open Settings > Safety for {connection}, choose Data changes, and apply the access level.",
    "sql.writeBlock.permissionLocalSafety":
      "Connection access level",
    "sql.writeBlock.guidanceLocalSafety":
      "Open Settings > Safety for {connection}, choose Data changes, and apply the connection's single access level.",
    "sql.writeBlock.permissionManagedCredential":
      "Managed write credential",
    "sql.writeBlock.guidanceManagedCredential":
      "{connection} uses a member-local credential, which is read-only. A workspace administrator must configure managed access and then enable its write policy in Settings > Safety.",
    "sql.writeBlock.permissionSchemaSafety": "Schema-change access",
    "sql.writeBlock.guidanceSchemaSafety":
      "Open Settings > Safety for {connection} and choose Schema changes. If that level is unavailable, the same screen shows the exact missing grant or provider capability.",
    "sql.writeBlock.permissionSchemaUnavailable":
      "Schema changes unavailable for this connection",
    "sql.writeBlock.guidanceSchemaUnavailable":
      "{connection} can run data changes, but its current managed provider cannot issue DopeDB's short-lived schema credential. Open the connection's access setting to see the supported maximum level and its requirement.",
    "sql.writeBlock.scriptGuidance":
      "Review this connection's single access-level control. It covers read, data changes, and schema changes without a second permission request.",
    "sql.writeBlock.scriptUnavailableGuidance":
      "One or more statements exceed this connection's current workspace or provider boundary. Review the statement errors; there is no local Safety switch that can widen it.",
    "sql.writeBlock.permissionWorkspaceGrant":
      "Workspace DB read/write or manage access",
    "sql.writeBlock.guidanceWorkspaceGrant":
      "Ask a connection manager to grant read/write or manage access to {connection}. That manager changes the limit in Settings > Safety; this device can only narrow it.",
    "sql.writeBlock.permissionWorkspacePolicy":
      "Connection access level (manager)",
    "sql.writeBlock.guidanceWorkspacePolicy":
      "A connection manager must open Settings > Safety for {connection}, choose Data changes, and apply its access level.",
    "sql.writeBlock.permissionWorkspacePolicyAndDevice":
      "Connection access level",
    "sql.writeBlock.guidanceWorkspacePolicyAndDevice":
      "You have manage access. Open Settings > Safety for {connection}, choose Data changes, and apply its single access level.",
    "sql.writeBlock.openSafety": "Open {connection} access settings",
    "sql.writeBlock.reviewSafety": "Review {connection} access settings",
    "sql.explain": "Explain",
    "sql.explainReadOnly": "Explain is for read statements - Run shows a write's impact preview instead.",
    "sql.explainSingle": "Explain works on a single statement",
    "sql.explainTitle": "Show the query plan (reads only)",
    "sql.failedRolledBack": "script failed - rolled back",
    "sql.format": "Format",
    "sql.formatTitle": "Format this document for the selected database dialect",
    "sql.formatting": "Formatting...",
    "sql.history": "Query history",
    "sql.loadingEditor": "Loading editor…",
    "sql.keepMine": "Keep mine",
    "sql.loadSaved": "Load saved",
    "sql.untitledQuery": "Untitled query",
    "sql.noPlan": "No plan available ({mode}).",
    "sql.noRowsReturned": "no rows returned",
    "sql.openAgentGroup": "Open AI app",
    "sql.openAgentReady": "{name} opened.",
    "sql.openAgentTerminal": "Open Agent Terminal",
    "sql.openAgentTitle": "Open {name}",
    "sql.noParameters": "No user parameters in this query",
    "sql.parameterApply": "Apply values",
    "sql.parameterExplain": "Show query plan",
    "sql.parameterName": "Parameter",
    "sql.parameterRun": "Run query",
    "sql.parameters": "Query parameters",
    "sql.parameterSafety":
      "Values are inserted as SQL expressions. The completed SQL is classified again and follows the same approval and safety policy before execution.",
    "sql.parameterValue": "Value",
    "sql.parameterValueFor": "Value for {name}",
    "sql.parameterValuePlaceholder": "SQL expression, for example 42 or 'Seoul'",
    "sql.planning": "Planning...",
    "sql.queryPlan": "Query plan",
    "sql.readAuto": "Read Auto",
    "sql.readAutoHint": "Read-only statements run without an approval step.",
    "sql.readReview": "Read Review",
    "sql.readReviewHint":
      "Read-only statements enter the durable proposal path before execution.",
    "sql.readOnlyScript": "read-only script",
    "sql.recovered": "Recovered draft",
    "sql.resultsTab": "Results",
    "sql.resultsEmpty": "Run a query to see results here",
    "sql.resolveMode": "Resolve mode",
    "sql.resolveModePlayground": "Playground",
    "sql.resolveModePlaygroundHint":
      "Resolve every statement against the selected schema context.",
    "sql.resolveModeScript": "Script",
    "sql.resolveModeScriptHint":
      "Let USE or SET search_path change completion context for later statements.",
    "sql.run": "Run",
    "sql.runHint": "Cmd+Enter to run (selection runs alone)",
    "sql.running": "Running",
    "sql.runningFor": "Running... {seconds}s",
    "sql.rowLimit": "{count} rows",
    "sql.rowLimitHint": "Read results are capped at {count} rows.",
    "sql.safetyLoading": "Loading safety policy",
    "sql.retrySafety": "Retry safety policy",
    "sql.saveConflict": "Save conflict",
    "sql.saveConflictBody":
      "This document changed in another surface. Compare before replacing either version.",
    "sql.saveFailed": "Autosave failed",
    "sql.saved": "Saved",
    "sql.databaseSelector": "Execution database",
    "sql.databaseSelectorHint":
      "{connection} queries run against the {database} database.",
    "sql.schemaSelector": "Execution schema",
    "sql.schemaSelectorHint": "{connection} queries run in the {schema} schema.",
    "sql.scriptNote":
      "A script that modifies data runs as ONE transaction - all statements commit together or none do. A read-only script runs sequentially.",
    "sql.showMore": "Show {count} more of {total}",
    "sql.signalExplainAnalyze": "EXPLAIN ANALYZE runs the query",
    "sql.signalHeavyRead": "Potentially heavy read",
    "sql.signalLargeScript": "Large script: {count} statements",
    "sql.signalNoWhere": "No WHERE detected",
    "sql.signalReadCap": "Result cap: {count} rows",
    "sql.signalReadScript": "{count} reads run sequentially",
    "sql.signalSchemaDisabled": "Schema changes are off",
    "sql.signalWriteScript": "Writes/DDL run in one transaction",
    "sql.signalWriteStatement": "Write/DDL requires approval",
    "sql.signalWritesDisabled": "Writes are off",
    "sql.schemaDisabledScript":
      "Schema changes are disabled for this connection. Choose Schema changes in Settings > Safety.",
    "sql.statementCount": "{count} statements",
    "sql.tx": "Tx:",
    "sql.txAuto": "Auto",
    "sql.txAutoHint":
      "Each statement commits automatically. Select Tx: Auto to open one connection-scoped rollback boundary for desktop and Agent SQL.",
    "sql.txManual": "Manual",
    "sql.txFailed": "Failed",
    "sql.txManualBeginHint":
      "Begin a connection-scoped manual transaction for desktop and Agent SQL.",
    "sql.txManualWritesRequired":
      "Enable writes for this connection before starting a manual transaction.",
    "sql.txManualDetail": "{count} statements are waiting for commit or rollback.",
    "sql.txFailedHint":
      "A statement failed. This transaction can only be rolled back.",
    "sql.txCommit": "Commit manual transaction",
    "sql.txRollback": "Roll back manual transaction",
    "sql.writeStaged": "write staged in manual transaction",
    "sql.scriptStaged": "script staged in manual transaction",
    "sql.unsaved": "Unsaved",
    "sql.viewParameters": "View parameters",
    "sql.viewParametersCount": "View {count} parameter occurrences",
    "sql.writeCommitted": "write committed",
    "sql.writesDisabledScript":
      "Writes are disabled for this connection - a script that modifies data will be blocked. Enable writes in Settings > Safety.",
  },
  {
    "sql.affected": "{count}개 영향",
    "sql.cancel": "쿼리 취소",
    "sql.cancelled": "쿼리가 취소되었습니다.",
    "sql.capped": "{count}행에서 제한됨 - 더 보려면 LIMIT을 추가하세요",
    "sql.committed": "스크립트 커밋됨 (하나의 트랜잭션)",
    "sql.documentTitle": "SQL 문서 제목",
    "sql.errorContext": "오류 컨텍스트",
    "sql.errorKind": "종류",
    "sql.errorMessage": "메시지",
    "sql.errorPosition": "위치",
    "sql.errorPositionAt": "{line}줄 {column}열",
    "sql.errorTitle": "쿼리 오류",
    "sql.writeBlock.requiredPermission": "필요한 권한",
    "sql.writeBlock.permissionDeviceSafety": "연결 접근 단계",
    "sql.writeBlock.guidanceDeviceSafety":
      "설정 → 안전 → {connection}에서 ‘데이터 변경’을 선택하고 접근 단계를 적용하세요.",
    "sql.writeBlock.permissionLocalSafety":
      "연결 접근 단계",
    "sql.writeBlock.guidanceLocalSafety":
      "설정 → 안전 → {connection}에서 ‘데이터 변경’을 선택하고 이 연결의 단일 접근 단계를 적용하세요.",
    "sql.writeBlock.permissionManagedCredential": "관리형 쓰기 자격 증명",
    "sql.writeBlock.guidanceManagedCredential":
      "{connection}은 읽기 전용인 구성원 로컬 자격 증명을 사용합니다. 워크스페이스 관리자가 관리형 접근을 구성한 뒤 설정 → 안전에서 쓰기 정책을 켜야 합니다.",
    "sql.writeBlock.permissionSchemaSafety": "스키마 변경 접근",
    "sql.writeBlock.guidanceSchemaSafety":
      "설정 → 안전 → {connection}에서 ‘스키마 변경’을 선택하세요. 선택할 수 없다면 같은 화면에서 부족한 권한이나 공급자 지원 여부를 바로 확인할 수 있습니다.",
    "sql.writeBlock.permissionSchemaUnavailable":
      "이 연결에서는 스키마 변경을 사용할 수 없음",
    "sql.writeBlock.guidanceSchemaUnavailable":
      "{connection}은 데이터 변경은 실행할 수 있지만 현재 관리형 공급자가 DopeDB의 단기 스키마 자격 증명을 발급할 수 없습니다. 이 연결의 권한 설정에서 지원되는 최대 단계와 필요한 조건을 확인하세요.",
    "sql.writeBlock.scriptGuidance":
      "이 연결의 단일 접근 단계 설정을 확인하세요. 두 번째 권한 요청 없이 읽기·데이터 변경·스키마 변경을 한 곳에서 제어합니다.",
    "sql.writeBlock.scriptUnavailableGuidance":
      "하나 이상의 문장이 이 연결의 현재 워크스페이스 또는 공급자 경계를 넘습니다. 각 문장의 오류를 확인하세요. 로컬 안전 설정으로 이 경계를 넓힐 수 없습니다.",
    "sql.writeBlock.permissionWorkspaceGrant":
      "워크스페이스 DB 읽기/쓰기 또는 관리 권한",
    "sql.writeBlock.guidanceWorkspaceGrant":
      "연결 관리자에게 {connection}의 읽기/쓰기 또는 관리 권한을 요청하세요. 관리자는 설정 → 안전에서 상한을 바꾸며, 이 기기에서는 권한을 좁힐 수만 있습니다.",
    "sql.writeBlock.permissionWorkspacePolicy": "연결 접근 단계(관리자)",
    "sql.writeBlock.guidanceWorkspacePolicy":
      "연결 관리자가 설정 → 안전 → {connection}에서 ‘데이터 변경’을 선택하고 접근 단계를 적용해야 합니다.",
    "sql.writeBlock.permissionWorkspacePolicyAndDevice":
      "연결 접근 단계",
    "sql.writeBlock.guidanceWorkspacePolicyAndDevice":
      "관리 권한이 있습니다. 설정 → 안전 → {connection}에서 ‘데이터 변경’을 선택하고 단일 접근 단계를 적용하세요.",
    "sql.writeBlock.openSafety": "{connection} 권한 설정 열기",
    "sql.writeBlock.reviewSafety": "{connection} 권한 설정에서 확인",
    "sql.explain": "Explain",
    "sql.explainReadOnly": "Explain은 읽기 문장용입니다. 쓰기 영향 미리보기는 Run에서 확인하세요.",
    "sql.explainSingle": "Explain은 단일 문장에서만 동작합니다",
    "sql.explainTitle": "쿼리 플랜 보기 (읽기 전용)",
    "sql.failedRolledBack": "스크립트 실패 - 롤백됨",
    "sql.format": "포맷",
    "sql.formatTitle": "선택한 데이터베이스 문법에 맞춰 문서 정리",
    "sql.formatting": "정리 중...",
    "sql.history": "쿼리 기록",
    "sql.loadingEditor": "편집기 불러오는 중…",
    "sql.keepMine": "내 내용 유지",
    "sql.loadSaved": "저장본 불러오기",
    "sql.untitledQuery": "제목 없는 쿼리",
    "sql.noPlan": "사용 가능한 플랜이 없습니다 ({mode}).",
    "sql.noRowsReturned": "반환된 행 없음",
    "sql.openAgentGroup": "AI 앱 열기",
    "sql.openAgentReady": "{name}를 열었습니다.",
    "sql.openAgentTerminal": "Agent Terminal 열기",
    "sql.openAgentTitle": "{name} 열기",
    "sql.noParameters": "이 쿼리에는 사용자 파라미터가 없습니다",
    "sql.parameterApply": "값 적용",
    "sql.parameterExplain": "쿼리 플랜 보기",
    "sql.parameterName": "파라미터",
    "sql.parameterRun": "쿼리 실행",
    "sql.parameters": "쿼리 파라미터",
    "sql.parameterSafety":
      "값은 SQL 표현식으로 삽입됩니다. 완성된 SQL은 실행 전에 다시 분류되며 같은 승인·안전 정책을 거칩니다.",
    "sql.parameterValue": "값",
    "sql.parameterValueFor": "{name} 값",
    "sql.parameterValuePlaceholder": "SQL 표현식, 예: 42 또는 '서울'",
    "sql.planning": "플랜 확인 중...",
    "sql.queryPlan": "쿼리 플랜",
    "sql.readAuto": "읽기 자동",
    "sql.readAutoHint": "읽기 전용 문장은 승인 단계 없이 실행됩니다.",
    "sql.readReview": "읽기 검토",
    "sql.readReviewHint":
      "읽기 전용 문장도 실행 전에 영속 제안 경로를 거칩니다.",
    "sql.readOnlyScript": "읽기 전용 스크립트",
    "sql.recovered": "복구된 초안",
    "sql.resultsTab": "결과",
    "sql.resultsEmpty": "쿼리를 실행하면 결과가 여기에 표시됩니다",
    "sql.resolveMode": "객체 해석 모드",
    "sql.resolveModePlayground": "Playground",
    "sql.resolveModePlaygroundHint":
      "모든 문장을 선택한 스키마 문맥에서 각각 해석합니다.",
    "sql.resolveModeScript": "Script",
    "sql.resolveModeScriptHint":
      "USE 또는 SET search_path 이후 문장의 자동완성 문맥을 전환합니다.",
    "sql.run": "실행",
    "sql.runHint": "Cmd+Enter로 실행 (선택 영역만 실행 가능)",
    "sql.running": "실행 중",
    "sql.runningFor": "실행 중... {seconds}초",
    "sql.rowLimit": "{count}행",
    "sql.rowLimitHint": "읽기 결과는 {count}행으로 제한됩니다.",
    "sql.safetyLoading": "안전 정책 불러오는 중",
    "sql.retrySafety": "안전 정책 다시 시도",
    "sql.saveConflict": "저장 충돌",
    "sql.saveConflictBody":
      "다른 화면에서 이 문서가 변경되었습니다. 어느 버전도 덮어쓰기 전에 비교하세요.",
    "sql.saveFailed": "자동 저장 실패",
    "sql.saved": "저장됨",
    "sql.databaseSelector": "실행 데이터베이스",
    "sql.databaseSelectorHint":
      "{connection} 쿼리를 {database} 데이터베이스에서 실행합니다.",
    "sql.schemaSelector": "실행 스키마",
    "sql.schemaSelectorHint": "{connection} 쿼리를 {schema} 스키마에서 실행합니다.",
    "sql.scriptNote":
      "데이터를 수정하는 스크립트는 하나의 트랜잭션으로 실행됩니다. 모든 문장이 함께 커밋되거나 모두 롤백됩니다. 읽기 전용 스크립트는 순서대로 실행됩니다.",
    "sql.showMore": "{total}개 중 {count}개 더 보기",
    "sql.signalExplainAnalyze": "EXPLAIN ANALYZE는 쿼리를 실행합니다",
    "sql.signalHeavyRead": "무거울 수 있는 읽기",
    "sql.signalLargeScript": "큰 스크립트: {count}개 문장",
    "sql.signalNoWhere": "WHERE 조건 없음",
    "sql.signalReadCap": "결과 제한: {count}행",
    "sql.signalReadScript": "{count}개 읽기를 순서대로 실행",
    "sql.signalSchemaDisabled": "스키마 변경 비활성화됨",
    "sql.signalWriteScript": "쓰기/DDL은 하나의 트랜잭션으로 실행",
    "sql.signalWriteStatement": "쓰기/DDL 승인 필요",
    "sql.signalWritesDisabled": "쓰기 비활성화됨",
    "sql.schemaDisabledScript":
      "이 연결의 스키마 변경이 꺼져 있습니다. 설정 → 안전에서 ‘스키마 변경’을 선택하세요.",
    "sql.statementCount": "{count}개 문장",
    "sql.tx": "Tx:",
    "sql.txAuto": "자동",
    "sql.txAutoHint":
      "각 문장을 자동 커밋합니다. Tx: 자동을 선택하면 데스크톱과 Agent SQL을 묶는 연결 단위 롤백 경계를 엽니다.",
    "sql.txManual": "수동",
    "sql.txFailed": "실패",
    "sql.txManualBeginHint":
      "데스크톱과 Agent SQL을 위한 연결 단위 수동 트랜잭션을 시작합니다.",
    "sql.txManualWritesRequired":
      "수동 트랜잭션을 시작하려면 이 연결의 쓰기를 활성화하세요.",
    "sql.txManualDetail": "{count}개 문장이 커밋 또는 롤백을 기다립니다.",
    "sql.txFailedHint":
      "문장 실행이 실패했습니다. 이 트랜잭션은 롤백만 할 수 있습니다.",
    "sql.txCommit": "수동 트랜잭션 커밋",
    "sql.txRollback": "수동 트랜잭션 롤백",
    "sql.writeStaged": "수동 트랜잭션에 쓰기 보류됨",
    "sql.scriptStaged": "수동 트랜잭션에 스크립트 보류됨",
    "sql.unsaved": "저장되지 않음",
    "sql.viewParameters": "파라미터 보기",
    "sql.viewParametersCount": "파라미터 {count}개 보기",
    "sql.writeCommitted": "쓰기 커밋됨",
    "sql.writesDisabledScript":
      "이 연결은 쓰기가 비활성화되어 있습니다. 데이터를 수정하는 스크립트는 차단됩니다. 설정 > 안전에서 쓰기를 활성화하세요.",
  },
);
