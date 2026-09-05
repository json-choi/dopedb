// agent, agentTools messages are owned by this bounded feature catalogue.
import { defineCatalog } from "../types";

export const agentsCatalog = defineCatalog(
  {
    "agent.activity": "Activity",
    "agent.audit": "Audit",
    "agent.auditBlockedWrites": "Unapproved Agent writes are blocked",
    "agent.auditBlockedWritesBody":
      "Query reads stay DB-enforced read-only. A write must become an immutable proposal that only the Desktop approval flow can authorize.",
    "agent.auditErrors": "{count} errors or blocked calls",
    "agent.auditHashChain": "Audit trail is recorded",
    "agent.auditHashChainBody":
      "Agent CLI operations are logged in Activity so database actions can be reviewed after the fact.",
    "agent.auditNoErrors": "No blocked or failed calls in the current session.",
    "agent.auditReadOnly": "Read tools use an enforced read-only path",
    "agent.auditReadOnlyBody":
      "dopedb query run executes through the read-only database session; replacement SQL and silent writes are rejected.",
    "agent.context": "Context",
    "agent.contextExposed": "Recorded operation context",
    "agent.contextHelp":
      "This ledger shows bounded metadata emitted by DopeDB after a local CLI command: command, scope identifiers, completion state, and error code. It never records credentials, result rows, or hidden agent reasoning.",
    "agent.contextSummaryDefault": "Bounded Terminal command metadata.",
    "agent.contextSummaryError": "Error details from the Agent operation.",
    "agent.dataAccess": "Data access",
    "agent.dataAccessBody":
      "Read commands stay on the enforced read-only path and their completion is recorded here.",
    "agent.dataModification": "Data modification",
    "agent.dataModificationBody":
      "Changes to rows stay blocked unless a reviewed approval flow allows them.",
    "agent.emptyBody":
      "Completed and failed Terminal CLI commands appear here as bounded metadata.",
    "agent.emptyCards": "Agent workspace states",
    "agent.errorCount": "{count} errors",
    "agent.jumpLatest": "Jump to latest",
    "agent.ledgerTitle": "Agent trust ledger",
    "agent.noSelection": "Select a timeline event to inspect what was exposed.",
    "agent.operations": "{count} operations",
    "agent.policy": "Policy",
    "agent.rows": "{count} rows",
    "agent.rowsTruncated": "{count} rows (truncated)",
    "agent.schemaAccess": "Schema access",
    "agent.schemaAccessBody":
      "Metadata commands are recorded without copying schemas or result rows into the ledger.",
    "agent.schemaModification": "Schema modification",
    "agent.schemaModificationBody":
      "DDL is treated as a high-risk request and should pause before execution.",
    "agent.session": "Session",
    "agent.succeeded": "{count} succeeded",
    "agent.timeline": "Timeline",
    "agent.workspace": "Agent workspace",
    "agent.you": "You",
    "agent.acpCancel": "Cancel",
    "agent.acpCancelFailed": "Could not cancel the Agent turn: {error}",
    "agent.acpCloseFailed": "Could not close the Agent session: {error}",
    "agent.acpCloseSession": "Close Agent session",
    "agent.acpClosedBeforeTurnCompleted":
      "This conversation closed before the Agent recorded a final answer. The local history is intact; resume the session to continue from the last completed step.",
    "agent.acpCollapseComposer": "Restore composer size",
    "agent.acpComposer": "Agent task composer",
    "agent.acpConfigFailed": "Could not change {name}: {error}",
    "agent.acpCopied": "Copied",
    "agent.acpCopyCode": "Copy code",
    "agent.acpDefaultModel": "Default model",
    "agent.acpDiagram": "Diagram",
    "agent.acpDiagramError":
      "The diagram could not be rendered. Review its source below.",
    "agent.acpDiagramLoading": "Rendering diagram…",
    "agent.acpDiagramSource": "View diagram source",
    "agent.acpAttachContext": "Attach current editor context",
    "agent.acpDetachContext": "Remove current editor context",
    "agent.acpEmptyFeatureSql": "Write, explain, and review SQL",
    "agent.acpEmptyFeatureInspect": "Inspect source code, schemas, and selected data",
    "agent.acpEmptyFeatureApprove": "Run changes only after explicit approval",
    "agent.acpEmptyTitle": "How can I help with this data?",
    "agent.acpExpandComposer": "Expand composer",
    "agent.acpFailed": "Agent session failed",
    "agent.acpInterruptedConnectionAuthority":
      "This data source's connection or safety authority changed before the Agent finished. Resume to continue under the current settings.",
    "agent.acpInterruptedProcessClosed":
      "The Agent process ended before it delivered a final answer. Resume to reconnect through the same official adapter and keep this local history.",
    "agent.acpInterruptedProcessUnavailable":
      "The previous Agent process is no longer available after the app restarted. Resume to reconnect through the same official adapter and keep this local history.",
    "agent.acpInterruptedSessionMetadataUnavailable":
      "This saved session's access metadata could not be read. Its local transcript is preserved, but the session cannot be resumed. Start a new Agent session under the current access.",
    "agent.acpInterruptedWorkspaceAuthority":
      "The workspace, account, or membership authority changed before the Agent finished. Resume to continue under the current access.",
    "agent.acpLifecycle.closed": "Closed",
    "agent.acpLifecycle.failed": "Failed",
    "agent.acpLifecycle.ready": "Ready",
    "agent.acpLifecycle.running": "Working",
    "agent.acpLifecycle.starting": "Starting",
    "agent.acpLifecycle.waitingPermission": "Approval",
    "agent.acpImageOmitted": "Remote image omitted",
    "agent.acpLoadFailed": "Could not load Agent sessions: {error}",
    "agent.acpLocalAuth":
      "Authentication stays in your local Claude or Codex login. DopeDB never reads or stores its token.",
    "agent.acpNew": "New Chat",
    "agent.acpMore": "More chat actions",
    "agent.acpNoSessions": "No conversations in this workspace yet.",
    "agent.acpReplayTruncated":
      "Earlier local transcript events were removed by the replay limit.",
    "agent.acpNoToken": "Local login · no app token",
    "agent.acpOpenLink": "Open link in the system browser",
    "agent.acpOpenSetup": "Set up Agent",
    "agent.acpPluginRequired": "Install an Agent adapter",
    "agent.acpPluginRequiredBody":
      "Choose Claude or Codex in Agent Tools. DopeDB installs only the selected signed adapter plugin.",
    "agent.acpPlainTextFallback":
      "This response is shown as plain text to keep the chat stable.",
    "agent.acpPermission": "Permission required",
    "agent.acpPermissionFailed":
      "Could not answer the permission request: {error}",
    "agent.acpPermissionResolved": "This permission request is no longer pending.",
    "agent.acpPermissionWaiting": "Waiting for your response",
    "agent.acpPinned": "Pinned to {name}",
    "agent.acpPlan": "Plan",
    "agent.acpPrompt": "Describe the data task for the Agent…",
    "agent.acpProvider": "Agent",
    "agent.acpScope": "Agent context",
    "agent.acpSelectResources": "Choose context",
    "agent.acpResourceScopeTrigger":
      "{project} · DB {databases} · Source {sources} · {mode}",
    "agent.acpCurrentResourceScope":
      "Agent context: {project}, {databases} databases, {sources} source repositories, {mode}",
    "agent.acpDatabaseResources": "Databases",
    "agent.acpSourceResources": "Source code",
    "agent.acpWriteTarget": "Write target",
    "agent.acpWriteTargetNamed": "Write · {database}",
    "agent.acpReadOnlyContext": "Read only",
    "agent.acpNoWritableDatabase":
      "No selected database currently passes the write policy.",
    "agent.externalRequestTitle": "External Agent request",
    "agent.externalConfigureTitle": "Create external Agent configuration",
    "agent.externalStartTitle": "Approve external Agent session",
    "agent.externalRequestLoadFailed":
      "Could not load external Agent requests: {error}",
    "agent.externalRequestResponseFailed":
      "Could not answer the external Agent request: {error}",
    "agent.externalNoConnection":
      "Connect at least one database before configuring an external Agent.",
    "agent.externalReject": "Reject",
    "agent.externalLoadingResources": "Loading exact Project resources…",
    "agent.externalSecurityBody":
      "The configuration stores resource IDs only. Starting the Agent still requires this Desktop approval, and the short-lived authority is bound to that Agent process tree without exposing a token.",
    "agent.externalChooseResources": "Choose the Project context",
    "agent.externalChooseResourcesBody":
      "Select any databases, BigQuery resources, and source repositories from one Project. You can optionally designate one database as the write-proposal target.",
    "agent.externalSaveConfig": "Approve and save configuration",
    "agent.externalConfiguredResourcesMissing":
      "One or more configured resources are unavailable in the active workspace or no longer satisfy its write policy. Reject this request, switch to the workspace that owns the Project and retry, or recreate the configuration through Desktop review.",
    "agent.externalReviewExactScope":
      "Review the exact resources this external Agent process will be allowed to use.",
    "agent.externalApproveStart": "Approve and start Agent",
    "agent.externalRefreshResources": "Refresh current resources",
    "agent.externalResourcesChanged":
      "A selected database revision changed. Refresh it, then review the exact current resources before approving.",
    "agent.externalDatabaseRevision": "{engine} · revision {revision}",
    "agent.externalWriteTarget": "Write proposals",
    "agent.externalProvider": "Agent",
    "agent.externalDirectory": "Working directory",
    "agent.acpEnvironmentLoadFailed": "Could not load Agent scopes",
    "agent.acpEnvironmentLoadFailedBody":
      "The Agent scope could not be verified: {error}",
    "agent.acpEnvironmentRequired": "Connect a database to a Project",
    "agent.acpEnvironmentRequiredBody":
      "In Explorer, connect this database and source code to a Project before starting the Agent.",
    "agent.acpEnvironmentReconfirm": "Reconfirm",
    "agent.acpEnvironmentReconfirmFailed":
      "The current connection revision could not be confirmed for the selected Project scope.",
    "agent.acpEnvironmentReconfirmFailedWithError":
      "Could not reconfirm the selected Project scope: {error}",
    "agent.acpProtocol": "ACP v1 · official Claude and Codex adapters",
    "agent.acpReadyBody":
      "The selected Project resources are attached as one exact, immutable ACP scope.",
    "agent.acpReadyTitle": "Ready to work",
    "agent.acpRenderFailed": "AI Chat could not be displayed",
    "agent.acpRenderFailedBody":
      "The session is still stored locally. Retry the panel or close it and continue in the workspace.",
    "agent.acpRenderRetry": "Retry panel",
    "agent.acpResume": "Resume session",
    "agent.acpResumeBody":
      "This bounded history is stored locally. Resume it through the same official adapter.",
    "agent.acpResumeFailed": "Could not resume the Agent session: {error}",
    "agent.acpRestartBody":
      "This session stopped before the adapter created history. Start a new Project-resource-pinned session.",
    "agent.acpSend": "Send task",
    "agent.acpSendFailed": "Could not send the Agent task: {error}",
    "agent.acpSessions": "Agent sessions",
    "agent.acpAgentSetup": "Agent setup",
    "agent.acpSkillRequiredBody":
      "This Agent is disabled until its DopeDB Skill is selected and installed in the app-wide Agent setup.",
    "agent.acpSkillRequiredTitle": "DopeDB Skill required",
    "agent.acpSetupActionFailed":
      "Could not open the Agent setup action: {error}",
    "agent.acpOpenLinkFailed":
      "Could not open the external link suggested by the Agent: {error}",
    "agent.acpSetupCheckAgain": "Check again",
    "agent.acpSetupCopied": "Login command copied",
    "agent.acpSetupCopyLogin": "Copy login command",
    "agent.acpSetupInstallBody":
      "{provider} is not installed. Install it from the provider's official guide, then check again.",
    "agent.acpSetupLoginBody":
      "{provider} is installed but not signed in. Run `{command}` in a local terminal, finish the provider login, then check again.",
    "agent.acpSetupOpenGuide": "Open install guide",
    "agent.acpSetupPrivacy":
      "The provider processes prompts under its terms. Authentication remains in the local CLI; DopeDB never reads or stores its token.",
    "agent.acpSetupRequired": "Waiting for local setup",
    "agent.acpSetupTitle": "{provider} local access",
    "agent.acpStartCodex": "Start Agent",
    "agent.acpStartFailed": "Could not start {provider} through ACP: {error}",
    "agent.acpStarting": "Starting the official ACP adapter…",
    "agent.acpActivityConnection": "Checking the database connection",
    "agent.acpActivityArticleList": "Finding Analysis Articles",
    "agent.acpActivityArticleVerify": "Verifying the Article query",
    "agent.acpActivityArticleCreate": "Saving a new Analysis Article",
    "agent.acpActivityArticleUpdate": "Updating the Analysis Article",
    "agent.acpActivityPrepareAnalysis": "Preparing the analysis presentation",
    "agent.acpActivityEvidencePlan": "Planning source and database evidence",
    "agent.acpActivityGeneric": "Running an Agent task",
    "agent.acpActivityInspectSchema": "Inspecting the database structure",
    "agent.acpActivityPlanning": "Organizing the next steps",
    "agent.acpActivityPrepareChange": "Preparing a database change",
    "agent.acpActivityQuery": "Reading data from the database",
    "agent.acpActivityReasoning": "Deciding the next action",
    "agent.acpActivitySourceRead": "Reading pinned source code",
    "agent.acpActivitySourceSearch": "Searching pinned source code",
    "agent.acpActivityToolSearch": "Finding the right Agent tools",
    "agent.acpThought": "Agent progress",
    "agent.acpTitle": "AI Chat",
    "agent.acpSelectDatabaseToOpen":
      "Select a database to open AI Chat",
    "agent.acpToolDetails": "Tool input and result",
    "agent.acpToolOutput": "Tool output",
    "agent.acpToolRequest": "Tool request",
    "agent.acpOpenAnalysisArticle": "Open Analysis Article",
    "agent.acpSqlApprovalTitle": "Review database change",
    "agent.acpSqlApprovalBody":
      "This SQL is reloaded from DopeDB's immutable local proposal. The Agent cannot approve or execute it.",
    "agent.acpSqlApprovalVerifying": "Verifying exact proposal…",
    "agent.acpSqlApprovalWaiting": "Waiting for your approval",
    "agent.acpSqlApprovalApproving": "Approving…",
    "agent.acpSqlApprovalApproved": "Approved",
    "agent.acpSqlApprovalRunning": "Running…",
    "agent.acpSqlApprovalRejecting": "Rejecting…",
    "agent.acpSqlApprovalExecuted": "Executed · {count} rows",
    "agent.acpSqlApprovalExecutedUnknown": "Executed",
    "agent.acpSqlApprovalRejected": "Rejected",
    "agent.acpSqlApprovalExpired": "Expired",
    "agent.acpSqlApprovalApproveRun": "Approve and run",
    "agent.acpSqlApprovalRun": "Run approved change",
    "agent.acpSqlApprovalReject": "Reject",
    "agent.acpSqlApprovalScopeMismatch":
      "This proposal does not belong to the current pinned connection.",
    "agent.acpToolStatusCompleted": "Completed",
    "agent.acpToolStatusFailed": "Failed",
    "agent.acpToolStatusPending": "Pending",
    "agent.acpToolStatusRunning": "Working",
    "agent.acpTurnCancelled": "Turn cancelled",
    "agent.acpTurnComplete": "Turn complete",
    "agent.acpTurnLimited": "Turn stopped at its limit",
    "agent.acpTurnRefused": "Agent refused this turn",
    "agent.acpWaiting": "Waiting…",
    "agent.acpWorking": "Agent is working",
    "agentTools.authenticated": "Signed in",
    "agentTools.autoUpdateFailed":
      "Could not automatically update {target}: {error}",
    "agentTools.autoUpdated":
      "{target} DopeDB Skill updated to revision {revision}.",
    "agentTools.startupBody":
      "Choose the official ACP adapters to install. Each selected adapter is verified separately and uses the provider CLI already signed in on this computer.",
    "agentTools.startupHeading": "Choose Agents for DopeDB",
    "agentTools.startupLater": "Later",
    "agentTools.startupSafety":
      "Adapters do not include Claude or Codex themselves. Their local CLI and login remain untouched; DopeDB never reads or refreshes a provider token.",
    "agentTools.startupInstallSelected": "Install selected adapters",
    "agentTools.startupInstalling": "Installing adapters…",
    "agentTools.startupSaveSelected": "Save selection",
    "agentTools.startupSelectOne": "Select at least one Agent.",
    "agentTools.startupTitle": "DopeDB Agent setup",
    "agentTools.startupVerificationFailed":
      "The installed Skill revision and package digest did not match the current bundle.",
    "agentTools.backupCreated": "Backup preserved at {path}",
    "agentTools.checkAgain": "Check again",
    "agentTools.checkingUpdates": "Checking updates…",
    "agentTools.cliMissing": "CLI not detected",
    "agentTools.conflictInvalidProvenance": "Invalid management marker",
    "agentTools.conflictMissing": "Missing",
    "agentTools.conflictModified": "Modified",
    "agentTools.conflictUnexpected": "Unexpected",
    "agentTools.conflicts": "{count} exact conflict(s)",
    "agentTools.currentRevision": "Current revision",
    "agentTools.description":
      "Optional for agents working from an external terminal: install the small DopeDB discovery Skill for Codex and Claude Code. Built-in AI Chat uses its typed MCP tools directly.",
    "agentTools.detectError": "Could not detect agent tools: {error}",
    "agentTools.detecting": "Detecting CLI…",
    "agentTools.detectionFailed": "CLI detection failed",
    "agentTools.detectProviderError": "{provider}: {error}",
    "agentTools.detected": "CLI detected",
    "agentTools.error": "Could not manage Agent tools: {error}",
    "agentTools.pluginsTitle": "ACP adapter plugins",
    "agentTools.pluginsDescription":
      "Install only the official Claude and Codex adapters you use. DopeDB verifies each signed bundle and runs it with bundled Node.",
    "agentTools.pluginsError": "Could not inspect ACP adapter plugins: {error}",
    "agentTools.pluginsInstalled": "Installed {count} ACP adapter plugin(s).",
    "agentTools.pluginRemoved": "ACP adapter plugin removed. Local CLI, login, Skill, and conversation history were preserved.",
    "agentTools.installSelected": "Install selected ({count})",
    "agentTools.installPlugin": "Install plugin",
    "agentTools.updatePlugin": "Install update",
    "agentTools.retryPlugin": "Retry installation",
    "agentTools.removePlugin": "Remove plugin",
    "agentTools.removePluginConfirm":
      "Close active {provider} sessions and remove this plugin? Local login and conversations are preserved.",
    "agentTools.enablePlugin": "Enable",
    "agentTools.disablePlugin": "Disable",
    "agentTools.pluginDownload": "Download {size}",
    "agentTools.pluginInstalledIdentity": "Adapter {version} · {release}",
    "agentTools.pluginUpdateIdentity": "Adapter {version} · {release}",
    "agentTools.pluginUpdateDescription":
      "Signed release {release} is available for adapter {version}. The current adapter remains active until you install it.",
    "agentTools.pluginProgress": "Installing {provider} ACP adapter",
    "agentTools.pluginStagedDescription":
      "The signed adapter is installed. Its first successful chat promotes it to the active version.",
    "agentTools.pluginState.notInstalled": "Not installed",
    "agentTools.pluginState.checking": "Checking",
    "agentTools.pluginState.downloading": "Downloading",
    "agentTools.pluginState.verifying": "Verifying",
    "agentTools.pluginState.staged": "Installed",
    "agentTools.pluginState.ready": "Ready",
    "agentTools.pluginState.updateAvailable": "Update available",
    "agentTools.pluginState.removing": "Removing",
    "agentTools.pluginState.failed": "Failed",
    "agentTools.pluginState.rollbackRequired": "Recovery required",
    "agentTools.localClisTitle": "Local Agent CLIs",
    "agentTools.localClisDescription":
      "Claude Code and Codex own authentication. DopeDB injects their verified local executable path and never reads a token.",
    "agentTools.skillTitle": "DopeDB Skill",
    "agentTools.skillDescription":
      "Optional discovery guide for Agents working outside built-in AI Chat.",
    "agentTools.install": "Install",
    "agentTools.installAll": "Install DopeDB Skill",
    "agentTools.installAndUpdate": "Install & update",
    "agentTools.installedRevision": "Installed revision {revision}",
    "agentTools.notAuthenticated": "Sign-in required",
    "agentTools.path": "Install path",
    "agentTools.reasonFilesDifferFromManagedSnapshot":
      "Installed files differ from the managed snapshot.",
    "agentTools.reasonInstallPathInspectionFailed":
      "The install path could not be inspected safely.",
    "agentTools.reasonInstallPathSymlink":
      "The install path contains a symbolic link.",
    "agentTools.reasonInstallRootNotDirectory":
      "An install-root component is not a directory.",
    "agentTools.reasonInstallTargetNotDirectory":
      "The install target exists but is not a directory.",
    "agentTools.reasonInstallTargetOutsideHome":
      "The install target is outside your home directory.",
    "agentTools.reasonInstallTargetSymlink":
      "The install target is a symbolic link.",
    "agentTools.reasonInstalledFileChanged":
      "An installed file changed while it was being checked.",
    "agentTools.reasonInstalledFileTooLarge":
      "An installed file is too large for this platform.",
    "agentTools.reasonInstalledSkillByteLimit":
      "The installed Skill exceeds the safe byte limit.",
    "agentTools.reasonInstalledSkillFileCountLimit":
      "The installed Skill exceeds the safe file-count limit.",
    "agentTools.reasonInstalledSkillNestingLimit":
      "The installed Skill exceeds the safe nesting limit.",
    "agentTools.reasonInstalledSkillNonUnicodePath":
      "The installed Skill contains a path that cannot be displayed safely.",
    "agentTools.reasonInstalledSkillReadFailed":
      "The installed Skill could not be read safely.",
    "agentTools.reasonInstalledSkillSymlink":
      "The installed Skill contains a symbolic link.",
    "agentTools.reasonInstalledSkillUnsafePath":
      "The installed Skill contains an unsafe path.",
    "agentTools.reasonInstalledSkillUnsupportedFile":
      "The installed Skill contains an unsupported or oversized file.",
    "agentTools.reasonInventoryEscapedRoot":
      "An inventory path escaped the install root.",
    "agentTools.reasonProvenanceMarkerMalformed":
      "The DopeDB management marker is malformed.",
    "agentTools.reasonProvenanceMarkerNotFile":
      "The DopeDB management marker is not a regular file.",
    "agentTools.reasonProvenanceMarkerUnreadable":
      "The DopeDB management marker could not be read.",
    "agentTools.reasonUnknownManagedSnapshot":
      "The DopeDB management marker names an unknown snapshot.",
    "agentTools.reasonUnmanagedFiles":
      "This path contains files not managed by this DopeDB release.",
    "agentTools.reasonUnsafePathComponent":
      "The install target contains an unsafe path component.",
    "agentTools.remove": "Remove",
    "agentTools.removeConfirm": "Remove this managed Skill?",
    "agentTools.removed": "Managed DopeDB Skill removed.",
    "agentTools.repair": "Back up and repair",
    "agentTools.repairConfirm":
      "Preserve the existing files and repair {count} conflict(s)?",
    "agentTools.selfTest": "Test version-matched guide",
    "agentTools.selfTestPassed":
      "CLI self-test passed for revision {revision} ({bytes} guide bytes).",
    "agentTools.stateInvalid": "Invalid installation",
    "agentTools.stateManagedCurrent": "Current",
    "agentTools.stateManagedOlder": "Update available",
    "agentTools.stateMissing": "Not installed",
    "agentTools.stateNewerKnown": "Managed by a newer DopeDB",
    "agentTools.stateUnknownConflict": "Existing unknown files",
    "agentTools.stateUserModified": "User-modified",
    "agentTools.title": "Agent tools",
    "agentTools.update": "Update",
    "agentTools.updateAll": "Update DopeDB Skill",
    "agentTools.updated": "DopeDB Skill installation updated.",
    "agentTools.version": "DopeDB {version} · Skill revision {revision}",
  },
  {
    "agent.activity": "활동",
    "agent.audit": "감사",
    "agent.auditBlockedWrites": "승인되지 않은 Agent 쓰기는 차단됨",
    "agent.auditBlockedWritesBody":
      "조회 쿼리는 DB에서 강제하는 read-only 경로를 유지합니다. 쓰기는 불변 제안으로 만든 뒤 데스크톱 승인 흐름에서만 허용할 수 있습니다.",
    "agent.auditErrors": "오류 또는 차단된 호출 {count}개",
    "agent.auditHashChain": "감사 기록 저장",
    "agent.auditHashChainBody":
      "Agent CLI 작업은 활동 기록에 남아 나중에 데이터베이스 작업을 검토할 수 있습니다.",
    "agent.auditNoErrors": "현재 세션에는 차단되거나 실패한 호출이 없습니다.",
    "agent.auditReadOnly": "읽기 도구는 강제 read-only 경로 사용",
    "agent.auditReadOnlyBody":
      "dopedb query run은 read-only 데이터베이스 세션에서 실행되며, SQL 교체와 조용한 쓰기를 거절합니다.",
    "agent.context": "컨텍스트",
    "agent.contextExposed": "기록된 작업 컨텍스트",
    "agent.contextHelp":
      "이 원장은 로컬 CLI 명령 뒤 DopeDB가 내보낸 제한된 메타데이터만 보여줍니다: 명령, 범위 식별자, 완료 상태, 오류 코드. 인증 정보, 결과 행, 외부 에이전트의 숨은 추론은 기록하지 않습니다.",
    "agent.contextSummaryDefault": "제한된 Terminal 명령 메타데이터.",
    "agent.contextSummaryError": "Agent 작업에서 나온 오류 상세.",
    "agent.dataAccess": "데이터 접근",
    "agent.dataAccessBody":
      "조회 명령은 강제 read-only 경로를 유지하며 완료 상태가 여기에 기록됩니다.",
    "agent.dataModification": "데이터 수정",
    "agent.dataModificationBody":
      "행 변경은 검토된 승인 흐름이 허용하기 전까지 차단된 상태로 둡니다.",
    "agent.emptyBody":
      "완료되거나 실패한 Terminal CLI 명령이 제한된 메타데이터로 여기에 표시됩니다.",
    "agent.emptyCards": "에이전트 작업공간 상태",
    "agent.errorCount": "오류 {count}개",
    "agent.jumpLatest": "최신으로 이동",
    "agent.ledgerTitle": "에이전트 신뢰 원장",
    "agent.noSelection": "타임라인 이벤트를 선택하면 무엇이 노출됐는지 볼 수 있습니다.",
    "agent.operations": "작업 {count}개",
    "agent.policy": "정책",
    "agent.rows": "{count}행",
    "agent.rowsTruncated": "{count}행 (잘림)",
    "agent.schemaAccess": "스키마 접근",
    "agent.schemaAccessBody":
      "스키마나 결과 행을 원장에 복사하지 않고 메타데이터 명령만 기록합니다.",
    "agent.schemaModification": "스키마 수정",
    "agent.schemaModificationBody":
      "DDL은 고위험 요청으로 취급하고 실행 전 멈춰 검토해야 합니다.",
    "agent.session": "세션",
    "agent.succeeded": "성공 {count}개",
    "agent.timeline": "타임라인",
    "agent.workspace": "에이전트 작업공간",
    "agent.you": "나",
    "agent.acpCancel": "취소",
    "agent.acpCancelFailed": "Agent 작업을 취소하지 못했습니다: {error}",
    "agent.acpCloseFailed": "Agent 세션을 닫지 못했습니다: {error}",
    "agent.acpCloseSession": "Agent 세션 닫기",
    "agent.acpClosedBeforeTurnCompleted":
      "Agent가 최종 답변을 기록하기 전에 대화가 닫혔습니다. 로컬 기록은 보존되어 있으니 마지막으로 완료한 단계부터 계속하려면 세션을 이어가세요.",
    "agent.acpCollapseComposer": "입력창 크기 복원",
    "agent.acpComposer": "Agent 작업 입력",
    "agent.acpConfigFailed": "{name} 설정을 바꾸지 못했습니다: {error}",
    "agent.acpCopied": "복사됨",
    "agent.acpCopyCode": "코드 복사",
    "agent.acpDefaultModel": "기본 모델",
    "agent.acpDiagram": "다이어그램",
    "agent.acpDiagramError":
      "다이어그램을 렌더링하지 못했습니다. 아래 원본을 확인하세요.",
    "agent.acpDiagramLoading": "다이어그램 렌더링 중…",
    "agent.acpDiagramSource": "다이어그램 원본 보기",
    "agent.acpAttachContext": "현재 편집기 문맥 첨부",
    "agent.acpDetachContext": "현재 편집기 문맥 제거",
    "agent.acpEmptyFeatureSql": "SQL 작성·설명·검토",
    "agent.acpEmptyFeatureInspect": "소스 코드·스키마·선택 데이터 탐색",
    "agent.acpEmptyFeatureApprove": "명시적 승인 뒤 변경 실행",
    "agent.acpEmptyTitle": "이 데이터에서 무엇을 도와드릴까요?",
    "agent.acpExpandComposer": "입력창 확대",
    "agent.acpFailed": "Agent 세션 실패",
    "agent.acpInterruptedConnectionAuthority":
      "Agent가 답변을 마치기 전에 이 데이터 소스의 연결 또는 안전 권한이 변경되었습니다. 현재 설정으로 계속하려면 세션을 이어가세요.",
    "agent.acpInterruptedProcessClosed":
      "최종 답변을 전달하기 전에 Agent 프로세스가 종료되었습니다. 로컬 대화 기록을 유지한 채 같은 공식 어댑터로 다시 연결하려면 세션을 이어가세요.",
    "agent.acpInterruptedProcessUnavailable":
      "앱이 다시 시작되어 이전 Agent 프로세스에 연결할 수 없습니다. 로컬 대화 기록을 유지한 채 같은 공식 어댑터로 다시 연결하려면 세션을 이어가세요.",
    "agent.acpInterruptedSessionMetadataUnavailable":
      "저장된 세션의 접근 정보를 읽지 못했습니다. 로컬 대화 기록은 보존되지만 이 세션은 이어갈 수 없습니다. 현재 접근 범위에서 새 Agent 세션을 시작하세요.",
    "agent.acpInterruptedWorkspaceAuthority":
      "Agent가 답변을 마치기 전에 워크스페이스·계정 또는 멤버십 권한이 변경되었습니다. 현재 권한으로 계속하려면 세션을 이어가세요.",
    "agent.acpLifecycle.closed": "닫힘",
    "agent.acpLifecycle.failed": "실패",
    "agent.acpLifecycle.ready": "준비됨",
    "agent.acpLifecycle.running": "작업 중",
    "agent.acpLifecycle.starting": "시작 중",
    "agent.acpLifecycle.waitingPermission": "승인 대기",
    "agent.acpImageOmitted": "원격 이미지 생략됨",
    "agent.acpLoadFailed": "Agent 세션을 불러오지 못했습니다: {error}",
    "agent.acpLocalAuth":
      "인증은 사용자의 로컬 Claude 또는 Codex 로그인이 소유합니다. DopeDB는 토큰을 읽거나 저장하지 않습니다.",
    "agent.acpNew": "새 채팅",
    "agent.acpMore": "채팅 작업 더보기",
    "agent.acpNoSessions": "이 워크스페이스에는 아직 대화가 없습니다.",
    "agent.acpReplayTruncated":
      "로컬 재생 한도를 넘은 이전 대화 기록은 정리되었습니다.",
    "agent.acpNoToken": "로컬 로그인 · 앱 토큰 없음",
    "agent.acpOpenLink": "시스템 브라우저에서 링크 열기",
    "agent.acpOpenSetup": "에이전트 설정",
    "agent.acpPluginRequired": "에이전트 어댑터를 설치하세요",
    "agent.acpPluginRequiredBody":
      "에이전트 도구에서 Claude 또는 Codex를 선택하세요. DopeDB는 선택한 서명된 어댑터 플러그인만 설치합니다.",
    "agent.acpPlainTextFallback":
      "채팅을 안정적으로 유지하기 위해 이 답변을 일반 텍스트로 표시합니다.",
    "agent.acpPermission": "권한 승인 필요",
    "agent.acpPermissionFailed": "권한 요청에 응답하지 못했습니다: {error}",
    "agent.acpPermissionResolved": "이 권한 요청은 더 이상 대기 중이 아닙니다.",
    "agent.acpPermissionWaiting": "응답 대기 중",
    "agent.acpPinned": "{name}에 고정됨",
    "agent.acpPlan": "계획",
    "agent.acpPrompt": "Agent가 수행할 데이터 작업을 입력하세요…",
    "agent.acpProvider": "Agent",
    "agent.acpScope": "Agent 컨텍스트",
    "agent.acpSelectResources": "컨텍스트 선택",
    "agent.acpResourceScopeTrigger":
      "{project} · DB {databases} · 소스 {sources} · {mode}",
    "agent.acpCurrentResourceScope":
      "Agent 컨텍스트: {project}, DB {databases}개, 소스 저장소 {sources}개, {mode}",
    "agent.acpDatabaseResources": "데이터베이스",
    "agent.acpSourceResources": "소스 코드",
    "agent.acpWriteTarget": "쓰기 대상",
    "agent.acpWriteTargetNamed": "쓰기 · {database}",
    "agent.acpReadOnlyContext": "읽기 전용",
    "agent.acpNoWritableDatabase":
      "현재 쓰기 정책을 통과한 선택 DB가 없습니다.",
    "agent.externalRequestTitle": "외부 Agent 요청",
    "agent.externalConfigureTitle": "외부 Agent 설정 만들기",
    "agent.externalStartTitle": "외부 Agent 세션 승인",
    "agent.externalRequestLoadFailed":
      "외부 Agent 요청을 불러오지 못했습니다: {error}",
    "agent.externalRequestResponseFailed":
      "외부 Agent 요청에 응답하지 못했습니다: {error}",
    "agent.externalNoConnection":
      "외부 Agent를 설정하려면 먼저 데이터베이스를 하나 이상 연결하세요.",
    "agent.externalReject": "거절",
    "agent.externalLoadingResources": "정확한 프로젝트 리소스를 불러오는 중…",
    "agent.externalSecurityBody":
      "설정 파일에는 리소스 ID만 저장됩니다. Agent를 시작할 때마다 이 Desktop 승인이 필요하며, 단기 권한은 토큰을 노출하지 않고 해당 Agent 프로세스 트리에만 묶입니다.",
    "agent.externalChooseResources": "프로젝트 컨텍스트 선택",
    "agent.externalChooseResourcesBody":
      "한 프로젝트에서 DB, BigQuery, 소스 저장소를 원하는 조합으로 선택하세요. 필요하면 DB 하나만 쓰기 제안 대상으로 지정할 수 있습니다.",
    "agent.externalSaveConfig": "승인하고 설정 저장",
    "agent.externalConfiguredResourcesMissing":
      "설정된 리소스 중 일부가 현재 워크스페이스에 없거나 더 이상 쓰기 정책을 충족하지 않습니다. 요청을 거절한 뒤 프로젝트가 있는 워크스페이스로 전환해 재시도하거나 Desktop 검토를 거쳐 설정을 다시 만드세요.",
    "agent.externalReviewExactScope":
      "외부 Agent 프로세스가 사용할 수 있는 정확한 리소스를 확인하세요.",
    "agent.externalApproveStart": "승인하고 Agent 시작",
    "agent.externalRefreshResources": "현재 리소스 새로고침",
    "agent.externalResourcesChanged":
      "선택한 데이터베이스 revision이 변경되었습니다. 새로고침한 뒤 현재 리소스를 다시 확인하고 승인하세요.",
    "agent.externalDatabaseRevision": "{engine} · revision {revision}",
    "agent.externalWriteTarget": "쓰기 제안",
    "agent.externalProvider": "Agent",
    "agent.externalDirectory": "작업 폴더",
    "agent.acpEnvironmentLoadFailed": "Agent 범위를 불러오지 못했습니다",
    "agent.acpEnvironmentLoadFailedBody":
      "Agent 범위를 검증하지 못했습니다: {error}",
    "agent.acpEnvironmentRequired": "프로젝트에 DB를 먼저 연결하세요",
    "agent.acpEnvironmentRequiredBody":
      "Agent를 시작하기 전에 탐색기에서 이 DB와 소스 코드를 프로젝트에 연결하세요.",
    "agent.acpEnvironmentReconfirm": "재확인",
    "agent.acpEnvironmentReconfirmFailed":
      "선택한 프로젝트 범위에서 현재 연결 리비전을 확인하지 못했습니다.",
    "agent.acpEnvironmentReconfirmFailedWithError":
      "선택한 프로젝트 범위를 재확인하지 못했습니다: {error}",
    "agent.acpProtocol": "ACP v1 · 공식 Claude·Codex 어댑터",
    "agent.acpReadyBody":
      "선택한 프로젝트 리소스를 변경할 수 없는 하나의 정확한 ACP 범위로 첨부합니다.",
    "agent.acpReadyTitle": "작업 준비 완료",
    "agent.acpRenderFailed": "AI Chat 화면을 표시하지 못했습니다",
    "agent.acpRenderFailedBody":
      "세션은 로컬에 보존되어 있습니다. 패널을 다시 표시하거나 닫고 워크스페이스에서 계속 작업할 수 있습니다.",
    "agent.acpRenderRetry": "패널 다시 표시",
    "agent.acpResume": "세션 이어가기",
    "agent.acpResumeBody":
      "크기가 제한된 이 기록은 로컬에 저장됩니다. 같은 공식 어댑터로 세션을 이어갑니다.",
    "agent.acpResumeFailed": "Agent 세션을 이어가지 못했습니다: {error}",
    "agent.acpRestartBody":
      "어댑터가 기록을 만들기 전에 이 세션이 중단됐습니다. 프로젝트 리소스에 고정된 새 세션을 시작하세요.",
    "agent.acpSend": "작업 보내기",
    "agent.acpSendFailed": "Agent 작업을 보내지 못했습니다: {error}",
    "agent.acpSessions": "Agent 세션",
    "agent.acpAgentSetup": "Agent 설정",
    "agent.acpSkillRequiredBody":
      "앱 전역 Agent 설정에서 이 Agent를 선택하고 DopeDB Skill을 설치할 때까지 사용할 수 없습니다.",
    "agent.acpSkillRequiredTitle": "DopeDB Skill 필요",
    "agent.acpSetupActionFailed":
      "Agent 설정 작업을 열지 못했습니다: {error}",
    "agent.acpOpenLinkFailed":
      "Agent가 제안한 외부 링크를 열지 못했습니다: {error}",
    "agent.acpSetupCheckAgain": "다시 확인",
    "agent.acpSetupCopied": "로그인 명령 복사됨",
    "agent.acpSetupCopyLogin": "로그인 명령 복사",
    "agent.acpSetupInstallBody":
      "{provider}가 설치되어 있지 않습니다. 제공자의 공식 안내에서 설치한 뒤 다시 확인하세요.",
    "agent.acpSetupLoginBody":
      "{provider}가 설치되어 있지만 로그인되지 않았습니다. 로컬 터미널에서 `{command}`를 실행해 제공자 로그인을 마친 뒤 다시 확인하세요.",
    "agent.acpSetupOpenGuide": "설치 안내 열기",
    "agent.acpSetupPrivacy":
      "프롬프트는 제공자 약관에 따라 처리됩니다. 인증은 로컬 CLI에 남으며 DopeDB는 토큰을 읽거나 저장하지 않습니다.",
    "agent.acpSetupRequired": "로컬 설정 대기 중",
    "agent.acpSetupTitle": "{provider} 로컬 접근",
    "agent.acpStartCodex": "Agent 시작",
    "agent.acpStartFailed": "ACP로 {provider}를 시작하지 못했습니다: {error}",
    "agent.acpStarting": "공식 ACP 어댑터를 시작하는 중…",
    "agent.acpActivityConnection": "데이터베이스 연결 상태 확인",
    "agent.acpActivityArticleList": "분석 아티클 목록 확인",
    "agent.acpActivityArticleVerify": "아티클 쿼리 검증",
    "agent.acpActivityArticleCreate": "새 분석 아티클 저장",
    "agent.acpActivityArticleUpdate": "분석 아티클 업데이트",
    "agent.acpActivityPrepareAnalysis": "분석 결과 표현 준비",
    "agent.acpActivityEvidencePlan": "소스와 데이터베이스 근거 범위 확인",
    "agent.acpActivityGeneric": "Agent 작업 실행",
    "agent.acpActivityInspectSchema": "데이터베이스 구조 확인",
    "agent.acpActivityPlanning": "다음 작업 순서 정리",
    "agent.acpActivityPrepareChange": "데이터 변경 준비",
    "agent.acpActivityQuery": "데이터베이스 조회",
    "agent.acpActivityReasoning": "다음 작업 판단",
    "agent.acpActivitySourceRead": "고정된 소스 코드 확인",
    "agent.acpActivitySourceSearch": "고정된 소스 코드 검색",
    "agent.acpActivityToolSearch": "필요한 Agent 도구 찾기",
    "agent.acpThought": "Agent 진행 상황",
    "agent.acpTitle": "AI Chat",
    "agent.acpSelectDatabaseToOpen":
      "데이터베이스를 선택하면 AI Chat을 열 수 있습니다",
    "agent.acpToolDetails": "도구 입력 및 결과",
    "agent.acpToolOutput": "도구 출력",
    "agent.acpToolRequest": "도구 요청",
    "agent.acpOpenAnalysisArticle": "Analysis Article 열기",
    "agent.acpSqlApprovalTitle": "데이터 변경 검토",
    "agent.acpSqlApprovalBody":
      "DopeDB의 변경 불가능한 로컬 제안에서 다시 불러온 SQL입니다. Agent는 이를 승인하거나 실행할 수 없습니다.",
    "agent.acpSqlApprovalVerifying": "정확한 제안 확인 중…",
    "agent.acpSqlApprovalWaiting": "승인 대기 중",
    "agent.acpSqlApprovalApproving": "승인 중…",
    "agent.acpSqlApprovalApproved": "승인됨",
    "agent.acpSqlApprovalRunning": "실행 중…",
    "agent.acpSqlApprovalRejecting": "거절 중…",
    "agent.acpSqlApprovalExecuted": "실행됨 · {count}행",
    "agent.acpSqlApprovalExecutedUnknown": "실행됨",
    "agent.acpSqlApprovalRejected": "거절됨",
    "agent.acpSqlApprovalExpired": "만료됨",
    "agent.acpSqlApprovalApproveRun": "승인하고 실행",
    "agent.acpSqlApprovalRun": "승인된 변경 실행",
    "agent.acpSqlApprovalReject": "거절",
    "agent.acpSqlApprovalScopeMismatch":
      "이 제안은 현재 고정된 연결에 속하지 않습니다.",
    "agent.acpToolStatusCompleted": "완료",
    "agent.acpToolStatusFailed": "실패",
    "agent.acpToolStatusPending": "대기 중",
    "agent.acpToolStatusRunning": "진행 중",
    "agent.acpTurnCancelled": "작업 취소됨",
    "agent.acpTurnComplete": "작업 완료",
    "agent.acpTurnLimited": "한도에 도달해 작업 종료",
    "agent.acpTurnRefused": "Agent가 작업을 거절함",
    "agent.acpWaiting": "기다리는 중…",
    "agent.acpWorking": "Agent가 작업 중입니다",
    "agentTools.authenticated": "로그인됨",
    "agentTools.autoUpdateFailed":
      "{target}을 자동 업데이트하지 못했습니다: {error}",
    "agentTools.autoUpdated":
      "{target} DopeDB Skill을 리비전 {revision}(으)로 업데이트했습니다.",
    "agentTools.startupBody":
      "설치할 공식 ACP 어댑터를 선택하세요. 선택한 어댑터를 각각 검증하고 이 컴퓨터에 이미 로그인된 제공자 CLI를 사용합니다.",
    "agentTools.startupHeading": "DopeDB에서 사용할 Agent 선택",
    "agentTools.startupLater": "나중에",
    "agentTools.startupSafety":
      "어댑터에는 Claude나 Codex 자체가 포함되지 않습니다. 로컬 CLI와 로그인은 변경하지 않으며 DopeDB는 제공자 토큰을 읽거나 갱신하지 않습니다.",
    "agentTools.startupInstallSelected": "선택한 어댑터 설치",
    "agentTools.startupInstalling": "어댑터 설치 중…",
    "agentTools.startupSaveSelected": "선택 저장",
    "agentTools.startupSelectOne": "Agent를 하나 이상 선택하세요.",
    "agentTools.startupTitle": "DopeDB Agent 설정",
    "agentTools.startupVerificationFailed":
      "설치된 Skill 리비전과 패키지 다이제스트가 현재 번들과 일치하지 않습니다.",
    "agentTools.backupCreated": "기존 파일을 {path}에 보존했습니다.",
    "agentTools.checkAgain": "다시 확인",
    "agentTools.checkingUpdates": "업데이트 확인 중…",
    "agentTools.cliMissing": "CLI를 찾지 못함",
    "agentTools.conflictInvalidProvenance": "잘못된 관리 표식",
    "agentTools.conflictMissing": "누락됨",
    "agentTools.conflictModified": "수정됨",
    "agentTools.conflictUnexpected": "예상하지 않은 파일",
    "agentTools.conflicts": "정확한 충돌 {count}개",
    "agentTools.currentRevision": "현재 리비전",
    "agentTools.description":
      "외부 터미널에서 작업하는 Agent를 위한 선택 기능입니다. Codex와 Claude Code에 작은 DopeDB 탐색 Skill을 설치하며, 내장 AI Chat은 typed MCP 도구를 직접 사용합니다.",
    "agentTools.detectError": "에이전트 도구를 확인하지 못했습니다: {error}",
    "agentTools.detecting": "CLI 확인 중…",
    "agentTools.detectionFailed": "CLI 확인 실패",
    "agentTools.detectProviderError": "{provider}: {error}",
    "agentTools.detected": "CLI 감지됨",
    "agentTools.error": "Agent 도구를 관리하지 못했습니다: {error}",
    "agentTools.pluginsTitle": "ACP 어댑터 플러그인",
    "agentTools.pluginsDescription":
      "사용하는 Claude와 Codex 공식 어댑터만 설치합니다. DopeDB가 서명된 번들을 검증하고 내장 Node로 실행합니다.",
    "agentTools.pluginsError": "ACP 어댑터 플러그인을 확인하지 못했습니다: {error}",
    "agentTools.pluginsInstalled": "ACP 어댑터 플러그인 {count}개를 설치했습니다.",
    "agentTools.pluginRemoved": "ACP 어댑터 플러그인을 제거했습니다. 로컬 CLI, 로그인, 스킬과 대화 기록은 보존했습니다.",
    "agentTools.installSelected": "선택 항목 설치 ({count})",
    "agentTools.installPlugin": "플러그인 설치",
    "agentTools.updatePlugin": "업데이트 설치",
    "agentTools.retryPlugin": "설치 다시 시도",
    "agentTools.removePlugin": "플러그인 제거",
    "agentTools.removePluginConfirm":
      "활성 {provider} 세션을 닫고 이 플러그인을 제거할까요? 로컬 로그인과 대화 기록은 보존됩니다.",
    "agentTools.enablePlugin": "사용",
    "agentTools.disablePlugin": "사용 안 함",
    "agentTools.pluginDownload": "다운로드 {size}",
    "agentTools.pluginInstalledIdentity": "어댑터 {version} · {release}",
    "agentTools.pluginUpdateIdentity": "어댑터 {version} · {release}",
    "agentTools.pluginUpdateDescription":
      "어댑터 {version}용 서명 릴리스 {release}을 설치할 수 있습니다. 설치하기 전까지 현재 어댑터가 계속 사용됩니다.",
    "agentTools.pluginProgress": "{provider} ACP 어댑터 설치 중",
    "agentTools.pluginStagedDescription":
      "서명된 어댑터가 설치되었습니다. 첫 채팅이 정상적으로 시작되면 활성 버전으로 확정됩니다.",
    "agentTools.pluginState.notInstalled": "설치되지 않음",
    "agentTools.pluginState.checking": "확인 중",
    "agentTools.pluginState.downloading": "다운로드 중",
    "agentTools.pluginState.verifying": "검증 중",
    "agentTools.pluginState.staged": "설치됨",
    "agentTools.pluginState.ready": "준비됨",
    "agentTools.pluginState.updateAvailable": "업데이트 가능",
    "agentTools.pluginState.removing": "제거 중",
    "agentTools.pluginState.failed": "실패",
    "agentTools.pluginState.rollbackRequired": "복구 필요",
    "agentTools.localClisTitle": "로컬 Agent CLI",
    "agentTools.localClisDescription":
      "Claude Code와 Codex가 인증을 소유합니다. DopeDB는 검증한 로컬 실행 경로만 주입하며 토큰을 읽지 않습니다.",
    "agentTools.skillTitle": "DopeDB 스킬",
    "agentTools.skillDescription":
      "내장 AI Chat 밖에서 작업하는 Agent를 위한 선택형 탐색 안내입니다.",
    "agentTools.install": "설치",
    "agentTools.installAll": "DopeDB 스킬 설치",
    "agentTools.installAndUpdate": "설치 및 업데이트",
    "agentTools.installedRevision": "설치된 리비전 {revision}",
    "agentTools.notAuthenticated": "로그인 필요",
    "agentTools.path": "설치 경로",
    "agentTools.reasonFilesDifferFromManagedSnapshot":
      "설치된 파일이 관리 기록과 다릅니다.",
    "agentTools.reasonInstallPathInspectionFailed":
      "설치 경로를 안전하게 검사하지 못했습니다.",
    "agentTools.reasonInstallPathSymlink":
      "설치 경로에 심볼릭 링크가 포함되어 있습니다.",
    "agentTools.reasonInstallRootNotDirectory":
      "설치 루트의 일부가 폴더가 아닙니다.",
    "agentTools.reasonInstallTargetNotDirectory":
      "설치 대상이 이미 있지만 폴더가 아닙니다.",
    "agentTools.reasonInstallTargetOutsideHome":
      "설치 대상이 사용자 홈 폴더 밖에 있습니다.",
    "agentTools.reasonInstallTargetSymlink":
      "설치 대상이 심볼릭 링크입니다.",
    "agentTools.reasonInstalledFileChanged":
      "검사하는 동안 설치된 파일이 변경되었습니다.",
    "agentTools.reasonInstalledFileTooLarge":
      "설치된 파일이 이 플랫폼에서 처리하기에 너무 큽니다.",
    "agentTools.reasonInstalledSkillByteLimit":
      "설치된 스킬이 안전한 전체 용량 제한을 넘었습니다.",
    "agentTools.reasonInstalledSkillFileCountLimit":
      "설치된 스킬이 안전한 파일 개수 제한을 넘었습니다.",
    "agentTools.reasonInstalledSkillNestingLimit":
      "설치된 스킬이 안전한 폴더 깊이 제한을 넘었습니다.",
    "agentTools.reasonInstalledSkillNonUnicodePath":
      "설치된 스킬에 안전하게 표시할 수 없는 경로가 있습니다.",
    "agentTools.reasonInstalledSkillReadFailed":
      "설치된 스킬을 안전하게 읽지 못했습니다.",
    "agentTools.reasonInstalledSkillSymlink":
      "설치된 스킬에 심볼릭 링크가 포함되어 있습니다.",
    "agentTools.reasonInstalledSkillUnsafePath":
      "설치된 스킬에 안전하지 않은 경로가 있습니다.",
    "agentTools.reasonInstalledSkillUnsupportedFile":
      "설치된 스킬에 지원하지 않거나 너무 큰 파일이 있습니다.",
    "agentTools.reasonInventoryEscapedRoot":
      "검사한 경로가 설치 루트 밖으로 벗어났습니다.",
    "agentTools.reasonProvenanceMarkerMalformed":
      "DopeDB 관리 표식의 형식이 잘못되었습니다.",
    "agentTools.reasonProvenanceMarkerNotFile":
      "DopeDB 관리 표식이 일반 파일이 아닙니다.",
    "agentTools.reasonProvenanceMarkerUnreadable":
      "DopeDB 관리 표식을 읽지 못했습니다.",
    "agentTools.reasonUnknownManagedSnapshot":
      "DopeDB 관리 표식이 알 수 없는 스냅샷을 가리킵니다.",
    "agentTools.reasonUnmanagedFiles":
      "이 경로에 현재 DopeDB 릴리스가 관리하지 않는 파일이 있습니다.",
    "agentTools.reasonUnsafePathComponent":
      "설치 대상에 안전하지 않은 경로 요소가 있습니다.",
    "agentTools.remove": "제거",
    "agentTools.removeConfirm": "이 관리형 스킬을 제거할까요?",
    "agentTools.removed": "관리형 DopeDB 스킬을 제거했습니다.",
    "agentTools.repair": "백업 후 복구",
    "agentTools.repairConfirm": "기존 파일을 보존하고 충돌 {count}개를 복구할까요?",
    "agentTools.selfTest": "버전 일치 가이드 테스트",
    "agentTools.selfTestPassed":
      "리비전 {revision} CLI 자체 테스트를 통과했습니다(가이드 {bytes}바이트).",
    "agentTools.stateInvalid": "잘못된 설치",
    "agentTools.stateManagedCurrent": "최신",
    "agentTools.stateManagedOlder": "업데이트 가능",
    "agentTools.stateMissing": "설치되지 않음",
    "agentTools.stateNewerKnown": "더 최신 DopeDB에서 관리됨",
    "agentTools.stateUnknownConflict": "알 수 없는 기존 파일",
    "agentTools.stateUserModified": "사용자 수정됨",
    "agentTools.title": "에이전트 도구",
    "agentTools.update": "업데이트",
    "agentTools.updateAll": "DopeDB 스킬 업데이트",
    "agentTools.updated": "DopeDB 스킬 설치를 업데이트했습니다.",
    "agentTools.version": "DopeDB {version} · 스킬 리비전 {revision}",
  },
);
