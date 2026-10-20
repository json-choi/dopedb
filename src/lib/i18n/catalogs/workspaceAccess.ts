// Member grant, access-lowering and preserved-edit conflict messages are owned by this bounded feature catalogue.
import { defineCatalog } from "../types";

export const workspaceAccessCatalog = defineCatalog(
  {
    "workspaceAccess.readOnly": "Read only",
    "workspaceAccess.teamOrigin": "Team access",
    "workspaceAccess.ownAccessHint": "You can't change your own access.",
    "workspaceAccess.updatingAccess": "Updating…",
    "workspaceAccess.capabilityNone": "No access",
    "workspaceAccess.capabilityView": "View · connection details only",
    "workspaceAccess.capabilityRead": "Read · no database changes",
    "workspaceAccess.capabilityUseManaged": "Use · role-based automatic access",
    "workspaceAccess.capabilityUseLocal": "Use · own credentials",
    "workspaceAccess.capabilityManage": "Manage · access and settings",
    "workspaceAccess.conflictsTitle": "Connection changes to review",
    "workspaceAccess.conflictsCount": "{count} open",
    "workspaceAccess.conflictsDescription":
      "These edits were made against an older version. Compare each with the current version and choose which one the team keeps.",
    "workspaceAccess.conflictMeta": "Edited from r{expected} · server was r{server}",
    "workspaceAccess.conflictChangedAgain": "Changed again",
    "workspaceAccess.conflictChangedAgainHint":
      "The current version changed again after this conflict was recorded.",
    "workspaceAccess.conflictField": "Field",
    "workspaceAccess.conflictCurrent": "Current r{revision}",
    "workspaceAccess.conflictCandidate": "Candidate",
    "workspaceAccess.conflictSame": "The current version already matches this candidate.",
    "workspaceAccess.fieldName": "Name",
    "workspaceAccess.fieldEngine": "Engine",
    "workspaceAccess.fieldProvider": "Provider",
    "workspaceAccess.fieldDriver": "Driver",
    "workspaceAccess.fieldHost": "Host",
    "workspaceAccess.fieldPort": "Port",
    "workspaceAccess.fieldDatabase": "Database",
    "workspaceAccess.fieldSsl": "TLS mode",
    "workspaceAccess.fieldEnvironment": "Environment",
    "workspaceAccess.fieldSchemaGroup": "Schema group",
    "workspaceAccess.fieldWrites": "Writes",
    "workspaceAccess.fieldState": "State",
    "workspaceAccess.valueAllowed": "Allowed",
    "workspaceAccess.valueDeleted": "Delete requested",
    "workspaceAccess.valueActive": "Active",
    "workspaceAccess.keepCurrent": "Keep current",
    "workspaceAccess.applyCandidate": "Apply candidate",
    "workspaceAccess.applyDeletion": "Apply deletion",
    "workspaceAccess.applyDeletionTitle": "Remove team connection",
    "workspaceAccess.applyDeletionConfirm":
      "Remove {name} for the whole team by applying the preserved deletion? Active managed access is revoked first.",
    "workspaceAccess.resolving": "Applying…",
    "workspaceAccess.conflictFailed": "Couldn't record the decision for this change.",
    "workspaceAccess.applyFailed": "Couldn't apply the candidate version.",
    "workspaceAccess.keptCurrent": "Kept the current version of {name}.",
    "workspaceAccess.appliedCandidate": "Applied the candidate version to {name}.",
    "workspaceAccess.appliedDeletion": "Removed {name} from the workspace.",
    "workspaceAccess.errorOwnGrant": "You can't lower or remove your own access to this database.",
    "workspaceAccess.errorGrantChanged":
      "This member's access changed in the meantime. Check the current level and choose again.",
    "workspaceAccess.errorGrantConcurrent": "Access changed at the same time. Try again.",
    "workspaceAccess.errorMemberChangeInProgress":
      "Another access change for this member is in progress. Try again shortly.",
    "workspaceAccess.errorMemberLeaseRevoke":
      "This member's active database credentials couldn't be revoked yet. Try changing access again shortly.",
    "workspaceAccess.errorAccessChanged":
      "This database's access changed in the meantime. The latest state is shown; try again.",
    "workspaceAccess.errorConnectionChangeInProgress":
      "Another access change for this database is in progress. Try again shortly.",
    "workspaceAccess.errorForbidden": "You no longer manage access to this database.",
    "workspaceAccess.errorWorkspaceDenied": "You no longer have access to this workspace.",
    "workspaceAccess.errorRoleInsufficient":
      "Your workspace role no longer allows this. Ask an owner to check your role.",
    "workspaceAccess.errorWritePolicyAdmin":
      "Only a workspace admin can apply a version that changes write access.",
    "workspaceAccess.errorConflictChangedAgain":
      "The database changed again. Check the current version before deciding.",
    "workspaceAccess.errorConflictResolvedElsewhere":
      "Another manager already resolved this change differently.",
    "workspaceAccess.errorConflictGone": "This change no longer needs your review.",
    "workspaceAccess.errorApplyConflict":
      "The database changed before the candidate was applied. The new change is listed for review.",
    "workspaceAccess.errorConnectionGone": "This team connection no longer exists.",
    "workspaceAccess.errorConnectionConcurrent":
      "The database changed at the same time. Check it and try again.",
    "workspaceAccess.errorConnectionLeaseRevoke":
      "Active database credentials couldn't be revoked yet. Try again shortly.",
    "workspaceAccess.errorManagedEngine":
      "A managed database can't change its engine. Keep the current version instead.",
    "workspaceAccess.errorNoWriteCredential":
      "This provider connection has no write identity, so the candidate's write setting can't be applied.",
    "workspaceAccess.responseInvalid":
      "The workspace service returned an unexpected response. Update DopeDB or try again later.",
  },
  {
    "workspaceAccess.readOnly": "읽기 전용",
    "workspaceAccess.teamOrigin": "팀 공유",
    "workspaceAccess.ownAccessHint": "자신의 접근 권한은 변경할 수 없습니다.",
    "workspaceAccess.updatingAccess": "변경 중…",
    "workspaceAccess.capabilityNone": "접근 없음",
    "workspaceAccess.capabilityView": "보기 · 연결 정보만",
    "workspaceAccess.capabilityRead": "읽기 · DB 변경 불가",
    "workspaceAccess.capabilityUseManaged": "사용 · 역할 기반 자동 접근",
    "workspaceAccess.capabilityUseLocal": "사용 · 본인 자격 증명",
    "workspaceAccess.capabilityManage": "관리 · 권한과 설정 변경",
    "workspaceAccess.conflictsTitle": "검토할 연결 변경",
    "workspaceAccess.conflictsCount": "미결 {count}건",
    "workspaceAccess.conflictsDescription":
      "이전 버전을 기준으로 편집한 변경이 보존되어 있습니다. 각각 현재 버전과 비교한 뒤 팀이 유지할 버전을 선택하세요.",
    "workspaceAccess.conflictMeta": "편집 기준 r{expected} · 당시 서버 r{server}",
    "workspaceAccess.conflictChangedAgain": "다시 변경됨",
    "workspaceAccess.conflictChangedAgainHint":
      "충돌이 기록된 뒤 현재 버전이 다시 변경되었습니다.",
    "workspaceAccess.conflictField": "항목",
    "workspaceAccess.conflictCurrent": "현재 r{revision}",
    "workspaceAccess.conflictCandidate": "후보",
    "workspaceAccess.conflictSame": "현재 버전이 이미 이 후보와 같습니다.",
    "workspaceAccess.fieldName": "이름",
    "workspaceAccess.fieldEngine": "엔진",
    "workspaceAccess.fieldProvider": "공급자",
    "workspaceAccess.fieldDriver": "드라이버",
    "workspaceAccess.fieldHost": "호스트",
    "workspaceAccess.fieldPort": "포트",
    "workspaceAccess.fieldDatabase": "데이터베이스",
    "workspaceAccess.fieldSsl": "TLS 모드",
    "workspaceAccess.fieldEnvironment": "환경",
    "workspaceAccess.fieldSchemaGroup": "스키마 그룹",
    "workspaceAccess.fieldWrites": "쓰기",
    "workspaceAccess.fieldState": "상태",
    "workspaceAccess.valueAllowed": "허용",
    "workspaceAccess.valueDeleted": "삭제 요청",
    "workspaceAccess.valueActive": "활성",
    "workspaceAccess.keepCurrent": "현재 유지",
    "workspaceAccess.applyCandidate": "후보 적용",
    "workspaceAccess.applyDeletion": "삭제 적용",
    "workspaceAccess.applyDeletionTitle": "팀 연결 제거",
    "workspaceAccess.applyDeletionConfirm":
      "보존된 삭제 후보를 적용해 팀 전체에서 {name}을(를) 제거할까요? 활성 관리형 접근을 먼저 회수합니다.",
    "workspaceAccess.resolving": "적용 중…",
    "workspaceAccess.conflictFailed": "이 변경에 대한 결정을 기록하지 못했습니다.",
    "workspaceAccess.applyFailed": "후보 버전을 적용하지 못했습니다.",
    "workspaceAccess.keptCurrent": "{name}의 현재 버전을 유지했습니다.",
    "workspaceAccess.appliedCandidate": "{name}에 후보 버전을 적용했습니다.",
    "workspaceAccess.appliedDeletion": "워크스페이스에서 {name}을(를) 제거했습니다.",
    "workspaceAccess.errorOwnGrant": "자신의 이 데이터베이스 접근 권한은 낮추거나 제거할 수 없습니다.",
    "workspaceAccess.errorGrantChanged":
      "그사이 이 구성원의 접근 권한이 바뀌었습니다. 현재 수준을 확인하고 다시 선택하세요.",
    "workspaceAccess.errorGrantConcurrent": "접근 권한이 동시에 변경되었습니다. 다시 시도하세요.",
    "workspaceAccess.errorMemberChangeInProgress":
      "이 구성원의 다른 접근 권한 변경이 진행 중입니다. 잠시 뒤 다시 시도하세요.",
    "workspaceAccess.errorMemberLeaseRevoke":
      "이 구성원의 활성 데이터베이스 자격 증명을 아직 폐기하지 못했습니다. 잠시 뒤 다시 접근 변경을 시도하세요.",
    "workspaceAccess.errorAccessChanged":
      "그사이 이 데이터베이스의 접근 설정이 바뀌었습니다. 최신 상태를 표시했으니 다시 시도하세요.",
    "workspaceAccess.errorConnectionChangeInProgress":
      "이 데이터베이스의 다른 접근 변경이 진행 중입니다. 잠시 뒤 다시 시도하세요.",
    "workspaceAccess.errorForbidden": "더 이상 이 데이터베이스의 접근 권한을 관리할 수 없습니다.",
    "workspaceAccess.errorWorkspaceDenied": "이 워크스페이스에 더 이상 접근할 수 없습니다.",
    "workspaceAccess.errorRoleInsufficient":
      "현재 워크스페이스 역할로는 이 작업을 할 수 없습니다. 소유자에게 역할 확인을 요청하세요.",
    "workspaceAccess.errorWritePolicyAdmin":
      "쓰기 권한을 바꾸는 버전은 워크스페이스 관리자만 적용할 수 있습니다.",
    "workspaceAccess.errorConflictChangedAgain":
      "데이터베이스가 다시 변경되었습니다. 현재 버전을 확인한 뒤 결정하세요.",
    "workspaceAccess.errorConflictResolvedElsewhere":
      "다른 관리자가 이미 이 변경을 다르게 처리했습니다.",
    "workspaceAccess.errorConflictGone": "이 변경은 더 이상 검토할 필요가 없습니다.",
    "workspaceAccess.errorApplyConflict":
      "후보를 적용하기 전에 데이터베이스가 변경되었습니다. 새 변경을 검토 목록에 표시했습니다.",
    "workspaceAccess.errorConnectionGone": "이 팀 연결은 더 이상 존재하지 않습니다.",
    "workspaceAccess.errorConnectionConcurrent":
      "데이터베이스가 동시에 변경되었습니다. 확인한 뒤 다시 시도하세요.",
    "workspaceAccess.errorConnectionLeaseRevoke":
      "활성 데이터베이스 자격 증명을 아직 폐기하지 못했습니다. 잠시 뒤 다시 시도하세요.",
    "workspaceAccess.errorManagedEngine":
      "관리형 데이터베이스의 엔진은 바꿀 수 없습니다. 현재 버전을 유지하세요.",
    "workspaceAccess.errorNoWriteCredential":
      "이 공급자 연결에는 쓰기 계정이 없어 후보의 쓰기 설정을 적용할 수 없습니다.",
    "workspaceAccess.responseInvalid":
      "워크스페이스 서비스가 예상하지 못한 응답을 보냈습니다. DopeDB를 업데이트하거나 나중에 다시 시도하세요.",
  },
);
