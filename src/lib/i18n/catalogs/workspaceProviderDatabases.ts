// Workspace shared database inventory, removal, managed-access repair entry and the
// add-database flow (including Neon least-privilege preparation) are owned by this
// bounded feature catalogue. The `neonFinding`, `neonValue` and `serverError`
// families localize fixed control-plane sentences; the Korean `neonFinding` and
// `neonValue` entries repeat the control plane's own wording.
import { defineCatalog } from "../types";

export const workspaceProviderDatabasesCatalog = defineCatalog(
  {
    "workspaceProviderDatabases.title": "Workspace databases",
    "workspaceProviderDatabases.description":
      "Register a database once for the team. Each permitted member receives short-lived credentials for their role, rotated automatically.",
    "workspaceProviderDatabases.add": "Add database",
    "workspaceProviderDatabases.listLabel": "Shared databases",
    "workspaceProviderDatabases.loading": "Loading shared databases…",
    "workspaceProviderDatabases.loadError": "Could not load the shared databases.",
    "workspaceProviderDatabases.inventoryError":
      "Provider details could not be loaded. Provider targets stay hidden and adding a database is unavailable until they load.",
    "workspaceProviderDatabases.emptyTitle": "No databases have been shared yet",
    "workspaceProviderDatabases.emptyDescription":
      "Use Add database to register one from a connected provider account.",
    "workspaceProviderDatabases.managedMode": "Managed",
    "workspaceProviderDatabases.managedModeHint": "Role-based automatic access",
    "workspaceProviderDatabases.localMode": "Member local",
    "workspaceProviderDatabases.localModeHint": "Each member enters database credentials locally",
    "workspaceProviderDatabases.target": "{provider} · {path}",
    "workspaceProviderDatabases.neonProjectsAccount": "Neon · {count} projects",
    "workspaceProviderDatabases.connectFirst": "Connect a provider account first",
    "workspaceProviderDatabases.connectFirstDescription":
      "Connect a provider account, then come back here to choose a database.",
    "workspaceProviderDatabases.reconnectFirstDescription":
      "The connected provider accounts must be reconnected before their databases can be listed.",
    "workspaceProviderDatabases.openAccounts": "Open provider accounts",
    "workspaceProviderDatabases.goToAccounts": "Go to provider accounts",
    "workspaceProviderDatabases.focusRepair":
      "If Desktop still cannot connect to this database, repair its managed access.",
    "workspaceProviderDatabases.focusManaged":
      "Managed access for this database comes from its provider account. If Desktop still cannot connect, check that account.",
    "workspaceProviderDatabases.focusMissing":
      "The requested database is not among this workspace's shared databases. It may have been removed.",
    "workspaceProviderDatabases.repairDescription":
      "Google authorization is requested again while this exact project and instance stay pinned. DopeDB then rechecks IAM database authentication, the dedicated database users and the PostgreSQL schema owner.",
    "workspaceProviderDatabases.repairAccountDescription":
      "The provider account that serves this database is connected again. The database registration and every member's access stay the same.",
    "workspaceProviderDatabases.repair": "Repair managed access",
    "workspaceProviderDatabases.repairing": "Opening repair…",
    "workspaceProviderDatabases.remove": "Remove shared database",
    "workspaceProviderDatabases.removing": "Removing…",
    "workspaceProviderDatabases.removeConfirm":
      "Remove “{name}” from the workspace? Its active credentials and execution sessions will end.",
    "workspaceProviderDatabases.removed": "Removed “{name}” from the workspace.",
    "workspaceProviderDatabases.removeError": "Could not remove the shared database.",
    "workspaceProviderDatabases.removeConflict":
      "“{name}” changed after this list was loaded, so it was not removed. The change was recorded as a conflict under Database access, and the list has been refreshed.",
    "workspaceProviderDatabases.removeChanged":
      "“{name}” or its access changed while it was being removed, so nothing was removed. The list has been refreshed; try again.",
    "workspaceProviderDatabases.removeMissing":
      "“{name}” is no longer shared in this workspace. The list has been refreshed.",
    "workspaceProviderDatabases.removeRevocationPending":
      "Active database access for “{name}” could not be revoked yet. Try again after its short-lived credentials expire.",
    "workspaceProviderDatabases.removeBusy":
      "Another access change for “{name}” is in progress. Try again shortly.",
    "workspaceProviderDatabases.imported": "Added “{name}” to the workspace.",

    "workspaceProviderDatabases.wizardTitle": "Add a shared database",
    "workspaceProviderDatabases.wizardDescription":
      "Choose an authorized provider account, then one fixed database target.",
    "workspaceProviderDatabases.stepsLabel": "Add database steps",
    "workspaceProviderDatabases.stepProgress": "Step {current} of {total}",
    "workspaceProviderDatabases.stepAccount": "Account",
    "workspaceProviderDatabases.stepTarget": "Target database",
    "workspaceProviderDatabases.stepReview": "Review",
    "workspaceProviderDatabases.accountQuestion": "Which provider account should be searched?",
    "workspaceProviderDatabases.accountDescription":
      "This choice only authorizes discovery. No team database is created yet.",
    "workspaceProviderDatabases.accountLabel": "Provider account",
    "workspaceProviderDatabases.selectAccount": "Select an account",
    "workspaceProviderDatabases.reconnectSuffix": "Reconnect required",
    "workspaceProviderDatabases.accountReconnect":
      "This account must be reconnected before its databases can be listed.",
    "workspaceProviderDatabases.unsupportedProvider":
      "This version of DopeDB cannot list this provider's resources.",
    "workspaceProviderDatabases.targetQuestion": "Choose one database to share",
    "workspaceProviderDatabases.targetDescription":
      "Only the selected project, instance and database are pinned to this workspace connection.",
    "workspaceProviderDatabases.select": "Select",
    "workspaceProviderDatabases.level.organizations": "Organization",
    "workspaceProviderDatabases.level.projects": "Project",
    "workspaceProviderDatabases.level.instances": "Instance",
    "workspaceProviderDatabases.level.databases": "Database",
    "workspaceProviderDatabases.level.branches": "Branch",
    "workspaceProviderDatabases.level.brokers": "Broker",
    "workspaceProviderDatabases.level.targets": "Target",
    "workspaceProviderDatabases.productionSuffix": "Production",
    "workspaceProviderDatabases.environmentRequiredSuffix": "Environment required",
    "workspaceProviderDatabases.notReadySuffix": "Not ready",
    "workspaceProviderDatabases.levelLoading": "Loading {level} list…",
    "workspaceProviderDatabases.levelError": "Could not load the {level} list.",
    "workspaceProviderDatabases.levelEmpty": "There is nothing to choose here.",
    "workspaceProviderDatabases.leafEmpty":
      "No database here is ready to share. Only ready databases with a known environment can be added.",
    "workspaceProviderDatabases.resourcesShapeError": "The provider resource response is invalid.",
    "workspaceProviderDatabases.reviewTitle": "Review the registration",
    "workspaceProviderDatabases.reviewDescription":
      "After it is created, choose the members who can use it under Database access.",
    "workspaceProviderDatabases.reviewAccount": "Authorized account",
    "workspaceProviderDatabases.reviewTarget": "Target",
    "workspaceProviderDatabases.reviewCredentials": "Credentials",
    "workspaceProviderDatabases.credentialDescription":
      "Rotated per member · read by default · writes follow the admin policy",
    "workspaceProviderDatabases.nameLabel": "Name in the workspace",
    "workspaceProviderDatabases.nameRequired": "Enter a name.",
    "workspaceProviderDatabases.nameInvalid": "Use at most 120 characters on a single line.",
    "workspaceProviderDatabases.productionNotice":
      "This is a production database. Queries can affect real production data. It is added with writes disabled; write access is set separately under Database access.",
    "workspaceProviderDatabases.productionApproval":
      "I approve adding this production database. The approval is recorded in the audit log.",
    "workspaceProviderDatabases.back": "Back",
    "workspaceProviderDatabases.continue": "Continue",
    "workspaceProviderDatabases.create": "Create shared database",
    "workspaceProviderDatabases.creating": "Creating…",
    "workspaceProviderDatabases.verifyingSelection": "Verifying the selection…",
    "workspaceProviderDatabases.importProgress": "Registering the shared database",
    "workspaceProviderDatabases.selectionExpired":
      "The provider selection expired or changed. The list was reloaded; check the database and try again.",
    "workspaceProviderDatabases.selectionUnavailable":
      "The selected database is no longer available. Choose a database again.",
    "workspaceProviderDatabases.receiptError": "Could not verify the selected provider resource.",
    "workspaceProviderDatabases.receiptShapeError":
      "The provider resource verification response is invalid.",
    "workspaceProviderDatabases.importError": "Could not create the shared database.",
    "workspaceProviderDatabases.alreadyImported": "This database is already shared in the workspace.",
    "workspaceProviderDatabases.receiptRejected":
      "The verification for this selection expired or was already used. Create the shared database again to verify it anew.",
    "workspaceProviderDatabases.idempotencyConflict":
      "This request conflicted with an earlier attempt. Try again.",

    "workspaceProviderDatabases.neonTitle": "Prepare Neon least-privilege access",
    "workspaceProviderDatabases.neonDescription":
      "Before the database is registered, DopeDB inspects public privileges and ownership boundaries. Existing access is preserved, unsafe boundaries need a separate administrator review, and new short-lived read and write roles are verified against the live connection.",
    "workspaceProviderDatabases.branchEnvironment": "Branch environment",
    "workspaceProviderDatabases.chooseEnvironment": "Choose environment",
    "workspaceProviderDatabases.environmentDevelopment": "Development",
    "workspaceProviderDatabases.environmentProduction": "Production",
    "workspaceProviderDatabases.protectedBranch":
      "Neon identifies this as a protected production branch. It cannot be treated as development.",
    "workspaceProviderDatabases.developmentBranch":
      "Neon identifies this as an unprotected development branch.",
    "workspaceProviderDatabases.preflightDescription":
      "No database privileges change yet. Review the no-change preflight first.",
    "workspaceProviderDatabases.preflight": "Run preflight",
    "workspaceProviderDatabases.preflighting": "Checking…",
    "workspaceProviderDatabases.preflightProgress": "Running the Neon least-privilege preflight",
    "workspaceProviderDatabases.applyProgress": "Applying and verifying Neon least-privilege access",
    "workspaceProviderDatabases.blockedTitle": "Some items cannot be configured automatically",
    "workspaceProviderDatabases.approvalTitle": "Changes require approval",
    "workspaceProviderDatabases.readyTitle": "The least-privilege boundary can be applied",
    "workspaceProviderDatabases.rollback":
      "The automatic changes shown are rolled back if verification fails.",
    "workspaceProviderDatabases.noRollback":
      "A change cannot be recovered automatically, so nothing will be applied.",
    "workspaceProviderDatabases.findingsLabel": "Preflight findings",
    "workspaceProviderDatabases.findingBlocker": "Blocked",
    "workspaceProviderDatabases.findingChange": "Change",
    "workspaceProviderDatabases.findingVerified": "Verified",
    "workspaceProviderDatabases.findingNeedsApproval": "Needs approval",
    "workspaceProviderDatabases.findingBefore": "Before",
    "workspaceProviderDatabases.findingAfter": "After",
    "workspaceProviderDatabases.publicApproval":
      "Existing PUBLIC privileges need a separate administrator review",
    "workspaceProviderDatabases.publicApprovalDescription":
      "This can affect other users of the same branch. If verification fails, the inverse operations shown restore the previous state.",
    "workspaceProviderDatabases.productionChangeApproval":
      "I approve privilege changes and verification on the production database",
    "workspaceProviderDatabases.productionChangeApprovalDescription":
      "The approval is recorded in the audit log together with the plan hash.",
    "workspaceProviderDatabases.neonVerified":
      "Setup and verification are complete. The read role blocks writes, and the write role allows DML while denying DDL and role administration. The shared database is created with writes disabled.",
    "workspaceProviderDatabases.recheck": "Run preflight again",
    "workspaceProviderDatabases.apply": "Approve, apply and verify",
    "workspaceProviderDatabases.applying": "Applying and verifying…",
    "workspaceProviderDatabases.neonClassify":
      "Choose whether this Neon branch is for development or production first.",
    "workspaceProviderDatabases.neonReselect": "Select the Neon database again.",
    "workspaceProviderDatabases.neonPreflightError":
      "Could not complete the Neon least-privilege preflight.",
    "workspaceProviderDatabases.neonPreflightShapeError": "The Neon preflight response is invalid.",
    "workspaceProviderDatabases.neonPreflightExpired": "The Neon preflight expired. Run it again.",
    "workspaceProviderDatabases.neonBlocked":
      "Resolve the blocked items, then run the preflight again.",
    "workspaceProviderDatabases.neonPublicApprovalRequired":
      "Existing PUBLIC privileges are preserved. A separate administrator review is required.",
    "workspaceProviderDatabases.neonProductionApprovalRequired":
      "Approve the production database changes first.",
    "workspaceProviderDatabases.neonApplyError":
      "Could not complete Neon least-privilege setup and verification.",
    "workspaceProviderDatabases.neonApplyShapeError":
      "The Neon setup and verification response is invalid.",
    "workspaceProviderDatabases.neonVerificationExpired":
      "Neon setup verification expired. Start again from the preflight.",
    "workspaceProviderDatabases.neonSelectionChanged":
      "The Neon selection expired or changed. The list was reloaded; check the database and run the preflight again.",
    "workspaceProviderDatabases.neonPlanChanged":
      "The Neon plan or branch authority changed. Run the preflight again.",
    "workspaceProviderDatabases.neonManualRepair":
      "Neon setup needs manual repair. Review the workspace audit log before retrying.",

    "workspaceProviderDatabases.neonFinding.branchNotReady":
      "The selected Neon branch compute is not Ready.",
    "workspaceProviderDatabases.neonFinding.databaseOwnerMismatch":
      "The Neon owner session does not match the selected database owner.",
    "workspaceProviderDatabases.neonFinding.roleCreateUnavailable":
      "The database owner cannot create least-privilege lease roles.",
    "workspaceProviderDatabases.neonFinding.databaseConnectNotGrantable":
      "Database CONNECT cannot be delegated to a short-lived role.",
    "workspaceProviderDatabases.neonFinding.databaseInventoryInvalid":
      "The database inventory could not be pinned safely.",
    "workspaceProviderDatabases.neonFinding.otherDatabaseInvalid":
      "A public access target in another database could not be identified safely.",
    "workspaceProviderDatabases.neonFinding.otherDatabaseConnectNotGrantable":
      "PUBLIC CONNECT on another database cannot be revoked by the current owner.",
    "workspaceProviderDatabases.neonFinding.schemaNotGrantable":
      "An allowed schema is missing or does not satisfy the role delegation and write-probe boundaries.",
    "workspaceProviderDatabases.neonFinding.schemaInventoryInvalid":
      "A public schema privilege target could not be identified safely.",
    "workspaceProviderDatabases.neonFinding.schemaOwnershipUnsafe":
      "A managed schema creator or object owner is outside the single-owner boundary.",
    "workspaceProviderDatabases.neonFinding.outsideSchemaPublicAccess":
      "PUBLIC USAGE or CREATE remains on a schema outside the allowlist.",
    "workspaceProviderDatabases.neonFinding.publicObjectWriteAccess":
      "An object in a managed schema grants write access to PUBLIC.",
    "workspaceProviderDatabases.neonFinding.objectNotGrantable":
      "Current object read and write privileges cannot be delegated to a least-privilege role.",
    "workspaceProviderDatabases.neonFinding.publicSecurityDefiner":
      "A SECURITY DEFINER function can be executed by PUBLIC.",
    "workspaceProviderDatabases.neonFinding.ownershipMarkerDrift":
      "The existing DopeDB marker differs from the expected policy and is not adopted automatically.",
    "workspaceProviderDatabases.neonFinding.ownershipMarkerMembershipDrift":
      "The membership boundary of the DopeDB policy owner differs from the expected state.",
    "workspaceProviderDatabases.neonFinding.leaseRoleDrift":
      "An existing DopeDB-formatted role differs from the expected login, expiry or privilege boundary.",
    "workspaceProviderDatabases.neonFinding.activeLeaseRolePresent":
      "An active short-lived DopeDB role remains and cannot be attributed safely to this branch's credentials.",
    "workspaceProviderDatabases.neonFinding.publicAccessPreserved":
      "Existing PUBLIC access is not changed while connecting. A separate DBA review is required.",
    "workspaceProviderDatabases.neonFinding.revokePublicDatabase":
      "Revoke PUBLIC {privilege} on the database.",
    "workspaceProviderDatabases.neonFinding.revokeOtherDatabasePublicConnect":
      "Revoke PUBLIC CONNECT so short-lived roles cannot move to another database.",
    "workspaceProviderDatabases.neonFinding.revokePublicSchemaCreate":
      "Revoke CREATE so PUBLIC cannot create objects in managed schemas.",
    "workspaceProviderDatabases.neonFinding.createOwnershipMarker":
      "Create a NOLOGIN marker so only policy boundaries created by DopeDB are eligible for later recovery.",
    "workspaceProviderDatabases.neonFinding.readWriteSmokePlanned":
      "Connect with short-lived read and write roles and verify the allowed and denied boundaries.",
    "workspaceProviderDatabases.neonFinding.policyAlreadyReady":
      "Current ACLs and the ownership marker satisfy the DopeDB read boundary.",
    "workspaceProviderDatabases.neonValue.verificationFailed": "Verification failed",
    "workspaceProviderDatabases.neonValue.developmentBranchOrDba":
      "Dedicated development branch or DBA action required",
    "workspaceProviderDatabases.neonValue.sameBranch": "Same Neon branch",
    "workspaceProviderDatabases.neonValue.outsideAllowlist": "Schema outside the allowlist",
    "workspaceProviderDatabases.neonValue.noPublicPrivilege": "No PUBLIC {privilege}",
    "workspaceProviderDatabases.neonValue.noMarker": "No marker",
    "workspaceProviderDatabases.neonValue.nologinMarker": "NOLOGIN least-privilege marker",
    "workspaceProviderDatabases.neonValue.existingLeaseRole": "Existing short-lived role",
    "workspaceProviderDatabases.neonValue.noPreRunVerification": "No pre-run verification",
    "workspaceProviderDatabases.neonValue.smokeResult":
      "Read succeeds · write DML succeeds · DDL and role administration denied · probe removed",
    "workspaceProviderDatabases.neonValue.policySatisfied": "Policy satisfied",
    "workspaceProviderDatabases.neonValue.noChange": "No change",

    "workspaceProviderDatabases.serverError.neonKeyInvalid":
      "The Neon API key is invalid or revoked. Issue a new key in the Neon Console and reconnect the account.",
    "workspaceProviderDatabases.serverError.neonScopeDenied":
      "The Neon API key cannot access the requested scope. Check the personal key with its organization ID, or the permissions of the organization or project key.",
    "workspaceProviderDatabases.serverError.neonProjectsDenied":
      "Neon refused to list projects for this API key. Check that it is a project-scoped organization key, or try again with a new key.",
    "workspaceProviderDatabases.serverError.neonProjectUnverified":
      "Neon could not verify this project for the API key. Check that the project ID and the key come from the same project.",
    "workspaceProviderDatabases.serverError.neonProjectNotFound":
      "The Neon project was not found or this API key cannot access it. Check the project ID and the key's scope.",
    "workspaceProviderDatabases.serverError.neonBranchStarting":
      "The Neon branch is starting or resetting. Try again shortly.",
    "workspaceProviderDatabases.serverError.neonNoProject":
      "The Neon API key cannot access any project. Check the project scope and organization permissions.",
    "workspaceProviderDatabases.serverError.neonRateLimited":
      "The Neon API request limit was reached. Try again shortly.",
    "workspaceProviderDatabases.serverError.neonBranchNeedsRepair":
      "Managed access for this Neon branch needs repair before it can be prepared.",
    "workspaceProviderDatabases.serverError.neonClassifyBranch":
      "Choose whether this default or unclassified Neon branch is for development or production before continuing.",
    "workspaceProviderDatabases.serverError.gcpLegacyIntegration":
      "This Cloud SQL account connection predates the fixed database inventory. Reconnect it under provider accounts.",
  },
  {
    "workspaceProviderDatabases.title": "워크스페이스 DB",
    "workspaceProviderDatabases.description":
      "DB를 한 번 등록하면 팀에 공유되고, 허용된 구성원마다 역할에 맞는 단기 자격 증명이 자동으로 회전됩니다.",
    "workspaceProviderDatabases.add": "DB 추가",
    "workspaceProviderDatabases.listLabel": "공유 DB",
    "workspaceProviderDatabases.loading": "공유 DB를 불러오는 중…",
    "workspaceProviderDatabases.loadError": "공유 DB를 불러오지 못했습니다.",
    "workspaceProviderDatabases.inventoryError":
      "공급자 정보를 불러오지 못했습니다. 다시 불러올 때까지 공급자 대상이 표시되지 않고 DB를 추가할 수 없습니다.",
    "workspaceProviderDatabases.emptyTitle": "아직 공유된 DB가 없습니다",
    "workspaceProviderDatabases.emptyDescription":
      "DB 추가에서 연결된 공급자 계정의 DB를 등록하세요.",
    "workspaceProviderDatabases.managedMode": "관리형",
    "workspaceProviderDatabases.managedModeHint": "역할 기반 자동 접근",
    "workspaceProviderDatabases.localMode": "구성원 로컬",
    "workspaceProviderDatabases.localModeHint": "구성원이 각자 로컬에서 DB 자격 증명을 입력합니다",
    "workspaceProviderDatabases.target": "{provider} · {path}",
    "workspaceProviderDatabases.neonProjectsAccount": "Neon · 프로젝트 {count}개",
    "workspaceProviderDatabases.connectFirst": "먼저 공급자 계정을 연결하세요",
    "workspaceProviderDatabases.connectFirstDescription":
      "공급자 계정을 연결한 뒤 이곳으로 돌아와 DB를 선택하세요.",
    "workspaceProviderDatabases.reconnectFirstDescription":
      "연결된 공급자 계정을 다시 연결해야 DB 목록을 불러올 수 있습니다.",
    "workspaceProviderDatabases.openAccounts": "공급자 계정 열기",
    "workspaceProviderDatabases.goToAccounts": "공급자 계정으로 이동",
    "workspaceProviderDatabases.focusRepair":
      "Desktop에서 이 DB에 계속 연결되지 않으면 관리형 접근을 복구하세요.",
    "workspaceProviderDatabases.focusManaged":
      "이 DB의 관리형 접근은 연결된 공급자 계정이 제공합니다. Desktop에서 계속 연결되지 않으면 해당 계정을 확인하세요.",
    "workspaceProviderDatabases.focusMissing":
      "요청한 DB가 이 워크스페이스의 공유 DB 목록에 없습니다. 이미 제거되었을 수 있습니다.",
    "workspaceProviderDatabases.repairDescription":
      "Google 승인을 다시 받은 뒤 이 프로젝트와 인스턴스를 그대로 고정해 IAM DB 인증, 전용 DB 사용자와 PostgreSQL 스키마 소유자를 다시 점검합니다.",
    "workspaceProviderDatabases.repairAccountDescription":
      "이 DB를 제공하는 공급자 계정을 다시 연결합니다. DB 등록과 구성원의 접근 권한은 그대로 유지됩니다.",
    "workspaceProviderDatabases.repair": "관리형 접근 복구",
    "workspaceProviderDatabases.repairing": "복구 화면 여는 중…",
    "workspaceProviderDatabases.remove": "공유 DB 제거",
    "workspaceProviderDatabases.removing": "제거 중…",
    "workspaceProviderDatabases.removeConfirm":
      "‘{name}’ 공유 DB를 워크스페이스에서 제거할까요? 이 DB의 활성 자격 증명과 실행 세션이 종료됩니다.",
    "workspaceProviderDatabases.removed": "‘{name}’ 공유 DB를 워크스페이스에서 제거했습니다.",
    "workspaceProviderDatabases.removeError": "공유 DB를 제거하지 못했습니다.",
    "workspaceProviderDatabases.removeConflict":
      "목록을 불러온 뒤 ‘{name}’ 공유 DB가 변경되어 제거하지 않았습니다. 변경 내용은 DB 접근 권한의 충돌 항목에 기록되었고 목록을 새로 고쳤습니다.",
    "workspaceProviderDatabases.removeChanged":
      "제거하는 동안 ‘{name}’ 공유 DB 또는 접근 권한이 변경되어 아무것도 제거하지 않았습니다. 목록을 새로 고쳤으니 다시 시도하세요.",
    "workspaceProviderDatabases.removeMissing":
      "‘{name}’ 공유 DB는 더 이상 이 워크스페이스에 없습니다. 목록을 새로 고쳤습니다.",
    "workspaceProviderDatabases.removeRevocationPending":
      "‘{name}’ 공유 DB의 활성 접근을 아직 회수하지 못했습니다. 단기 자격 증명이 만료된 뒤 다시 시도하세요.",
    "workspaceProviderDatabases.removeBusy":
      "‘{name}’ 공유 DB에 다른 접근 변경이 진행 중입니다. 잠시 뒤 다시 시도하세요.",
    "workspaceProviderDatabases.imported": "‘{name}’ 공유 DB를 워크스페이스에 추가했습니다.",

    "workspaceProviderDatabases.wizardTitle": "공유 DB 추가",
    "workspaceProviderDatabases.wizardDescription":
      "인증된 공급자 계정과 고정할 DB 대상을 차례로 선택합니다.",
    "workspaceProviderDatabases.stepsLabel": "DB 추가 단계",
    "workspaceProviderDatabases.stepProgress": "{current}/{total}단계",
    "workspaceProviderDatabases.stepAccount": "계정",
    "workspaceProviderDatabases.stepTarget": "대상 DB",
    "workspaceProviderDatabases.stepReview": "검토",
    "workspaceProviderDatabases.accountQuestion": "어떤 공급자 계정에서 찾을까요?",
    "workspaceProviderDatabases.accountDescription":
      "이 선택은 조회 인증에만 쓰입니다. 아직 팀 DB가 만들어지지 않습니다.",
    "workspaceProviderDatabases.accountLabel": "공급자 계정",
    "workspaceProviderDatabases.selectAccount": "계정 선택",
    "workspaceProviderDatabases.reconnectSuffix": "재연결 필요",
    "workspaceProviderDatabases.accountReconnect":
      "이 계정을 다시 연결해야 DB 목록을 불러올 수 있습니다.",
    "workspaceProviderDatabases.unsupportedProvider":
      "이 버전의 DopeDB는 이 공급자의 리소스를 조회할 수 없습니다.",
    "workspaceProviderDatabases.targetQuestion": "공유할 DB 하나를 선택하세요",
    "workspaceProviderDatabases.targetDescription":
      "선택한 프로젝트·인스턴스·DB만 이 워크스페이스 연결에 고정됩니다.",
    "workspaceProviderDatabases.select": "선택",
    "workspaceProviderDatabases.level.organizations": "조직",
    "workspaceProviderDatabases.level.projects": "프로젝트",
    "workspaceProviderDatabases.level.instances": "인스턴스",
    "workspaceProviderDatabases.level.databases": "DB",
    "workspaceProviderDatabases.level.branches": "브랜치",
    "workspaceProviderDatabases.level.brokers": "브로커",
    "workspaceProviderDatabases.level.targets": "대상",
    "workspaceProviderDatabases.productionSuffix": "운영",
    "workspaceProviderDatabases.environmentRequiredSuffix": "환경 확인 필요",
    "workspaceProviderDatabases.notReadySuffix": "준비 안 됨",
    "workspaceProviderDatabases.levelLoading": "{level} 목록을 불러오는 중…",
    "workspaceProviderDatabases.levelError": "{level} 목록을 불러오지 못했습니다.",
    "workspaceProviderDatabases.levelEmpty": "선택할 수 있는 항목이 없습니다.",
    "workspaceProviderDatabases.leafEmpty":
      "공유할 준비가 된 DB가 없습니다. 준비 상태이며 환경이 확인된 DB만 추가할 수 있습니다.",
    "workspaceProviderDatabases.resourcesShapeError": "공급자 리소스 응답 형식을 확인하지 못했습니다.",
    "workspaceProviderDatabases.reviewTitle": "등록 내용을 확인하세요",
    "workspaceProviderDatabases.reviewDescription":
      "생성한 뒤 DB 접근 권한에서 사용할 구성원을 지정하세요.",
    "workspaceProviderDatabases.reviewAccount": "인증 계정",
    "workspaceProviderDatabases.reviewTarget": "대상",
    "workspaceProviderDatabases.reviewCredentials": "자격 증명",
    "workspaceProviderDatabases.credentialDescription":
      "구성원별 자동 회전 · 기본 읽기 · 관리자 쓰기 정책",
    "workspaceProviderDatabases.nameLabel": "워크스페이스 표시 이름",
    "workspaceProviderDatabases.nameRequired": "이름을 입력하세요.",
    "workspaceProviderDatabases.nameInvalid": "한 줄로 120자 이내여야 합니다.",
    "workspaceProviderDatabases.productionNotice":
      "운영 DB입니다. 실행하는 쿼리가 실제 운영 데이터에 영향을 줄 수 있습니다. 쓰기는 꺼진 상태로 추가되며 쓰기 허용은 DB 접근 권한에서 따로 정합니다.",
    "workspaceProviderDatabases.productionApproval":
      "이 운영 DB 추가를 승인합니다. 승인은 감사 기록에 남습니다.",
    "workspaceProviderDatabases.back": "이전",
    "workspaceProviderDatabases.continue": "계속",
    "workspaceProviderDatabases.create": "공유 DB 만들기",
    "workspaceProviderDatabases.creating": "만드는 중…",
    "workspaceProviderDatabases.verifyingSelection": "선택을 확인하는 중…",
    "workspaceProviderDatabases.importProgress": "공유 DB를 등록하는 중",
    "workspaceProviderDatabases.selectionExpired":
      "공급자 선택이 만료되었거나 변경되었습니다. 목록을 다시 불러왔으니 DB를 확인한 뒤 다시 시도하세요.",
    "workspaceProviderDatabases.selectionUnavailable":
      "선택한 DB를 더 이상 사용할 수 없습니다. DB를 다시 선택하세요.",
    "workspaceProviderDatabases.receiptError": "선택한 공급자 리소스를 확인하지 못했습니다.",
    "workspaceProviderDatabases.receiptShapeError":
      "공급자 리소스 확인 응답 형식을 확인하지 못했습니다.",
    "workspaceProviderDatabases.importError": "공유 DB를 만들지 못했습니다.",
    "workspaceProviderDatabases.alreadyImported": "이 DB는 이미 워크스페이스에 공유되어 있습니다.",
    "workspaceProviderDatabases.receiptRejected":
      "이 선택의 확인이 만료되었거나 이미 사용되었습니다. 공유 DB를 다시 만들면 새로 확인합니다.",
    "workspaceProviderDatabases.idempotencyConflict":
      "이전 시도와 요청이 충돌했습니다. 다시 시도하세요.",

    "workspaceProviderDatabases.neonTitle": "Neon 최소 권한 준비",
    "workspaceProviderDatabases.neonDescription":
      "DB를 등록하기 전에 공개 권한과 소유권 경계를 점검합니다. 기존 접근은 보존하고, 안전하지 않은 경계는 별도 관리자 검토가 필요하며, 새 단기 읽기·쓰기 역할의 경계를 실제 연결로 검증합니다.",
    "workspaceProviderDatabases.branchEnvironment": "브랜치 환경",
    "workspaceProviderDatabases.chooseEnvironment": "환경 선택",
    "workspaceProviderDatabases.environmentDevelopment": "개발",
    "workspaceProviderDatabases.environmentProduction": "운영",
    "workspaceProviderDatabases.protectedBranch":
      "Neon에서 보호된 운영 브랜치로 확인했습니다. 개발 환경으로 낮출 수 없습니다.",
    "workspaceProviderDatabases.developmentBranch": "Neon에서 비보호 개발 브랜치로 확인했습니다.",
    "workspaceProviderDatabases.preflightDescription":
      "아직 DB 권한을 변경하지 않습니다. 먼저 변경 없는 사전 점검 결과를 확인하세요.",
    "workspaceProviderDatabases.preflight": "사전 점검",
    "workspaceProviderDatabases.preflighting": "점검 중…",
    "workspaceProviderDatabases.preflightProgress": "Neon 최소 권한 사전 점검 중",
    "workspaceProviderDatabases.applyProgress": "Neon 최소 권한 설정과 검증 중",
    "workspaceProviderDatabases.blockedTitle": "자동으로 설정할 수 없는 항목이 있습니다",
    "workspaceProviderDatabases.approvalTitle": "승인할 변경이 있습니다",
    "workspaceProviderDatabases.readyTitle": "최소 권한 경계를 적용할 수 있습니다",
    "workspaceProviderDatabases.rollback":
      "표시된 자동 변경은 검증에 실패하면 원래 상태로 되돌립니다.",
    "workspaceProviderDatabases.noRollback":
      "자동으로 되돌릴 수 없는 변경이 있어 적용하지 않습니다.",
    "workspaceProviderDatabases.findingsLabel": "사전 점검 결과",
    "workspaceProviderDatabases.findingBlocker": "차단",
    "workspaceProviderDatabases.findingChange": "변경",
    "workspaceProviderDatabases.findingVerified": "확인됨",
    "workspaceProviderDatabases.findingNeedsApproval": "승인 필요",
    "workspaceProviderDatabases.findingBefore": "변경 전",
    "workspaceProviderDatabases.findingAfter": "변경 후",
    "workspaceProviderDatabases.publicApproval": "기존 PUBLIC 권한은 별도 관리자 검토가 필요합니다",
    "workspaceProviderDatabases.publicApprovalDescription":
      "같은 브랜치의 다른 사용자 접근에 영향을 줄 수 있으며, 검증에 실패하면 표시된 역연산으로 이전 상태를 복구합니다.",
    "workspaceProviderDatabases.productionChangeApproval":
      "운영 DB의 권한 변경과 검증 실행을 승인합니다",
    "workspaceProviderDatabases.productionChangeApprovalDescription":
      "승인은 계획 해시와 함께 감사 기록에 남습니다.",
    "workspaceProviderDatabases.neonVerified":
      "설정과 검증을 완료했습니다. 읽기 역할의 쓰기 차단과 쓰기 역할의 DML 허용·DDL 및 역할 관리 거부를 확인했습니다. 공유 DB는 쓰기가 꺼진 상태로 생성됩니다.",
    "workspaceProviderDatabases.recheck": "다시 점검",
    "workspaceProviderDatabases.apply": "승인 후 설정·검증",
    "workspaceProviderDatabases.applying": "설정·검증 중…",
    "workspaceProviderDatabases.neonClassify":
      "먼저 Neon 브랜치가 개발용인지 운영용인지 선택하세요.",
    "workspaceProviderDatabases.neonReselect": "Neon DB를 다시 선택하세요.",
    "workspaceProviderDatabases.neonPreflightError": "Neon 최소 권한 사전 점검을 완료하지 못했습니다.",
    "workspaceProviderDatabases.neonPreflightShapeError": "Neon 사전 점검 응답 형식을 확인하지 못했습니다.",
    "workspaceProviderDatabases.neonPreflightExpired": "Neon 사전 점검이 만료되었습니다. 다시 점검하세요.",
    "workspaceProviderDatabases.neonBlocked": "차단 항목을 해결한 뒤 사전 점검을 다시 실행하세요.",
    "workspaceProviderDatabases.neonPublicApprovalRequired":
      "기존 PUBLIC 권한은 보존합니다. 별도 관리자 검토가 필요합니다.",
    "workspaceProviderDatabases.neonProductionApprovalRequired": "먼저 운영 DB 변경을 승인하세요.",
    "workspaceProviderDatabases.neonApplyError": "Neon 최소 권한 설정과 검증을 완료하지 못했습니다.",
    "workspaceProviderDatabases.neonApplyShapeError": "Neon 설정·검증 응답 형식을 확인하지 못했습니다.",
    "workspaceProviderDatabases.neonVerificationExpired":
      "Neon 설정 검증이 만료되었습니다. 사전 점검부터 다시 실행하세요.",
    "workspaceProviderDatabases.neonSelectionChanged":
      "Neon 선택이 만료되었거나 변경되었습니다. 목록을 다시 불러왔으니 DB를 확인한 뒤 사전 점검을 다시 실행하세요.",
    "workspaceProviderDatabases.neonPlanChanged":
      "Neon 계획 또는 브랜치 권한이 변경되었습니다. 사전 점검을 다시 실행하세요.",
    "workspaceProviderDatabases.neonManualRepair":
      "Neon 설정에 수동 복구가 필요합니다. 다시 시도하기 전에 워크스페이스 감사 기록을 확인하세요.",

    "workspaceProviderDatabases.neonFinding.branchNotReady":
      "선택한 Neon 브랜치의 compute가 Ready 상태가 아닙니다.",
    "workspaceProviderDatabases.neonFinding.databaseOwnerMismatch":
      "Neon owner session이 선택한 데이터베이스 소유자와 일치하지 않습니다.",
    "workspaceProviderDatabases.neonFinding.roleCreateUnavailable":
      "데이터베이스 소유자가 최소권한 lease role을 만들 수 없습니다.",
    "workspaceProviderDatabases.neonFinding.databaseConnectNotGrantable":
      "데이터베이스 CONNECT 권한을 단기 role에 위임할 수 없습니다.",
    "workspaceProviderDatabases.neonFinding.databaseInventoryInvalid":
      "데이터베이스 목록을 안전하게 고정하지 못했습니다.",
    "workspaceProviderDatabases.neonFinding.otherDatabaseInvalid":
      "다른 데이터베이스의 공개 접근 대상을 안전하게 식별하지 못했습니다.",
    "workspaceProviderDatabases.neonFinding.otherDatabaseConnectNotGrantable":
      "다른 데이터베이스의 PUBLIC CONNECT를 현재 owner로 회수할 수 없습니다.",
    "workspaceProviderDatabases.neonFinding.schemaNotGrantable":
      "허용 schema가 없거나 단기 role 위임·쓰기 probe 생성 경계를 만족하지 않습니다.",
    "workspaceProviderDatabases.neonFinding.schemaInventoryInvalid":
      "공개 schema 권한 대상을 안전하게 식별하지 못했습니다.",
    "workspaceProviderDatabases.neonFinding.schemaOwnershipUnsafe":
      "관리 schema의 생성자 또는 객체 소유자가 단일 owner 경계 밖에 있습니다.",
    "workspaceProviderDatabases.neonFinding.outsideSchemaPublicAccess":
      "allowlist 밖 schema에 PUBLIC USAGE 또는 CREATE가 남아 있습니다.",
    "workspaceProviderDatabases.neonFinding.publicObjectWriteAccess":
      "관리 schema의 객체에 PUBLIC 쓰기 권한이 있습니다.",
    "workspaceProviderDatabases.neonFinding.objectNotGrantable":
      "현재 객체의 읽기·쓰기 권한을 최소권한 role에 위임할 수 없습니다.",
    "workspaceProviderDatabases.neonFinding.publicSecurityDefiner":
      "PUBLIC이 실행할 수 있는 SECURITY DEFINER 함수가 있습니다.",
    "workspaceProviderDatabases.neonFinding.ownershipMarkerDrift":
      "기존 DopeDB marker가 예상 정책과 달라 자동으로 인수하지 않습니다.",
    "workspaceProviderDatabases.neonFinding.ownershipMarkerMembershipDrift":
      "DopeDB 정책 owner의 구성원 경계가 예상 상태와 다릅니다.",
    "workspaceProviderDatabases.neonFinding.leaseRoleDrift":
      "기존 DopeDB 형식 role의 로그인·만료·권한 경계가 예상 정책과 다릅니다.",
    "workspaceProviderDatabases.neonFinding.activeLeaseRolePresent":
      "활성 DopeDB 단기 role이 남아 있어 다른 branch의 자격증명인지 구분할 수 없습니다.",
    "workspaceProviderDatabases.neonFinding.publicAccessPreserved":
      "기존 PUBLIC 접근 권한은 연결 과정에서 변경하지 않습니다. 별도 DBA 검토가 필요합니다.",
    "workspaceProviderDatabases.neonFinding.revokePublicDatabase":
      "PUBLIC의 데이터베이스 {privilege} 권한을 회수합니다.",
    "workspaceProviderDatabases.neonFinding.revokeOtherDatabasePublicConnect":
      "단기 role이 다른 데이터베이스로 이동하지 못하도록 PUBLIC CONNECT를 회수합니다.",
    "workspaceProviderDatabases.neonFinding.revokePublicSchemaCreate":
      "PUBLIC이 관리 schema에 객체를 만들지 못하도록 CREATE를 회수합니다.",
    "workspaceProviderDatabases.neonFinding.createOwnershipMarker":
      "DopeDB가 만든 정책 경계만 이후 복구 대상으로 식별하도록 NOLOGIN marker를 만듭니다.",
    "workspaceProviderDatabases.neonFinding.readWriteSmokePlanned":
      "단기 read/write role을 실제 연결해 허용·거부 경계를 검증합니다.",
    "workspaceProviderDatabases.neonFinding.policyAlreadyReady":
      "현재 ACL과 ownership marker가 DopeDB 읽기 경계를 만족합니다.",
    "workspaceProviderDatabases.neonValue.verificationFailed": "검증 실패",
    "workspaceProviderDatabases.neonValue.developmentBranchOrDba": "전용 개발 브랜치 또는 DBA 조치 필요",
    "workspaceProviderDatabases.neonValue.sameBranch": "같은 Neon 브랜치",
    "workspaceProviderDatabases.neonValue.outsideAllowlist": "allowlist 밖 schema",
    "workspaceProviderDatabases.neonValue.noPublicPrivilege": "PUBLIC {privilege} 없음",
    "workspaceProviderDatabases.neonValue.noMarker": "marker 없음",
    "workspaceProviderDatabases.neonValue.nologinMarker": "NOLOGIN 최소권한 marker",
    "workspaceProviderDatabases.neonValue.existingLeaseRole": "기존 단기 role",
    "workspaceProviderDatabases.neonValue.noPreRunVerification": "실행 전 검증 없음",
    "workspaceProviderDatabases.neonValue.smokeResult":
      "read 성공·write DML 성공·DDL/role 관리 거부·probe 제거",
    "workspaceProviderDatabases.neonValue.policySatisfied": "정책 충족",
    "workspaceProviderDatabases.neonValue.noChange": "변경 없음",

    "workspaceProviderDatabases.serverError.neonKeyInvalid":
      "Neon API 키가 유효하지 않거나 폐기되었습니다. Neon Console에서 새 키를 발급해 계정을 다시 연결하세요.",
    "workspaceProviderDatabases.serverError.neonScopeDenied":
      "Neon API 키로 요청한 범위에 접근할 수 없습니다. 개인 키와 조직 ID 또는 조직·프로젝트 범위 키의 권한을 확인하세요.",
    "workspaceProviderDatabases.serverError.neonProjectsDenied":
      "Neon이 이 API 키의 프로젝트 목록 요청을 거부했습니다. 키가 프로젝트 범위 조직 키인지 확인하거나 새 키로 다시 시도하세요.",
    "workspaceProviderDatabases.serverError.neonProjectUnverified":
      "Neon이 입력한 프로젝트와 API 키의 범위를 확인하지 못했습니다. 프로젝트 ID와 키를 같은 프로젝트에서 복사했는지 확인하세요.",
    "workspaceProviderDatabases.serverError.neonProjectNotFound":
      "Neon 프로젝트를 찾을 수 없거나 이 API 키로 접근할 수 없습니다. 프로젝트 ID와 키 범위를 확인하세요.",
    "workspaceProviderDatabases.serverError.neonBranchStarting":
      "Neon 브랜치가 시작 또는 초기화 중입니다. 잠시 뒤 다시 시도하세요.",
    "workspaceProviderDatabases.serverError.neonNoProject":
      "Neon API 키로 접근할 수 있는 프로젝트가 없습니다. 프로젝트 범위와 조직 권한을 확인하세요.",
    "workspaceProviderDatabases.serverError.neonRateLimited":
      "Neon API 요청 한도에 도달했습니다. 잠시 뒤 다시 시도하세요.",
    "workspaceProviderDatabases.serverError.neonBranchNeedsRepair":
      "이 Neon 브랜치의 관리형 접근은 준비하기 전에 복구가 필요합니다.",
    "workspaceProviderDatabases.serverError.neonClassifyBranch":
      "계속하기 전에 기본 또는 미분류 Neon 브랜치가 개발용인지 운영용인지 선택하세요.",
    "workspaceProviderDatabases.serverError.gcpLegacyIntegration":
      "이 Cloud SQL 계정 연결은 고정 DB 목록을 저장하기 전 버전입니다. 공급자 계정에서 다시 연결하세요.",
  },
);
