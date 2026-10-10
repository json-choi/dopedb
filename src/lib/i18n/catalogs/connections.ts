// connections messages are owned by this bounded feature catalogue.
import { defineCatalog } from "../types";

export const connectionsCatalog = defineCatalog(
  {
    "connections.browse": "Browse...",
    "connections.allDataSources": "All data sources",
    "connections.allSchemas": "All schemas",
    "connections.advanced": "Advanced",
    "connections.advancedParameters": "Advanced parameters",
    "connections.addDataSourceMenu": "Add data source",
    "connections.addDataSourceSearchLabel": "Search data sources",
    "connections.addDataSourceSearchPlaceholder":
      "Search databases, cloud, or files",
    "connections.addParameter": "Add parameter",
    "connections.autoDisconnect": "Auto-disconnect after",
    "connections.autoDisconnectSeconds":
      "Auto-disconnect interval in seconds",
    "connections.authentication": "Authentication",
    "connections.caCertificate": "CA certificate path",
    "connections.clientCertificate": "Client certificate path",
    "connections.clientCertificateKey":
      "Client certificate and key file",
    "connections.clientKey": "Client private key path",
    "connections.clipboardImported": "Connection URL imported from clipboard",
    "connections.clipboardNoConnectionUrl": "Clipboard does not contain a supported database URL",
    "connections.clipboardUnavailable": "Could not read the clipboard",
    "connections.collapse": "Collapse",
    "connections.collections": "Collections ({count})",
    "connections.columns": "{count} columns",
    "connections.collapseMetadata": "Collapse metadata for {table}",
    "connections.connectionDeleted": "Connection deleted",
    "connections.connectionDuplicated":
      "Duplicate draft is ready. Choose Save or Save and close to save it.",
    "connections.connectionMenu": "Connection actions",
    "connections.projectMenu": "Project actions",
    "connections.connectionOk": "Connection test passed. Testing does not save changes.",
    "connections.managedWorkspace.label": "Endpoint and credentials",
    "connections.managedWorkspace.status": "Managed by the workspace",
    "connections.managedWorkspace.managerDescription":
      "The real endpoint and a short-lived credential are issued when this database is used. Repair its provider setup in Workspace management → Providers; member access is managed in Database access.",
    "connections.managedWorkspace.memberDescription":
      "The real endpoint and a short-lived credential are issued by the Workspace. Ask a Workspace admin to check the provider account and database registration if access fails.",
    "connections.managedWorkspace.securityNote":
      "This Desktop profile intentionally contains no editable host or password. The workspace owns the provider target and issues member-specific, short-lived access only when it is needed.",
    "connections.managedWorkspace.open": "Open managed-access repair",
    "connections.managedWorkspace.recover": "Repair managed connection",
    "connections.managedWorkspace.recoveryRequiredManager":
      "This managed database connection needs repair. Repair it in Workspace management → Providers; short-lived credentials resume automatically afterwards.",
    "connections.managedWorkspace.recoveryRequiredMember":
      "This managed database connection needs repair. Ask a Workspace manager to repair its provider connection.",
    "connections.managedWorkspace.recoveryRequiredManagerCompact":
      "Managed connection repair is required.",
    "connections.managedWorkspace.recoveryRequiredMemberCompact":
      "A Workspace manager must repair this connection.",
    "connections.connectionSaved": "Connection saved",
    "connections.saveAndClose": "Save and close",
    "connections.connectionSavedToProject": "Connection saved and added to the Project",
    "connections.clouds": "Clouds",
    "connections.dataSourceFromCloudProvider":
      "Data Source from Cloud Provider",
    "connections.cloudCatalogDescription":
      "Cloud credentials are managed separately from database connection profiles.",
    "connections.cloudCredentialDescription":
      "Configure account credentials",
    "connections.connectionMethod": "Connection method",
    "connections.connectionMethodHint":
      "Controls provider-specific connection behavior. Cloud account credentials are managed separately.",
    "connections.connectionType": "Connection type",
    "connections.connectionTypeDefault": "Default",
    "connections.connectionTypeUrlOnly": "URL only",
    "connections.connectionUrl": "URL",
    "connections.connectionUrlOverrides":
      "Overrides the connection settings above.",
    "connections.cloudflareAccount": "Cloudflare account",
    "connections.cloudflareD1Database": "D1 database",
    "connections.cloudflareD1ConnectAccount": "Connect Cloudflare",
    "connections.cloudflareD1ChangeAccount": "Change account",
    "connections.cloudflareD1Connected": "Connected",
    "connections.cloudflareD1NotConnected": "Not connected",
    "connections.cloudflareD1Authenticating": "Waiting for browser login…",
    "connections.cloudflareD1CheckingConnection": "Checking connection…",
    "connections.cloudflareD1SelectAccount": "Select an account",
    "connections.cloudflareD1SelectDatabase": "Select a D1 database",
    "connections.cloudflareD1ConnectFirst": "Connect Cloudflare first",
    "connections.cloudflareD1AccountHint":
      "Wrangler opens Cloudflare in your browser. DopeDB never asks for or stores an API token.",
    "connections.cloudflareD1WranglerRequired":
      "Install Wrangler 4 or later to connect a Cloudflare account.",
    "connections.cloudflareD1AccountsLoading": "Loading accounts…",
    "connections.cloudflareD1DatabasesLoading": "Loading D1 databases…",
    "connections.cloudflareD1NoAccounts": "No accessible accounts found.",
    "connections.cloudflareD1NoDatabases": "No D1 databases found in this account.",
    "connections.cloudflareD1AuthenticationFailed": "Could not connect the Cloudflare account.",
    "connections.cloudflareD1AccountsLoadFailed": "Could not load Cloudflare accounts.",
    "connections.cloudflareD1DatabasesLoadFailed": "Could not load D1 databases.",
    "connections.cloudflareD1PermissionError": "This Cloudflare account does not have access to the requested resource.",
    "connections.cloudflareD1ErrorTimeout": "Cloudflare did not finish in time. Try again.",
    "connections.cloudflareD1ErrorNetwork": "Could not reach Cloudflare. Check the network and try again.",
    "connections.connection": "Connection",
    "connections.createDataSource": "Create data source",
    "connections.copyName": "{name} copy",
    "connections.database": "Database",
    "connections.databaseExplorer": "Explorer",
    "connections.databaseExplorerActions": "Explorer actions",
    "connections.projects": "Projects",
    "connections.addProject": "Add Project",
    "connections.addEnvironment": "Add Environment",
    "connections.deleteProject": "Delete Project",
    "connections.reallyDeleteProject": "Delete this Project? Database connections will be kept outside the Project.",
    "connections.projectDeleted":
      "Deleted {project}. Database connections were preserved outside this Project.",
    "connections.createProject": "Create Project",
    "connections.createFirstProject": "Create your first Project",
    "connections.creatingProject": "Creating…",
    "connections.projectSetupTitle": "Create Project",
    "connections.projectSetupDescription":
      "Create a Project first, then organize database access, source code, and Analysis Articles by Environment.",
    "connections.projectName": "Project name",
    "connections.projectNamePlaceholder": "e.g. Customer portal",
    "connections.firstEnvironment": "First Environment",
    "connections.environmentName": "Environment name",
    "connections.environmentNamePlaceholder": "e.g. main or development",
    "connections.environmentSetupTitle": "Add Environment",
    "connections.environmentSetupDescription":
      "Add an Environment inside a Project, then connect the databases and source code that belong to that exact scope.",
    "connections.creatingEnvironment": "Adding…",
    "connections.refreshExplorer": "Refresh Explorer",
    "connections.environmentRiskClass": "Risk class",
    "connections.environmentRiskDevelopment": "Development",
    "connections.environmentRiskStaging": "Staging",
    "connections.environmentRiskProduction": "Production",
    "connections.environmentProductionConfirm":
      "I understand this Environment represents production access.",
    "connections.environmentRiskTest": "Test",
    "connections.environmentRiskCustom": "Custom",
    "connections.projectSetupNextStep":
      "After creation, add databases and source code inside this Environment.",
    "connections.projectDatabaseCount": "{count} databases",
    "connections.projectDatabaseMoveDown": "Move down",
    "connections.projectDatabaseMoveUp": "Move up",
    "connections.projectDatabaseOrderUpdated":
      "Moved {item} to position {position} of {total}.",
    "connections.projectDatabaseReorderHint":
      "Drag to reorder. For keyboard control, use Option/Alt+Up or Option/Alt+Down, or open Connection actions.",
    "connections.environmentAddDatabase": "Add database…",
    "connections.environmentAddSource": "Add data source…",
    "connections.environmentAnalysisLoadFailed":
      "Could not load analyses",
    "connections.environmentDatabaseLoadFailed":
      "Could not load Environment databases",
    "connections.environmentConnectionMoved":
      "Moved {connection} to {environment}.",
    "connections.projectConnectionCleanupFailed":
      "Added {connection} to the Project, but its old Unassigned local copy could not be removed. Delete that copy from its connection menu.",
    "connections.environmentConnectionRemoved":
      "Removed {connection} from the Project.",
    "connections.removeFromProject": "Remove from Project",
    "connections.reallyRemoveFromProject": "Remove from this Project?",
    "connections.environmentSourceLoadFailed":
      "Could not load Environment data sources",
    "connections.environmentAnalyses": "Analyses",
    "connections.environmentDatabases": "Databases",
    "connections.environmentDatabaseUnavailable":
      "This workspace database is not available on this device",
    "connections.environmentLocalFolder": "Local folder",
    "connections.environmentDataSources": "Data sources",
    "connections.environmentNoAnalyses": "No analyses yet",
    "connections.loadingConnections": "Loading connections…",
    "connections.loadingProjects": "Loading Projects…",
    "connections.unassigned": "Unassigned",
    "connections.dataSourceCatalogNavigation":
      "Data source catalog navigation",
    "connections.dataSources": "Data Sources",
    "connections.dataSourcesAndDrivers": "Data Sources and Drivers",
    "connections.editData": "Edit Data",
    "connections.databaseFile": "Database file path",
    "connections.databaseRequiredHint": "Required for MongoDB",
    "connections.bigQueryProjectId": "GCP project ID",
    "connections.bigQueryDataset": "Dataset",
    "connections.bigQueryAuthenticationMode": "Sign-in method",
    "connections.bigQueryGoogleAccount": "Google account",
    "connections.bigQueryServiceAccount": "Service account",
    "connections.bigQueryAuthenticating": "Connecting your Google account…",
    "connections.bigQueryPreparingTools": "Preparing verified Google tools…",
    "connections.bigQueryConnected": "Connected",
    "connections.bigQueryNotConnected": "Not connected",
    "connections.bigQueryConnectGoogleAccount": "Connect Google account",
    "connections.bigQueryChangeGoogleAccount": "Change account",
    "connections.bigQueryReconnectGoogleAccount": "Reconnect Google account",
    "connections.bigQueryReconnecting": "Reconnecting…",
    "connections.bigQueryAuthenticationExpired":
      "Google Cloud requires account reauthentication.",
    "connections.bigQueryChooseCredentialFile": "Choose credential JSON",
    "connections.bigQueryReplaceCredentialFile": "Replace credential JSON",
    "connections.bigQueryProjectsLoading": "Loading accessible projects…",
    "connections.bigQueryDatasetsLoading": "Loading datasets…",
    "connections.bigQuerySelectProject": "Select a project",
    "connections.bigQuerySelectDataset": "Select a dataset",
    "connections.bigQueryProjectPlaceholder": "Enter a GCP project ID",
    "connections.bigQueryDatasetPlaceholder": "Enter a dataset ID",
    "connections.bigQueryNoProjects":
      "No accessible projects were returned. You can still enter a project ID.",
    "connections.bigQueryNoDatasets":
      "This project has no accessible datasets. You can still enter a dataset ID.",
    "connections.bigQueryErrorTimeout":
      "Google Cloud took too long to respond. Try again.",
    "connections.bigQueryErrorNetwork":
      "Google Cloud could not be reached. Check the network and try again.",
    "connections.bigQueryAuthenticationFailed":
      "Could not read the Google sign-in state. Connect the account again.",
    "connections.bigQueryAuthenticationPermissionError":
      "Google sign-in was blocked by the local security boundary. Try connecting again.",
    "connections.bigQueryProjectsLoadFailed":
      "Could not load projects. Check the Google account and try again.",
    "connections.bigQueryProjectsPermissionError":
      "The connected Google account cannot list GCP projects.",
    "connections.bigQueryDatasetsLoadFailed":
      "Could not load datasets. Check that the BigQuery API is enabled for this project, then try again.",
    "connections.bigQueryDatasetsPermissionError":
      "The connected Google account cannot list datasets in this project.",
    "connections.bigQueryRuntimePreparationFailed":
      "Could not prepare the official Google tools. Check the network and try again.",
    "connections.bigQueryRuntimeVerificationError":
      "The downloaded Google tools did not pass local verification. Download them again.",
    "connections.bigQueryLocation": "Location (optional)",
    "connections.bigQueryLocationPlaceholder": "Auto-detect, e.g. US or asia-northeast3",
    "connections.bigQueryMaximumBytesBilled": "Maximum bytes billed",
    "connections.bigQueryCliReady": "Official Google tools are ready",
    "connections.bigQueryCliRequired":
      "Prepared automatically on the first connection",
    "connections.bigQueryCliStatus": "Google tools",
    "connections.bigQuerySecurityNote":
      "DopeDB prepares everything needed to connect. Sign in with Google in your browser, or choose a service-account file. Your credentials stay on this device. Queries are read-only and must stay under this connection's billing limit.",
    "connections.bigQuerySharedSecurityNote":
      "This shared record contains only the BigQuery project and dataset identity. Each member connects Google credentials locally; no token or service-account key is shared through the workspace.",
    "connections.discoveredSchemaCount": "{count} schemas",
    "connections.defaultSchema": "Default schema",
    "connections.defaultValue": "Default",
    "connections.ddlTitle": "{table} - DDL",
    "connections.driver": "Driver",
    "connections.driverAutomatic": "Automatic (recommended)",
    "connections.driverBundled": "Bundled with this app",
    "connections.driverSystem": "Provided by the system",
    "connections.driverSystemRequired": "Install outside DopeDB",
    "connections.driverCatalogLoading": "Loading driver catalog...",
    "connections.driverCatalogScope":
      "This catalog only lists drivers the app can diagnose or install. Unsupported drivers are not presented as available.",
    "connections.driverDetails": "Driver details",
    "connections.driverDownload": "Download",
    "connections.driverDownloadRequired": "Download required",
    "connections.driverDownloading": "Downloading...",
    "connections.driverHint":
      "Automatic selects the highest-priority compatible driver for this engine and connection method.",
    "connections.driverInstallation": "Installation",
    "connections.driverInstalled": "{name} is installed.",
    "connections.driverInstalledStatus": "Installed",
    "connections.driverCapabilities": "Driver capabilities",
    "connections.driverCapability.sql": "SQL queries",
    "connections.driverCapability.documentQuery": "Document queries",
    "connections.driverCapability.transactions": "Transactions",
    "connections.driverCapability.introspection": "Schema introspection",
    "connections.driverCapability.collections": "Collections",
    "connections.driverCapability.schemaDiff": "Schema comparison",
    "connections.driverCapability.monitoring": "Monitoring",
    "connections.drivers": "Drivers",
    "connections.driverVersion": "Version",
    "connections.problemDriverCatalogUnavailable":
      "The driver catalog could not be loaded.",
    "connections.problemDriverInstallRequired":
      "Install the selected driver before testing or saving this data source.",
    "connections.problemDriverUnavailable":
      "No installed driver matches this database and connection method.",
    "connections.problemDuplicateName":
      "Another data source already uses this name.",
    "connections.problemHostInvalid":
      "Enter a host name without a URL scheme or whitespace.",
    "connections.problemHostRequired": "Enter the database host.",
    "connections.problemConnectionUrlInvalid":
      "Enter a supported PostgreSQL, MySQL, SQLite, MongoDB, BigQuery, or Cloudflare D1 URL.",
    "connections.problemCloudflareAccountRequired":
      "Enter the Cloudflare account ID.",
    "connections.problemCloudflareAccountInvalid":
      "The Cloudflare account ID must be 32 hexadecimal characters.",
    "connections.problemCloudflareD1DatabaseRequired":
      "Enter the D1 database ID.",
    "connections.problemCloudflareD1DatabaseInvalid":
      "Enter a valid D1 database UUID.",
    "connections.problemCloudflareD1ReadTokenRequired":
      "Enter a D1 Read API token for this device.",
    "connections.problemTimeZoneInvalid":
      "Enter a valid time zone such as UTC, Asia/Seoul, or +09:00.",
    "connections.problemKeepAliveInvalid":
      "Enter a keep-alive interval from 10 through 86400 seconds.",
    "connections.problemAutoDisconnectInvalid":
      "Enter an auto-disconnect interval from 30 through 86400 seconds.",
    "connections.problemStartupScriptTooLong":
      "Keep the startup script within 4096 characters.",
    "connections.problemStartupScriptSkippedByPooler":
      "This connection goes through a transaction-mode pooler that shares server sessions, so the startup script does not run. Use a session-mode or direct connection to apply it.",
    "connections.problemSshAliasInvalid":
      "Use an OpenSSH Host alias with letters, numbers, dots, underscores, or hyphens.",
    "connections.problemPostgresUsernameInvalid":
      "This PostgreSQL user starts or ends with whitespace or contains control characters. Check that it matches the role exactly.",
    "connections.problemSshTunnelSingleHostRequired":
      "An SSH tunnel requires one database host.",
    "connections.problemSshTunnelSrvUnsupported":
      "MongoDB SRV discovery cannot use a single-host SSH tunnel.",
    "connections.problemMongoDatabaseRequired":
      "Enter the MongoDB database name.",
    "connections.problemTargetDatabaseRequired": "Choose a target database before saving. You can test the server connection first.",
    "connections.problemTargetDatabaseInvalid": "Use a database name of at most 255 UTF-8 bytes without control characters.",
    "connections.databaseDiscoveryLoading": "Finding databases…",
    "connections.databaseDiscoveryEmpty": "No databases found. Enter a database name manually.",
    "connections.databaseDiscoveryFailed": "Could not list databases. Check the connection details and retry, or enter a database name manually.",
    "connections.databaseDiscoveryRetry": "Find databases",
    "connections.problemBigQueryProjectRequired":
      "Enter the GCP project ID.",
    "connections.problemBigQueryProjectInvalid":
      "Use a 6-30 character lowercase GCP project ID.",
    "connections.problemBigQueryDatasetRequired":
      "Enter the BigQuery dataset ID.",
    "connections.problemBigQueryDatasetInvalid":
      "Use only letters, digits, or underscores in the dataset ID.",
    "connections.problemBigQueryLocationInvalid":
      "Use only letters, digits, or hyphens in the BigQuery location.",
    "connections.problemBigQueryMaximumBytesBilledInvalid":
      "Enter a maximum bytes billed value from 1 byte through 10 TiB.",
    "connections.problemNameRequired": "Enter a data source name.",
    "connections.problemPortInvalid":
      "Enter a port from 1 through 65535.",
    "connections.problemRuntime": "Connection check failed",
    "connections.problemSaveFailed": "Could not save the connection",
    "connections.problemDeleteFailed": "Could not delete the connection",
    "connections.problemDriverFailed": "Could not install the driver",
    "connections.problemRefreshFailed": "Could not refresh the workspace data",
    "connections.workspaceRefreshed":
      "Workspace data was refreshed. Test the connection again.",
    "connections.workspaceRefreshFailed":
      "Could not refresh the workspace data. Check the network, then try again.",
    "connections.testFailure.sshClientMissingTitle": "System SSH is unavailable",
    "connections.testFailure.sshClientMissingRecovery":
      "Install or restore the system SSH client, then check the SSH Host alias in SSH/SSL.",
    "connections.testFailure.sshConfigurationTitle": "SSH configuration was rejected",
    "connections.testFailure.sshConfigurationRecovery":
      "Check the Host alias and its entry in your system SSH configuration.",
    "connections.testFailure.sshHostKeyTitle": "SSH host identity could not be verified",
    "connections.testFailure.sshHostKeyRecovery":
      "Verify the host identity with your administrator before changing known-hosts data, then check the SSH Host alias.",
    "connections.testFailure.sshAuthenticationTitle": "SSH authentication failed",
    "connections.testFailure.sshAuthenticationRecovery":
      "Check the system SSH agent, key, and Host alias. The database password does not control SSH authentication.",
    "connections.testFailure.sshForwardingTitle": "SSH forwarding could not start",
    "connections.testFailure.sshForwardingRecovery":
      "Check the SSH Host alias, network route, and the target server's forwarding policy.",
    "connections.testFailure.sshTimeoutTitle": "SSH tunnel timed out",
    "connections.testFailure.sshTimeoutRecovery":
      "Check the SSH Host alias and network reachability, then test again.",
    "connections.testFailure.sshUnknownTitle": "SSH tunnel could not be established",
    "connections.testFailure.sshUnknownRecovery":
      "Review the SSH Host alias and system SSH configuration before testing again.",
    "connections.testFailure.timeoutNetworkTitle": "Could not reach the database",
    "connections.testFailure.timeoutNetworkRecovery":
      "Check the host, port, network access, and SSH Host alias, then test again.",
    "connections.testFailure.authenticationTitle": "Authentication failed",
    "connections.testFailure.authenticationRecovery":
      "Check the user and password stored on this device, then test again.",
    "connections.testFailure.tlsTitle": "TLS verification failed",
    "connections.testFailure.tlsRecovery":
      "Check the TLS mode and certificate paths in SSH/SSL, then test again.",
    "connections.testFailure.databaseConfigTitle": "Database configuration was rejected",
    "connections.testFailure.databaseConfigRecovery":
      "Check the database name and connection options, then test again.",
    "connections.testFailure.unknownTitle": "Connection check failed",
    "connections.testFailure.unknownRecovery":
      "Check the host, port, database, and connection options, then test again.",
    "connections.testFailure.managedTitle":
      "Workspace-managed access could not be issued",
    "connections.testFailure.managedManagerRecovery":
      "Do not edit the read-only connection values below. Open this database in Workspace management → Providers, check its provider account and database registration, then test again.",
    "connections.testFailure.managedMemberRecovery":
      "This connection is managed by the workspace, not on this device. Ask a workspace admin to check its provider account, database registration, and your access, then test again.",
    "connections.testFailure.memberBindingRecovery":
      "Your username, password, SSH Host alias, and TLS files for this shared connection are kept on this device. Open Connect credentials to check them, then test again.",
    "connections.testFailure.savedCredentialRecovery":
      "The check used the password saved on this device. If it changed, or this device no longer has it, enter the password again and save.",
    "connections.testFailure.savedCredentialEndpointChangedTitle":
      "The endpoint changed, so the saved password must be entered again",
    "connections.testFailure.savedCredentialEndpointChangedRecovery":
      "A saved password is used only with the host, port, user, and SSH Host alias it was saved for, over TLS settings at least as strict, so nothing was sent. Enter the password for these settings, or restore the earlier ones.",
    "connections.testFailure.sharedConnectionChangedTitle":
      "This shared connection changed in the workspace",
    "connections.testFailure.sharedConnectionChangedRecovery":
      "This device still has the earlier version, so nothing was opened. Refresh the workspace data, then test again.",
    "connections.testFailure.workspaceSignInRequiredTitle":
      "Sign in to the workspace again",
    "connections.testFailure.workspaceSignInRequiredRecovery":
      "This device's workspace sign-in expired, so shared access was not authorized and nothing was opened. Sign in again, then test again.",
    "connections.testFailure.credentialStoreDeniedRecovery":
      "This device's credential store did not release the saved password, so nothing was sent. Allow DopeDB to use it, unlocking the keychain if asked, then test again.",
    "connections.testFailure.lockTimeoutTitle":
      "Another session is holding a lock the check needs",
    "connections.testFailure.lockTimeoutRecovery":
      "The database stopped waiting for a lock held by another session. The connection settings need no change; test again in a moment.",
    "connections.saveFailure.projectBinding":
      "The connection was saved, but it could not be added to the Project. Save again to retry.",
    "connections.saveFailure.credentialStore":
      "The password could not be stored in this computer's credential store. Allow DopeDB to use it, then save again.",
    "connections.saveFailure.configuration":
      "These connection settings were not accepted. Check the fields listed in Problems, then save again.",
    "connections.saveFailure.blocked":
      "Your workspace role cannot change this connection here.",
    "connections.saveFailure.notFound":
      "This connection no longer exists. Close the editor and open it again from the Explorer.",
    "connections.saveFailure.workspaceUnavailable":
      "The workspace service could not be reached. Check your network, then try again.",
    "connections.saveFailure.unknown":
      "The connection could not be saved. Try again.",
    "connections.deleteFailure.blocked":
      "Your workspace role cannot delete this connection.",
    "connections.deleteFailure.unknown":
      "The connection could not be deleted. Try again.",
    "connections.authCleanupDeferred":
      "The temporary sign-in created for this connection could not be removed from this device.",
    "connections.testCancel": "Stop test",
    "connections.testUnavailableSharedDraft":
      "Save the shared connection first. Testing checks the saved version.",
    "connections.testUnavailableManagedCooldown":
      "Workspace-managed access can be checked again in {seconds}s.",
    "connections.parameterReserved":
      "This option has its own control on another tab and is ignored here.",
    "connections.parameterDuplicate":
      "This name is used more than once. The last value is used.",
    "connections.discardChangesTitle": "Discard unsaved changes?",
    "connections.discardChangesBody":
      "Your changes to this connection, including any password you typed, have not been saved.",
    "connections.keepEditing": "Keep editing",
    "connections.discardChanges": "Discard changes",
    "connections.driverDownloadFailed": "{name} could not be installed. Try again.",
    "connections.driverDownloadNetworkFailed":
      "{name} could not be downloaded. Check your network, then try again.",
    "connections.tls": "TLS",
    "connections.tlsEnabledOnDevice": "On for this device",
    "connections.tlsDisabledOnDevice": "Off for this device",
    "connections.tlsMemberOwned":
      "Each member turns on MongoDB TLS and chooses certificate files in Connect credentials.",
    "connections.credentialVerified": "Verified",
    "connections.credentialSavedOnDevice": "Saved on this device",
    "connections.removeSavedPassword": "Remove saved password",
    "connections.enterPassword": "Enter password",
    "connections.savedPasswordRemovalPending":
      "The saved password will be removed from this device when you save.",
    "connections.localDiscoveryRetry": "Look again on this computer",
    "connections.catalogIssue.managed":
      "This workspace-managed connection needs repair before its catalog can be loaded.",
    "connections.catalogIssue.blocked":
      "The current workspace policy blocks access to this database.",
    "connections.catalogIssue.cancelled":
      "The catalog request was cancelled.",
    "connections.catalogIssue.network":
      "The catalog could not be loaded because the network is unavailable.",
    "connections.catalogIssue.timeout":
      "The catalog request exceeded its time limit.",
    "connections.catalogIssue.notFound":
      "This connection resource is no longer available.",
    "connections.catalogIssue.unknown":
      "The catalog could not be loaded safely. Review the connection settings.",
    "connections.catalogIssue.ddl":
      "The DDL could not be loaded safely.",
    "connections.catalogIssue.project":
      "Projects could not be loaded.",
    "connections.catalogIssue.bindings":
      "Project databases could not be loaded.",
    "connections.catalogIssue.sources":
      "Project data sources could not be loaded.",
    "connections.catalogIssue.analyses":
      "Project analyses could not be loaded.",
    "connections.problems": "Problems",
    "connections.problemsEmpty":
      "No configuration problems were found.",
    "connections.problemSqliteFileRequired":
      "Choose a SQLite database file.",
    "connections.duplicate": "Duplicate connection",
    "connections.demoCreating": "Creating Demo SQLite...",
    "connections.demoCreated": "Demo SQLite is ready.",
    "connections.demoDescription":
      "Create a local database with seeded sample data",
    "connections.demoSqlite": "Create Demo SQLite",
    "connections.edit": "Edit connection",
    "connections.engine": "Engine",
    "connections.enableTls": "Use TLS",
    "connections.environment": "Environment",
    "connections.environmentHint": "(optional - labels the sidebar)",
    "connections.fileAndSample": "Files and samples",
    "connections.sampleDatabase": "Sample database",
    "connections.expand": "Expand",
    "connections.expandMetadata": "Expand metadata for {table}",
    "connections.compareSchemaStructure": "Compare Schema Structure",
    "connections.searchLoadedObjects": "Search loaded Explorer objects",
    "connections.filterLoadedObjectsPlaceholder":
      "Search loaded tables, views, and objects",
    "connections.filterResultCount": "{count} objects",
    "connections.functions": "Functions ({count})",
    "connections.host": "Host",
    "connections.general": "General",
    "connections.importClipboard": "Import clipboard URL",
    "connections.introspectionScope": "Introspection scope",
    "connections.introspectionScopeBody":
      "Choose the namespaces and object names shown by Database Explorer, Action Search, and schema diagrams.",
    "connections.loadingSchema": "Loading schema...",
    "connections.loadingMetadata": "Loading metadata...",
    "connections.loadingSchemaScope": "Discovering schemas...",
    "connections.materializedViews": "Materialized views ({count})",
    "connections.indexes": "Indexes ({count})",
    "connections.keys": "Keys ({count})",
    "connections.name": "Name",
    "connections.new": "New connection",
    "connections.noConnections": "No connections yet.",
    "connections.noDataSourceResults":
      "No data sources match this search.",
    "connections.noDriverResults":
      "No drivers match this search.",
    "connections.noObjects": "No database objects.",
    "connections.noMetadata": "No column, key, or index metadata.",
    "connections.noSchemasDiscovered": "No schemas were discovered for this data source.",
    "connections.noParameters": "No advanced parameters.",
    "connections.noTables": "No tables.",
    "connections.noTablesMatch":
      'No loaded Explorer objects match "{filter}".',
    "connections.objectOn": "on",
    "connections.objectNamePattern": "Object name pattern",
    "connections.objectNamePatternHint":
      "Use * and ? wildcards. This filter is shared by Explorer, Search, and schema diagrams.",
    "connections.password": "Password",
    "connections.passwordStored": "Enter password",
    "connections.passwordStoredExisting": "stored",
    "connections.options": "Options",
    "connections.notNull": "Not null",
    "connections.nullable": "Nullable",
    "connections.parameterKey": "Parameter",
    "connections.parameterValue": "Value",
    "connections.port": "Port",
    "connections.procedures": "Procedures ({count})",
    "connections.providerAuto": "Automatic detection",
    "connections.providerGcpCloudSql": "GCP Cloud SQL",
    "connections.providerCloudflareD1": "Cloudflare D1",
    "connections.providerGeneric": "Generic / self-hosted",
    "connections.providerBigQueryCli": "Official Google BigQuery CLI",
    "connections.providerNeon": "Neon",
    "connections.neonBranch": "Neon branch",
    "connections.neonBranchTarget": "Neon branch {name} ({id})",
    "connections.neonBranchState": "State: {state}",
    "connections.providerPlanetScale": "PlanetScale",
    "connections.searchDataSources": "Search data sources",
    "connections.searchDrivers": "Search drivers",
    "connections.reallyDeleteDemo":
      "Delete this connection and its Demo SQLite file?",
    "connections.readOnlyDefault": "Start the command-line shell read-only",
    "connections.readOnlyDefaultBody":
      "Applies to the advanced shell in Settings → Command line and to this connection's CLI summary. Write access for queries, table editors, and the Agent is managed in Settings → Safety.",
    "connections.keepAlive": "Run keep-alive query each",
    "connections.keepAliveSeconds":
      "Keep-alive interval in seconds",
    "connections.refreshSchema": "Refresh schema",
    "connections.safety": "Safety",
    "connections.seconds": "seconds",
    "connections.schemaDiffMissingSection": "Missing here ({count})",
    "connections.schemaDiffPendingChip": "diff",
    "connections.schemaDiffPendingTitle": "Open schema comparison to load this database",
    "connections.schemaDiffTableAdded": "Only in this database; missing from the baseline",
    "connections.schemaDiffTableChanged":
      "Compared with the baseline: +{added} columns, −{missing} columns, ~{changed} changed",
    "connections.schemaDiffTableMissing": "Missing in this database; exists in the baseline",
    "connections.schemaDiffTitle":
      "Compared with the baseline: +{added} only here, −{missing} missing here, ~{changed} changed",
    "connections.schemaComparison": "Schema comparison group",
    "connections.schemaGroup": "Schema group",
    "connections.schemaGroupConfirmGroup":
      'Add "{connection}" to schema group "{group}"?',
    "connections.schemaGroupConfirmPair":
      'Group "{source}" and "{target}" together as "{group}"?',
    "connections.schemaGroupPlaceholder": "billing-api",
    "connections.schemaGroupTitle": "{group} schema group",
    "connections.schemaScopeSaveFirst":
      "Apply this data source first, then return here to discover its schemas.",
    "connections.schemas": "Schemas",
    "connections.schemasBody":
      "Connections in one schema group can be compared across environments.",
    "connections.schemaGroupUpdated": "Schema group updated",
    "connections.sequences": "Sequences ({count})",
    "connections.showDdl": "Show CREATE DDL",
    "connections.showRowCounts": "Show row counts",
    "connections.supportedProviders":
      "Supported connection methods",
    "connections.srv": "Use mongodb+srv:// (SRV DNS lookup)",
    "connections.sslMode": "SSL mode",
    "connections.sslConfiguration": "SSL configuration",
    "connections.sqliteNoTls": "SQLite does not use a network TLS connection.",
    "connections.startupScript": "Startup script",
    "connections.startupScriptHint":
      "Runs allowlisted session SET statements whenever a new PostgreSQL or MySQL connection is established.",
    "connections.startupScriptPlaceholder":
      "SET application_name = 'DopeDB';",
    "connections.sshSsl": "SSH/SSL",
    "connections.sshHostAlias": "OpenSSH Host alias",
    "connections.sshHostAliasHint":
      "Optional. DopeDB runs the system ssh client; keys, passphrases, agents, ProxyJump, and host-key policy stay in ~/.ssh/config and the OS.",
    "connections.sshHostAliasPlaceholder": "database-bastion",
    "connections.sshTunnel": "SSH tunnel",
    "connections.tables": "Tables ({count})",
    "connections.test": "Test connection",
    "connections.tabList": "Data source settings",
    "connections.testing": "Testing...",
    "connections.triggers": "Triggers ({count})",
    "connections.timeZone": "Time zone",
    "connections.timeZonePlaceholder": "UTC, Asia/Seoul, +09:00",
    "connections.transactionAuto": "Auto",
    "connections.transactionControl": "Transaction control",
    "connections.transactionOperationScoped":
      "Automatic execution is the default. Query and data toolbars can open a bounded connection-scoped manual transaction for commit or rollback.",
    "connections.unique": "Unique",
    "connections.user": "User",
    "connections.userPassword": "User & Password",
    "connections.views": "Views ({count})",
  },
  {
    "connections.browse": "찾아보기...",
    "connections.allDataSources": "모든 데이터 소스",
    "connections.allSchemas": "모든 스키마",
    "connections.advanced": "고급",
    "connections.advancedParameters": "고급 매개변수",
    "connections.addDataSourceMenu": "데이터 소스 추가",
    "connections.addDataSourceSearchLabel": "데이터 소스 검색",
    "connections.addDataSourceSearchPlaceholder":
      "데이터베이스, 클라우드 또는 파일 검색",
    "connections.addParameter": "매개변수 추가",
    "connections.autoDisconnect": "다음 시간 후 자동 연결 해제",
    "connections.autoDisconnectSeconds":
      "자동 연결 해제 간격(초)",
    "connections.authentication": "인증",
    "connections.caCertificate": "CA 인증서 경로",
    "connections.clientCertificate": "클라이언트 인증서 경로",
    "connections.clientCertificateKey":
      "클라이언트 인증서 및 키 파일",
    "connections.clientKey": "클라이언트 개인 키 경로",
    "connections.clipboardImported": "클립보드의 연결 URL을 가져왔습니다",
    "connections.clipboardNoConnectionUrl": "클립보드에 지원되는 데이터베이스 URL이 없습니다",
    "connections.clipboardUnavailable": "클립보드를 읽지 못했습니다",
    "connections.collapse": "접기",
    "connections.collections": "컬렉션 ({count})",
    "connections.columns": "{count}개 컬럼",
    "connections.collapseMetadata": "{table} 메타데이터 접기",
    "connections.connectionDeleted": "연결이 삭제되었습니다",
    "connections.connectionDuplicated":
      "복제 초안을 만들었습니다. 저장 또는 저장하고 닫기로 저장하세요.",
    "connections.connectionMenu": "연결 메뉴",
    "connections.projectMenu": "프로젝트 메뉴",
    "connections.connectionOk": "연결 검사 성공. 검사는 변경 내용을 저장하지 않습니다.",
    "connections.managedWorkspace.label": "엔드포인트 및 자격 증명",
    "connections.managedWorkspace.status": "워크스페이스에서 관리됨",
    "connections.managedWorkspace.managerDescription":
      "이 DB를 사용할 때 실제 엔드포인트와 단기 자격 증명이 발급됩니다. 공급자 설정은 워크스페이스 관리 → 공급자에서 복구하고, 구성원 접근은 DB 접근 권한에서 관리합니다.",
    "connections.managedWorkspace.memberDescription":
      "실제 엔드포인트와 단기 자격 증명은 워크스페이스가 발급합니다. 접근에 실패하면 워크스페이스 관리자에게 공급자 계정과 DB 등록 상태 확인을 요청하세요.",
    "connections.managedWorkspace.securityNote":
      "이 Desktop 프로필에는 편집할 호스트나 비밀번호가 의도적으로 들어 있지 않습니다. 워크스페이스가 공급자 대상을 관리하고 필요할 때만 구성원별 단기 접근을 발급합니다.",
    "connections.managedWorkspace.open": "관리형 접근 복구 열기",
    "connections.managedWorkspace.recover": "관리형 연결 복구",
    "connections.managedWorkspace.recoveryRequiredManager":
      "이 관리형 DB 연결을 복구해야 합니다. 워크스페이스 관리 → 공급자에서 복구하면 단기 자격 증명이 다시 자동 갱신됩니다.",
    "connections.managedWorkspace.recoveryRequiredMember":
      "이 관리형 DB 연결을 복구해야 합니다. 워크스페이스 관리자에게 공급자 연결 복구를 요청하세요.",
    "connections.managedWorkspace.recoveryRequiredManagerCompact":
      "관리형 연결 복구가 필요합니다.",
    "connections.managedWorkspace.recoveryRequiredMemberCompact":
      "워크스페이스 관리자가 이 연결을 복구해야 합니다.",
    "connections.connectionSaved": "연결이 저장되었습니다",
    "connections.saveAndClose": "저장하고 닫기",
    "connections.connectionSavedToProject": "연결을 저장하고 Project에 배정했습니다",
    "connections.clouds": "클라우드",
    "connections.dataSourceFromCloudProvider":
      "클라우드 공급자의 데이터 소스",
    "connections.cloudCatalogDescription":
      "클라우드 자격 증명은 데이터베이스 연결 프로필과 분리해 관리합니다.",
    "connections.cloudCredentialDescription":
      "계정 자격 증명 설정",
    "connections.connectionMethod": "연결 방식",
    "connections.connectionMethodHint":
      "공급자별 연결 동작을 선택합니다. 클라우드 계정 자격 증명은 별도로 관리됩니다.",
    "connections.connectionType": "연결 유형",
    "connections.connectionTypeDefault": "기본",
    "connections.connectionTypeUrlOnly": "URL 전용",
    "connections.connectionUrl": "URL",
    "connections.connectionUrlOverrides":
      "위 연결 설정을 이 URL로 재정의합니다.",
    "connections.cloudflareAccount": "Cloudflare 계정",
    "connections.cloudflareD1Database": "D1 데이터베이스",
    "connections.cloudflareD1ConnectAccount": "Cloudflare 연결",
    "connections.cloudflareD1ChangeAccount": "계정 변경",
    "connections.cloudflareD1Connected": "연결됨",
    "connections.cloudflareD1NotConnected": "연결 안 됨",
    "connections.cloudflareD1Authenticating": "브라우저 로그인을 기다리는 중…",
    "connections.cloudflareD1CheckingConnection": "연결 확인 중…",
    "connections.cloudflareD1SelectAccount": "계정 선택",
    "connections.cloudflareD1SelectDatabase": "D1 데이터베이스 선택",
    "connections.cloudflareD1ConnectFirst": "Cloudflare를 먼저 연결하세요",
    "connections.cloudflareD1AccountHint":
      "Wrangler가 브라우저에서 Cloudflare 로그인을 엽니다. DopeDB는 API 토큰을 요청하거나 저장하지 않습니다.",
    "connections.cloudflareD1WranglerRequired":
      "Cloudflare 계정 연결에는 Wrangler 4 이상이 필요합니다.",
    "connections.cloudflareD1AccountsLoading": "계정 불러오는 중…",
    "connections.cloudflareD1DatabasesLoading": "D1 데이터베이스 불러오는 중…",
    "connections.cloudflareD1NoAccounts": "접근 가능한 계정이 없습니다.",
    "connections.cloudflareD1NoDatabases": "이 계정에 D1 데이터베이스가 없습니다.",
    "connections.cloudflareD1AuthenticationFailed": "Cloudflare 계정을 연결하지 못했습니다.",
    "connections.cloudflareD1AccountsLoadFailed": "Cloudflare 계정을 불러오지 못했습니다.",
    "connections.cloudflareD1DatabasesLoadFailed": "D1 데이터베이스를 불러오지 못했습니다.",
    "connections.cloudflareD1PermissionError": "이 Cloudflare 계정은 요청한 리소스에 접근할 수 없습니다.",
    "connections.cloudflareD1ErrorTimeout": "Cloudflare 응답 시간이 초과되었습니다. 다시 시도하세요.",
    "connections.cloudflareD1ErrorNetwork": "Cloudflare에 연결할 수 없습니다. 네트워크를 확인하고 다시 시도하세요.",
    "connections.connection": "연결",
    "connections.createDataSource": "데이터 소스 생성",
    "connections.copyName": "{name} 복사본",
    "connections.database": "데이터베이스",
    "connections.databaseExplorer": "탐색기",
    "connections.databaseExplorerActions": "탐색기 작업",
    "connections.projects": "프로젝트",
    "connections.addProject": "프로젝트 추가",
    "connections.addEnvironment": "환경 추가",
    "connections.deleteProject": "프로젝트 삭제",
    "connections.reallyDeleteProject": "프로젝트를 삭제할까요? DB 연결은 프로젝트 밖에 보존됩니다.",
    "connections.projectDeleted":
      "{project} 프로젝트를 삭제했습니다. DB 연결은 프로젝트 밖에 보존했습니다.",
    "connections.createProject": "프로젝트 만들기",
    "connections.createFirstProject": "첫 프로젝트 만들기",
    "connections.creatingProject": "만드는 중…",
    "connections.projectSetupTitle": "프로젝트 만들기",
    "connections.projectSetupDescription":
      "프로젝트를 먼저 만든 다음 환경별로 데이터베이스 접근, 소스 코드, 분석 아티클을 정리합니다.",
    "connections.projectName": "프로젝트 이름",
    "connections.projectNamePlaceholder": "예: 고객 포털",
    "connections.firstEnvironment": "첫 환경",
    "connections.environmentName": "환경 이름",
    "connections.environmentNamePlaceholder": "예: main 또는 development",
    "connections.environmentSetupTitle": "환경 추가",
    "connections.environmentSetupDescription":
      "프로젝트 안에 환경을 추가한 다음, 그 범위에 속한 데이터베이스와 소스 코드를 연결합니다.",
    "connections.creatingEnvironment": "추가하는 중…",
    "connections.refreshExplorer": "탐색기 새로고침",
    "connections.environmentRiskClass": "위험 등급",
    "connections.environmentRiskDevelopment": "개발",
    "connections.environmentRiskStaging": "스테이징",
    "connections.environmentRiskProduction": "운영",
    "connections.environmentProductionConfirm":
      "이 환경이 운영 접근 권한을 나타낸다는 점을 이해했습니다.",
    "connections.environmentRiskTest": "테스트",
    "connections.environmentRiskCustom": "사용자 지정",
    "connections.projectSetupNextStep":
      "만든 다음 이 환경 안에 데이터베이스와 소스 코드를 추가합니다.",
    "connections.projectDatabaseCount": "데이터베이스 {count}개",
    "connections.projectDatabaseMoveDown": "아래로 이동",
    "connections.projectDatabaseMoveUp": "위로 이동",
    "connections.projectDatabaseOrderUpdated":
      "{item}을(를) {total}개 중 {position}번째로 옮겼습니다.",
    "connections.projectDatabaseReorderHint":
      "드래그해 순서를 바꿉니다. 키보드는 Option/Alt+위/아래 화살표 또는 연결 메뉴를 사용하세요.",
    "connections.environmentAddDatabase": "데이터베이스 추가…",
    "connections.environmentAddSource": "데이터 소스 추가…",
    "connections.environmentAnalysisLoadFailed":
      "분석을 불러오지 못했습니다",
    "connections.environmentDatabaseLoadFailed":
      "환경 데이터베이스를 불러오지 못했습니다",
    "connections.environmentConnectionMoved":
      "{connection} 연결을 {environment} 환경으로 이동했습니다.",
    "connections.projectConnectionCleanupFailed":
      "{connection} 연결을 프로젝트에 추가했지만 기존 미분류 로컬 복사본을 제거하지 못했습니다. 해당 연결 메뉴에서 복사본을 삭제해 주세요.",
    "connections.environmentConnectionRemoved":
      "{connection} 연결을 프로젝트에서 제거했습니다.",
    "connections.removeFromProject": "프로젝트에서 제거",
    "connections.reallyRemoveFromProject": "이 프로젝트에서 제거할까요?",
    "connections.environmentSourceLoadFailed":
      "환경 데이터 소스를 불러오지 못했습니다",
    "connections.environmentAnalyses": "분석",
    "connections.environmentDatabases": "데이터베이스",
    "connections.environmentDatabaseUnavailable":
      "이 워크스페이스 데이터베이스를 현재 기기에서 사용할 수 없습니다",
    "connections.environmentLocalFolder": "로컬 폴더",
    "connections.environmentDataSources": "데이터 소스",
    "connections.environmentNoAnalyses": "아직 분석 아티클이 없습니다",
    "connections.loadingConnections": "연결 불러오는 중…",
    "connections.loadingProjects": "프로젝트 불러오는 중…",
    "connections.unassigned": "미분류",
    "connections.dataSourceCatalogNavigation":
      "데이터 소스 카탈로그 탐색",
    "connections.dataSources": "데이터 소스",
    "connections.dataSourcesAndDrivers": "데이터 소스 및 드라이버",
    "connections.editData": "데이터 편집",
    "connections.databaseFile": "데이터베이스 파일 경로",
    "connections.databaseRequiredHint": "MongoDB에는 필수입니다",
    "connections.bigQueryProjectId": "GCP 프로젝트 ID",
    "connections.bigQueryDataset": "데이터셋",
    "connections.bigQueryAuthenticationMode": "로그인 방식",
    "connections.bigQueryGoogleAccount": "Google 계정",
    "connections.bigQueryServiceAccount": "서비스 계정",
    "connections.bigQueryAuthenticating": "Google 계정 연결 중…",
    "connections.bigQueryPreparingTools": "검증된 Google 도구 준비 중…",
    "connections.bigQueryConnected": "연결됨",
    "connections.bigQueryNotConnected": "연결되지 않음",
    "connections.bigQueryConnectGoogleAccount": "Google 계정 연결",
    "connections.bigQueryChangeGoogleAccount": "계정 변경",
    "connections.bigQueryReconnectGoogleAccount": "Google 계정 다시 연결",
    "connections.bigQueryReconnecting": "다시 연결 중…",
    "connections.bigQueryAuthenticationExpired":
      "Google Cloud에서 계정 재인증을 요구합니다.",
    "connections.bigQueryChooseCredentialFile": "인증 JSON 선택",
    "connections.bigQueryReplaceCredentialFile": "인증 JSON 교체",
    "connections.bigQueryProjectsLoading": "접근 가능한 프로젝트 불러오는 중…",
    "connections.bigQueryDatasetsLoading": "데이터셋 불러오는 중…",
    "connections.bigQuerySelectProject": "프로젝트 선택",
    "connections.bigQuerySelectDataset": "데이터셋 선택",
    "connections.bigQueryProjectPlaceholder": "GCP 프로젝트 ID 입력",
    "connections.bigQueryDatasetPlaceholder": "데이터셋 ID 입력",
    "connections.bigQueryNoProjects":
      "접근 가능한 프로젝트가 없습니다. 프로젝트 ID를 직접 입력할 수도 있습니다.",
    "connections.bigQueryNoDatasets":
      "이 프로젝트에 접근 가능한 데이터셋이 없습니다. 데이터셋 ID를 직접 입력할 수도 있습니다.",
    "connections.bigQueryErrorTimeout":
      "Google Cloud 응답이 지연되었습니다. 다시 시도하세요.",
    "connections.bigQueryErrorNetwork":
      "Google Cloud에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.",
    "connections.bigQueryAuthenticationFailed":
      "Google 로그인 상태를 확인하지 못했습니다. 계정을 다시 연결하세요.",
    "connections.bigQueryAuthenticationPermissionError":
      "로컬 보안 경계가 Google 로그인을 차단했습니다. 다시 연결하세요.",
    "connections.bigQueryProjectsLoadFailed":
      "프로젝트를 불러오지 못했습니다. Google 계정을 확인하고 다시 시도하세요.",
    "connections.bigQueryProjectsPermissionError":
      "연결한 Google 계정에 GCP 프로젝트 목록을 볼 권한이 없습니다.",
    "connections.bigQueryDatasetsLoadFailed":
      "데이터셋을 불러오지 못했습니다. 이 프로젝트의 BigQuery API 사용 설정을 확인한 뒤 다시 시도하세요.",
    "connections.bigQueryDatasetsPermissionError":
      "연결한 Google 계정에 이 프로젝트의 데이터셋 목록을 볼 권한이 없습니다.",
    "connections.bigQueryRuntimePreparationFailed":
      "공식 Google 도구를 준비하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.",
    "connections.bigQueryRuntimeVerificationError":
      "다운로드한 Google 도구가 로컬 검증을 통과하지 못했습니다. 다시 다운로드하세요.",
    "connections.bigQueryLocation": "리전 (선택)",
    "connections.bigQueryLocationPlaceholder": "자동 감지, 예: US 또는 asia-northeast3",
    "connections.bigQueryMaximumBytesBilled": "최대 과금 바이트",
    "connections.bigQueryCliReady": "공식 Google 도구 준비됨",
    "connections.bigQueryCliRequired": "첫 연결 때 자동으로 준비됨",
    "connections.bigQueryCliStatus": "Google 도구",
    "connections.bigQuerySecurityNote":
      "연결에 필요한 도구는 DopeDB가 자동으로 준비합니다. 브라우저에서 Google에 로그인하거나 서비스 계정 파일을 선택하세요. 인증 정보는 이 기기에만 보관됩니다. 조회만 실행할 수 있으며 연결별 과금 한도를 적용합니다.",
    "connections.bigQuerySharedSecurityNote":
      "이 공유 레코드에는 BigQuery 프로젝트와 데이터셋 식별자만 들어갑니다. 각 멤버가 Google 자격 증명을 로컬에서 연결하며, 토큰이나 서비스 계정 키는 워크스페이스를 통해 공유되지 않습니다.",
    "connections.discoveredSchemaCount": "스키마 {count}개",
    "connections.defaultSchema": "기본 스키마",
    "connections.defaultValue": "기본값",
    "connections.ddlTitle": "{table} - DDL",
    "connections.driver": "드라이버",
    "connections.driverAutomatic": "자동 선택 (권장)",
    "connections.driverBundled": "앱에 내장됨",
    "connections.driverSystem": "시스템에서 제공",
    "connections.driverSystemRequired": "DopeDB 외부에서 설치 필요",
    "connections.driverCatalogLoading": "드라이버 목록 불러오는 중...",
    "connections.driverCatalogScope":
      "앱이 진단하거나 설치할 수 있는 드라이버만 표시합니다. 지원하지 않는 드라이버를 사용 가능한 것처럼 표시하지 않습니다.",
    "connections.driverDetails": "드라이버 상세",
    "connections.driverDownload": "다운로드",
    "connections.driverDownloadRequired": "다운로드 필요",
    "connections.driverDownloading": "다운로드 중...",
    "connections.driverHint":
      "자동 선택은 엔진과 연결 방식에 맞는 우선순위가 가장 높은 드라이버를 사용합니다.",
    "connections.driverInstallation": "설치 상태",
    "connections.driverInstalled": "{name} 드라이버가 설치되었습니다.",
    "connections.driverInstalledStatus": "설치됨",
    "connections.driverCapabilities": "드라이버 기능",
    "connections.driverCapability.sql": "SQL 쿼리",
    "connections.driverCapability.documentQuery": "문서 쿼리",
    "connections.driverCapability.transactions": "트랜잭션",
    "connections.driverCapability.introspection": "스키마 탐색",
    "connections.driverCapability.collections": "컬렉션",
    "connections.driverCapability.schemaDiff": "스키마 비교",
    "connections.driverCapability.monitoring": "모니터링",
    "connections.drivers": "드라이버",
    "connections.driverVersion": "버전",
    "connections.problemDriverCatalogUnavailable":
      "드라이버 목록을 불러오지 못했습니다.",
    "connections.problemDriverInstallRequired":
      "이 데이터 소스를 테스트하거나 저장하기 전에 선택한 드라이버를 설치하세요.",
    "connections.problemDriverUnavailable":
      "이 데이터베이스와 연결 방식에 맞는 설치된 드라이버가 없습니다.",
    "connections.problemDuplicateName":
      "다른 데이터 소스가 이미 이 이름을 사용합니다.",
    "connections.problemHostInvalid":
      "URL scheme과 공백 없이 호스트 이름을 입력하세요.",
    "connections.problemHostRequired": "데이터베이스 호스트를 입력하세요.",
    "connections.problemConnectionUrlInvalid":
      "지원되는 PostgreSQL, MySQL, SQLite, MongoDB, BigQuery 또는 Cloudflare D1 URL을 입력하세요.",
    "connections.problemCloudflareAccountRequired":
      "Cloudflare 계정 ID를 입력하세요.",
    "connections.problemCloudflareAccountInvalid":
      "Cloudflare 계정 ID는 32자리 16진수여야 합니다.",
    "connections.problemCloudflareD1DatabaseRequired":
      "D1 데이터베이스 ID를 입력하세요.",
    "connections.problemCloudflareD1DatabaseInvalid":
      "올바른 D1 데이터베이스 UUID를 입력하세요.",
    "connections.problemCloudflareD1ReadTokenRequired":
      "이 기기에서 사용할 D1 Read API 토큰을 입력하세요.",
    "connections.problemTimeZoneInvalid":
      "UTC, Asia/Seoul 또는 +09:00 같은 올바른 시간대를 입력하세요.",
    "connections.problemKeepAliveInvalid":
      "10초부터 86400초 사이의 keep-alive 간격을 입력하세요.",
    "connections.problemAutoDisconnectInvalid":
      "30초부터 86400초 사이의 자동 연결 해제 간격을 입력하세요.",
    "connections.problemStartupScriptTooLong":
      "시작 스크립트는 4096자 이내로 입력하세요.",
    "connections.problemStartupScriptSkippedByPooler":
      "이 연결은 서버 세션을 공유하는 트랜잭션 모드 풀러를 거치므로 시작 스크립트가 실행되지 않습니다. 적용하려면 세션 모드 또는 직접 연결을 사용하세요.",
    "connections.problemSshAliasInvalid":
      "영문자, 숫자, 점, 밑줄 또는 하이픈으로 된 OpenSSH Host 별칭을 입력하세요.",
    "connections.problemPostgresUsernameInvalid":
      "이 PostgreSQL 사용자 이름의 앞이나 뒤에 공백이 있거나 제어 문자가 들어 있습니다. 실제 역할 이름과 정확히 같은지 확인하세요.",
    "connections.problemSshTunnelSingleHostRequired":
      "SSH 터널에는 데이터베이스 호스트 하나만 사용할 수 있습니다.",
    "connections.problemSshTunnelSrvUnsupported":
      "MongoDB SRV 검색은 단일 호스트 SSH 터널과 함께 사용할 수 없습니다.",
    "connections.problemMongoDatabaseRequired":
      "MongoDB 데이터베이스 이름을 입력하세요.",
    "connections.problemTargetDatabaseRequired": "저장하기 전에 대상 데이터베이스를 선택하세요. 서버 연결은 먼저 검사할 수 있습니다.",
    "connections.problemTargetDatabaseInvalid": "제어 문자가 없는 255 UTF-8 바이트 이하의 데이터베이스 이름을 입력하세요.",
    "connections.databaseDiscoveryLoading": "데이터베이스 찾는 중…",
    "connections.databaseDiscoveryEmpty": "찾은 데이터베이스가 없습니다. 데이터베이스 이름을 직접 입력하세요.",
    "connections.databaseDiscoveryFailed": "데이터베이스 목록을 불러오지 못했습니다. 연결 정보를 확인하고 다시 시도하거나 이름을 직접 입력하세요.",
    "connections.databaseDiscoveryRetry": "데이터베이스 찾기",
    "connections.problemBigQueryProjectRequired":
      "GCP 프로젝트 ID를 입력하세요.",
    "connections.problemBigQueryProjectInvalid":
      "6~30자의 소문자 GCP 프로젝트 ID를 입력하세요.",
    "connections.problemBigQueryDatasetRequired":
      "BigQuery 데이터셋 ID를 입력하세요.",
    "connections.problemBigQueryDatasetInvalid":
      "데이터셋 ID에는 영문자, 숫자, 밑줄만 사용하세요.",
    "connections.problemBigQueryLocationInvalid":
      "BigQuery 리전에는 영문자, 숫자, 하이픈만 사용하세요.",
    "connections.problemBigQueryMaximumBytesBilledInvalid":
      "최대 과금 바이트는 1바이트부터 10TiB 사이로 입력하세요.",
    "connections.problemNameRequired": "데이터 소스 이름을 입력하세요.",
    "connections.problemPortInvalid":
      "1부터 65535 사이의 포트를 입력하세요.",
    "connections.problemRuntime": "연결 검사 실패",
    "connections.problemSaveFailed": "연결을 저장하지 못했습니다",
    "connections.problemDeleteFailed": "연결을 삭제하지 못했습니다",
    "connections.problemDriverFailed": "드라이버를 설치하지 못했습니다",
    "connections.problemRefreshFailed": "워크스페이스 데이터를 새로고침하지 못했습니다",
    "connections.workspaceRefreshed":
      "워크스페이스 데이터를 새로고침했습니다. 연결을 다시 테스트하세요.",
    "connections.workspaceRefreshFailed":
      "워크스페이스 데이터를 새로고침하지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요.",
    "connections.testFailure.sshClientMissingTitle": "시스템 SSH를 사용할 수 없습니다",
    "connections.testFailure.sshClientMissingRecovery":
      "시스템 SSH 클라이언트를 설치하거나 복구한 뒤 SSH/SSL에서 SSH Host 별칭을 확인하세요.",
    "connections.testFailure.sshConfigurationTitle": "SSH 설정이 거부되었습니다",
    "connections.testFailure.sshConfigurationRecovery":
      "Host 별칭과 시스템 SSH 설정의 해당 항목을 확인하세요.",
    "connections.testFailure.sshHostKeyTitle": "SSH 호스트 신원을 확인하지 못했습니다",
    "connections.testFailure.sshHostKeyRecovery":
      "known-hosts 데이터를 변경하기 전에 관리자와 호스트 신원을 확인한 뒤 SSH Host 별칭을 점검하세요.",
    "connections.testFailure.sshAuthenticationTitle": "SSH 인증에 실패했습니다",
    "connections.testFailure.sshAuthenticationRecovery":
      "시스템 SSH 에이전트, 키와 Host 별칭을 확인하세요. 데이터베이스 비밀번호는 SSH 인증을 제어하지 않습니다.",
    "connections.testFailure.sshForwardingTitle": "SSH 포워딩을 시작하지 못했습니다",
    "connections.testFailure.sshForwardingRecovery":
      "SSH Host 별칭, 네트워크 경로와 대상 서버의 포워딩 정책을 확인하세요.",
    "connections.testFailure.sshTimeoutTitle": "SSH 터널 시간이 초과되었습니다",
    "connections.testFailure.sshTimeoutRecovery":
      "SSH Host 별칭과 네트워크 연결을 확인한 뒤 다시 테스트하세요.",
    "connections.testFailure.sshUnknownTitle": "SSH 터널을 설정하지 못했습니다",
    "connections.testFailure.sshUnknownRecovery":
      "다시 테스트하기 전에 SSH Host 별칭과 시스템 SSH 설정을 검토하세요.",
    "connections.testFailure.timeoutNetworkTitle": "데이터베이스에 연결할 수 없습니다",
    "connections.testFailure.timeoutNetworkRecovery":
      "호스트, 포트, 네트워크 접근과 SSH Host 별칭을 확인한 뒤 다시 테스트하세요.",
    "connections.testFailure.authenticationTitle": "인증에 실패했습니다",
    "connections.testFailure.authenticationRecovery":
      "이 기기에 저장된 사용자와 비밀번호를 확인한 뒤 다시 테스트하세요.",
    "connections.testFailure.tlsTitle": "TLS 검증에 실패했습니다",
    "connections.testFailure.tlsRecovery":
      "SSH/SSL에서 TLS 모드와 인증서 경로를 확인한 뒤 다시 테스트하세요.",
    "connections.testFailure.databaseConfigTitle": "데이터베이스 설정이 거부되었습니다",
    "connections.testFailure.databaseConfigRecovery":
      "데이터베이스 이름과 연결 옵션을 확인한 뒤 다시 테스트하세요.",
    "connections.testFailure.unknownTitle": "연결 검사에 실패했습니다",
    "connections.testFailure.unknownRecovery":
      "호스트, 포트, 데이터베이스와 연결 옵션을 확인한 뒤 다시 테스트하세요.",
    "connections.testFailure.managedTitle":
      "워크스페이스 관리형 접근을 발급하지 못했습니다",
    "connections.testFailure.managedManagerRecovery":
      "아래 읽기 전용 연결값은 수정하지 마세요. 워크스페이스 관리 → 공급자에서 이 DB를 열어 공급자 계정과 DB 등록 상태를 확인한 뒤 다시 테스트하세요.",
    "connections.testFailure.managedMemberRecovery":
      "이 연결은 이 기기가 아니라 워크스페이스에서 관리됩니다. 워크스페이스 관리자에게 공급자 계정, DB 등록과 내 접근 권한 확인을 요청한 뒤 다시 테스트하세요.",
    "connections.testFailure.memberBindingRecovery":
      "이 공유 연결의 사용자명, 비밀번호, SSH Host 별칭, TLS 파일은 이 기기에 저장됩니다. 자격 증명 연결을 열어 확인한 뒤 다시 테스트하세요.",
    "connections.testFailure.savedCredentialRecovery":
      "이 기기에 저장된 비밀번호로 검사했습니다. 비밀번호가 바뀌었거나 이 기기에 남아 있지 않다면 다시 입력하고 저장하세요.",
    "connections.testFailure.savedCredentialEndpointChangedTitle":
      "엔드포인트가 바뀌어 저장된 비밀번호를 다시 입력해야 합니다",
    "connections.testFailure.savedCredentialEndpointChangedRecovery":
      "저장된 비밀번호는 저장할 때의 호스트, 포트, 사용자, SSH Host 별칭과 그때보다 약하지 않은 TLS 설정에서만 사용하므로 아무것도 보내지 않았습니다. 이 설정의 비밀번호를 입력하거나 이전 설정으로 되돌리세요.",
    "connections.testFailure.sharedConnectionChangedTitle":
      "워크스페이스에서 이 공유 연결이 변경되었습니다",
    "connections.testFailure.sharedConnectionChangedRecovery":
      "이 기기에는 이전 버전이 남아 있어 연결을 열지 않았습니다. 워크스페이스 데이터를 새로고침한 뒤 다시 테스트하세요.",
    "connections.testFailure.workspaceSignInRequiredTitle":
      "워크스페이스에 다시 로그인해야 합니다",
    "connections.testFailure.workspaceSignInRequiredRecovery":
      "이 기기의 워크스페이스 로그인이 만료되어 공유 접근을 확인하지 못했고 연결을 열지 않았습니다. 다시 로그인한 뒤 테스트하세요.",
    "connections.testFailure.credentialStoreDeniedRecovery":
      "이 기기의 자격 증명 저장소가 저장된 비밀번호를 내주지 않아 아무것도 보내지 않았습니다. DopeDB의 사용을 허용하고, 요청하면 키체인 잠금을 해제한 뒤 다시 테스트하세요.",
    "connections.testFailure.lockTimeoutTitle":
      "다른 세션이 검사에 필요한 잠금을 잡고 있습니다",
    "connections.testFailure.lockTimeoutRecovery":
      "다른 세션이 잡은 잠금을 기다리다 데이터베이스가 대기를 멈췄습니다. 연결 설정은 바꿀 필요가 없으니 잠시 후 다시 테스트하세요.",
    "connections.saveFailure.projectBinding":
      "연결은 저장했지만 프로젝트에 추가하지 못했습니다. 다시 저장해 재시도하세요.",
    "connections.saveFailure.credentialStore":
      "이 컴퓨터의 보안 저장소에 비밀번호를 저장하지 못했습니다. DopeDB의 접근을 허용한 뒤 다시 저장하세요.",
    "connections.saveFailure.configuration":
      "이 연결 설정을 받아들이지 않았습니다. 문제 목록의 항목을 확인한 뒤 다시 저장하세요.",
    "connections.saveFailure.blocked":
      "현재 워크스페이스 역할로는 여기서 이 연결을 변경할 수 없습니다.",
    "connections.saveFailure.notFound":
      "이 연결이 더 이상 없습니다. 편집기를 닫고 탐색기에서 다시 여세요.",
    "connections.saveFailure.workspaceUnavailable":
      "워크스페이스 서비스에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요.",
    "connections.saveFailure.unknown":
      "연결을 저장하지 못했습니다. 다시 시도하세요.",
    "connections.deleteFailure.blocked":
      "현재 워크스페이스 역할로는 이 연결을 삭제할 수 없습니다.",
    "connections.deleteFailure.unknown":
      "연결을 삭제하지 못했습니다. 다시 시도하세요.",
    "connections.authCleanupDeferred":
      "이 연결을 위해 만든 임시 로그인을 이 기기에서 제거하지 못했습니다.",
    "connections.testCancel": "테스트 중지",
    "connections.testUnavailableSharedDraft":
      "공유 연결을 먼저 저장하세요. 테스트는 저장된 버전을 확인합니다.",
    "connections.testUnavailableManagedCooldown":
      "워크스페이스 관리형 접근은 {seconds}초 뒤에 다시 확인할 수 있습니다.",
    "connections.parameterReserved":
      "이 옵션은 다른 탭의 전용 설정이 소유하므로 여기서는 무시됩니다.",
    "connections.parameterDuplicate":
      "같은 이름이 두 번 이상 있습니다. 마지막 값이 사용됩니다.",
    "connections.discardChangesTitle": "저장하지 않은 변경을 버릴까요?",
    "connections.discardChangesBody":
      "입력한 비밀번호를 포함해 이 연결의 변경 내용이 아직 저장되지 않았습니다.",
    "connections.keepEditing": "계속 편집",
    "connections.discardChanges": "변경 버리기",
    "connections.driverDownloadFailed": "{name}을(를) 설치하지 못했습니다. 다시 시도하세요.",
    "connections.driverDownloadNetworkFailed":
      "{name}을(를) 내려받지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요.",
    "connections.tls": "TLS",
    "connections.tlsEnabledOnDevice": "이 기기에서 사용",
    "connections.tlsDisabledOnDevice": "이 기기에서 사용 안 함",
    "connections.tlsMemberOwned":
      "MongoDB TLS 사용 여부와 인증서 파일은 구성원마다 자격 증명 연결에서 정합니다.",
    "connections.credentialVerified": "확인됨",
    "connections.credentialSavedOnDevice": "이 기기에 저장됨",
    "connections.removeSavedPassword": "저장된 비밀번호 삭제",
    "connections.enterPassword": "비밀번호 입력",
    "connections.savedPasswordRemovalPending":
      "저장하면 이 기기에 저장된 비밀번호가 삭제됩니다.",
    "connections.localDiscoveryRetry": "이 컴퓨터에서 다시 찾기",
    "connections.catalogIssue.managed":
      "카탈로그를 불러오기 전에 이 워크스페이스 관리형 연결을 복구해야 합니다.",
    "connections.catalogIssue.blocked":
      "현재 워크스페이스 정책이 이 데이터베이스 접근을 차단합니다.",
    "connections.catalogIssue.cancelled":
      "카탈로그 요청이 취소되었습니다.",
    "connections.catalogIssue.network":
      "네트워크를 사용할 수 없어 카탈로그를 불러오지 못했습니다.",
    "connections.catalogIssue.timeout":
      "카탈로그 요청 시간이 초과되었습니다.",
    "connections.catalogIssue.notFound":
      "이 연결 리소스를 더 이상 사용할 수 없습니다.",
    "connections.catalogIssue.unknown":
      "카탈로그를 안전하게 불러오지 못했습니다. 연결 설정을 검토하세요.",
    "connections.catalogIssue.ddl":
      "DDL을 안전하게 불러오지 못했습니다.",
    "connections.catalogIssue.project":
      "프로젝트를 불러오지 못했습니다.",
    "connections.catalogIssue.bindings":
      "프로젝트 데이터베이스를 불러오지 못했습니다.",
    "connections.catalogIssue.sources":
      "프로젝트 데이터 소스를 불러오지 못했습니다.",
    "connections.catalogIssue.analyses":
      "프로젝트 분석을 불러오지 못했습니다.",
    "connections.problems": "문제",
    "connections.problemsEmpty": "구성 문제를 찾지 못했습니다.",
    "connections.problemSqliteFileRequired":
      "SQLite 데이터베이스 파일을 선택하세요.",
    "connections.duplicate": "연결 복제",
    "connections.demoCreating": "Demo SQLite 생성 중...",
    "connections.demoCreated": "Demo SQLite가 준비되었습니다.",
    "connections.demoDescription":
      "샘플 데이터가 포함된 로컬 데이터베이스 생성",
    "connections.demoSqlite": "Demo SQLite 생성",
    "connections.edit": "연결 편집",
    "connections.engine": "엔진",
    "connections.enableTls": "TLS 사용",
    "connections.environment": "환경",
    "connections.environmentHint": "(선택 - 사이드바에 표시)",
    "connections.fileAndSample": "파일 및 샘플",
    "connections.sampleDatabase": "샘플 데이터베이스",
    "connections.expand": "펼치기",
    "connections.expandMetadata": "{table} 메타데이터 펼치기",
    "connections.compareSchemaStructure": "스키마 구조 비교",
    "connections.searchLoadedObjects": "적재된 Explorer 객체 검색",
    "connections.filterLoadedObjectsPlaceholder":
      "적재된 테이블, 뷰, 객체 검색",
    "connections.filterResultCount": "객체 {count}개",
    "connections.functions": "함수 ({count})",
    "connections.host": "호스트",
    "connections.general": "일반",
    "connections.importClipboard": "클립보드 URL 가져오기",
    "connections.introspectionScope": "인트로스펙션 범위",
    "connections.introspectionScopeBody":
      "데이터베이스 탐색기, 전체 검색, 스키마 다이어그램에 표시할 네임스페이스와 객체 이름을 선택합니다.",
    "connections.loadingSchema": "스키마 불러오는 중...",
    "connections.loadingMetadata": "메타데이터 불러오는 중...",
    "connections.loadingSchemaScope": "스키마 찾는 중...",
    "connections.materializedViews": "구체화된 뷰 ({count})",
    "connections.indexes": "인덱스 ({count})",
    "connections.keys": "키 ({count})",
    "connections.name": "이름",
    "connections.new": "새 연결",
    "connections.noConnections": "아직 연결이 없습니다.",
    "connections.noDataSourceResults":
      "검색과 일치하는 데이터 소스가 없습니다.",
    "connections.noDriverResults":
      "검색과 일치하는 드라이버가 없습니다.",
    "connections.noObjects": "데이터베이스 객체가 없습니다.",
    "connections.noMetadata": "컬럼, 키 또는 인덱스 메타데이터가 없습니다.",
    "connections.noSchemasDiscovered": "이 데이터 소스에서 스키마를 찾지 못했습니다.",
    "connections.noParameters": "고급 매개변수가 없습니다.",
    "connections.noTables": "테이블이 없습니다.",
    "connections.noTablesMatch":
      '적재된 Explorer 객체 중 "{filter}"와 일치하는 항목이 없습니다.',
    "connections.objectOn": "대상",
    "connections.objectNamePattern": "객체 이름 패턴",
    "connections.objectNamePatternHint":
      "*와 ? 와일드카드를 사용합니다. 탐색기, 전체 검색, 스키마 다이어그램이 같은 필터를 사용합니다.",
    "connections.password": "비밀번호",
    "connections.passwordStored": "비밀번호 입력",
    "connections.passwordStoredExisting": "저장됨",
    "connections.options": "옵션",
    "connections.notNull": "NULL 불가",
    "connections.nullable": "NULL 허용",
    "connections.parameterKey": "매개변수",
    "connections.parameterValue": "값",
    "connections.port": "포트",
    "connections.procedures": "프로시저 ({count})",
    "connections.providerAuto": "자동 감지",
    "connections.providerGcpCloudSql": "GCP Cloud SQL",
    "connections.providerCloudflareD1": "Cloudflare D1",
    "connections.providerGeneric": "일반 / 자체 호스팅",
    "connections.providerBigQueryCli": "Google BigQuery 공식 CLI",
    "connections.providerNeon": "Neon",
    "connections.neonBranch": "Neon 브랜치",
    "connections.neonBranchTarget": "Neon 브랜치 {name} ({id})",
    "connections.neonBranchState": "상태: {state}",
    "connections.providerPlanetScale": "PlanetScale",
    "connections.searchDataSources": "데이터 소스 검색",
    "connections.searchDrivers": "드라이버 검색",
    "connections.reallyDeleteDemo":
      "이 연결과 Demo SQLite 파일을 삭제할까요?",
    "connections.readOnlyDefault": "명령줄 셸을 읽기 전용으로 시작",
    "connections.readOnlyDefaultBody":
      "설정 → 명령줄의 고급 셸과 이 연결의 CLI 요약에 적용됩니다. 쿼리, 테이블 편집기, Agent의 쓰기 권한은 설정 → 안전에서 관리합니다.",
    "connections.keepAlive": "다음 간격마다 keep-alive 쿼리 실행",
    "connections.keepAliveSeconds": "keep-alive 간격(초)",
    "connections.refreshSchema": "스키마 새로고침",
    "connections.safety": "안전",
    "connections.seconds": "초",
    "connections.schemaDiffMissingSection": "이 환경에 없음 ({count})",
    "connections.schemaDiffPendingChip": "비교",
    "connections.schemaDiffPendingTitle": "스키마 비교 화면을 열면 이 DB를 불러옵니다",
    "connections.schemaDiffTableAdded": "이 DB에만 있으며 기준 DB에는 없습니다",
    "connections.schemaDiffTableChanged":
      "기준 DB와 비교: +{added} 컬럼, −{missing} 컬럼, ~{changed} 변경",
    "connections.schemaDiffTableMissing": "이 DB에는 없고 기준 DB에는 있습니다",
    "connections.schemaDiffTitle":
      "기준 DB와 비교: +{added} 이 DB에만 있음, −{missing} 이 DB에 없음, ~{changed} 변경",
    "connections.schemaComparison": "스키마 비교 그룹",
    "connections.schemaGroup": "스키마 그룹",
    "connections.schemaGroupConfirmGroup":
      '"{connection}"을(를) 스키마 그룹 "{group}"에 추가할까요?',
    "connections.schemaGroupConfirmPair":
      '"{source}"와 "{target}"을(를) 같은 스키마 그룹 "{group}"으로 묶을까요?',
    "connections.schemaGroupPlaceholder": "billing-api",
    "connections.schemaGroupTitle": "{group} 스키마 그룹",
    "connections.schemaScopeSaveFirst":
      "이 데이터 소스를 먼저 적용한 뒤 돌아와 스키마를 찾으세요.",
    "connections.schemas": "스키마",
    "connections.schemasBody":
      "같은 스키마 그룹의 연결은 환경별로 비교할 수 있습니다.",
    "connections.schemaGroupUpdated": "스키마 그룹이 업데이트되었습니다",
    "connections.sequences": "시퀀스 ({count})",
    "connections.showDdl": "CREATE DDL 보기",
    "connections.showRowCounts": "행 수 표시",
    "connections.supportedProviders": "지원 연결 방식",
    "connections.srv": "mongodb+srv:// 사용 (SRV DNS 조회)",
    "connections.sslMode": "SSL 모드",
    "connections.sslConfiguration": "SSL 구성",
    "connections.sqliteNoTls": "SQLite는 네트워크 TLS 연결을 사용하지 않습니다.",
    "connections.startupScript": "시작 스크립트",
    "connections.startupScriptHint":
      "새 PostgreSQL 또는 MySQL 연결을 만들 때 허용된 session SET 문만 실행합니다.",
    "connections.startupScriptPlaceholder":
      "SET application_name = 'DopeDB';",
    "connections.sshSsl": "SSH/SSL",
    "connections.sshHostAlias": "OpenSSH Host 별칭",
    "connections.sshHostAliasHint":
      "선택 사항입니다. DopeDB는 시스템 ssh만 실행하며 키, passphrase, agent, ProxyJump, host-key 정책은 ~/.ssh/config와 OS에 남습니다.",
    "connections.sshHostAliasPlaceholder": "database-bastion",
    "connections.sshTunnel": "SSH 터널",
    "connections.tables": "테이블 ({count})",
    "connections.test": "연결 테스트",
    "connections.tabList": "데이터 소스 설정",
    "connections.testing": "테스트 중...",
    "connections.triggers": "트리거 ({count})",
    "connections.timeZone": "시간대",
    "connections.timeZonePlaceholder": "UTC, Asia/Seoul, +09:00",
    "connections.transactionAuto": "자동",
    "connections.transactionControl": "트랜잭션 제어",
    "connections.transactionOperationScoped":
      "기본은 자동 실행입니다. 쿼리와 데이터 툴바에서 연결 단위 수동 트랜잭션을 열어 커밋하거나 롤백할 수 있습니다.",
    "connections.unique": "고유",
    "connections.user": "사용자",
    "connections.userPassword": "사용자 및 비밀번호",
    "connections.views": "뷰 ({count})",
  },
);
