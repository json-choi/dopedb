// workspaceNeonBranches messages (Neon safe-branch plans, approvals, executions and the
// safe-run journey) are owned by this bounded feature catalogue.
import { defineCatalog } from "../types";

export const workspaceNeonBranchesCatalog = defineCatalog(
  {
    "workspaceNeonBranches.title": "Safe Neon branches",
    "workspaceNeonBranches.description":
      "Create isolated state before an Agent task, then approve each plan and follow the provider's actual progress here.",
    "workspaceNeonBranches.createSafeBranch": "Create safe branch",
    "workspaceNeonBranches.closeCreate": "Close create plan",
    "workspaceNeonBranches.progress": "Neon branch operation in progress",
    "workspaceNeonBranches.neonProject": "Neon project",
    "workspaceNeonBranches.project": "Project {project}",
    "workspaceNeonBranches.branches": "Branches",
    "workspaceNeonBranches.branchesAria": "Neon branches",
    "workspaceNeonBranches.searchPlaceholder": "Search branches or connections",
    "workspaceNeonBranches.searchAria": "Search Neon branches",
    "workspaceNeonBranches.observedAt": "Checked {time}",
    "workspaceNeonBranches.loadingBranches": "Loading Neon branches…",
    "workspaceNeonBranches.loadingOperations": "Loading branch operations…",
    "workspaceNeonBranches.noBranches": "This project has no branches.",
    "workspaceNeonBranches.noSearchResults": "No branches match your search.",
    "workspaceNeonBranches.markerDefault": "Default",
    "workspaceNeonBranches.markerProtected": "Protected",
    "workspaceNeonBranches.markerSchemaOnly": "Schema only",
    "workspaceNeonBranches.markerEphemeral": "Ephemeral",
    "workspaceNeonBranches.expiresAt": "Expires {time}",
    "workspaceNeonBranches.branchState.init": "Starting",
    "workspaceNeonBranches.branchState.resetting": "Resetting",
    "workspaceNeonBranches.branchState.ready": "Ready",
    "workspaceNeonBranches.branchState.archived": "Archived",
    "workspaceNeonBranches.branchState.unknown": "Unknown state",
    "workspaceNeonBranches.missingTargets":
      "{count} shared connections point to a branch that no longer exists: {names}. Remove or re-add them from the shared database list.",
    "workspaceNeonBranches.selectedBranch": "Selected branch",
    "workspaceNeonBranches.selectBranchHint":
      "Select a ready branch to plan a connection switch or a discard.",
    "workspaceNeonBranches.environmentProduction": "Production",
    "workspaceNeonBranches.environmentDevelopment": "Development",
    "workspaceNeonBranches.environmentUnknown": "Environment not classified",
    "workspaceNeonBranches.connectionCount": "{count} shared connections",
    "workspaceNeonBranches.chooseEnvironment": "Choose environment",
    "workspaceNeonBranches.switchTitle": "Switch shared connection target",
    "workspaceNeonBranches.switchDescription":
      "Moves a shared connection to the selected branch. The connection ID and permissions stay; existing leases are revoked and a new revision pinned to this branch is created.",
    "workspaceNeonBranches.switchConnection": "Shared connection to switch",
    "workspaceNeonBranches.targetEnvironment": "Target environment",
    "workspaceNeonBranches.alreadyTarget":
      "This connection already uses the selected branch. Choose a different target branch.",
    "workspaceNeonBranches.targetNotReady":
      "Finish least-privilege setup and database verification for this branch before using it as a connection target.",
    "workspaceNeonBranches.targetConflict":
      "Another shared connection already uses the same database on this branch.",
    "workspaceNeonBranches.activeLeases":
      "{count} active leases will be revoked. Running queries and Agent sessions end instead of moving to the new target.",
    "workspaceNeonBranches.createSwitchPlan": "Create switch plan",
    "workspaceNeonBranches.ownedBranch": "DopeDB-owned branch · {name}",
    "workspaceNeonBranches.deleteDescription":
      "Discarding needs its own plan and approval and only uses Neon's default recoverable deletion.",
    "workspaceNeonBranches.createDeletePlan": "Create discard plan",
    "workspaceNeonBranches.createPlanTitle": "Create plan",
    "workspaceNeonBranches.createPlanDescription":
      "This step does not change the provider. Create a plan, then approve and run it separately from the history below.",
    "workspaceNeonBranches.sourceBranch": "Source branch",
    "workspaceNeonBranches.newBranchName": "New branch name",
    "workspaceNeonBranches.namePlaceholder": "agent-safe-branch",
    "workspaceNeonBranches.nameInvalid":
      "Branch names cannot contain control or text-direction characters.",
    "workspaceNeonBranches.copyScope": "Copy scope",
    "workspaceNeonBranches.dataAndSchema": "Data + schema",
    "workspaceNeonBranches.schemaOnly": "Schema only",
    "workspaceNeonBranches.endpoint": "Connection endpoint",
    "workspaceNeonBranches.createReadWriteEndpoint": "Create read/write endpoint",
    "workspaceNeonBranches.checkpointOnly": "Create checkpoint only",
    "workspaceNeonBranches.copyPoint": "Copy point",
    "workspaceNeonBranches.executionHead": "Latest state at execution",
    "workspaceNeonBranches.exactTimestamp": "Exact timestamp",
    "workspaceNeonBranches.exactLsn": "Exact LSN",
    "workspaceNeonBranches.timestamp": "Timestamp",
    "workspaceNeonBranches.lsn": "LSN",
    "workspaceNeonBranches.lsnPlaceholder": "0/16B6C50",
    "workspaceNeonBranches.lsnInvalid": "Enter an LSN such as 0/16B6C50.",
    "workspaceNeonBranches.sourceEnvironment": "Source environment",
    "workspaceNeonBranches.productionCopyNotice":
      "This copies production data. A different workspace administrator must approve the plan before it can run.",
    "workspaceNeonBranches.createNoChangePlan": "Create no-change plan",
    "workspaceNeonBranches.planning": "Creating plan…",
    "workspaceNeonBranches.planCreated":
      "Plan created. Review it in the approval and execution history.",
    "workspaceNeonBranches.historyTitle": "Approval and execution history",
    "workspaceNeonBranches.historyDescription":
      "Recent plans are kept together with the provider's state.",
    "workspaceNeonBranches.historyCount": "{count} plans",
    "workspaceNeonBranches.historyEmpty": "No branch operation plans yet.",
    "workspaceNeonBranches.operationDeleteTitle": "Discard {name}",
    "workspaceNeonBranches.operationDeleteSummary":
      "Recoverable deletion · {endpoints} endpoints · 0 connections · 0 leases",
    "workspaceNeonBranches.operationSwitchSummary":
      "{database} · {leases} leases revoked · new connection revision",
    "workspaceNeonBranches.endpointIncluded": "endpoint included",
    "workspaceNeonBranches.checkpoint": "checkpoint",
    "workspaceNeonBranches.plannedAt": "Planned {time}",
    "workspaceNeonBranches.planExpires": "Plan expires {time}",
    "workspaceNeonBranches.planExpired": "Plan expired",
    "workspaceNeonBranches.riskProduction": "Production data",
    "workspaceNeonBranches.approvalSeparate": "Second admin approval",
    "workspaceNeonBranches.separateApproval":
      "A production-data plan must be approved from another administrator account. Ask another administrator to open this screen.",
    "workspaceNeonBranches.bootstrapRequired":
      "The branch was created but is not a shared database yet. Select the new branch in Add database to finish least-privilege setup and database verification.",
    "workspaceNeonBranches.failureCode": "Failure code",
    "workspaceNeonBranches.reject": "Reject",
    "workspaceNeonBranches.approve": "Approve plan",
    "workspaceNeonBranches.recheckDelete": "Check discard state again",
    "workspaceNeonBranches.executeDelete": "Discard branch",
    "workspaceNeonBranches.retrySwitch": "Retry switch",
    "workspaceNeonBranches.executeSwitch": "Switch connection target",
    "workspaceNeonBranches.recoverCredentials": "Repair credential boundary",
    "workspaceNeonBranches.recheckState": "Check state again",
    "workspaceNeonBranches.executeCreate": "Create branch",
    "workspaceNeonBranches.confirmApproveDelete":
      "Approve discarding {name}? Once approved, the branch can be discarded with Neon's default recoverable deletion.",
    "workspaceNeonBranches.confirmExecuteDelete":
      "Discard {name} now? Endpoint connections end when Neon starts the deletion, and the recovery window depends on your Neon account.",
    "workspaceNeonBranches.confirmApproveSwitch":
      "Approve moving {connection} to {branch}? When it runs, the connection's existing leases and Agent sessions end.",
    "workspaceNeonBranches.confirmExecuteSwitch":
      "Move {connection} to {branch} now? {count} active leases are revoked and running sessions end.",
    "workspaceNeonBranches.state.awaitingApproval": "Awaiting approval",
    "workspaceNeonBranches.state.ready": "Ready to run",
    "workspaceNeonBranches.state.deleteStarted": "Discard started",
    "workspaceNeonBranches.state.switchStarted": "Switch started",
    "workspaceNeonBranches.state.createStarted": "Creation started",
    "workspaceNeonBranches.state.reconciling": "Checking provider",
    "workspaceNeonBranches.state.deleteComplete": "Discard verified",
    "workspaceNeonBranches.state.switchComplete": "Switch complete",
    "workspaceNeonBranches.state.createComplete": "Creation complete",
    "workspaceNeonBranches.state.repairRequired": "Repair required",
    "workspaceNeonBranches.state.failed": "Failed",
    "workspaceNeonBranches.state.cancelled": "Cancelled",
    "workspaceNeonBranches.warning.productionCopy": "Production data will be copied",
    "workspaceNeonBranches.warning.protectedCredentials":
      "Credentials on the protected branch may rotate",
    "workspaceNeonBranches.warning.schemaOnly":
      "Only the schema is copied; no data is included",
    "workspaceNeonBranches.warning.endpointCompute":
      "A read/write compute endpoint will be created",
    "workspaceNeonBranches.warning.inheritedCredentials":
      "Inherited temporary DopeDB roles will be retired",
    "workspaceNeonBranches.warning.executionHead":
      "The latest state at execution time will be used",
    "workspaceNeonBranches.warning.connectionsTerminate":
      "Branch endpoint connections end when the provider deletion starts",
    "workspaceNeonBranches.warning.recoveryNotGuaranteed":
      "The recovery window depends on your Neon account and is not guaranteed by DopeDB",
    "workspaceNeonBranches.warning.targetChanges":
      "The shared connection moves to a new revision pinned to the target branch",
    "workspaceNeonBranches.warning.accessRevoked":
      "Existing leases and execution sessions end before the switch",
    "workspaceNeonBranches.warning.productionSwitch":
      "A switch involving production data needs approval from a different administrator",
    "workspaceNeonBranches.blocker.createIncomplete": "The create operation has not completed",
    "workspaceNeonBranches.blocker.branchNotReady": "A provider operation is in progress",
    "workspaceNeonBranches.blocker.rootBranch": "The root branch cannot be discarded",
    "workspaceNeonBranches.blocker.defaultBranch": "The default branch cannot be discarded",
    "workspaceNeonBranches.blocker.protectedBranch": "A protected branch cannot be discarded",
    "workspaceNeonBranches.blocker.childBranches": "Remove child branches first",
    "workspaceNeonBranches.blocker.workspaceConnections":
      "A shared connection still uses this branch",
    "workspaceNeonBranches.blocker.activeLeases": "Active credential leases remain",
    "workspaceNeonBranches.blocker.providerRestricted": "Neon currently restricts this change",
    "workspaceNeonBranches.safeRun.title": "Current safe run · {branch}",
    "workspaceNeonBranches.safeRun.aria": "Safe run steps",
    "workspaceNeonBranches.safeRun.step.checkpoint": "Checkpoint",
    "workspaceNeonBranches.safeRun.step.isolate": "Isolated connection",
    "workspaceNeonBranches.safeRun.step.execute": "Run and inspect",
    "workspaceNeonBranches.safeRun.step.return": "Return and discard",
    "workspaceNeonBranches.safeRun.stepComplete": "Complete",
    "workspaceNeonBranches.safeRun.stepCurrent": "Current",
    "workspaceNeonBranches.safeRun.stepWaiting": "Waiting",
    "workspaceNeonBranches.safeRun.phase.checkpointing": "Preparing checkpoint",
    "workspaceNeonBranches.safeRun.phase.accessRequired": "Least privilege required",
    "workspaceNeonBranches.safeRun.phase.readyToIsolate": "Ready to isolate",
    "workspaceNeonBranches.safeRun.phase.isolatedActive": "Isolated run active",
    "workspaceNeonBranches.safeRun.phase.readyToDiscard": "Ready to discard",
    "workspaceNeonBranches.safeRun.phase.discarded": "Safely discarded",
    "workspaceNeonBranches.safeRun.phase.attention": "Needs attention",
    "workspaceNeonBranches.safeRun.description.checkpointing":
      "Approve the plan in the history below and follow it until the provider confirms completion.",
    "workspaceNeonBranches.safeRun.description.accessRequired":
      "Add the isolated branch with Add database first to verify least-privilege roles and a live database connection.",
    "workspaceNeonBranches.safeRun.description.readyToIsolate":
      "Pinning a new revision of the source connection to this branch ends its existing leases and sessions.",
    "workspaceNeonBranches.safeRun.description.isolatedActive":
      "Run the Agent task against the connection shown here, inspect the result, then return to the source.",
    "workspaceNeonBranches.safeRun.description.readyToDiscard":
      "The source connection is back on its branch. The unreferenced isolated branch can now be planned, approved and discarded.",
    "workspaceNeonBranches.safeRun.description.discarded":
      "The provider confirms the isolated branch is gone.",
    "workspaceNeonBranches.safeRun.description.attention":
      "The provider state and the recorded operation disagree. Inspect the branch and the history before continuing.",
    "workspaceNeonBranches.safeRun.selectConnection": "Select a connection to switch",
    "workspaceNeonBranches.safeRun.isolationPlan": "Plan isolation switch",
    "workspaceNeonBranches.safeRun.returnPlan": "Plan return to source",
    "workspaceNeonBranches.safeRun.discardPlan": "Plan isolated branch discard",
    "workspaceNeonBranches.safeRun.standaloneNotice":
      "This isolated connection was added as a separate shared database. After inspecting the results, remove it from the shared database list before discarding the branch.",
    "workspaceNeonBranches.errors.load": "Could not load the Neon branch state.",
    "workspaceNeonBranches.errors.loadOperations": "Could not load the Neon branch history.",
    "workspaceNeonBranches.errors.invalidResponse":
      "The workspace service returned an invalid Neon branch response.",
    "workspaceNeonBranches.errors.mismatch":
      "The Neon branch response does not match the current provider connection. Refresh and try again.",
    "workspaceNeonBranches.errors.timestamp": "Enter an exact copy timestamp.",
    "workspaceNeonBranches.errors.createPlan": "Could not create the Neon branch plan.",
    "workspaceNeonBranches.errors.createPlanShape": "The Neon branch plan response is invalid.",
    "workspaceNeonBranches.errors.deletePlan": "Could not create the Neon branch discard plan.",
    "workspaceNeonBranches.errors.deletePlanShape":
      "The Neon branch discard plan response is invalid.",
    "workspaceNeonBranches.errors.switchPlan": "Could not create the Neon branch switch plan.",
    "workspaceNeonBranches.errors.switchPlanShape":
      "The Neon branch switch plan response is invalid.",
    "workspaceNeonBranches.errors.operation": "Could not advance the Neon branch operation.",
    "workspaceNeonBranches.errors.conflict":
      "The operation changed or another change is still running. Refresh and try again.",
  },
  {
    "workspaceNeonBranches.title": "Neon 안전 브랜치",
    "workspaceNeonBranches.description":
      "Agent 작업 전에 격리된 상태를 만들고, 각 계획을 승인한 뒤 공급자의 실제 진행 상태를 여기서 확인합니다.",
    "workspaceNeonBranches.createSafeBranch": "안전 브랜치 만들기",
    "workspaceNeonBranches.closeCreate": "생성 계획 닫기",
    "workspaceNeonBranches.progress": "Neon 브랜치 작업 진행 중",
    "workspaceNeonBranches.neonProject": "Neon 프로젝트",
    "workspaceNeonBranches.project": "프로젝트 {project}",
    "workspaceNeonBranches.branches": "브랜치",
    "workspaceNeonBranches.branchesAria": "Neon 브랜치 목록",
    "workspaceNeonBranches.searchPlaceholder": "브랜치 또는 연결 검색",
    "workspaceNeonBranches.searchAria": "Neon 브랜치 검색",
    "workspaceNeonBranches.observedAt": "{time} 기준",
    "workspaceNeonBranches.loadingBranches": "Neon 브랜치를 불러오는 중…",
    "workspaceNeonBranches.loadingOperations": "브랜치 작업 내역을 불러오는 중…",
    "workspaceNeonBranches.noBranches": "이 프로젝트에는 브랜치가 없습니다.",
    "workspaceNeonBranches.noSearchResults": "검색과 일치하는 브랜치가 없습니다.",
    "workspaceNeonBranches.markerDefault": "기본",
    "workspaceNeonBranches.markerProtected": "보호됨",
    "workspaceNeonBranches.markerSchemaOnly": "스키마만",
    "workspaceNeonBranches.markerEphemeral": "임시",
    "workspaceNeonBranches.expiresAt": "{time} 만료",
    "workspaceNeonBranches.branchState.init": "시작 중",
    "workspaceNeonBranches.branchState.resetting": "초기화 중",
    "workspaceNeonBranches.branchState.ready": "준비됨",
    "workspaceNeonBranches.branchState.archived": "보관됨",
    "workspaceNeonBranches.branchState.unknown": "상태 알 수 없음",
    "workspaceNeonBranches.missingTargets":
      "공유 연결 {count}개가 더 이상 없는 브랜치를 가리킵니다: {names}. 공유 DB 목록에서 제거하거나 다시 추가하세요.",
    "workspaceNeonBranches.selectedBranch": "선택한 브랜치",
    "workspaceNeonBranches.selectBranchHint":
      "연결 전환이나 폐기를 계획하려면 준비된 브랜치를 선택하세요.",
    "workspaceNeonBranches.environmentProduction": "운영",
    "workspaceNeonBranches.environmentDevelopment": "개발",
    "workspaceNeonBranches.environmentUnknown": "환경 미분류",
    "workspaceNeonBranches.connectionCount": "공유 연결 {count}개",
    "workspaceNeonBranches.chooseEnvironment": "환경 선택",
    "workspaceNeonBranches.switchTitle": "공유 연결 대상 전환",
    "workspaceNeonBranches.switchDescription":
      "공유 연결을 선택한 브랜치로 옮깁니다. 연결 ID와 권한은 유지되며, 기존 단기 자격 증명을 폐기한 뒤 이 브랜치에 고정된 새 리비전을 만듭니다.",
    "workspaceNeonBranches.switchConnection": "전환할 공유 연결",
    "workspaceNeonBranches.targetEnvironment": "대상 환경",
    "workspaceNeonBranches.alreadyTarget":
      "이 연결은 이미 선택한 브랜치를 사용합니다. 다른 대상 브랜치를 선택하세요.",
    "workspaceNeonBranches.targetNotReady":
      "이 브랜치를 연결 대상으로 쓰려면 먼저 최소 권한 준비와 DB 검증을 완료하세요.",
    "workspaceNeonBranches.targetConflict":
      "이 브랜치의 같은 DB를 다른 공유 연결이 이미 사용하고 있습니다.",
    "workspaceNeonBranches.activeLeases":
      "활성 단기 자격 증명 {count}개를 폐기합니다. 실행 중인 쿼리와 Agent 세션은 새 대상으로 옮겨지지 않고 종료됩니다.",
    "workspaceNeonBranches.createSwitchPlan": "전환 계획 만들기",
    "workspaceNeonBranches.ownedBranch": "DopeDB 소유 브랜치 · {name}",
    "workspaceNeonBranches.deleteDescription":
      "폐기는 별도 계획과 승인을 거치며 Neon의 기본 복구 가능 삭제만 사용합니다.",
    "workspaceNeonBranches.createDeletePlan": "폐기 계획 만들기",
    "workspaceNeonBranches.createPlanTitle": "생성 계획",
    "workspaceNeonBranches.createPlanDescription":
      "이 단계는 공급자를 변경하지 않습니다. 계획을 만든 뒤 아래 내역에서 따로 승인하고 실행합니다.",
    "workspaceNeonBranches.sourceBranch": "원본 브랜치",
    "workspaceNeonBranches.newBranchName": "새 브랜치 이름",
    "workspaceNeonBranches.namePlaceholder": "agent-safe-branch",
    "workspaceNeonBranches.nameInvalid":
      "브랜치 이름에는 제어 문자나 텍스트 방향 문자를 쓸 수 없습니다.",
    "workspaceNeonBranches.copyScope": "복제 범위",
    "workspaceNeonBranches.dataAndSchema": "데이터 + 스키마",
    "workspaceNeonBranches.schemaOnly": "스키마만",
    "workspaceNeonBranches.endpoint": "접속 엔드포인트",
    "workspaceNeonBranches.createReadWriteEndpoint": "읽기·쓰기 엔드포인트 생성",
    "workspaceNeonBranches.checkpointOnly": "체크포인트만 생성",
    "workspaceNeonBranches.copyPoint": "복제 시점",
    "workspaceNeonBranches.executionHead": "실행 시점의 최신 상태",
    "workspaceNeonBranches.exactTimestamp": "정확한 시각",
    "workspaceNeonBranches.exactLsn": "정확한 LSN",
    "workspaceNeonBranches.timestamp": "시각",
    "workspaceNeonBranches.lsn": "LSN",
    "workspaceNeonBranches.lsnPlaceholder": "0/16B6C50",
    "workspaceNeonBranches.lsnInvalid": "0/16B6C50 형식의 LSN을 입력하세요.",
    "workspaceNeonBranches.sourceEnvironment": "원본 환경",
    "workspaceNeonBranches.productionCopyNotice":
      "운영 데이터를 복제합니다. 요청자와 다른 워크스페이스 관리자가 계획을 승인해야 실행할 수 있습니다.",
    "workspaceNeonBranches.createNoChangePlan": "변경 없는 계획 만들기",
    "workspaceNeonBranches.planning": "계획을 만드는 중…",
    "workspaceNeonBranches.planCreated": "계획을 만들었습니다. 승인·실행 내역에서 확인하세요.",
    "workspaceNeonBranches.historyTitle": "승인·실행 내역",
    "workspaceNeonBranches.historyDescription": "최근 계획을 공급자 상태와 함께 보관합니다.",
    "workspaceNeonBranches.historyCount": "계획 {count}개",
    "workspaceNeonBranches.historyEmpty": "아직 브랜치 작업 계획이 없습니다.",
    "workspaceNeonBranches.operationDeleteTitle": "{name} 폐기",
    "workspaceNeonBranches.operationDeleteSummary":
      "복구 가능한 삭제 · 엔드포인트 {endpoints}개 · 연결 0개 · 단기 자격 증명 0개",
    "workspaceNeonBranches.operationSwitchSummary":
      "{database} · 단기 자격 증명 {leases}개 폐기 · 새 연결 리비전",
    "workspaceNeonBranches.endpointIncluded": "엔드포인트 포함",
    "workspaceNeonBranches.checkpoint": "체크포인트",
    "workspaceNeonBranches.plannedAt": "{time} 계획",
    "workspaceNeonBranches.planExpires": "{time} 계획 만료",
    "workspaceNeonBranches.planExpired": "계획 만료됨",
    "workspaceNeonBranches.riskProduction": "운영 데이터",
    "workspaceNeonBranches.approvalSeparate": "다른 관리자 승인",
    "workspaceNeonBranches.separateApproval":
      "운영 데이터 계획은 다른 관리자 계정에서 승인해야 합니다. 다른 관리자에게 이 화면을 열어 달라고 요청하세요.",
    "workspaceNeonBranches.bootstrapRequired":
      "브랜치는 만들어졌지만 아직 공유 DB가 아닙니다. DB 추가에서 새 브랜치를 선택해 최소 권한 준비와 DB 검증을 완료하세요.",
    "workspaceNeonBranches.failureCode": "실패 코드",
    "workspaceNeonBranches.reject": "거절",
    "workspaceNeonBranches.approve": "계획 승인",
    "workspaceNeonBranches.recheckDelete": "폐기 상태 다시 확인",
    "workspaceNeonBranches.executeDelete": "브랜치 폐기",
    "workspaceNeonBranches.retrySwitch": "전환 다시 시도",
    "workspaceNeonBranches.executeSwitch": "연결 대상 전환",
    "workspaceNeonBranches.recoverCredentials": "자격 증명 경계 복구",
    "workspaceNeonBranches.recheckState": "상태 다시 확인",
    "workspaceNeonBranches.executeCreate": "브랜치 만들기",
    "workspaceNeonBranches.confirmApproveDelete":
      "{name} 브랜치 폐기를 승인할까요? 승인하면 Neon의 기본 복구 가능 삭제로 브랜치를 폐기할 수 있습니다.",
    "workspaceNeonBranches.confirmExecuteDelete":
      "{name} 브랜치를 지금 폐기할까요? Neon이 삭제를 시작하면 엔드포인트 연결이 종료되며, 복구 가능 기간은 Neon 계정에 따라 다릅니다.",
    "workspaceNeonBranches.confirmApproveSwitch":
      "{connection} 연결을 {branch} 브랜치로 옮기는 계획을 승인할까요? 실행하면 이 연결의 기존 단기 자격 증명과 Agent 세션이 종료됩니다.",
    "workspaceNeonBranches.confirmExecuteSwitch":
      "{connection} 연결을 지금 {branch} 브랜치로 옮길까요? 활성 단기 자격 증명 {count}개를 폐기하고 실행 중인 세션을 종료합니다.",
    "workspaceNeonBranches.state.awaitingApproval": "승인 대기",
    "workspaceNeonBranches.state.ready": "실행 준비",
    "workspaceNeonBranches.state.deleteStarted": "폐기 시작",
    "workspaceNeonBranches.state.switchStarted": "전환 시작",
    "workspaceNeonBranches.state.createStarted": "생성 시작",
    "workspaceNeonBranches.state.reconciling": "공급자 확인 중",
    "workspaceNeonBranches.state.deleteComplete": "폐기 확인됨",
    "workspaceNeonBranches.state.switchComplete": "전환 완료",
    "workspaceNeonBranches.state.createComplete": "생성 완료",
    "workspaceNeonBranches.state.repairRequired": "복구 필요",
    "workspaceNeonBranches.state.failed": "실패",
    "workspaceNeonBranches.state.cancelled": "취소됨",
    "workspaceNeonBranches.warning.productionCopy": "운영 데이터가 복제됩니다",
    "workspaceNeonBranches.warning.protectedCredentials":
      "보호 브랜치의 자격 증명이 교체될 수 있습니다",
    "workspaceNeonBranches.warning.schemaOnly": "스키마만 복제되며 데이터는 포함되지 않습니다",
    "workspaceNeonBranches.warning.endpointCompute": "읽기·쓰기 compute 엔드포인트가 생성됩니다",
    "workspaceNeonBranches.warning.inheritedCredentials": "상속된 DopeDB 임시 역할을 폐기합니다",
    "workspaceNeonBranches.warning.executionHead": "실행 시점의 최신 상태를 사용합니다",
    "workspaceNeonBranches.warning.connectionsTerminate":
      "공급자 삭제가 시작되면 브랜치 엔드포인트 연결이 종료됩니다",
    "workspaceNeonBranches.warning.recoveryNotGuaranteed":
      "복구 가능 기간은 Neon 계정에 따라 다르며 DopeDB가 보장하지 않습니다",
    "workspaceNeonBranches.warning.targetChanges":
      "공유 연결이 대상 브랜치에 고정된 새 리비전으로 바뀝니다",
    "workspaceNeonBranches.warning.accessRevoked":
      "전환 전에 기존 단기 자격 증명과 실행 세션을 종료합니다",
    "workspaceNeonBranches.warning.productionSwitch":
      "운영 데이터가 포함된 전환은 요청자와 다른 관리자의 승인이 필요합니다",
    "workspaceNeonBranches.blocker.createIncomplete": "생성 작업이 아직 완료되지 않았습니다",
    "workspaceNeonBranches.blocker.branchNotReady": "공급자 작업이 진행 중입니다",
    "workspaceNeonBranches.blocker.rootBranch": "루트 브랜치는 폐기할 수 없습니다",
    "workspaceNeonBranches.blocker.defaultBranch": "기본 브랜치는 폐기할 수 없습니다",
    "workspaceNeonBranches.blocker.protectedBranch": "보호 브랜치는 폐기할 수 없습니다",
    "workspaceNeonBranches.blocker.childBranches": "하위 브랜치를 먼저 정리해야 합니다",
    "workspaceNeonBranches.blocker.workspaceConnections":
      "이 브랜치를 사용하는 공유 연결이 있습니다",
    "workspaceNeonBranches.blocker.activeLeases": "활성 단기 자격 증명이 남아 있습니다",
    "workspaceNeonBranches.blocker.providerRestricted": "Neon이 현재 이 변경을 제한합니다",
    "workspaceNeonBranches.safeRun.title": "현재 안전 실행 · {branch}",
    "workspaceNeonBranches.safeRun.aria": "안전 실행 단계",
    "workspaceNeonBranches.safeRun.step.checkpoint": "체크포인트",
    "workspaceNeonBranches.safeRun.step.isolate": "격리 연결",
    "workspaceNeonBranches.safeRun.step.execute": "실행·검사",
    "workspaceNeonBranches.safeRun.step.return": "복귀·폐기",
    "workspaceNeonBranches.safeRun.stepComplete": "완료",
    "workspaceNeonBranches.safeRun.stepCurrent": "현재",
    "workspaceNeonBranches.safeRun.stepWaiting": "대기",
    "workspaceNeonBranches.safeRun.phase.checkpointing": "체크포인트 준비 중",
    "workspaceNeonBranches.safeRun.phase.accessRequired": "최소 권한 준비 필요",
    "workspaceNeonBranches.safeRun.phase.readyToIsolate": "격리 전환 준비됨",
    "workspaceNeonBranches.safeRun.phase.isolatedActive": "격리 실행 중",
    "workspaceNeonBranches.safeRun.phase.readyToDiscard": "폐기 준비됨",
    "workspaceNeonBranches.safeRun.phase.discarded": "안전하게 폐기됨",
    "workspaceNeonBranches.safeRun.phase.attention": "확인 필요",
    "workspaceNeonBranches.safeRun.description.checkpointing":
      "아래 승인·실행 내역에서 계획을 승인하고 공급자가 완료를 확인할 때까지 지켜보세요.",
    "workspaceNeonBranches.safeRun.description.accessRequired":
      "먼저 DB 추가에서 격리 브랜치를 추가해 최소 권한 역할과 실제 DB 접속을 검증하세요.",
    "workspaceNeonBranches.safeRun.description.readyToIsolate":
      "원본 연결의 새 리비전을 이 브랜치에 고정하면 기존 단기 자격 증명과 세션이 종료됩니다.",
    "workspaceNeonBranches.safeRun.description.isolatedActive":
      "여기 표시된 연결로 Agent 작업을 실행하고 결과를 검사한 뒤 원본으로 복귀하세요.",
    "workspaceNeonBranches.safeRun.description.readyToDiscard":
      "원본 연결의 복귀가 확인됐습니다. 참조가 없는 격리 브랜치를 계획하고 승인한 뒤 폐기할 수 있습니다.",
    "workspaceNeonBranches.safeRun.description.discarded":
      "공급자에서 격리 브랜치가 사라진 것까지 확인했습니다.",
    "workspaceNeonBranches.safeRun.description.attention":
      "공급자 상태와 기록된 작업이 일치하지 않습니다. 계속하기 전에 브랜치와 내역을 확인하세요.",
    "workspaceNeonBranches.safeRun.selectConnection": "전환할 연결 선택",
    "workspaceNeonBranches.safeRun.isolationPlan": "격리 전환 계획",
    "workspaceNeonBranches.safeRun.returnPlan": "원본 복귀 계획",
    "workspaceNeonBranches.safeRun.discardPlan": "격리 브랜치 폐기 계획",
    "workspaceNeonBranches.safeRun.standaloneNotice":
      "별도 공유 DB로 추가한 격리 연결입니다. 결과를 확인한 뒤 공유 DB 목록에서 이 연결을 제거해야 브랜치를 폐기할 수 있습니다.",
    "workspaceNeonBranches.errors.load": "Neon 브랜치 상태를 불러오지 못했습니다.",
    "workspaceNeonBranches.errors.loadOperations": "Neon 브랜치 작업 내역을 불러오지 못했습니다.",
    "workspaceNeonBranches.errors.invalidResponse":
      "워크스페이스 서비스가 올바르지 않은 Neon 브랜치 응답을 보냈습니다.",
    "workspaceNeonBranches.errors.mismatch":
      "Neon 브랜치 응답이 현재 공급자 연결과 일치하지 않습니다. 새로고침한 뒤 다시 시도하세요.",
    "workspaceNeonBranches.errors.timestamp": "복제 시각을 정확히 입력하세요.",
    "workspaceNeonBranches.errors.createPlan": "Neon 브랜치 계획을 만들지 못했습니다.",
    "workspaceNeonBranches.errors.createPlanShape": "Neon 브랜치 계획 응답이 올바르지 않습니다.",
    "workspaceNeonBranches.errors.deletePlan": "Neon 브랜치 폐기 계획을 만들지 못했습니다.",
    "workspaceNeonBranches.errors.deletePlanShape":
      "Neon 브랜치 폐기 계획 응답이 올바르지 않습니다.",
    "workspaceNeonBranches.errors.switchPlan": "Neon 브랜치 전환 계획을 만들지 못했습니다.",
    "workspaceNeonBranches.errors.switchPlanShape":
      "Neon 브랜치 전환 계획 응답이 올바르지 않습니다.",
    "workspaceNeonBranches.errors.operation": "Neon 브랜치 작업을 진행하지 못했습니다.",
    "workspaceNeonBranches.errors.conflict":
      "작업 상태가 바뀌었거나 다른 변경이 아직 진행 중입니다. 새로고침한 뒤 다시 시도하세요.",
  },
);
