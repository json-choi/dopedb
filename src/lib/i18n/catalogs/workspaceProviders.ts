// workspaceProviders messages (provider accounts, browser authorization, Neon and
// Vault credential forms, Google Cloud SQL setup and repair) are owned by this
// bounded feature catalogue.
import { defineCatalog } from "../types";

export const workspaceProvidersCatalog = defineCatalog(
  {
    "workspaceProviders.description": "Connect provider accounts and register managed databases for the workspace.",
    "workspaceProviders.views": "Provider tasks",
    "workspaceProviders.viewAccounts": "Connect accounts",
    "workspaceProviders.viewDatabases": "Shared databases",

    "workspaceProviders.accountsTitle": "Provider accounts",
    "workspaceProviders.accountsDescription":
      "Choose where your database is hosted and connect that provider account. The workspace uses it to find databases and issue short-lived credentials; long-lived database passwords are never stored.",
    "workspaceProviders.loadFailed": "Could not load provider accounts.",
    "workspaceProviders.unavailable": "No managed provider is available in this deployment.",
    "workspaceProviders.inventoryFailed":
      "Shared database counts could not be loaded. Accounts are still shown.",
    "workspaceProviders.connect": "Connect",
    "workspaceProviders.addAccount": "Add",
    "workspaceProviders.connectProviderAccount": "Connect a {provider} account",
    "workspaceProviders.addProviderAccount": "Add another {provider} account",
    "workspaceProviders.connectedCount": "{count} connected",
    "workspaceProviders.notConnected": "Not connected",
    "workspaceProviders.leaseLimit": "Short-lived credentials up to {minutes} min",
    "workspaceProviders.providerUnavailable": "New connections are not available in this deployment.",
    "workspaceProviders.notePlanetScale":
      "Sign in with PlanetScale, then issue member-specific roles or passwords that expire.",
    "workspaceProviders.noteGcpCloudSql":
      "Sign in with Google, then choose a project and instance here. DopeDB configures role-based IAM access and rotates short-lived credentials automatically.",
    "workspaceProviders.noteNeon":
      "Use a project-scoped API key to create, expire, and revoke 15-minute roles.",
    "workspaceProviders.noteVault":
      "Use an approved Vault broker to issue and revoke member-specific database credentials that last at most 15 minutes.",

    "workspaceProviders.accountActive": "Active",
    "workspaceProviders.accountReconnectRequired": "Reconnect required",
    "workspaceProviders.accountDatabases": "Shared databases: {count}",
    "workspaceProviders.accountDatabasesUnavailable": "Shared database count unavailable",
    "workspaceProviders.accountLastChecked": "Last checked {time}",
    "workspaceProviders.accountReconnectNeeded":
      "Credentials cannot be issued until this account is reconnected.",
    "workspaceProviders.accountBroadKey":
      "This personal API key may grant account-wide access. Reconnect with a project-scoped organization key when possible.",
    "workspaceProviders.neonProjectsName": "Neon · Projects: {count}",
    "workspaceProviders.reconnectAccount": "Reconnect {name}",
    "workspaceProviders.disconnectAccount": "Disconnect {name}",
    "workspaceProviders.disconnectConfirm":
      "Databases registered through {name} return to member-local credentials, and active short-lived access is revoked. Disconnect this provider account?",
    "workspaceProviders.disconnecting": "Disconnecting…",
    "workspaceProviders.disconnectFailed": "Could not disconnect the provider account.",

    "workspaceProviders.authorizationOpening": "Opening {provider} sign-in in your browser…",
    "workspaceProviders.authorizationWaiting":
      "Finish the {provider} authorization in your browser. DopeDB continues when you return to this window.",
    "workspaceProviders.authorizationRepairWaiting":
      "Approve {provider} again in your browser to repair the managed database. DopeDB continues when you return to this window.",
    "workspaceProviders.authorizationChecking": "Checking the {provider} authorization…",
    "workspaceProviders.authorizationIncomplete":
      "The {provider} authorization is not complete yet. Finish it in the browser and check again, or start over.",
    "workspaceProviders.authorizationExpired":
      "The {provider} sign-in link expired before the authorization finished. Start again.",
    "workspaceProviders.authorizationStartFailed": "Could not start the provider sign-in.",
    "workspaceProviders.authorizationCheckFailed": "Could not check the authorization result.",
    "workspaceProviders.checkAgain": "Check again",
    "workspaceProviders.startAgain": "Start again",
    "workspaceProviders.accountConnected":
      "{provider} account connected. Add its databases under Shared databases.",
    "workspaceProviders.gcpRepaired": "Managed database access was repaired and saved.",
    "workspaceProviders.openSharedDatabases": "Open shared databases",
    "workspaceProviders.repairProviderUnavailable":
      "This database's provider is not available in this deployment, so it cannot be repaired here.",
    "workspaceProviders.gcpRepairInventoryUnavailable":
      "The managed database list could not be loaded, so the repair target is unknown. Load it again, then reconnect.",
    "workspaceProviders.gcpSetupReady":
      "A Google Cloud authorization for {account} is ready. Continue the setup before {time}.",
    "workspaceProviders.gcpSetupContinue": "Continue setup",

    "workspaceProviders.verifyConnect": "Verify and connect",
    "workspaceProviders.verifying": "Verifying…",
    "workspaceProviders.optional": "Optional",
    "workspaceProviders.fieldRequired": "Required.",
    "workspaceProviders.fieldInvalid": "Check this value.",

    "workspaceProviders.neonTitle": "Connect a Neon account",
    "workspaceProviders.neonReconnectTitle": "Reconnect a Neon account",
    "workspaceProviders.neonIntro":
      "Neon does not offer browser sign-in for third-party apps, so it connects with an API key. Use a project-scoped organization API key when possible.",
    "workspaceProviders.neonKeyStorage":
      "The workspace service verifies the key, then stores it encrypted on the server for this workspace. It is not saved on this device or with any shared database.",
    "workspaceProviders.neonGuideTitle": "Create the right Neon key",
    "workspaceProviders.neonGuideDescription":
      "Follow these Neon Console menus. A project-scoped organization key keeps the connection limited to one project.",
    "workspaceProviders.neonGuideOrganizationTitle": "Open organization settings",
    "workspaceProviders.neonGuideOrganizationPath": "Organization → Settings → API Keys",
    "workspaceProviders.neonGuideOrganizationBody":
      "Choose the organization that owns the database, then open API Keys from its settings.",
    "workspaceProviders.neonGuideKeyTitle": "Create a project-scoped key",
    "workspaceProviders.neonGuideKeyPath": "Create API key → Project-scoped",
    "workspaceProviders.neonGuideKeyBody":
      "Select the target project. Copy the token when it appears; Neon shows it only once.",
    "workspaceProviders.neonGuideProjectTitle": "Copy the project ID",
    "workspaceProviders.neonGuideProjectPath": "Project → Settings → General",
    "workspaceProviders.neonGuideProjectBody":
      "Copy the Project ID from General and paste it below with the API key.",
    "workspaceProviders.neonGuidePersonalTitle": "Personal project instead?",
    "workspaceProviders.neonGuidePersonalPath": "Profile → Account Settings → API Keys",
    "workspaceProviders.neonGuidePersonalBody":
      "Create a personal API key there. It may grant account-wide access, so use a project-scoped organization key when available.",
    "workspaceProviders.neonGuideCaution":
      "Do not paste a database password, connection string, or Neon Auth key here.",
    "workspaceProviders.neonGuideOpen": "Open the Neon guide",
    "workspaceProviders.neonApiKey": "Neon API key",
    "workspaceProviders.neonApiKeyPlaceholder": "Project-scoped API key",
    "workspaceProviders.neonApiKeyInvalid": "Enter the 20–512 character API key without spaces.",
    "workspaceProviders.neonProjectId": "Project ID · recommended",
    "workspaceProviders.neonProjectIdPlaceholder": "Example: frosty-tree-12345678",
    "workspaceProviders.neonOrganizationId": "Organization ID · personal key only",
    "workspaceProviders.neonOrganizationIdPlaceholder": "org-...",
    "workspaceProviders.neonIdentifierInvalid":
      "Use lowercase letters, digits, and hyphens, up to 60 characters.",
    "workspaceProviders.neonConnectFailed": "Could not verify and connect the Neon account.",

    "workspaceProviders.vaultTitle": "Connect a Vault broker",
    "workspaceProviders.vaultReconnectTitle": "Reconnect a Vault broker",
    "workspaceProviders.vaultReconnectTargetLocked":
      "The database target identifies this account and stays the same. Enter the broker address and a current AppRole Role ID and Secret ID.",
    "workspaceProviders.vaultIntro":
      "Connect an approved Vault Database Secrets broker. DopeDB requests one short-lived database credential per member and never copies the broker secret to this device.",
    "workspaceProviders.vaultSecretStorage":
      "The workspace service verifies the AppRole, then stores the Role ID and Secret ID encrypted on the server for this workspace. They are not saved on this device.",
    "workspaceProviders.vaultCaution":
      "The Vault origin must be pre-approved by the workspace service. Use a dedicated AppRole with a 1–15 minute service-token TTL, limited to reading the named connection and roles, issuing their credentials, and revoking leases. The read role must be enforced as read-only by the database, with a separate write role. Never paste the database password itself.",
    "workspaceProviders.vaultGuideOpen": "Open the Vault guide",
    "workspaceProviders.vaultBrokerTitle": "Vault broker",
    "workspaceProviders.vaultAddress": "Vault HTTPS origin",
    "workspaceProviders.vaultAddressPlaceholder": "https://vault.example.com",
    "workspaceProviders.vaultAddressInvalid":
      "Enter an https:// origin, for example https://vault.example.com.",
    "workspaceProviders.vaultNamespace": "Vault namespace",
    "workspaceProviders.vaultAuthMount": "AppRole auth mount",
    "workspaceProviders.vaultDatabaseMount": "Database secrets mount",
    "workspaceProviders.vaultDatabaseConnection": "Vault database connection name",
    "workspaceProviders.vaultDatabaseConnectionPlaceholder": "dopedb-postgres",
    "workspaceProviders.vaultRoleId": "AppRole Role ID",
    "workspaceProviders.vaultSecretId": "AppRole Secret ID",
    "workspaceProviders.vaultReadRole": "Read database role",
    "workspaceProviders.vaultReadRolePlaceholder": "dopedb-read",
    "workspaceProviders.vaultWriteRole": "Write database role · optional",
    "workspaceProviders.vaultTargetTitle": "Exact database target",
    "workspaceProviders.vaultTargetDescription":
      "Issued usernames and passwords may only replace credentials for this fixed, TLS-verified target. Host, port, engine, and database are rechecked before import and every lease.",
    "workspaceProviders.vaultEngine": "Engine",
    "workspaceProviders.vaultHost": "Host",
    "workspaceProviders.vaultHostPlaceholder": "db.internal.example.com",
    "workspaceProviders.vaultPort": "Port",
    "workspaceProviders.vaultPortInvalid": "Enter a port from 1 to 65535.",
    "workspaceProviders.vaultDatabase": "Database",
    "workspaceProviders.vaultProduction": "This target contains production data",
    "workspaceProviders.vaultProductionDescription":
      "Production targets need an additional explicit confirmation when the shared database is imported.",
    "workspaceProviders.vaultConnectFailed": "Could not verify and connect the Vault broker.",

    "workspaceProviders.gcpTitle": "Set up Google Cloud SQL",
    "workspaceProviders.gcpRepairTitle": "Repair managed Cloud SQL access",
    "workspaceProviders.gcpAccountDescription":
      "Authorized as {account}. Choose the Cloud SQL instance to connect.",
    "workspaceProviders.gcpRepairDescription":
      "Re-authorized as {account}. The existing managed connection is repaired without changing its target.",
    "workspaceProviders.gcpReconnectDescription":
      "The short-lived Google authorization expired. Reconnecting the account does not change the Cloud SQL instance.",
    "workspaceProviders.gcpExpiresAt": "This authorization expires at {time}.",
    "workspaceProviders.gcpStepsLabel": "Setup progress",
    "workspaceProviders.gcpStepAuthorize": "Authorize Google account",
    "workspaceProviders.gcpStepTarget": "Choose target and environment",
    "workspaceProviders.gcpStepConfigure": "Configure automatically after approval",
    "workspaceProviders.gcpStepRepair": "Repair the pinned connection after approval",
    "workspaceProviders.gcpStepComplete": "Complete",
    "workspaceProviders.gcpStepCurrent": "Current step",
    "workspaceProviders.gcpStepWaiting": "Waiting",
    "workspaceProviders.gcpExpiredTitle": "Google authorization session expired",
    "workspaceProviders.gcpExpiredDescription":
      "Reconnect to renew only the setup authorization. Cloud SQL changes still need their own approval.",
    "workspaceProviders.gcpReconnect": "Reconnect Google account",
    "workspaceProviders.gcpPinnedTitle": "Pinned existing database",
    "workspaceProviders.gcpPinnedDescription":
      "The project and instance cannot be changed during repair. DopeDB reuses this integration and rechecks every managed-access prerequisite.",
    "workspaceProviders.gcpRepairTargetUnavailable":
      "The managed Cloud SQL target could not be found. Return to Shared databases and start the repair again.",
    "workspaceProviders.gcpTargetTitle": "Connection target",
    "workspaceProviders.gcpTargetDescription":
      "Choose a project and instance to see only the changes and approvals it needs.",
    "workspaceProviders.gcpProject": "Project",
    "workspaceProviders.gcpChooseProject": "Choose a project",
    "workspaceProviders.gcpProjectsLoading": "Loading projects…",
    "workspaceProviders.gcpProjectsEmpty": "This Google account cannot see any Google Cloud project.",
    "workspaceProviders.gcpProjectsFailed": "Could not load Google Cloud projects.",
    "workspaceProviders.gcpInstance": "Cloud SQL instance",
    "workspaceProviders.gcpChooseInstance": "Choose an instance",
    "workspaceProviders.gcpInstancesLoading": "Checking instances…",
    "workspaceProviders.gcpInstancesEmpty":
      "This project has no PostgreSQL or MySQL Cloud SQL instance.",
    "workspaceProviders.gcpInstancesFailed": "Could not load Cloud SQL instances.",
    "workspaceProviders.gcpPermissionsFailed": "Could not verify Google Cloud setup permissions.",
    "workspaceProviders.gcpRunning": "Running",
    "workspaceProviders.gcpUnavailable": "Unavailable",
    "workspaceProviders.gcpProduction": "Production",
    "workspaceProviders.gcpNonProduction": "Non-production",
    "workspaceProviders.gcpPendingProduction": "Will classify as production",
    "workspaceProviders.gcpPendingDevelopment": "Will classify as non-production",
    "workspaceProviders.gcpClassificationRequired": "Environment classification required",
    "workspaceProviders.gcpNotReady": "This instance is not running, so it cannot be connected now.",
    "workspaceProviders.gcpClassificationTitle": "Add environment classification",
    "workspaceProviders.gcpClassificationDescription":
      "Existing instance labels are preserved; only the selected environment label is added. The Google account needs Cloud SQL Admin or the cloudsql.instances.update permission.",
    "workspaceProviders.gcpEnvironment": "Environment",
    "workspaceProviders.gcpChooseEnvironment": "Choose environment",
    "workspaceProviders.gcpEnvironmentProduction": "Production · environment=production",
    "workspaceProviders.gcpEnvironmentDevelopment": "Non-production · environment=development",
    "workspaceProviders.gcpSchemaTitle": "Schema access (optional)",
    "workspaceProviders.gcpSchemaDescription":
      "Create a separate login that acts as this owner in public. Existing users, object owners, and default privileges stay unchanged. Desktop verifies the role before running SQL; broader roles or unsafe defaults need a separate administrator review.",
    "workspaceProviders.gcpSchemaRepairKeepsDelegate":
      "Repair keeps the schema delegation this database already has. Enter and approve a database and owner here only to change who the schema is delegated to.",
    "workspaceProviders.gcpSchemaDatabase": "Database for schema changes",
    "workspaceProviders.gcpSchemaOwner": "Existing migration owner role",
    "workspaceProviders.gcpSchemaApproval":
      "Allow the new dedicated login to use this database owner role",
    "workspaceProviders.gcpSchemaIncomplete":
      "Fill in both fields and approve schema access, or clear them to connect without it.",
    "workspaceProviders.gcpCredentialsDescription":
      "DopeDB configures separate read-only and read/write service accounts. A PostgreSQL schema account is added only with the separate schema approval. The account matching a member's role is used only when an administrator enables that database level, and the app rotates short-lived IAM credentials automatically. Long-lived keys and Google sign-in tokens are not stored.",
    "workspaceProviders.gcpAutomaticTitle": "Applied automatically when connected",
    "workspaceProviders.gcpAutomaticLabels":
      "Preserve existing labels and add the environment classification.",
    "workspaceProviders.gcpAutomaticAccounts":
      "Create separate read-only and read/write accounts for PostgreSQL 14 or later, with instance-scoped IAM. Existing users and schema ownership are preserved.",
    "workspaceProviders.gcpAutomaticRotation":
      "Rotate short-lived credentials according to the administrator's database policy and each member's role.",
    "workspaceProviders.gcpCheckingPermissions": "Checking Google Cloud permissions",
    "workspaceProviders.gcpCheckingPermissionsDescription":
      "Safely checking the setup permissions for this project.",
    "workspaceProviders.gcpPermissionsReady": "Automatic setup permissions verified",
    "workspaceProviders.gcpPermissionsReadyDescription":
      "This account has the required setup permissions. Runtime database access is verified separately during setup.",
    "workspaceProviders.gcpRolesRequired": "Setup roles required: {count}",
    "workspaceProviders.gcpTemporaryGrant": "Temporarily grant the required roles and continue",
    "workspaceProviders.gcpTemporaryGrantDescription":
      "They are granted only to this account with a 15-minute expiry condition and removed right after the connection is set up.",
    "workspaceProviders.gcpCannotGrant":
      "This account cannot change the project IAM policy. A project administrator must grant the roles above.",
    "workspaceProviders.gcpOpenIam": "Open Google Cloud IAM",
    "workspaceProviders.gcpPurposeServiceUsage": "Enable required Google Cloud APIs",
    "workspaceProviders.gcpPurposeWorkloadIdentity":
      "Configure a keyless Workload Identity Pool and Provider",
    "workspaceProviders.gcpPurposeServiceAccount":
      "Create connection-only service accounts and IAM policies",
    "workspaceProviders.gcpPurposeProjectIam":
      "Grant least privilege scoped to one Cloud SQL instance",
    "workspaceProviders.gcpPurposeCloudSql":
      "Configure IAM database users and the PostgreSQL schema-owner policy",
    "workspaceProviders.gcpProductionApproval": "Approve production Cloud SQL connection",
    "workspaceProviders.gcpProductionApprovalDescription":
      "This selection and your approval are recorded in the workspace audit log. Write access is configured separately under Database access after connecting.",
    "workspaceProviders.gcpIamApproval": "Approve the IAM database authentication setting change",
    "workspaceProviders.gcpIamApprovalDescription":
      "Existing database flags are preserved and only the IAM authentication flag is added. Google Cloud documents this flag as not requiring an instance restart.",
    "workspaceProviders.gcpConfiguringTitle": "Automatic Google Cloud setup in progress",
    "workspaceProviders.gcpConfiguringDescription":
      "Checking required APIs, dedicated data accounts, and Cloud SQL IAM without changing existing application permissions.",
    "workspaceProviders.gcpIamPropagationTitle": "Waiting for Google Cloud permissions",
    "workspaceProviders.gcpIamPropagationDescription":
      "Google Cloud is still applying the configured permissions. Keep this screen open; setup retries automatically for up to 10 minutes while this authorization is valid. The connection is saved only after access is verified.",
    "workspaceProviders.gcpSavingTitle": "Saving the connection",
    "workspaceProviders.gcpSavingDescription":
      "The configured access is checked once more and saved to the workspace.",
    "workspaceProviders.gcpElapsed": "{seconds}s elapsed",
    "workspaceProviders.gcpFailureTitle": "Connection setup could not be completed",
    "workspaceProviders.gcpFinalDescription":
      "Review the selected target and approvals. Setup creates dedicated data accounts and preserves existing users, PUBLIC permissions, default privileges, and object ownership. Connecting does not enable schema management. Keep this screen open until setup completes.",
    "workspaceProviders.gcpRepairFinalDescription":
      "Reconnect this pinned target using dedicated data accounts. Existing application permissions, object ownership, workspace grants, and the database connection ID are preserved. Schema management requires separately verified access.",
    "workspaceProviders.gcpConfiguringButton": "Configuring Google Cloud…",
    "workspaceProviders.gcpConfigureWithGrant": "Apply temporary access, configure, and connect",
    "workspaceProviders.gcpConfigureWithClassification": "Add classification, configure, and connect",
    "workspaceProviders.gcpConfigure": "Configure and connect",
    "workspaceProviders.gcpRepairConfigure": "Repair and reconnect",
    "workspaceProviders.gcpApprovalsRequired": "Check the Cloud SQL target and required approvals.",
    "workspaceProviders.gcpBootstrapFailed": "Could not complete the automatic Google Cloud setup.",
    "workspaceProviders.gcpBootstrapShapeError": "The automatic Google Cloud setup result is invalid.",
    "workspaceProviders.gcpSaveFailed": "Could not save the Google Cloud connection.",
    "workspaceProviders.gcpSavedShapeError": "Could not verify the saved Google Cloud connection.",
    "workspaceProviders.gcpActiveLeaseWait":
      "Active short-lived database credentials: {count}. They expire by {time} (about {minutes} min from now). Keep this screen open and retry after that time.",
    "workspaceProviders.gcpActiveLeaseReconnect":
      "Active short-lived database credentials: {count}. They expire by {time} (about {minutes} min from now). The Google setup authorization expires too soon to finish safely, so reconnect the Google account after that time and retry.",

    "workspaceProviders.serverChangeInProgress":
      "Another provider access change is already in progress. Try again when it finishes.",
    "workspaceProviders.serverConcurrentChange":
      "Provider access changed at the same time. Try connecting again.",
    "workspaceProviders.serverProviderUnavailable":
      "Managed access for this provider is not available in this deployment.",
    "workspaceProviders.serverProviderUnverified": "The provider connection could not be verified.",
    "workspaceProviders.serverActiveAccessPending":
      "Active short-lived database access cannot be revoked yet. Reconnect again after it expires.",
    "workspaceProviders.serverIntegrationNotFound":
      "This provider account was already removed. The list has been refreshed.",
    "workspaceProviders.serverDisconnectCleanupPending":
      "The disconnect is not finished: active database access is still being cleaned up. Try again to resume it.",
    "workspaceProviders.serverDisconnectReconciliation":
      "The disconnect could not be confirmed yet. Try again to resume it.",
    "workspaceProviders.serverDisconnectAmbiguous":
      "The provider could not confirm the disconnect. Reconnect the account, then disconnect it again.",
    "workspaceProviders.serverNeonConfigurationInvalid":
      "The Neon API key, project ID, or organization ID is not in a valid format.",
    "workspaceProviders.serverNeonKeyInvalid":
      "The Neon API key is invalid or revoked. Create a new key in the Neon Console and connect again.",
    "workspaceProviders.serverNeonScopeDenied":
      "The Neon API key cannot access the requested scope. Check the personal key and organization ID, or the permissions of the organization or project-scoped key.",
    "workspaceProviders.serverNeonProjectsHidden":
      "Neon refused to list projects for this API key. Check that it is a project-scoped organization key, then try again with a new key.",
    "workspaceProviders.serverNeonProjectUnverified":
      "Neon could not match the project ID with this API key. Check that both were copied from the same project.",
    "workspaceProviders.serverNeonProjectNotFound":
      "The Neon project was not found, or this API key cannot access it. Check the project ID and the key's scope.",
    "workspaceProviders.serverNeonNoProject":
      "This Neon API key cannot access any project. Check the project scope and organization permissions.",
    "workspaceProviders.serverNeonRateLimited":
      "The Neon API request limit was reached. Try again shortly.",
    "workspaceProviders.serverVaultRateLimited":
      "Vault verification was retried too quickly. Wait a minute, then try again.",
    "workspaceProviders.serverVaultConfigurationInvalid":
      "The Vault AppRole configuration is invalid. Check the origin, mounts, roles, and target.",
    "workspaceProviders.serverVaultUnavailable":
      "Vault is unavailable. Check that the workspace service can reach the broker.",
    "workspaceProviders.serverVaultRejected":
      "Vault rejected the request. Check the AppRole credentials and policies.",
    "workspaceProviders.serverVaultTargetChanged":
      "Disconnect the existing Vault target before changing its broker roles or mounts.",
    "workspaceProviders.serverGcpDisabled": "Google Cloud SQL is not enabled for this deployment.",
    "workspaceProviders.serverGcpSetupExpired":
      "The Google Cloud authorization expired. Reconnect the Google account to continue.",
    "workspaceProviders.serverGcpDedicatedAccounts":
      "Each Cloud SQL instance must use its own dedicated service accounts, and these are already used by another connection.",
    "workspaceProviders.serverGcpTargetDuplicated":
      "This Cloud SQL instance is already connected more than once. Disconnect the extra account first.",
    "workspaceProviders.serverGcpAlreadyConnected":
      "These Cloud SQL service accounts or this instance are already connected.",
    "workspaceProviders.serverGcpRepairTargetChanged":
      "The managed Cloud SQL repair target changed. Start the repair again from Shared databases.",
    "workspaceProviders.serverGcpProjectChanged":
      "The Google Cloud project changed during setup. Choose the project again.",
    "workspaceProviders.serverGcpProjectUnavailable":
      "This Google account can no longer access the Google Cloud project.",
    "workspaceProviders.serverGcpSchemaTarget":
      "Specify the exact database and existing migration owner role for schema access.",
    "workspaceProviders.serverGcpSchemaApproval": "Schema access needs your explicit approval.",
    "workspaceProviders.serverGcpDiscoveryFailed": "Google Cloud resources could not be listed.",
    "workspaceProviders.serverGcpSetupFailed": "Google Cloud setup failed.",
    "workspaceProviders.serverGcpActiveAccess":
      "Active Cloud SQL database credentials are still valid. Try again after they expire.",
    "workspaceProviders.serverGcpDataAccountRoles":
      "The dedicated Cloud SQL data account does not have the expected roles. Existing roles were preserved; an administrator must review this account separately.",
    "workspaceProviders.serverGcpUnexpectedUser":
      "Cloud SQL returned a different database user. Existing access was preserved.",
    "workspaceProviders.serverGcpRoleConflict":
      "The setup account's database role already exists outside Cloud SQL user management. A database administrator must resolve the conflicting role before reconnecting.",
    "workspaceProviders.serverGcpRuntimeDenied":
      "Google Cloud runtime access is still denied after setup. Retry shortly; if this persists, check the Workload Identity and service-account IAM policies.",
    "workspaceProviders.serverGcpPermissionsRequired":
      "Check the permissions required for automatic Google Cloud setup.",
    "workspaceProviders.serverGcpTemporaryGrantCleanup":
      "The temporary Google Cloud setup permissions could not be removed immediately. They expire automatically in 15 minutes.",
    "workspaceProviders.serverGcpLegacyIntegration":
      "This Cloud SQL account connection predates the fixed database inventory. Reconnect it under Connect accounts.",
    "workspaceProviders.serverGcpAuthorizationExpired":
      "The Google Cloud authorization expired. Reconnect the account.",
    "workspaceProviders.serverGcpScopeMissing":
      "The Google authorization does not include cloud-platform access. Reconnect the account and approve Google Cloud access.",
    "workspaceProviders.serverGcpQuotaApiDisabled":
      "A required Google Cloud API is disabled in the quota project.",
    "workspaceProviders.serverGcpApiDisabledInProject":
      "Google Cloud API {service} is disabled in quota project {project}.",
    "workspaceProviders.serverGcpApiDisabled":
      "Google Cloud API {service} is disabled in the quota project.",
    "workspaceProviders.serverGcpOrganizationPolicy":
      "A Google Cloud organization policy blocked this setup step.",
    "workspaceProviders.serverGcpServiceUsageRequired":
      "Required APIs cannot be enabled. Service Usage Admin is required.",
    "workspaceProviders.serverGcpTemporaryCredential":
      "Temporary service account credentials could not be issued.",
    "workspaceProviders.serverGcpWorkloadIdentityRequired":
      "Workload Identity could not be configured. Workload Identity Pool Admin is required.",
    "workspaceProviders.serverGcpServiceAccountRequired":
      "Service accounts could not be configured. Service Account Admin is required.",
    "workspaceProviders.serverGcpProjectIamRequired":
      "The project IAM policy could not be changed. Project IAM Admin is required.",
    "workspaceProviders.serverGcpCloudSqlAdminRequired":
      "Cloud SQL settings could not be changed. Cloud SQL Admin is required.",
    "workspaceProviders.serverGcpRejected": "Google Cloud rejected this setup step.",
    "workspaceProviders.serverGcpResourceNotFound": "The selected Google Cloud resource was not found.",
    "workspaceProviders.serverGcpResourceConflict":
      "An existing Google Cloud resource conflicts with this DopeDB setup.",
    "workspaceProviders.serverGcpRateLimited":
      "The Google Cloud request limit was reached. Try again shortly.",
    "workspaceProviders.serverGcpSetupIncomplete": "Google Cloud setup could not be completed.",
    "workspaceProviders.serverGcpIamPropagation":
      "The new Google Cloud service account has not reached IAM yet. Try again shortly.",
    "workspaceProviders.serverGcpIamAdminApproval":
      "A Google Cloud project IAM administrator must grant the missing setup roles.",
    "workspaceProviders.serverGcpTemporaryGrantTimeout":
      "The temporary Google Cloud setup permissions did not become active in time.",
    "workspaceProviders.serverGcpCloudSqlPropagation":
      "The new Google Cloud service account has not reached Cloud SQL yet. Try again shortly.",
    "workspaceProviders.serverGcpRecoveryStateSave":
      "Could not save the Cloud SQL permission recovery state. Try again shortly.",
  },
  {
    "workspaceProviders.description": "공급자 계정을 연결하고 워크스페이스의 관리형 데이터베이스를 등록합니다.",
    "workspaceProviders.views": "공급자 작업",
    "workspaceProviders.viewAccounts": "계정 연결",
    "workspaceProviders.viewDatabases": "공유 데이터베이스",

    "workspaceProviders.accountsTitle": "공급자 계정",
    "workspaceProviders.accountsDescription":
      "데이터베이스가 있는 공급자를 고르고 계정을 연결하세요. 워크스페이스는 이 계정으로 DB를 찾고 단기 자격 증명을 발급하며, 장기 DB 비밀번호는 저장하지 않습니다.",
    "workspaceProviders.loadFailed": "공급자 계정을 불러오지 못했습니다.",
    "workspaceProviders.unavailable": "이 배포 환경에서 사용할 수 있는 관리형 공급자가 없습니다.",
    "workspaceProviders.inventoryFailed":
      "공유 DB 수를 불러오지 못했습니다. 계정 목록은 그대로 표시됩니다.",
    "workspaceProviders.connect": "연결",
    "workspaceProviders.addAccount": "추가",
    "workspaceProviders.connectProviderAccount": "{provider} 계정 연결",
    "workspaceProviders.addProviderAccount": "다른 {provider} 계정 추가",
    "workspaceProviders.connectedCount": "{count}개 연결됨",
    "workspaceProviders.notConnected": "연결 안 됨",
    "workspaceProviders.leaseLimit": "단기 자격 증명 최대 {minutes}분",
    "workspaceProviders.providerUnavailable": "이 배포 환경에서는 새로 연결할 수 없습니다.",
    "workspaceProviders.notePlanetScale":
      "PlanetScale에 로그인한 뒤 구성원별로 만료되는 역할이나 비밀번호를 발급합니다.",
    "workspaceProviders.noteGcpCloudSql":
      "Google에 로그인한 뒤 이 화면에서 프로젝트와 인스턴스를 고르면 역할 기반 IAM 접근과 단기 자격 증명 회전을 자동으로 구성합니다.",
    "workspaceProviders.noteNeon":
      "프로젝트 범위 API 키로 15분 제한 역할을 만들고 만료·회수합니다.",
    "workspaceProviders.noteVault":
      "승인된 Vault 브로커로 구성원별 DB 자격 증명을 최대 15분 동안 발급하고 회수합니다.",

    "workspaceProviders.accountActive": "정상",
    "workspaceProviders.accountReconnectRequired": "재연결 필요",
    "workspaceProviders.accountDatabases": "공유 DB {count}개",
    "workspaceProviders.accountDatabasesUnavailable": "공유 DB 수를 확인할 수 없음",
    "workspaceProviders.accountLastChecked": "마지막 확인 {time}",
    "workspaceProviders.accountReconnectNeeded":
      "이 계정을 다시 연결해야 자격 증명을 발급할 수 있습니다.",
    "workspaceProviders.accountBroadKey":
      "개인 API 키는 계정 전체 권한을 가질 수 있습니다. 가능하면 프로젝트 범위 조직 키로 다시 연결하세요.",
    "workspaceProviders.neonProjectsName": "Neon · 프로젝트 {count}개",
    "workspaceProviders.reconnectAccount": "{name} 다시 연결",
    "workspaceProviders.disconnectAccount": "{name} 연결 해제",
    "workspaceProviders.disconnectConfirm":
      "이 계정으로 등록한 DB는 구성원별 자격 증명 방식으로 돌아가고 사용 중인 단기 접근은 회수됩니다. {name} 연결을 해제할까요?",
    "workspaceProviders.disconnecting": "연결 해제 중…",
    "workspaceProviders.disconnectFailed": "공급자 계정 연결을 해제하지 못했습니다.",

    "workspaceProviders.authorizationOpening": "브라우저에서 {provider} 로그인을 여는 중…",
    "workspaceProviders.authorizationWaiting":
      "브라우저에서 {provider} 승인을 마치세요. 이 창으로 돌아오면 DopeDB가 이어서 진행합니다.",
    "workspaceProviders.authorizationRepairWaiting":
      "관리형 DB를 복구하려면 브라우저에서 {provider} 승인을 다시 진행하세요. 이 창으로 돌아오면 DopeDB가 이어서 진행합니다.",
    "workspaceProviders.authorizationChecking": "{provider} 승인 결과를 확인하는 중…",
    "workspaceProviders.authorizationIncomplete":
      "{provider} 승인이 아직 완료되지 않았습니다. 브라우저에서 마친 뒤 다시 확인하거나 처음부터 다시 시작하세요.",
    "workspaceProviders.authorizationExpired":
      "승인이 끝나기 전에 {provider} 로그인 링크가 만료되었습니다. 다시 시작하세요.",
    "workspaceProviders.authorizationStartFailed": "공급자 로그인을 시작하지 못했습니다.",
    "workspaceProviders.authorizationCheckFailed": "승인 결과를 확인하지 못했습니다.",
    "workspaceProviders.checkAgain": "다시 확인",
    "workspaceProviders.startAgain": "다시 시작",
    "workspaceProviders.accountConnected":
      "{provider} 계정을 연결했습니다. 공유 데이터베이스에서 DB를 추가하세요.",
    "workspaceProviders.gcpRepaired": "관리형 DB 접근을 복구하고 저장했습니다.",
    "workspaceProviders.openSharedDatabases": "공유 데이터베이스 열기",
    "workspaceProviders.repairProviderUnavailable":
      "이 DB의 공급자를 이 배포 환경에서 사용할 수 없어 여기서 복구할 수 없습니다.",
    "workspaceProviders.gcpRepairInventoryUnavailable":
      "관리형 DB 목록을 불러오지 못해 복구 대상을 알 수 없습니다. 목록을 다시 불러온 뒤 다시 연결하세요.",
    "workspaceProviders.gcpSetupReady":
      "{account}의 Google Cloud 승인이 준비되었습니다. {time} 전에 설정을 이어서 진행하세요.",
    "workspaceProviders.gcpSetupContinue": "설정 계속",

    "workspaceProviders.verifyConnect": "검증 후 연결",
    "workspaceProviders.verifying": "검증 중…",
    "workspaceProviders.optional": "선택 사항",
    "workspaceProviders.fieldRequired": "필수 항목입니다.",
    "workspaceProviders.fieldInvalid": "값을 확인하세요.",

    "workspaceProviders.neonTitle": "Neon 계정 연결",
    "workspaceProviders.neonReconnectTitle": "Neon 계정 다시 연결",
    "workspaceProviders.neonIntro":
      "Neon은 제3자 앱용 브라우저 로그인을 제공하지 않아 API 키로 연결합니다. 가능하면 프로젝트 범위 조직 API 키를 사용하세요.",
    "workspaceProviders.neonKeyStorage":
      "워크스페이스 서비스가 키를 검증한 뒤 이 워크스페이스용으로 서버에 암호화해 보관합니다. 이 기기나 공유 DB에는 저장하지 않습니다.",
    "workspaceProviders.neonGuideTitle": "올바른 Neon 키 만들기",
    "workspaceProviders.neonGuideDescription":
      "아래 Neon Console 메뉴를 순서대로 따라가세요. 프로젝트 범위 조직 키는 연결 권한을 한 프로젝트로 제한합니다.",
    "workspaceProviders.neonGuideOrganizationTitle": "조직 설정 열기",
    "workspaceProviders.neonGuideOrganizationPath": "Organization → Settings → API Keys",
    "workspaceProviders.neonGuideOrganizationBody":
      "DB를 소유한 조직을 선택하고 조직 설정에서 API Keys를 여세요.",
    "workspaceProviders.neonGuideKeyTitle": "프로젝트 범위 키 만들기",
    "workspaceProviders.neonGuideKeyPath": "Create API key → Project-scoped",
    "workspaceProviders.neonGuideKeyBody":
      "대상 프로젝트를 선택하세요. 토큰은 한 번만 표시되므로 바로 복사하세요.",
    "workspaceProviders.neonGuideProjectTitle": "프로젝트 ID 복사",
    "workspaceProviders.neonGuideProjectPath": "Project → Settings → General",
    "workspaceProviders.neonGuideProjectBody":
      "General 화면의 Project ID를 복사해 API 키와 함께 아래에 붙여 넣으세요.",
    "workspaceProviders.neonGuidePersonalTitle": "개인 프로젝트인가요?",
    "workspaceProviders.neonGuidePersonalPath": "Profile → Account Settings → API Keys",
    "workspaceProviders.neonGuidePersonalBody":
      "이 메뉴에서 개인 API 키를 만들 수 있습니다. 계정 전체 권한을 가질 수 있으므로 가능하면 프로젝트 범위 조직 키를 사용하세요.",
    "workspaceProviders.neonGuideCaution":
      "DB 비밀번호, 연결 문자열, Neon Auth 키를 이곳에 붙여 넣지 마세요.",
    "workspaceProviders.neonGuideOpen": "Neon 공식 가이드 열기",
    "workspaceProviders.neonApiKey": "Neon API 키",
    "workspaceProviders.neonApiKeyPlaceholder": "프로젝트 범위 API 키",
    "workspaceProviders.neonApiKeyInvalid": "공백 없이 20~512자의 API 키를 입력하세요.",
    "workspaceProviders.neonProjectId": "프로젝트 ID · 권장",
    "workspaceProviders.neonProjectIdPlaceholder": "예: frosty-tree-12345678",
    "workspaceProviders.neonOrganizationId": "조직 ID · 개인 키만",
    "workspaceProviders.neonOrganizationIdPlaceholder": "org-...",
    "workspaceProviders.neonIdentifierInvalid":
      "소문자, 숫자, 하이픈만 사용해 60자 이내로 입력하세요.",
    "workspaceProviders.neonConnectFailed": "Neon 계정을 검증하고 연결하지 못했습니다.",

    "workspaceProviders.vaultTitle": "Vault 브로커 연결",
    "workspaceProviders.vaultReconnectTitle": "Vault 브로커 다시 연결",
    "workspaceProviders.vaultReconnectTargetLocked":
      "DB 대상은 이 계정을 식별하므로 그대로 유지됩니다. 브로커 주소와 현재 AppRole Role ID, Secret ID를 입력하세요.",
    "workspaceProviders.vaultIntro":
      "승인된 Vault Database Secrets 브로커를 연결합니다. DopeDB는 구성원마다 단기 DB 자격 증명을 요청하며 브로커 비밀값을 이 기기로 복사하지 않습니다.",
    "workspaceProviders.vaultSecretStorage":
      "워크스페이스 서비스가 AppRole을 검증한 뒤 Role ID와 Secret ID를 이 워크스페이스용으로 서버에 암호화해 보관합니다. 이 기기에는 저장하지 않습니다.",
    "workspaceProviders.vaultCaution":
      "Vault 주소는 워크스페이스 서비스에서 미리 허용되어야 합니다. AppRole은 1~15분 service token과 지정한 연결·역할 조회, 자격 증명 발급, lease 회수 권한만 가진 전용 역할로 만들고, 읽기 역할은 DB 자체에서 읽기 전용으로 강제하며 쓰기 역할과 분리하세요. 실제 DB 비밀번호는 입력하지 마세요.",
    "workspaceProviders.vaultGuideOpen": "Vault 공식 가이드 열기",
    "workspaceProviders.vaultBrokerTitle": "Vault 브로커",
    "workspaceProviders.vaultAddress": "Vault HTTPS 주소",
    "workspaceProviders.vaultAddressPlaceholder": "https://vault.example.com",
    "workspaceProviders.vaultAddressInvalid":
      "https://vault.example.com처럼 https:// 주소를 입력하세요.",
    "workspaceProviders.vaultNamespace": "Vault 네임스페이스",
    "workspaceProviders.vaultAuthMount": "AppRole 인증 마운트",
    "workspaceProviders.vaultDatabaseMount": "Database Secrets 마운트",
    "workspaceProviders.vaultDatabaseConnection": "Vault DB 연결 이름",
    "workspaceProviders.vaultDatabaseConnectionPlaceholder": "dopedb-postgres",
    "workspaceProviders.vaultRoleId": "AppRole Role ID",
    "workspaceProviders.vaultSecretId": "AppRole Secret ID",
    "workspaceProviders.vaultReadRole": "읽기 DB 역할",
    "workspaceProviders.vaultReadRolePlaceholder": "dopedb-read",
    "workspaceProviders.vaultWriteRole": "쓰기 DB 역할 · 선택",
    "workspaceProviders.vaultTargetTitle": "정확한 DB 대상",
    "workspaceProviders.vaultTargetDescription":
      "발급된 사용자명과 비밀번호는 이 TLS 검증 대상의 자격 증명만 대체합니다. 가져오기와 매 lease 발급 시 호스트·포트·엔진·DB를 다시 확인합니다.",
    "workspaceProviders.vaultEngine": "엔진",
    "workspaceProviders.vaultHost": "호스트",
    "workspaceProviders.vaultHostPlaceholder": "db.internal.example.com",
    "workspaceProviders.vaultPort": "포트",
    "workspaceProviders.vaultPortInvalid": "1~65535 사이의 포트를 입력하세요.",
    "workspaceProviders.vaultDatabase": "데이터베이스",
    "workspaceProviders.vaultProduction": "이 대상은 운영 데이터를 포함합니다",
    "workspaceProviders.vaultProductionDescription":
      "운영 대상은 공유 DB로 가져올 때 별도의 명시적 확인이 필요합니다.",
    "workspaceProviders.vaultConnectFailed": "Vault 브로커를 검증하고 연결하지 못했습니다.",

    "workspaceProviders.gcpTitle": "Google Cloud SQL 연결 설정",
    "workspaceProviders.gcpRepairTitle": "관리형 Cloud SQL 접근 복구",
    "workspaceProviders.gcpAccountDescription":
      "{account} 계정으로 승인했습니다. 연결할 Cloud SQL 인스턴스를 선택하세요.",
    "workspaceProviders.gcpRepairDescription":
      "{account} 계정으로 다시 승인했습니다. 기존 관리형 연결의 대상을 바꾸지 않고 복구합니다.",
    "workspaceProviders.gcpReconnectDescription":
      "단기 Google 승인이 만료되었습니다. 계정을 다시 연결해도 Cloud SQL 인스턴스 설정은 바뀌지 않습니다.",
    "workspaceProviders.gcpExpiresAt": "이 승인은 {time}에 만료됩니다.",
    "workspaceProviders.gcpStepsLabel": "설정 단계",
    "workspaceProviders.gcpStepAuthorize": "Google 계정 승인",
    "workspaceProviders.gcpStepTarget": "대상과 환경 선택",
    "workspaceProviders.gcpStepConfigure": "승인 후 자동 구성",
    "workspaceProviders.gcpStepRepair": "승인 후 고정된 연결 복구",
    "workspaceProviders.gcpStepComplete": "완료",
    "workspaceProviders.gcpStepCurrent": "현재 단계",
    "workspaceProviders.gcpStepWaiting": "대기",
    "workspaceProviders.gcpExpiredTitle": "Google 승인 세션이 만료되었습니다",
    "workspaceProviders.gcpExpiredDescription":
      "다시 연결하면 설정 승인만 갱신됩니다. Cloud SQL 설정 변경은 여전히 각각 승인이 필요합니다.",
    "workspaceProviders.gcpReconnect": "Google 계정 다시 연결",
    "workspaceProviders.gcpPinnedTitle": "고정된 기존 DB",
    "workspaceProviders.gcpPinnedDescription":
      "복구 중에는 프로젝트와 인스턴스를 바꿀 수 없습니다. 기존 연동을 재사용하고 관리형 접근의 모든 필수 조건을 다시 확인합니다.",
    "workspaceProviders.gcpRepairTargetUnavailable":
      "복구할 관리형 Cloud SQL 대상을 찾지 못했습니다. 공유 데이터베이스에서 복구를 다시 시작하세요.",
    "workspaceProviders.gcpTargetTitle": "연결 대상",
    "workspaceProviders.gcpTargetDescription":
      "프로젝트와 인스턴스를 고르면 필요한 변경과 승인 항목만 표시합니다.",
    "workspaceProviders.gcpProject": "프로젝트",
    "workspaceProviders.gcpChooseProject": "프로젝트 선택",
    "workspaceProviders.gcpProjectsLoading": "프로젝트를 불러오는 중…",
    "workspaceProviders.gcpProjectsEmpty": "이 Google 계정으로 볼 수 있는 Google Cloud 프로젝트가 없습니다.",
    "workspaceProviders.gcpProjectsFailed": "Google Cloud 프로젝트를 불러오지 못했습니다.",
    "workspaceProviders.gcpInstance": "Cloud SQL 인스턴스",
    "workspaceProviders.gcpChooseInstance": "인스턴스 선택",
    "workspaceProviders.gcpInstancesLoading": "인스턴스 확인 중…",
    "workspaceProviders.gcpInstancesEmpty":
      "이 프로젝트에는 PostgreSQL 또는 MySQL Cloud SQL 인스턴스가 없습니다.",
    "workspaceProviders.gcpInstancesFailed": "Cloud SQL 인스턴스를 불러오지 못했습니다.",
    "workspaceProviders.gcpPermissionsFailed": "Google Cloud 설정 권한을 확인하지 못했습니다.",
    "workspaceProviders.gcpRunning": "실행 중",
    "workspaceProviders.gcpUnavailable": "연결할 수 없음",
    "workspaceProviders.gcpProduction": "운영",
    "workspaceProviders.gcpNonProduction": "비운영",
    "workspaceProviders.gcpPendingProduction": "운영 분류 예정",
    "workspaceProviders.gcpPendingDevelopment": "비운영 분류 예정",
    "workspaceProviders.gcpClassificationRequired": "환경 분류 필요",
    "workspaceProviders.gcpNotReady": "이 인스턴스가 실행 중이 아니어서 지금은 연결할 수 없습니다.",
    "workspaceProviders.gcpClassificationTitle": "환경 분류 추가",
    "workspaceProviders.gcpClassificationDescription":
      "기존 인스턴스 라벨은 보존하고 선택한 environment 라벨만 추가합니다. Google 계정에 Cloud SQL Admin 또는 cloudsql.instances.update 권한이 필요합니다.",
    "workspaceProviders.gcpEnvironment": "환경",
    "workspaceProviders.gcpChooseEnvironment": "환경 선택",
    "workspaceProviders.gcpEnvironmentProduction": "운영 · environment=production",
    "workspaceProviders.gcpEnvironmentDevelopment": "비운영 · environment=development",
    "workspaceProviders.gcpSchemaTitle": "스키마 변경 접근 (선택)",
    "workspaceProviders.gcpSchemaDescription":
      "public에서 이 소유자 역할로 실행하는 별도 로그인을 만듭니다. 기존 사용자·객체 소유권·기본 권한은 유지합니다. Desktop이 SQL 실행 전에 역할을 검증하며, 권한이 너무 넓거나 기본 권한이 안전하지 않으면 DB 관리자의 별도 검토가 필요합니다.",
    "workspaceProviders.gcpSchemaRepairKeepsDelegate":
      "복구는 이 데이터베이스에 이미 있는 스키마 위임을 그대로 유지합니다. 위임 대상을 바꿀 때만 여기에 데이터베이스와 소유자를 입력하고 승인하세요.",
    "workspaceProviders.gcpSchemaDatabase": "스키마를 변경할 DB",
    "workspaceProviders.gcpSchemaOwner": "기존 마이그레이션 소유자 역할",
    "workspaceProviders.gcpSchemaApproval": "새 전용 로그인에 이 DB 소유자 역할 사용을 허용합니다",
    "workspaceProviders.gcpSchemaIncomplete":
      "두 항목을 입력하고 스키마 접근을 승인하거나, 비워 두고 스키마 접근 없이 연결하세요.",
    "workspaceProviders.gcpCredentialsDescription":
      "읽기·쓰기 전용 서비스 계정을 구성하며, 별도 스키마 승인 시에만 PostgreSQL 스키마 계정을 추가합니다. 관리자가 DB별 단계를 허용한 경우에만 구성원 역할에 맞는 계정을 사용하며, 단기 IAM 자격 증명은 앱이 자동 회전합니다. 장기 키와 Google 로그인 토큰은 저장하지 않습니다.",
    "workspaceProviders.gcpAutomaticTitle": "연결 시 자동으로 적용",
    "workspaceProviders.gcpAutomaticLabels": "기존 라벨을 보존하고 환경 분류를 추가합니다.",
    "workspaceProviders.gcpAutomaticAccounts":
      "PostgreSQL 14 이상에서 읽기·쓰기 전용 계정과 인스턴스 범위 IAM을 구성합니다. 기존 사용자와 스키마 소유권은 보존합니다.",
    "workspaceProviders.gcpAutomaticRotation":
      "관리자 DB 정책과 구성원 역할에 맞춰 단기 자격 증명을 자동 회전합니다.",
    "workspaceProviders.gcpCheckingPermissions": "Google Cloud 권한 확인 중",
    "workspaceProviders.gcpCheckingPermissionsDescription":
      "프로젝트의 설정 권한을 안전하게 확인하고 있습니다.",
    "workspaceProviders.gcpPermissionsReady": "자동 구성 권한 확인됨",
    "workspaceProviders.gcpPermissionsReadyDescription":
      "현재 계정에 자동 설정 권한이 있습니다. 실제 DB 접근 권한은 구성 과정에서 별도로 확인합니다.",
    "workspaceProviders.gcpRolesRequired": "설정 역할 {count}개 필요",
    "workspaceProviders.gcpTemporaryGrant": "필요한 역할을 임시 부여하고 계속",
    "workspaceProviders.gcpTemporaryGrantDescription":
      "이 계정에만 15분 만료 조건으로 부여하고, 연결 설정이 끝나면 즉시 제거합니다.",
    "workspaceProviders.gcpCannotGrant":
      "현재 계정은 프로젝트 IAM 정책을 변경할 수 없습니다. 프로젝트 관리자가 위 역할을 부여해야 합니다.",
    "workspaceProviders.gcpOpenIam": "Google Cloud IAM 열기",
    "workspaceProviders.gcpPurposeServiceUsage": "필수 Google Cloud API 활성화",
    "workspaceProviders.gcpPurposeWorkloadIdentity":
      "키 없이 연결할 Workload Identity Pool과 Provider 구성",
    "workspaceProviders.gcpPurposeServiceAccount": "연결 전용 서비스 계정 생성과 IAM 정책 구성",
    "workspaceProviders.gcpPurposeProjectIam": "Cloud SQL 인스턴스 범위의 최소 권한 부여",
    "workspaceProviders.gcpPurposeCloudSql": "IAM DB 사용자와 PostgreSQL 스키마 소유자 정책 구성",
    "workspaceProviders.gcpProductionApproval": "운영 Cloud SQL 연결 승인",
    "workspaceProviders.gcpProductionApprovalDescription":
      "이 선택과 관리자의 승인은 워크스페이스 감사 기록에 남습니다. 쓰기 허용 여부는 연결 후 DB 접근 권한에서 별도로 정합니다.",
    "workspaceProviders.gcpIamApproval": "IAM DB 인증 설정 변경 승인",
    "workspaceProviders.gcpIamApprovalDescription":
      "기존 database flag를 보존하고 IAM 인증 flag만 추가합니다. Google Cloud 기준 이 flag는 인스턴스 재시작이 필요하지 않습니다.",
    "workspaceProviders.gcpConfiguringTitle": "Google Cloud 자동 구성 진행 중",
    "workspaceProviders.gcpConfiguringDescription":
      "기존 애플리케이션 권한을 바꾸지 않고 필수 API, 전용 데이터 계정과 Cloud SQL IAM을 확인하고 있습니다.",
    "workspaceProviders.gcpIamPropagationTitle": "Google Cloud 권한 반영 대기 중",
    "workspaceProviders.gcpIamPropagationDescription":
      "Google Cloud에서 설정한 권한을 반영하고 있습니다. 이 화면을 유지하면 현재 승인이 유효한 동안 최대 10분간 자동으로 다시 시도합니다. 실제 접근이 확인된 뒤에만 연결을 저장합니다.",
    "workspaceProviders.gcpSavingTitle": "연결을 저장하는 중",
    "workspaceProviders.gcpSavingDescription":
      "구성한 접근을 한 번 더 확인하고 워크스페이스에 저장하고 있습니다.",
    "workspaceProviders.gcpElapsed": "{seconds}초 경과",
    "workspaceProviders.gcpFailureTitle": "연결 설정을 완료하지 못했습니다",
    "workspaceProviders.gcpFinalDescription":
      "선택한 대상과 승인 항목을 확인하세요. 전용 데이터 계정을 생성하며 기존 사용자, PUBLIC 권한, 기본 권한과 객체 소유권은 보존합니다. 연결만으로 스키마 관리 권한을 활성화하지 않습니다. 설정이 끝날 때까지 이 화면을 유지하세요.",
    "workspaceProviders.gcpRepairFinalDescription":
      "고정된 대상에 전용 데이터 계정으로 다시 연결합니다. 기존 애플리케이션 권한, 객체 소유권, 워크스페이스 구성원 권한과 DB 연결 ID는 보존합니다. 스키마 관리는 별도로 검증된 접근 권한이 필요합니다.",
    "workspaceProviders.gcpConfiguringButton": "Google Cloud 구성 중…",
    "workspaceProviders.gcpConfigureWithGrant": "임시 권한 적용 후 자동 설정하고 연결",
    "workspaceProviders.gcpConfigureWithClassification": "환경 분류 추가 후 자동 설정하고 연결",
    "workspaceProviders.gcpConfigure": "자동 설정하고 연결",
    "workspaceProviders.gcpRepairConfigure": "복구하고 다시 연결",
    "workspaceProviders.gcpApprovalsRequired": "Cloud SQL 대상과 필요한 승인을 확인하세요.",
    "workspaceProviders.gcpBootstrapFailed": "Google Cloud 자동 설정을 완료하지 못했습니다.",
    "workspaceProviders.gcpBootstrapShapeError": "Google Cloud 자동 설정 결과를 확인하지 못했습니다.",
    "workspaceProviders.gcpSaveFailed": "Google Cloud 연결을 저장하지 못했습니다.",
    "workspaceProviders.gcpSavedShapeError": "저장된 Google Cloud 연결을 확인하지 못했습니다.",
    "workspaceProviders.gcpActiveLeaseWait":
      "사용 중인 단기 DB 자격 증명: {count}개. 약 {minutes}분 뒤인 {time}까지 모두 만료됩니다. 이 화면을 유지하고 해당 시각 이후 다시 시도하세요.",
    "workspaceProviders.gcpActiveLeaseReconnect":
      "사용 중인 단기 DB 자격 증명: {count}개. 약 {minutes}분 뒤인 {time}까지 모두 만료됩니다. Google 설정 승인이 그보다 먼저 만료되므로, 해당 시각 이후 Google 계정을 다시 연결해 시도하세요.",

    "workspaceProviders.serverChangeInProgress":
      "다른 공급자 접근 변경이 진행 중입니다. 끝난 뒤 다시 시도하세요.",
    "workspaceProviders.serverConcurrentChange":
      "공급자 접근이 동시에 변경되었습니다. 다시 연결해 보세요.",
    "workspaceProviders.serverProviderUnavailable":
      "이 배포 환경에서는 이 공급자의 관리형 접근을 사용할 수 없습니다.",
    "workspaceProviders.serverProviderUnverified": "공급자 연결을 확인하지 못했습니다.",
    "workspaceProviders.serverActiveAccessPending":
      "현재 사용 중인 단기 DB 자격 증명은 즉시 폐기할 수 없습니다. 만료된 뒤 다시 연결하세요.",
    "workspaceProviders.serverIntegrationNotFound":
      "이 공급자 계정은 이미 제거되었습니다. 목록을 새로 고쳤습니다.",
    "workspaceProviders.serverDisconnectCleanupPending":
      "연결 해제가 아직 끝나지 않았습니다. 사용 중인 DB 접근을 정리하고 있으니 다시 시도해 이어서 진행하세요.",
    "workspaceProviders.serverDisconnectReconciliation":
      "연결 해제를 아직 확인하지 못했습니다. 다시 시도해 이어서 진행하세요.",
    "workspaceProviders.serverDisconnectAmbiguous":
      "공급자가 연결 해제를 확인하지 못했습니다. 계정을 다시 연결한 뒤 연결을 다시 해제하세요.",
    "workspaceProviders.serverNeonConfigurationInvalid":
      "Neon API 키, 프로젝트 ID 또는 조직 ID 형식이 올바르지 않습니다.",
    "workspaceProviders.serverNeonKeyInvalid":
      "Neon API 키가 유효하지 않거나 폐기되었습니다. Neon Console에서 새 키를 발급해 다시 연결하세요.",
    "workspaceProviders.serverNeonScopeDenied":
      "Neon API 키로 요청한 범위에 접근할 수 없습니다. 개인 키와 조직 ID 또는 조직·프로젝트 범위 키의 권한을 확인하세요.",
    "workspaceProviders.serverNeonProjectsHidden":
      "Neon이 이 API 키의 프로젝트 목록 요청을 거부했습니다. 키가 프로젝트 범위 조직 키인지 확인하고 새 키로 다시 시도하세요.",
    "workspaceProviders.serverNeonProjectUnverified":
      "Neon이 입력한 프로젝트와 API 키의 범위를 확인하지 못했습니다. 프로젝트 ID와 키를 같은 프로젝트에서 복사했는지 확인하세요.",
    "workspaceProviders.serverNeonProjectNotFound":
      "Neon 프로젝트를 찾을 수 없거나 이 API 키로 접근할 수 없습니다. 프로젝트 ID와 키 범위를 확인하세요.",
    "workspaceProviders.serverNeonNoProject":
      "Neon API 키로 접근 가능한 프로젝트가 없습니다. 프로젝트 범위와 조직 권한을 확인하세요.",
    "workspaceProviders.serverNeonRateLimited":
      "Neon API 요청 한도에 도달했습니다. 잠시 뒤 다시 시도하세요.",
    "workspaceProviders.serverVaultRateLimited":
      "Vault 검증을 너무 자주 시도했습니다. 1분 뒤 다시 시도하세요.",
    "workspaceProviders.serverVaultConfigurationInvalid":
      "Vault AppRole 설정이 올바르지 않습니다. 주소, 마운트, 역할과 대상을 확인하세요.",
    "workspaceProviders.serverVaultUnavailable":
      "Vault에 연결할 수 없습니다. 워크스페이스 서비스가 브로커에 접근할 수 있는지 확인하세요.",
    "workspaceProviders.serverVaultRejected":
      "Vault가 요청을 거부했습니다. AppRole 자격 증명과 정책을 확인하세요.",
    "workspaceProviders.serverVaultTargetChanged":
      "브로커 역할이나 마운트를 바꾸려면 기존 Vault 대상의 연결을 먼저 해제하세요.",
    "workspaceProviders.serverGcpDisabled": "이 배포 환경에서는 Google Cloud SQL을 사용할 수 없습니다.",
    "workspaceProviders.serverGcpSetupExpired":
      "Google Cloud 승인이 만료되었습니다. Google 계정을 다시 연결해 계속하세요.",
    "workspaceProviders.serverGcpDedicatedAccounts":
      "Cloud SQL 인스턴스마다 전용 서비스 계정을 사용해야 하는데, 이 계정은 이미 다른 연결에서 사용 중입니다.",
    "workspaceProviders.serverGcpTargetDuplicated":
      "이 Cloud SQL 인스턴스가 이미 두 번 이상 연결되어 있습니다. 중복된 계정의 연결을 먼저 해제하세요.",
    "workspaceProviders.serverGcpAlreadyConnected":
      "이 Cloud SQL 서비스 계정 또는 인스턴스는 이미 연결되어 있습니다.",
    "workspaceProviders.serverGcpRepairTargetChanged":
      "복구할 관리형 Cloud SQL 대상이 바뀌었습니다. 공유 데이터베이스에서 복구를 다시 시작하세요.",
    "workspaceProviders.serverGcpProjectChanged":
      "설정 중에 Google Cloud 프로젝트 정보가 바뀌었습니다. 프로젝트를 다시 선택하세요.",
    "workspaceProviders.serverGcpProjectUnavailable":
      "이 Google 계정으로 더 이상 Google Cloud 프로젝트에 접근할 수 없습니다.",
    "workspaceProviders.serverGcpSchemaTarget":
      "스키마 접근에 사용할 DB와 기존 마이그레이션 소유자 역할을 정확히 입력하세요.",
    "workspaceProviders.serverGcpSchemaApproval": "스키마 접근을 사용하려면 명시적으로 승인해야 합니다.",
    "workspaceProviders.serverGcpDiscoveryFailed": "Google Cloud 리소스를 조회하지 못했습니다.",
    "workspaceProviders.serverGcpSetupFailed": "Google Cloud 설정에 실패했습니다.",
    "workspaceProviders.serverGcpActiveAccess":
      "사용 중인 Cloud SQL DB 자격 증명이 아직 유효합니다. 만료된 뒤 다시 시도하세요.",
    "workspaceProviders.serverGcpDataAccountRoles":
      "DopeDB 전용 Cloud SQL 계정의 역할이 필요한 권한과 일치하지 않습니다. 기존 권한은 변경하지 않았습니다. 관리자가 해당 계정을 확인해 주세요.",
    "workspaceProviders.serverGcpUnexpectedUser":
      "Cloud SQL이 요청과 다른 DB 사용자 정보를 반환했습니다. 기존 접근 권한은 변경하지 않았습니다.",
    "workspaceProviders.serverGcpRoleConflict":
      "Cloud SQL 사용자 목록에 없는 기존 DB 역할이 설정 계정 이름과 충돌합니다. DB 관리자가 기존 역할을 확인해 충돌을 해결한 뒤 다시 연결하세요.",
    "workspaceProviders.serverGcpRuntimeDenied":
      "Google Cloud 설정 후에도 실제 접근이 거부되고 있습니다. 잠시 뒤 다시 시도하고, 계속되면 Workload Identity와 서비스 계정 IAM 정책을 확인하세요.",
    "workspaceProviders.serverGcpPermissionsRequired":
      "Google Cloud 자동 설정에 필요한 권한을 확인하세요.",
    "workspaceProviders.serverGcpTemporaryGrantCleanup":
      "임시 Google Cloud 설정 권한을 바로 제거하지 못했습니다. 해당 권한은 15분 뒤 자동 만료됩니다.",
    "workspaceProviders.serverGcpLegacyIntegration":
      "이 Cloud SQL 계정 연결은 고정 DB 목록을 저장하기 전 버전입니다. 계정 연결에서 다시 연결하세요.",
    "workspaceProviders.serverGcpAuthorizationExpired":
      "Google Cloud 승인이 만료되었습니다. 계정을 다시 연결하세요.",
    "workspaceProviders.serverGcpScopeMissing":
      "Google 승인에 cloud-platform 권한이 포함되지 않았습니다. 계정을 다시 연결하고 Google Cloud 접근을 승인하세요.",
    "workspaceProviders.serverGcpQuotaApiDisabled":
      "quota project에 필요한 Google Cloud API가 비활성화되어 있습니다.",
    "workspaceProviders.serverGcpApiDisabledInProject":
      "Google Cloud API {service}가 quota project {project}에서 비활성화되어 있습니다.",
    "workspaceProviders.serverGcpApiDisabled":
      "Google Cloud API {service}가 quota project에서 비활성화되어 있습니다.",
    "workspaceProviders.serverGcpOrganizationPolicy":
      "Google Cloud 조직 정책이 이 설정 작업을 차단했습니다.",
    "workspaceProviders.serverGcpServiceUsageRequired":
      "필수 API를 활성화할 수 없습니다. Service Usage Admin 권한이 필요합니다.",
    "workspaceProviders.serverGcpTemporaryCredential":
      "임시 서비스 계정 자격 증명을 발급할 수 없습니다.",
    "workspaceProviders.serverGcpWorkloadIdentityRequired":
      "Workload Identity를 구성할 수 없습니다. Workload Identity Pool Admin 권한이 필요합니다.",
    "workspaceProviders.serverGcpServiceAccountRequired":
      "서비스 계정을 구성할 수 없습니다. Service Account Admin 권한이 필요합니다.",
    "workspaceProviders.serverGcpProjectIamRequired":
      "프로젝트 IAM 정책을 변경할 수 없습니다. Project IAM Admin 권한이 필요합니다.",
    "workspaceProviders.serverGcpCloudSqlAdminRequired":
      "Cloud SQL 설정을 변경할 수 없습니다. Cloud SQL Admin 권한이 필요합니다.",
    "workspaceProviders.serverGcpRejected": "Google Cloud에서 이 설정 작업을 거부했습니다.",
    "workspaceProviders.serverGcpResourceNotFound": "선택한 Google Cloud 리소스를 찾지 못했습니다.",
    "workspaceProviders.serverGcpResourceConflict":
      "기존 Google Cloud 리소스가 이 DopeDB 설정과 충돌합니다.",
    "workspaceProviders.serverGcpRateLimited":
      "Google Cloud 요청 한도에 도달했습니다. 잠시 뒤 다시 시도하세요.",
    "workspaceProviders.serverGcpSetupIncomplete": "Google Cloud 설정을 완료하지 못했습니다.",
    "workspaceProviders.serverGcpIamPropagation":
      "새 Google Cloud 서비스 계정이 아직 IAM에 반영되지 않았습니다. 잠시 뒤 다시 시도하세요.",
    "workspaceProviders.serverGcpIamAdminApproval":
      "Google Cloud 프로젝트 IAM 관리자가 누락된 설정 역할을 승인해야 합니다.",
    "workspaceProviders.serverGcpTemporaryGrantTimeout":
      "임시 Google Cloud 설정 권한이 제한 시간 안에 활성화되지 않았습니다.",
    "workspaceProviders.serverGcpCloudSqlPropagation":
      "새 Google Cloud 서비스 계정이 아직 Cloud SQL에 반영되지 않았습니다. 잠시 뒤 다시 시도하세요.",
    "workspaceProviders.serverGcpRecoveryStateSave":
      "Cloud SQL 권한 복구 상태를 저장하지 못했습니다. 잠시 뒤 다시 시도하세요.",
  },
);
