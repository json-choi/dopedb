// Direct shared databases: the administrator's add flow (endpoint, credential check,
// scope and grant plan) and the member's own account status on a provisioned
// connection. Failure codes and provisioning states are closed families; each code or
// state has exactly one sentence, so no server or driver text is ever shown.
import { defineCatalog } from "../types";

export const directAccessCatalog = defineCatalog(
  {
    "directAccess.add.open": "Add direct connection",
    "directAccess.add.title": "Direct connection (PostgreSQL / MySQL)",
    "directAccess.add.description":
      "Share one server directly. Each permitted member gets their own account that DopeDB creates; nobody shares a password.",
    "directAccess.add.stepsLabel": "Direct connection steps",
    "directAccess.add.stepEndpoint": "Server",
    "directAccess.add.stepCredential": "Administrator",
    "directAccess.add.stepScope": "Access",
    "directAccess.add.endpointQuestion": "Where is the database?",
    "directAccess.add.endpointDescription":
      "Only the address is shared with the workspace. Verified TLS is on by default.",
    "directAccess.add.credentialQuestion": "Check an administrator account",
    "directAccess.add.credentialDescription":
      "DopeDB uses it to create and remove member accounts and to grant access. It stays in this device's keychain.",
    "directAccess.add.scopeQuestion": "What can members reach?",
    "directAccess.add.scopeDescription":
      "Choose the namespaces, then review exactly what DopeDB will run for each member.",
    "directAccess.add.prefillLabel": "Start from one of my connections",
    "directAccess.add.prefillHint": "Copies the address only. Passwords are never copied.",
    "directAccess.add.prefillPlaceholder": "Choose a connection…",
    "directAccess.add.engine": "Engine",
    "directAccess.add.enginePostgres": "PostgreSQL 14+",
    "directAccess.add.engineMysql": "MySQL 8.0.21+",
    "directAccess.add.host": "Host",
    "directAccess.add.hostInvalid": "Enter a host name or address without spaces.",
    "directAccess.add.port": "Port",
    "directAccess.add.portInvalid": "Use a port from 1 to 65535.",
    "directAccess.add.database": "Database",
    "directAccess.add.sslmode": "TLS verification",
    "directAccess.add.sslVerifiedSuffix": "verifies the server",
    "directAccess.add.sslUnverifiedSuffix": "does not verify the server",
    "directAccess.add.sslWarning":
      "This mode encrypts the connection but does not verify the server. Anyone who can intercept the network could read the administrator credential. Use it only on a network you trust.",
    "directAccess.add.sshAlias": "SSH host alias (optional)",
    "directAccess.add.sshAliasHint":
      "A Host from your ~/.ssh/config. It stays on this device and is never sent to the workspace.",
    "directAccess.add.sshAliasInvalid": "Use only letters, numbers, dots, dashes and underscores.",
    "directAccess.add.adminUser": "Administrator user",
    "directAccess.add.adminPassword": "Password",
    "directAccess.add.adminHint":
      "Used only to create and remove DopeDB-owned member accounts and their grants. Existing users, roles and passwords are never changed. The credential is kept in this device's keychain and never sent to the workspace.",
    "directAccess.add.check": "Check connection",
    "directAccess.add.checking": "Checking the database…",
    "directAccess.add.probeError": "The check could not run. Review the details and try again.",
    "directAccess.add.reportVersion": "Server version",
    "directAccess.add.reportSupported": "Supported",
    "directAccess.add.reportUnsupported": "Not supported",
    "directAccess.add.reportCreate": "Create member accounts",
    "directAccess.add.reportCanCreate": "Allowed",
    "directAccess.add.reportCannotCreate": "Not allowed",
    "directAccess.add.reportNamespaces": "Namespaces",
    "directAccess.add.reportGrantable": "{grantable} of {total} can be granted",
    "directAccess.add.warningGrantor":
      "This administrator cannot grant on every object, so some namespaces are unavailable.",
    "directAccess.add.warningPublicCreate":
      "Anyone can create objects in {names}. A member could then own objects there; consider restricting that first.",
    "directAccess.add.noGrantable":
      "This administrator cannot grant access on any namespace. Use an account with grant rights.",
    "directAccess.add.scopeNounPostgres": "Schemas",
    "directAccess.add.scopeNounMysql": "Databases",
    "directAccess.add.publicCreateSuffix": "anyone can create here",
    "directAccess.add.ungrantable": "Unavailable (this administrator cannot grant): {names}",
    "directAccess.add.scopeEmpty": "Choose at least one namespace.",
    "directAccess.add.writeCeiling": "Allow write access",
    "directAccess.add.writeCeilingHint":
      "Sets the most any member can be given. Members still get no write access until you grant it per member.",
    "directAccess.add.planTitle": "What DopeDB will run",
    "directAccess.add.planHint":
      "Run on this database for each member with the matching access. DopeDB never changes schema or default privileges.",
    "directAccess.add.planLoading": "Preparing the plan…",
    "directAccess.add.planRead": "Read access",
    "directAccess.add.planWrite": "Write access (adds to read)",
    "directAccess.add.name": "Name in the workspace",
    "directAccess.add.environment": "Environment",
    "directAccess.add.environmentNone": "Not set",
    "directAccess.add.registering": "Adding the shared database…",
    "directAccess.add.registerError":
      "The shared database could not be added. Nothing was changed; review the details and try again.",

    "directAccess.failure.markerMismatch":
      "The account on the server is not the one DopeDB created, so DopeDB left it untouched.",
    "directAccess.failure.oidMismatch":
      "This is a different server than the one that was registered, so DopeDB stopped.",
    "directAccess.failure.ownsObjects":
      "The account owns database objects, so DopeDB will not remove or change it.",
    "directAccess.failure.unexpectedMembership":
      "The account belongs to roles DopeDB did not grant, so DopeDB stopped.",
    "directAccess.failure.grantorInsufficient":
      "The administrator account lacks the rights to grant this access.",
    "directAccess.failure.versionUnsupported":
      "This server version is not supported. Use PostgreSQL 14 or later, or MySQL 8.0.21 or later.",
    "directAccess.failure.endpointChanged":
      "The server address no longer matches the registered database.",
    "directAccess.failure.permissionDenied":
      "The administrator account was refused. Check its user and password.",
    "directAccess.failure.network":
      "The database could not be reached. Check the address, network and TLS settings.",
    "directAccess.failure.nameConflict":
      "An account with the generated name already exists and is not DopeDB's, so DopeDB left it untouched.",
    "directAccess.failure.credentialMissing":
      "No administrator device holds the credential for this database yet.",

    "directAccess.connect": "Connect",
    "directAccess.requestAgain": "Request again",
    "directAccess.confirm.title": "Create your account on this database",
    "directAccess.confirm.body":
      "This creates your personal DopeDB account on that database. Your password stays on this device.",
    "directAccess.state.loading": "Checking your account…",
    "directAccess.state.loadError": "Could not read the status of your account.",
    "directAccess.state.notRequested": "Your account is not created yet",
    "directAccess.state.notRequestedBody":
      "Connect to create your own account on this database.",
    "directAccess.state.requested": "Account requested",
    "directAccess.state.requestedBody":
      "Waiting for an administrator device to create it. This can take a minute.",
    "directAccess.state.applying": "Waiting for an administrator device",
    "directAccess.state.applyingBody": "An administrator device is creating your account.",
    "directAccess.state.ready": "Account ready",
    "directAccess.state.readyBody": "Opening the database…",
    "directAccess.state.failed": "Account could not be created",
    "directAccess.state.revoked": "Access revoked",
    "directAccess.state.revokedBody": "Your account was removed from this database.",
    "directAccess.credentialNotice":
      "Your account on this database is not ready. Check its status in the Explorer.",
    "directAccess.analysisBlocked":
      "Your account on this shared database is not ready. Check its status in the Explorer, then run again.",
    "directAccess.testFailure.title": "Your account could not connect",
    "directAccess.testFailure.recovery":
      "Your account on this database is created and managed by DopeDB. Check its status in the Explorer, or ask an administrator.",
    "directAccess.safetySchemaUnavailable":
      "Schema changes are never available on a direct connection. Members get data access only.",
    "directAccess.editor.accountLabel": "Member accounts",
    "directAccess.editor.accountBadge": "Created per member by DopeDB",
    "directAccess.badge": "Direct connection",
    "directAccess.lowering.blocked":
      "This device does not have the admin credential for {database}, so DB access cannot be revoked now.",
    "directAccess.lowering.pendingNote":
      "Nothing has changed yet. A device that has the admin credential applies it, or you can apply it from the pending list in Members.",
    "directAccess.lowering.enterCredential": "Enter the admin credential",
    "directAccess.lowering.leavePending": "Leave it pending",
    "directAccess.lowering.leftPending":
      "Left pending. Members lists it until a device with the credential applies it.",
    "directAccess.lowering.credentialTitle": "Admin credential for {database}",
    "directAccess.lowering.saveToKeychain": "Save to this device's keychain",
    "directAccess.lowering.revokeNow": "Revoke now",
    "directAccess.lowering.revoking": "Revoking access…",
    "directAccess.lowering.retryFailed":
      "Could not revoke access with this credential. Check it and try again.",
    "directAccess.lowering.aMember": "A member",
    "directAccess.lowering.failed": "{member} on {database}: {reason}",
    "directAccess.lowering.deferred":
      "Another administrator device is applying this change. It stays pending until that finishes.",
    "directAccess.lowering.revocationRequired":
      "The workspace still sees database access that has to be revoked first. Reload and try again, or apply the pending item.",
    "directAccess.lowering.rejected":
      "The database access was revoked, but the workspace refused the change. Check the refreshed list and try again.",
  },
  {
    "directAccess.add.open": "직접 연결 추가",
    "directAccess.add.title": "직접 연결 (PostgreSQL / MySQL)",
    "directAccess.add.description":
      "서버 하나를 그대로 공유합니다. 허용된 구성원마다 DopeDB가 개인 계정을 만들어 주므로 비밀번호를 함께 쓰지 않습니다.",
    "directAccess.add.stepsLabel": "직접 연결 단계",
    "directAccess.add.stepEndpoint": "서버",
    "directAccess.add.stepCredential": "관리자",
    "directAccess.add.stepScope": "접근",
    "directAccess.add.endpointQuestion": "데이터베이스는 어디에 있나요?",
    "directAccess.add.endpointDescription":
      "주소만 워크스페이스와 공유합니다. 인증서 검증 TLS가 기본으로 켜져 있습니다.",
    "directAccess.add.credentialQuestion": "관리자 계정을 확인하세요",
    "directAccess.add.credentialDescription":
      "구성원 계정을 만들고 지우며 권한을 부여하는 데 사용합니다. 이 기기의 키체인에만 보관됩니다.",
    "directAccess.add.scopeQuestion": "구성원은 무엇에 접근할 수 있나요?",
    "directAccess.add.scopeDescription":
      "네임스페이스를 고른 뒤, 구성원마다 DopeDB가 실행할 내용을 정확히 확인하세요.",
    "directAccess.add.prefillLabel": "내 연결에서 시작",
    "directAccess.add.prefillHint": "주소만 복사합니다. 비밀번호는 복사하지 않습니다.",
    "directAccess.add.prefillPlaceholder": "연결 선택…",
    "directAccess.add.engine": "엔진",
    "directAccess.add.enginePostgres": "PostgreSQL 14+",
    "directAccess.add.engineMysql": "MySQL 8.0.21+",
    "directAccess.add.host": "호스트",
    "directAccess.add.hostInvalid": "공백 없는 호스트 이름이나 주소를 입력하세요.",
    "directAccess.add.port": "포트",
    "directAccess.add.portInvalid": "1부터 65535 사이의 포트를 입력하세요.",
    "directAccess.add.database": "데이터베이스",
    "directAccess.add.sslmode": "TLS 검증",
    "directAccess.add.sslVerifiedSuffix": "서버를 검증함",
    "directAccess.add.sslUnverifiedSuffix": "서버를 검증하지 않음",
    "directAccess.add.sslWarning":
      "이 모드는 연결을 암호화하지만 서버를 검증하지 않습니다. 네트워크를 가로챌 수 있는 사람이 관리자 자격 증명을 읽을 수 있습니다. 신뢰하는 네트워크에서만 사용하세요.",
    "directAccess.add.sshAlias": "SSH 호스트 별칭 (선택)",
    "directAccess.add.sshAliasHint":
      "~/.ssh/config의 Host 이름입니다. 이 기기에만 남고 워크스페이스로 전송되지 않습니다.",
    "directAccess.add.sshAliasInvalid": "영문, 숫자, 점, 대시, 밑줄만 사용할 수 있습니다.",
    "directAccess.add.adminUser": "관리자 사용자",
    "directAccess.add.adminPassword": "비밀번호",
    "directAccess.add.adminHint":
      "DopeDB가 만든 구성원 계정과 그 권한을 만들고 지우는 데만 사용합니다. 기존 사용자, 역할, 비밀번호는 바꾸지 않습니다. 자격 증명은 이 기기의 키체인에만 보관되며 워크스페이스로 전송되지 않습니다.",
    "directAccess.add.check": "연결 확인",
    "directAccess.add.checking": "데이터베이스를 확인하는 중…",
    "directAccess.add.probeError": "확인을 실행하지 못했습니다. 입력을 검토하고 다시 시도하세요.",
    "directAccess.add.reportVersion": "서버 버전",
    "directAccess.add.reportSupported": "지원됨",
    "directAccess.add.reportUnsupported": "지원되지 않음",
    "directAccess.add.reportCreate": "구성원 계정 생성",
    "directAccess.add.reportCanCreate": "가능",
    "directAccess.add.reportCannotCreate": "불가능",
    "directAccess.add.reportNamespaces": "네임스페이스",
    "directAccess.add.reportGrantable": "{total}개 중 {grantable}개에 권한 부여 가능",
    "directAccess.add.warningGrantor":
      "이 관리자는 모든 객체에 권한을 부여할 수 없어 일부 네임스페이스를 쓸 수 없습니다.",
    "directAccess.add.warningPublicCreate":
      "{names}에서는 누구나 객체를 만들 수 있습니다. 구성원이 그곳의 객체를 소유할 수 있으니 먼저 제한하는 것을 권장합니다.",
    "directAccess.add.noGrantable":
      "이 관리자는 어떤 네임스페이스에도 접근 권한을 부여할 수 없습니다. 권한 부여 권한이 있는 계정을 사용하세요.",
    "directAccess.add.scopeNounPostgres": "스키마",
    "directAccess.add.scopeNounMysql": "데이터베이스",
    "directAccess.add.publicCreateSuffix": "누구나 생성 가능",
    "directAccess.add.ungrantable": "사용할 수 없음 (이 관리자가 권한을 부여할 수 없음): {names}",
    "directAccess.add.scopeEmpty": "네임스페이스를 하나 이상 선택하세요.",
    "directAccess.add.writeCeiling": "쓰기 접근 허용",
    "directAccess.add.writeCeilingHint":
      "구성원에게 줄 수 있는 최대 권한을 정합니다. 구성원별로 따로 부여하기 전에는 쓰기 권한이 없습니다.",
    "directAccess.add.planTitle": "DopeDB가 실행할 내용",
    "directAccess.add.planHint":
      "해당 접근 권한을 가진 구성원마다 이 데이터베이스에서 실행됩니다. 스키마나 기본 권한은 절대 바꾸지 않습니다.",
    "directAccess.add.planLoading": "계획을 준비하는 중…",
    "directAccess.add.planRead": "읽기 접근",
    "directAccess.add.planWrite": "쓰기 접근 (읽기에 추가)",
    "directAccess.add.name": "워크스페이스 표시 이름",
    "directAccess.add.environment": "환경",
    "directAccess.add.environmentNone": "지정 안 함",
    "directAccess.add.registering": "공유 데이터베이스를 추가하는 중…",
    "directAccess.add.registerError":
      "공유 데이터베이스를 추가하지 못했습니다. 아무것도 바뀌지 않았으니 입력을 검토하고 다시 시도하세요.",

    "directAccess.failure.markerMismatch":
      "서버의 계정이 DopeDB가 만든 계정이 아니어서 그대로 두었습니다.",
    "directAccess.failure.oidMismatch":
      "등록된 서버와 다른 서버여서 DopeDB가 중단했습니다.",
    "directAccess.failure.ownsObjects":
      "계정이 데이터베이스 객체를 소유하고 있어 DopeDB가 삭제하거나 변경하지 않습니다.",
    "directAccess.failure.unexpectedMembership":
      "DopeDB가 부여하지 않은 역할에 계정이 속해 있어 중단했습니다.",
    "directAccess.failure.grantorInsufficient":
      "관리자 계정에 이 접근 권한을 부여할 권한이 없습니다.",
    "directAccess.failure.versionUnsupported":
      "지원되지 않는 서버 버전입니다. PostgreSQL 14 이상 또는 MySQL 8.0.21 이상을 사용하세요.",
    "directAccess.failure.endpointChanged":
      "서버 주소가 등록된 데이터베이스와 더 이상 일치하지 않습니다.",
    "directAccess.failure.permissionDenied":
      "관리자 계정이 거부되었습니다. 사용자와 비밀번호를 확인하세요.",
    "directAccess.failure.network":
      "데이터베이스에 연결할 수 없습니다. 주소, 네트워크, TLS 설정을 확인하세요.",
    "directAccess.failure.nameConflict":
      "생성하려는 이름의 계정이 이미 있고 DopeDB의 계정이 아니어서 그대로 두었습니다.",
    "directAccess.failure.credentialMissing":
      "아직 이 데이터베이스의 관리자 자격 증명을 가진 기기가 없습니다.",

    "directAccess.connect": "연결",
    "directAccess.requestAgain": "다시 요청",
    "directAccess.confirm.title": "이 데이터베이스에 내 계정 만들기",
    "directAccess.confirm.body":
      "해당 데이터베이스에 개인 DopeDB 계정을 만듭니다. 비밀번호는 이 기기에만 남습니다.",
    "directAccess.state.loading": "내 계정을 확인하는 중…",
    "directAccess.state.loadError": "내 계정 상태를 읽지 못했습니다.",
    "directAccess.state.notRequested": "아직 계정이 만들어지지 않았습니다",
    "directAccess.state.notRequestedBody":
      "연결하면 이 데이터베이스에 나만의 계정이 만들어집니다.",
    "directAccess.state.requested": "계정을 요청했습니다",
    "directAccess.state.requestedBody":
      "관리자 기기가 계정을 만들기를 기다리는 중입니다. 1분 정도 걸릴 수 있습니다.",
    "directAccess.state.applying": "관리자 기기를 기다리는 중",
    "directAccess.state.applyingBody": "관리자 기기가 내 계정을 만드는 중입니다.",
    "directAccess.state.ready": "계정 준비됨",
    "directAccess.state.readyBody": "데이터베이스를 여는 중…",
    "directAccess.state.failed": "계정을 만들지 못했습니다",
    "directAccess.state.revoked": "접근이 회수되었습니다",
    "directAccess.state.revokedBody": "이 데이터베이스에서 내 계정이 제거되었습니다.",
    "directAccess.credentialNotice":
      "이 데이터베이스의 내 계정이 아직 준비되지 않았습니다. Explorer에서 상태를 확인하세요.",
    "directAccess.analysisBlocked":
      "이 공유 데이터베이스의 내 계정이 아직 준비되지 않았습니다. Explorer에서 상태를 확인한 뒤 다시 실행하세요.",
    "directAccess.testFailure.title": "내 계정으로 연결하지 못했습니다",
    "directAccess.testFailure.recovery":
      "이 데이터베이스의 내 계정은 DopeDB가 만들고 관리합니다. Explorer에서 상태를 확인하거나 관리자에게 문의하세요.",
    "directAccess.safetySchemaUnavailable":
      "직접 연결에서는 스키마 변경을 사용할 수 없습니다. 구성원은 데이터 접근만 받습니다.",
    "directAccess.editor.accountLabel": "구성원 계정",
    "directAccess.editor.accountBadge": "DopeDB가 구성원별로 생성",
    "directAccess.badge": "직접 연결",
    "directAccess.lowering.blocked": "이 기기에는 {database}의 관리자 자격 증명이 없어 지금은 DB 접근을 회수할 수 없습니다.",
    "directAccess.lowering.pendingNote":
      "아직 아무것도 바뀌지 않았습니다. 관리자 자격 증명이 있는 기기가 적용하거나, 구성원 화면의 대기 목록에서 직접 적용할 수 있습니다.",
    "directAccess.lowering.enterCredential": "관리자 자격 증명 입력",
    "directAccess.lowering.leavePending": "대기 상태로 두기",
    "directAccess.lowering.leftPending": "대기 상태로 두었습니다. 자격 증명이 있는 기기가 적용할 때까지 구성원 화면에 표시됩니다.",
    "directAccess.lowering.credentialTitle": "{database} 관리자 자격 증명",
    "directAccess.lowering.saveToKeychain": "이 기기의 키체인에 저장",
    "directAccess.lowering.revokeNow": "지금 회수",
    "directAccess.lowering.revoking": "접근을 회수하는 중…",
    "directAccess.lowering.retryFailed": "이 자격 증명으로 접근을 회수하지 못했습니다. 확인한 뒤 다시 시도하세요.",
    "directAccess.lowering.aMember": "구성원",
    "directAccess.lowering.failed": "{database}의 {member}: {reason}",
    "directAccess.lowering.deferred": "다른 관리자 기기가 이 변경을 적용하는 중입니다. 끝날 때까지 대기 상태로 남습니다.",
    "directAccess.lowering.revocationRequired":
      "먼저 회수해야 하는 DB 접근이 워크스페이스에 남아 있습니다. 새로 고친 뒤 다시 시도하거나 대기 항목을 적용하세요.",
    "directAccess.lowering.rejected": "DB 접근은 회수했지만 워크스페이스가 변경을 거부했습니다. 새로 고친 목록을 확인하고 다시 시도하세요.",
  },
);
