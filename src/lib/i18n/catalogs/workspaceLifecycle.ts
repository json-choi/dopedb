// workspaceLifecycle (owner-only backups, key rotation, retention and workspace deletion)
// messages are owned by this bounded feature catalogue.
import { defineCatalog } from "../types";

export const workspaceLifecycleCatalog = defineCatalog(
  {
    "workspaceLifecycle.loading": "Loading backups and deletion status…",
    "workspaceLifecycle.loadFailed": "Could not load this workspace's backups and deletion status.",
    "workspaceLifecycle.refreshFailed":
      "Could not refresh the backups and deletion status. What you see may be out of date.",
    "workspaceLifecycle.backupsTitle": "Backups",
    "workspaceLifecycle.backupsDescription":
      "Encrypted snapshots of the workspace's shared connection definitions. They never contain database credentials or query results.",
    "workspaceLifecycle.createBackup": "Create backup",
    "workspaceLifecycle.creatingBackup": "Creating backup…",
    "workspaceLifecycle.backupCreated": "Backup created.",
    "workspaceLifecycle.backupDeleted": "Backup deleted. It is permanently purged after {days} days.",
    "workspaceLifecycle.backupsLoadFailed": "Could not load the backup list.",
    "workspaceLifecycle.noBackups":
      "No backups yet. Create one to keep a restorable copy of the shared connection definitions.",
    "workspaceLifecycle.backupDetails": "Workspace revision {revision} · key {keyVersion}",
    "workspaceLifecycle.restoreBackup": "Restore the backup from {date}",
    "workspaceLifecycle.restoreConfirm":
      "Connections in this backup that no longer exist are re-created as read-only, with access granted only to you. Connections that still exist are not overwritten: each one gets the backed-up version as a conflict to review in Database access.",
    "workspaceLifecycle.restoring": "Restoring backup…",
    "workspaceLifecycle.restoreDone": "Backup restored. Connections re-created: {count}.",
    "workspaceLifecycle.restoreConflicts":
      "Connections that already existed: {count}. Their backed-up versions are waiting as conflicts in Database access.",
    "workspaceLifecycle.reviewConflicts": "Review conflicts",
    "workspaceLifecycle.deleteBackup": "Delete the backup from {date}",
    "workspaceLifecycle.deleteBackupConfirm":
      "The backup is hidden now and permanently purged after {days} days. A deleted backup can no longer be restored.",
    "workspaceLifecycle.deletingBackup": "Deleting backup…",
    "workspaceLifecycle.createFailed": "Could not create the backup.",
    "workspaceLifecycle.restoreFailed": "Could not restore the backup.",
    "workspaceLifecycle.deleteFailed": "Could not delete the backup.",
    "workspaceLifecycle.keyTitle": "Encryption key",
    "workspaceLifecycle.keyDescription":
      "Backups are encrypted with a workspace data key that the server's key service protects. Rotating creates a new key, re-encrypts every backup, including those waiting for purge, and then destroys the previous key.",
    "workspaceLifecycle.keyLoadFailed": "Could not load the encryption key status.",
    "workspaceLifecycle.keyNotInitialized": "The workspace key is created with the first backup.",
    "workspaceLifecycle.activeKey": "Active key",
    "workspaceLifecycle.rotateKey": "Rotate key",
    "workspaceLifecycle.continueRotation": "Continue rotation",
    "workspaceLifecycle.rotating": "Rotating key…",
    "workspaceLifecycle.rotationProgressLabel": "Key rotation progress",
    "workspaceLifecycle.rotationStarting": "Starting the key rotation…",
    "workspaceLifecycle.rotationProgress": "Re-encrypting backups: {processed} done, {remaining} left.",
    "workspaceLifecycle.rotationRunning":
      "A key rotation is unfinished. Backups still on the previous key: {remaining}. Continue the rotation to finish; it resumes where it stopped.",
    "workspaceLifecycle.rotationCompletedAt": "Last rotation finished {date}. Backups re-encrypted: {count}.",
    "workspaceLifecycle.rotationCompleted": "Last rotation finished. Backups re-encrypted: {count}.",
    "workspaceLifecycle.rotationBusy":
      "Another request is already rotating this workspace's key. Refresh in about a minute to see its progress.",
    "workspaceLifecycle.rotateFailed": "Could not rotate the encryption key.",
    "workspaceLifecycle.retentionTitle": "Retention",
    "workspaceLifecycle.retentionDescription":
      "A deleted backup is hidden at once and permanently purged by the server when its retention window ends.",
    "workspaceLifecycle.activeBackups": "Active backups",
    "workspaceLifecycle.pendingPurge": "Waiting for purge",
    "workspaceLifecycle.retentionWindow": "Retention window",
    "workspaceLifecycle.days": "{count} days",
    "workspaceLifecycle.deleteTitle": "Delete workspace",
    "workspaceLifecycle.deleteSummary": "Schedule this workspace for permanent deletion.",
    "workspaceLifecycle.deleteExplain":
      "Scheduling removes access for every member and device at once, including yours. For {days} days you can cancel from Settings → Account; after that, the workspace's shared metadata and encryption keys are permanently removed.",
    "workspaceLifecycle.confirmNameLabel": "To confirm, type the workspace name exactly:",
    "workspaceLifecycle.scheduleDeletion": "Schedule deletion",
    "workspaceLifecycle.schedulingDeletion": "Scheduling deletion…",
    "workspaceLifecycle.scheduleFailed": "Could not schedule the workspace deletion.",
    "workspaceLifecycle.blockersIntro": "Resolve these before the workspace can be deleted.",
    "workspaceLifecycle.blockerProviderIntegrations": "connected provider accounts",
    "workspaceLifecycle.blockerCredentialLeases": "database credentials not yet revoked",
    "workspaceLifecycle.blockerProviderOperations": "provider operations unfinished or needing repair",
    "workspaceLifecycle.blockerKeyRotations": "key rotations still running",
    "workspaceLifecycle.blockerMemberRevocations": "member access changes in progress",
    "workspaceLifecycle.blockerKeyRotationHint": "Finish it under Encryption key above.",
    "workspaceLifecycle.openSection": "Open {section}",
    "workspaceLifecycle.deletionUnavailable":
      "Deletion is not available right now. Refresh to check the current status.",
    "workspaceLifecycle.scheduledTitle": "Workspace deletion is scheduled.",
    "workspaceLifecycle.scheduledBody":
      "Every member, including you, has lost access to this workspace. It disappears from this app the next time your workspace memberships refresh.",
    "workspaceLifecycle.requestedAt": "Scheduled",
    "workspaceLifecycle.purgeAt": "Permanent purge",
    "workspaceLifecycle.cancelLocation":
      "Until the purge time, you can cancel the deletion in Settings → Account, which lists workspaces scheduled for deletion.",
    "workspaceLifecycle.openAccountToCancel": "Open Account to cancel",
    "workspaceLifecycle.scheduledToast":
      "Deletion of {name} is scheduled. You can cancel it in Account until the permanent purge.",
    "workspaceLifecycle.errorUnexpectedResponse":
      "The workspace service returned a response this app could not read. Refresh and try again.",
    "workspaceLifecycle.errorOwnerRequired": "Only the workspace owner can manage backups and deletion.",
    "workspaceLifecycle.errorWorkspaceNotFound": "This workspace no longer exists.",
    "workspaceLifecycle.errorMetadataUnavailable":
      "The workspace's metadata is unavailable, so no backup was created.",
    "workspaceLifecycle.errorConnectionLimit":
      "A backup can hold up to 1,000 shared connections. Remove connections you no longer need, then try again.",
    "workspaceLifecycle.errorBackupChanged":
      "The workspace changed while the backup was being created. Try again.",
    "workspaceLifecycle.errorKeyIntegrity":
      "The workspace key or a backup failed its integrity check, so the operation stopped.",
    "workspaceLifecycle.errorEncryptionUnavailable":
      "The key service is unavailable, so the backup could not be encrypted. Try again later.",
    "workspaceLifecycle.errorBackupNotFound": "This backup no longer exists. The list has been refreshed.",
    "workspaceLifecycle.errorBackupCleanupPending":
      "The backup was deleted, but its permanent purge could not be scheduled. Retry to finish.",
    "workspaceLifecycle.errorRestoreIntegrity": "This backup failed its integrity check and cannot be restored.",
    "workspaceLifecycle.errorRestoreChanged":
      "The workspace changed during the restore, so nothing was restored. The current state has been reloaded; try again.",
    "workspaceLifecycle.errorDecryptionUnavailable":
      "The key service could not decrypt this backup right now. Try again later.",
    "workspaceLifecycle.errorKeyServiceUnavailable":
      "The key service is unavailable. A started rotation can be continued later.",
    "workspaceLifecycle.errorKeyServiceNotConfigured": "The workspace service has no key service configured.",
    "workspaceLifecycle.errorRotationUnavailable": "Key rotation is unavailable right now. Try again later.",
    "workspaceLifecycle.errorDeletionRefused":
      "Deletion was not scheduled because the workspace changed or the name did not match. The current status is shown here.",
    "workspaceLifecycle.errorDeletionCleanupPending":
      "The deletion was recorded, but the final purge could not be scheduled. Retry to finish.",
    "workspaceLifecycle.errorConfirmationRequired": "Type the exact workspace name to confirm.",
  },
  {
    "workspaceLifecycle.loading": "백업과 삭제 상태를 불러오는 중…",
    "workspaceLifecycle.loadFailed": "이 워크스페이스의 백업과 삭제 상태를 불러오지 못했습니다.",
    "workspaceLifecycle.refreshFailed":
      "백업과 삭제 상태를 새로 고치지 못했습니다. 표시된 내용이 최신이 아닐 수 있습니다.",
    "workspaceLifecycle.backupsTitle": "백업",
    "workspaceLifecycle.backupsDescription":
      "워크스페이스 공유 연결 정의의 암호화된 스냅샷입니다. DB 자격 증명이나 쿼리 결과는 포함하지 않습니다.",
    "workspaceLifecycle.createBackup": "백업 만들기",
    "workspaceLifecycle.creatingBackup": "백업 만드는 중…",
    "workspaceLifecycle.backupCreated": "백업을 만들었습니다.",
    "workspaceLifecycle.backupDeleted": "백업을 삭제했습니다. {days}일 뒤 영구 제거됩니다.",
    "workspaceLifecycle.backupsLoadFailed": "백업 목록을 불러오지 못했습니다.",
    "workspaceLifecycle.noBackups":
      "아직 백업이 없습니다. 백업을 만들면 공유 연결 정의를 복원할 수 있는 사본이 남습니다.",
    "workspaceLifecycle.backupDetails": "워크스페이스 리비전 {revision} · 키 {keyVersion}",
    "workspaceLifecycle.restoreBackup": "{date} 백업 복원",
    "workspaceLifecycle.restoreConfirm":
      "이 백업에 있지만 지금은 없는 연결을 읽기 전용으로 다시 만들고 접근 권한은 나에게만 부여합니다. 아직 있는 연결은 덮어쓰지 않으며, 연결마다 백업 버전을 DB 접근 권한에서 검토할 충돌로 남깁니다.",
    "workspaceLifecycle.restoring": "백업 복원 중…",
    "workspaceLifecycle.restoreDone": "백업을 복원했습니다. 다시 만든 연결은 {count}개입니다.",
    "workspaceLifecycle.restoreConflicts":
      "이미 있던 연결 {count}개는 백업 버전이 DB 접근 권한에서 검토할 충돌로 남았습니다.",
    "workspaceLifecycle.reviewConflicts": "충돌 검토",
    "workspaceLifecycle.deleteBackup": "{date} 백업 삭제",
    "workspaceLifecycle.deleteBackupConfirm":
      "백업을 지금 숨기고 {days}일 뒤 영구 제거합니다. 삭제한 백업은 복원할 수 없습니다.",
    "workspaceLifecycle.deletingBackup": "백업 삭제 중…",
    "workspaceLifecycle.createFailed": "백업을 만들지 못했습니다.",
    "workspaceLifecycle.restoreFailed": "백업을 복원하지 못했습니다.",
    "workspaceLifecycle.deleteFailed": "백업을 삭제하지 못했습니다.",
    "workspaceLifecycle.keyTitle": "암호화 키",
    "workspaceLifecycle.keyDescription":
      "백업은 서버 키 서비스가 보호하는 워크스페이스 데이터 키로 암호화됩니다. 키를 회전하면 새 키를 만들고 제거 대기 중인 백업까지 모두 다시 암호화한 뒤 이전 키를 폐기합니다.",
    "workspaceLifecycle.keyLoadFailed": "암호화 키 상태를 불러오지 못했습니다.",
    "workspaceLifecycle.keyNotInitialized": "워크스페이스 키는 첫 백업을 만들 때 생성됩니다.",
    "workspaceLifecycle.activeKey": "활성 키",
    "workspaceLifecycle.rotateKey": "키 회전",
    "workspaceLifecycle.continueRotation": "회전 계속",
    "workspaceLifecycle.rotating": "키 회전 중…",
    "workspaceLifecycle.rotationProgressLabel": "키 회전 진행률",
    "workspaceLifecycle.rotationStarting": "키 회전을 시작하는 중…",
    "workspaceLifecycle.rotationProgress": "백업 다시 암호화 중: {processed}개 완료, {remaining}개 남음",
    "workspaceLifecycle.rotationRunning":
      "키 회전이 끝나지 않았습니다. 아직 백업 {remaining}개가 이전 키를 사용합니다. 계속하면 멈춘 지점부터 안전하게 이어서 진행합니다.",
    "workspaceLifecycle.rotationCompletedAt": "마지막 회전 완료: {date}, 다시 암호화한 백업 {count}개",
    "workspaceLifecycle.rotationCompleted": "마지막 회전 완료: 다시 암호화한 백업 {count}개",
    "workspaceLifecycle.rotationBusy":
      "다른 요청이 이미 이 워크스페이스의 키를 회전하고 있습니다. 1분쯤 뒤 새로 고쳐 진행 상황을 확인하세요.",
    "workspaceLifecycle.rotateFailed": "암호화 키를 회전하지 못했습니다.",
    "workspaceLifecycle.retentionTitle": "보존",
    "workspaceLifecycle.retentionDescription":
      "삭제한 백업은 바로 숨겨지고, 보존 기간이 끝나면 서버가 영구 제거합니다.",
    "workspaceLifecycle.activeBackups": "활성 백업",
    "workspaceLifecycle.pendingPurge": "제거 대기",
    "workspaceLifecycle.retentionWindow": "보존 기간",
    "workspaceLifecycle.days": "{count}일",
    "workspaceLifecycle.deleteTitle": "워크스페이스 삭제",
    "workspaceLifecycle.deleteSummary": "이 워크스페이스의 영구 삭제를 예약합니다.",
    "workspaceLifecycle.deleteExplain":
      "예약하는 즉시 나를 포함한 모든 구성원과 기기의 접근이 중단됩니다. {days}일 동안은 설정 → 계정에서 취소할 수 있고, 그 뒤에는 워크스페이스의 공유 메타데이터와 암호화 키가 영구 제거됩니다.",
    "workspaceLifecycle.confirmNameLabel": "확인을 위해 워크스페이스 이름을 그대로 입력하세요:",
    "workspaceLifecycle.scheduleDeletion": "삭제 예약",
    "workspaceLifecycle.schedulingDeletion": "삭제 예약 중…",
    "workspaceLifecycle.scheduleFailed": "워크스페이스 삭제를 예약하지 못했습니다.",
    "workspaceLifecycle.blockersIntro": "워크스페이스를 삭제하려면 먼저 다음 항목을 정리하세요.",
    "workspaceLifecycle.blockerProviderIntegrations": "연결된 공급자 계정",
    "workspaceLifecycle.blockerCredentialLeases": "아직 회수되지 않은 DB 자격 증명",
    "workspaceLifecycle.blockerProviderOperations": "끝나지 않았거나 복구가 필요한 공급자 작업",
    "workspaceLifecycle.blockerKeyRotations": "진행 중인 키 회전",
    "workspaceLifecycle.blockerMemberRevocations": "처리 중인 구성원 접근 변경",
    "workspaceLifecycle.blockerKeyRotationHint": "위의 암호화 키에서 회전을 마치세요.",
    "workspaceLifecycle.openSection": "{section} 열기",
    "workspaceLifecycle.deletionUnavailable":
      "지금은 삭제를 예약할 수 없습니다. 새로 고쳐 현재 상태를 확인하세요.",
    "workspaceLifecycle.scheduledTitle": "워크스페이스 삭제가 예약되었습니다.",
    "workspaceLifecycle.scheduledBody":
      "나를 포함한 모든 구성원이 이 워크스페이스에 접근할 수 없습니다. 다음에 워크스페이스 멤버십을 새로 고치면 이 앱에서도 사라집니다.",
    "workspaceLifecycle.requestedAt": "예약 시각",
    "workspaceLifecycle.purgeAt": "영구 제거",
    "workspaceLifecycle.cancelLocation":
      "영구 제거 전까지는 삭제 예약된 워크스페이스를 보여 주는 설정 → 계정에서 삭제를 취소할 수 있습니다.",
    "workspaceLifecycle.openAccountToCancel": "계정에서 삭제 취소",
    "workspaceLifecycle.scheduledToast":
      "{name} 워크스페이스의 삭제를 예약했습니다. 영구 제거 전까지 계정에서 취소할 수 있습니다.",
    "workspaceLifecycle.errorUnexpectedResponse":
      "워크스페이스 서비스의 응답을 읽지 못했습니다. 새로 고친 뒤 다시 시도하세요.",
    "workspaceLifecycle.errorOwnerRequired": "백업과 삭제는 워크스페이스 소유자만 관리할 수 있습니다.",
    "workspaceLifecycle.errorWorkspaceNotFound": "이 워크스페이스가 더 이상 존재하지 않습니다.",
    "workspaceLifecycle.errorMetadataUnavailable":
      "워크스페이스 메타데이터를 읽을 수 없어 백업을 만들지 못했습니다.",
    "workspaceLifecycle.errorConnectionLimit":
      "백업에는 공유 연결을 1,000개까지만 담을 수 있습니다. 필요 없는 연결을 정리한 뒤 다시 시도하세요.",
    "workspaceLifecycle.errorBackupChanged": "백업을 만드는 동안 워크스페이스가 바뀌었습니다. 다시 시도하세요.",
    "workspaceLifecycle.errorKeyIntegrity":
      "워크스페이스 키나 백업의 무결성 검증에 실패해 작업을 멈췄습니다.",
    "workspaceLifecycle.errorEncryptionUnavailable":
      "키 서비스를 사용할 수 없어 백업을 암호화하지 못했습니다. 잠시 뒤 다시 시도하세요.",
    "workspaceLifecycle.errorBackupNotFound": "이 백업이 더 이상 없습니다. 목록을 새로 고쳤습니다.",
    "workspaceLifecycle.errorBackupCleanupPending":
      "백업은 삭제되었지만 영구 제거를 예약하지 못했습니다. 다시 시도해 마무리하세요.",
    "workspaceLifecycle.errorRestoreIntegrity": "이 백업은 무결성 검증에 실패해 복원할 수 없습니다.",
    "workspaceLifecycle.errorRestoreChanged":
      "복원하는 동안 워크스페이스가 바뀌어 아무것도 복원하지 않았습니다. 현재 상태를 다시 불러왔으니 다시 시도하세요.",
    "workspaceLifecycle.errorDecryptionUnavailable":
      "지금은 키 서비스가 이 백업을 복호화할 수 없습니다. 잠시 뒤 다시 시도하세요.",
    "workspaceLifecycle.errorKeyServiceUnavailable":
      "키 서비스를 사용할 수 없습니다. 시작한 회전은 나중에 이어서 진행할 수 있습니다.",
    "workspaceLifecycle.errorKeyServiceNotConfigured": "워크스페이스 서비스에 키 서비스가 구성되어 있지 않습니다.",
    "workspaceLifecycle.errorRotationUnavailable": "지금은 키를 회전할 수 없습니다. 잠시 뒤 다시 시도하세요.",
    "workspaceLifecycle.errorDeletionRefused":
      "워크스페이스가 바뀌었거나 이름이 일치하지 않아 삭제를 예약하지 않았습니다. 현재 상태를 표시했습니다.",
    "workspaceLifecycle.errorDeletionCleanupPending":
      "삭제는 기록되었지만 최종 제거를 예약하지 못했습니다. 다시 시도해 마무리하세요.",
    "workspaceLifecycle.errorConfirmationRequired": "확인을 위해 워크스페이스 이름을 정확히 입력하세요.",
  },
);
