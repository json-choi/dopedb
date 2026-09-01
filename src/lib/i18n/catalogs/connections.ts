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
    "connections.collapseAll": "Collapse all",
    "connections.collections": "Collections ({count})",
    "connections.columns": "{count} columns",
    "connections.collapseMetadata": "Collapse metadata for {table}",
    "connections.connectionDeleted": "Connection deleted",
    "connections.connectionDuplicated":
      "Duplicate draft is ready. Apply or OK to save it.",
    "connections.connectionMenu": "Connection actions",
    "connections.projectMenu": "Project actions",
    "connections.connectionOk": "Connection OK",
    "connections.managedWorkspace.label": "Endpoint and credentials",
    "connections.managedWorkspace.status": "Managed in Workspace Web",
    "connections.managedWorkspace.managerDescription":
      "The real endpoint and a short-lived credential are issued when this database is used. Change or repair the provider account and database registration in Workspace Web.",
    "connections.managedWorkspace.memberDescription":
      "The real endpoint and a short-lived credential are issued by the Workspace. Ask a Workspace admin to check the provider account and database registration if access fails.",
    "connections.managedWorkspace.securityNote":
      "This Desktop profile intentionally contains no editable host or password. Workspace Web owns the provider target and issues member-specific, short-lived access only when it is needed.",
    "connections.managedWorkspace.open": "Open this database in Workspace Web",
    "connections.managedWorkspace.opening": "Opening Workspace Web…",
    "connections.managedWorkspace.openFailed":
      "Could not open this database in Workspace Web: {error}",
    "connections.connectionSaved": "Connection saved",
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
    "connections.reallyDeleteProject": "Delete this Project?",
    "connections.projectDeleted":
      "Deleted {project}. Its database connections are now Unassigned.",
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
    "connections.environmentNamePlaceholder": "e.g. main or prod",
    "connections.environmentSetupTitle": "Add Environment",
    "connections.environmentSetupDescription":
      "Add an Environment inside a Project, then connect the databases and source code that belong to that exact scope.",
    "connections.creatingEnvironment": "Adding…",
    "connections.refreshExplorer": "Refresh Explorer",
    "connections.environmentRiskClass": "Risk class",
    "connections.environmentRiskDevelopment": "Development",
    "connections.environmentRiskStaging": "Staging",
    "connections.environmentRiskProduction": "Production",
    "connections.environmentRiskTest": "Test",
    "connections.environmentRiskCustom": "Custom",
    "connections.projectSetupNextStep":
      "After creation, add databases and source code inside this Environment.",
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
    "connections.bigQueryAuthenticating": "Connecting with Google Cloud CLI…",
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
      "Google sign-in and service-account import run inside the unmodified official Google Cloud CLI. DopeDB reuses a verified system installation or prepares a pinned app-owned copy; it never reads or stores Google tokens or key contents. Every SELECT is server dry-run and must stay under this connection's byte-billing ceiling.",
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
      "Enter a supported PostgreSQL, MySQL, SQLite, or MongoDB URL.",
    "connections.problemTimeZoneInvalid":
      "Enter a valid time zone such as UTC, Asia/Seoul, or +09:00.",
    "connections.problemKeepAliveInvalid":
      "Enter a keep-alive interval from 10 through 86400 seconds.",
    "connections.problemAutoDisconnectInvalid":
      "Enter an auto-disconnect interval from 30 through 86400 seconds.",
    "connections.problemStartupScriptTooLong":
      "Keep the startup script within 4096 characters.",
    "connections.problemSshAliasInvalid":
      "Use an OpenSSH Host alias with letters, numbers, dots, underscores, or hyphens.",
    "connections.problemSshTunnelSingleHostRequired":
      "An SSH tunnel requires one database host.",
    "connections.problemSshTunnelSrvUnsupported":
      "MongoDB SRV discovery cannot use a single-host SSH tunnel.",
    "connections.problemMongoDatabaseRequired":
      "Enter the MongoDB database name.",
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
      "Review the technical details, correct the connection settings, and test again.",
    "connections.testFailure.managedTitle":
      "Workspace-managed access could not be issued",
    "connections.testFailure.managedManagerRecovery":
      "Do not edit the read-only connection values below. Open this database in Workspace Web, check its provider account and database registration, then return here and test again.",
    "connections.testFailure.managedMemberRecovery":
      "This connection is controlled in Workspace Web, not on this device. Ask a Workspace admin to check its provider account, database registration, and your access, then test again.",
    "connections.testFailure.technicalDetails": "Technical details",
    "connections.testFailure.transportDetail":
      "The Desktop connection-test transport failed before returning a typed receipt.",
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
    "connections.expandAll": "Expand all",
    "connections.expandMetadata": "Expand metadata for {table}",
    "connections.compareSchemaStructure": "Compare Schema Structure",
    "connections.filterTables": "Filter database objects...",
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
    "connections.passwordStored": "stored securely",
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
    "connections.providerGeneric": "Generic / self-hosted",
    "connections.providerNeon": "Neon",
    "connections.neonBranch": "Neon branch",
    "connections.neonBranchTarget": "Neon branch {name} ({id})",
    "connections.neonBranchState": "State: {state}",
    "connections.providerPlanetScale": "PlanetScale",
    "connections.searchDataSources": "Search data sources",
    "connections.searchDrivers": "Search drivers",
    "connections.reallyDeleteDemo":
      "Delete this connection and its Demo SQLite file?",
    "connections.readOnlyDefault": "Open read-only by default",
    "connections.readOnlyDefaultBody":
      "New consoles and table editors start in read-only mode.",
    "connections.keepAlive": "Run keep-alive query each",
    "connections.keepAliveSeconds":
      "Keep-alive interval in seconds",
    "connections.refreshSchema": "Refresh schema",
    "connections.saved": "Saved.",
    "connections.safety": "Safety",
    "connections.seconds": "seconds",
    "connections.schemaDiffInSync": "Schema matches the baseline",
    "connections.schemaDiffMissingSection": "Missing here ({count})",
    "connections.schemaDiffPendingChip": "diff",
    "connections.schemaDiffPendingTitle": "Open schema comparison to load this database",
    "connections.schemaDiffTableAdded": "Only in this database; missing from the baseline",
    "connections.schemaDiffTableChanged":
      "Compared with the baseline: +{added} columns, -{missing} columns, ~{changed} changed",
    "connections.schemaDiffTableMissing": "Missing in this database; exists in the baseline",
    "connections.schemaDiffTitle":
      "Compared with the baseline: +{added} only here, -{missing} missing here, ~{changed} changed",
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
    "connections.scrollFromEditor": "Scroll from Editor",
    "connections.viewOptions": "View Options",
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
    "connections.collapseAll": "모두 접기",
    "connections.collections": "컬렉션 ({count})",
    "connections.columns": "{count}개 컬럼",
    "connections.collapseMetadata": "{table} 메타데이터 접기",
    "connections.connectionDeleted": "연결이 삭제되었습니다",
    "connections.connectionDuplicated":
      "복제 초안을 만들었습니다. 적용 또는 확인으로 저장하세요.",
    "connections.connectionMenu": "연결 메뉴",
    "connections.projectMenu": "프로젝트 메뉴",
    "connections.connectionOk": "연결 정상",
    "connections.managedWorkspace.label": "엔드포인트 및 자격 증명",
    "connections.managedWorkspace.status": "워크스페이스 웹에서 관리됨",
    "connections.managedWorkspace.managerDescription":
      "이 DB를 사용할 때 실제 엔드포인트와 단기 자격 증명이 발급됩니다. 공급자 계정과 DB 등록의 변경·복구는 워크스페이스 웹에서 진행하세요.",
    "connections.managedWorkspace.memberDescription":
      "실제 엔드포인트와 단기 자격 증명은 워크스페이스가 발급합니다. 접근에 실패하면 워크스페이스 관리자에게 공급자 계정과 DB 등록 상태 확인을 요청하세요.",
    "connections.managedWorkspace.securityNote":
      "이 Desktop 프로필에는 편집할 호스트나 비밀번호가 의도적으로 들어 있지 않습니다. 워크스페이스 웹이 공급자 대상을 관리하고 필요할 때만 구성원별 단기 접근을 발급합니다.",
    "connections.managedWorkspace.open": "워크스페이스 웹에서 이 DB 열기",
    "connections.managedWorkspace.opening": "워크스페이스 웹 여는 중…",
    "connections.managedWorkspace.openFailed":
      "워크스페이스 웹에서 이 DB를 열지 못했습니다: {error}",
    "connections.connectionSaved": "연결이 저장되었습니다",
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
    "connections.reallyDeleteProject": "이 프로젝트를 삭제할까요?",
    "connections.projectDeleted":
      "{project} 프로젝트를 삭제했습니다. 데이터베이스 연결은 미분류로 이동했습니다.",
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
    "connections.environmentNamePlaceholder": "예: main 또는 prod",
    "connections.environmentSetupTitle": "환경 추가",
    "connections.environmentSetupDescription":
      "프로젝트 안에 환경을 추가한 다음, 그 범위에 속한 데이터베이스와 소스 코드를 연결합니다.",
    "connections.creatingEnvironment": "추가하는 중…",
    "connections.refreshExplorer": "탐색기 새로고침",
    "connections.environmentRiskClass": "위험 등급",
    "connections.environmentRiskDevelopment": "개발",
    "connections.environmentRiskStaging": "스테이징",
    "connections.environmentRiskProduction": "운영",
    "connections.environmentRiskTest": "테스트",
    "connections.environmentRiskCustom": "사용자 지정",
    "connections.projectSetupNextStep":
      "만든 다음 이 환경 안에 데이터베이스와 소스 코드를 추가합니다.",
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
    "connections.bigQueryAuthenticating": "Google Cloud CLI로 연결 중…",
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
      "Google 로그인과 서비스 계정 가져오기는 수정하지 않은 공식 Google Cloud CLI 안에서 실행됩니다. DopeDB는 검증된 시스템 설치를 재사용하거나 버전이 고정된 앱 전용 사본을 준비하며, Google 토큰이나 키 내용을 읽거나 저장하지 않습니다. 모든 SELECT를 서버에서 dry-run한 뒤 연결별 최대 과금 바이트를 넘지 않을 때만 실행합니다.",
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
      "지원되는 PostgreSQL, MySQL, SQLite 또는 MongoDB URL을 입력하세요.",
    "connections.problemTimeZoneInvalid":
      "UTC, Asia/Seoul 또는 +09:00 같은 올바른 시간대를 입력하세요.",
    "connections.problemKeepAliveInvalid":
      "10초부터 86400초 사이의 keep-alive 간격을 입력하세요.",
    "connections.problemAutoDisconnectInvalid":
      "30초부터 86400초 사이의 자동 연결 해제 간격을 입력하세요.",
    "connections.problemStartupScriptTooLong":
      "시작 스크립트는 4096자 이내로 입력하세요.",
    "connections.problemSshAliasInvalid":
      "영문자, 숫자, 점, 밑줄 또는 하이픈으로 된 OpenSSH Host 별칭을 입력하세요.",
    "connections.problemSshTunnelSingleHostRequired":
      "SSH 터널에는 데이터베이스 호스트 하나만 사용할 수 있습니다.",
    "connections.problemSshTunnelSrvUnsupported":
      "MongoDB SRV 검색은 단일 호스트 SSH 터널과 함께 사용할 수 없습니다.",
    "connections.problemMongoDatabaseRequired":
      "MongoDB 데이터베이스 이름을 입력하세요.",
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
      "기술 상세를 확인하고 연결 설정을 수정한 뒤 다시 테스트하세요.",
    "connections.testFailure.managedTitle":
      "워크스페이스 관리형 접근을 발급하지 못했습니다",
    "connections.testFailure.managedManagerRecovery":
      "아래 읽기 전용 연결값은 수정하지 마세요. 워크스페이스 웹에서 이 DB를 열어 공급자 계정과 DB 등록 상태를 확인한 뒤 돌아와 다시 테스트하세요.",
    "connections.testFailure.managedMemberRecovery":
      "이 연결은 이 기기가 아니라 워크스페이스 웹에서 관리됩니다. 워크스페이스 관리자에게 공급자 계정, DB 등록과 내 접근 권한 확인을 요청한 뒤 다시 테스트하세요.",
    "connections.testFailure.technicalDetails": "기술 상세",
    "connections.testFailure.transportDetail":
      "Desktop 연결 테스트 전송이 구조화된 결과를 반환하기 전에 실패했습니다.",
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
    "connections.expandAll": "모두 펼치기",
    "connections.expandMetadata": "{table} 메타데이터 펼치기",
    "connections.compareSchemaStructure": "스키마 구조 비교",
    "connections.filterTables": "데이터베이스 객체 필터...",
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
    "connections.passwordStored": "보안 저장소에 저장됨",
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
    "connections.providerGeneric": "일반 / 자체 호스팅",
    "connections.providerNeon": "Neon",
    "connections.neonBranch": "Neon 브랜치",
    "connections.neonBranchTarget": "Neon 브랜치 {name} ({id})",
    "connections.neonBranchState": "상태: {state}",
    "connections.providerPlanetScale": "PlanetScale",
    "connections.searchDataSources": "데이터 소스 검색",
    "connections.searchDrivers": "드라이버 검색",
    "connections.reallyDeleteDemo":
      "이 연결과 Demo SQLite 파일을 삭제할까요?",
    "connections.readOnlyDefault": "기본 읽기 전용으로 열기",
    "connections.readOnlyDefaultBody":
      "새 콘솔과 테이블 편집기를 읽기 전용으로 시작합니다.",
    "connections.keepAlive": "다음 간격마다 keep-alive 쿼리 실행",
    "connections.keepAliveSeconds": "keep-alive 간격(초)",
    "connections.refreshSchema": "스키마 새로고침",
    "connections.saved": "저장되었습니다.",
    "connections.safety": "안전",
    "connections.seconds": "초",
    "connections.schemaDiffInSync": "기준 DB와 스키마가 같습니다",
    "connections.schemaDiffMissingSection": "이 환경에 없음 ({count})",
    "connections.schemaDiffPendingChip": "diff",
    "connections.schemaDiffPendingTitle": "스키마 비교 화면을 열면 이 DB를 불러옵니다",
    "connections.schemaDiffTableAdded": "이 DB에만 있으며 기준 DB에는 없습니다",
    "connections.schemaDiffTableChanged":
      "기준 DB와 비교: +{added} 컬럼, -{missing} 컬럼, ~{changed} 변경",
    "connections.schemaDiffTableMissing": "이 DB에는 없고 기준 DB에는 있습니다",
    "connections.schemaDiffTitle":
      "기준 DB와 비교: +{added} 이 DB에만 있음, -{missing} 이 DB에 없음, ~{changed} 변경",
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
    "connections.scrollFromEditor": "편집기 위치로 이동",
    "connections.viewOptions": "보기 옵션",
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
