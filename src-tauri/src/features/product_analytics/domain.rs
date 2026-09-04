use std::collections::HashSet;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::{Uuid, Variant};

const MAX_BATCH_EVENTS: usize = 16;
const MAX_EVENT_AGE: Duration = Duration::days(7);
const MAX_FUTURE_SKEW: Duration = Duration::minutes(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProductAnalyticsConsent {
    Pending,
    Granted,
    Denied,
}

impl ProductAnalyticsConsent {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Granted => "granted",
            Self::Denied => "denied",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ProductAnalyticsConsentState {
    pub(crate) consent: ProductAnalyticsConsent,
    pub(crate) generation: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProductAnalyticsBatchV1 {
    schema_version: u8,
    installation_id: Uuid,
    #[serde(skip_serializing)]
    consent_generation: u32,
    session_id: Uuid,
    app_version: String,
    platform: AnalyticsPlatform,
    locale: AnalyticsLocale,
    events: Vec<ProductAnalyticsEventV1>,
}

impl ProductAnalyticsBatchV1 {
    pub(super) const fn authorized_by(&self, state: ProductAnalyticsConsentState) -> bool {
        matches!(state.consent, ProductAnalyticsConsent::Granted)
            && state.generation == self.consent_generation
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AnalyticsPlatform {
    Macos,
    Windows,
    Linux,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AnalyticsLocale {
    Ko,
    En,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProductAnalyticsEventV1 {
    event_id: String,
    occurred_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    actor_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    workspace_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    workspace_kind: Option<WorkspaceKind>,
    #[serde(flatten)]
    payload: ProductAnalyticsPayloadV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum WorkspaceKind {
    Personal,
    Team,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "name", content = "properties", rename_all = "snake_case")]
enum ProductAnalyticsPayloadV1 {
    DesktopInstallationReady(DesktopInstallationReadyProperties),
    WorkspaceAuthenticationCompleted(WorkspaceAuthenticationCompletedProperties),
    WorkspaceScopeReady(WorkspaceScopeReadyProperties),
    KnowledgeEnvironmentCreated(KnowledgeEnvironmentCreatedProperties),
    ConnectionVerificationCompleted(ConnectionVerificationCompletedProperties),
    EnvironmentConnectionBound(EnvironmentConnectionBoundProperties),
    QueryExecutionCompleted(QueryExecutionCompletedProperties),
    KnowledgeSourceSyncCompleted(KnowledgeSourceSyncCompletedProperties),
    AgentSessionInitializationCompleted(AgentSessionInitializationCompletedProperties),
    AgentTurnCompleted(AgentTurnCompletedProperties),
    AnalysisArticleProposalCompleted(AnalysisArticleProposalCompletedProperties),
    AnalysisArticleRunCompleted(AnalysisArticleRunCompletedProperties),
    WorkspaceMembershipReady(WorkspaceMembershipReadyProperties),
    SharedConnectionAccessReady(SharedConnectionAccessReadyProperties),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopInstallationReadyProperties {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceAuthenticationCompletedProperties {
    outcome: AuthenticationOutcome,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AuthenticationOutcome {
    Success,
    Denied,
    Expired,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceScopeReadyProperties {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KnowledgeEnvironmentCreatedProperties {
    creation_kind: EnvironmentCreationKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum EnvironmentCreationKind {
    ProjectDefault,
    Additional,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConnectionVerificationCompletedProperties {
    outcome: BinaryOutcome,
    engine: AnalyticsEngine,
    credential_mode: CredentialMode,
    ssh: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnvironmentConnectionBoundProperties {
    access_mode: AccessMode,
    engine: AnalyticsEngine,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QueryExecutionCompletedProperties {
    outcome: QueryOutcome,
    statement_class: StatementClass,
    row_count_bucket: RowCountBucket,
    duration_bucket: DurationBucket,
    approval_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KnowledgeSourceSyncCompletedProperties {
    outcome: BinaryOutcome,
    source_kind: KnowledgeSourceKind,
    sync_reason: KnowledgeSyncReason,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentSessionInitializationCompletedProperties {
    outcome: BinaryOutcome,
    provider: AgentProvider,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentTurnCompletedProperties {
    outcome: AgentTurnOutcome,
    provider: AgentProvider,
    duration_bucket: DurationBucket,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnalysisArticleProposalCompletedProperties {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnalysisArticleRunCompletedProperties {
    outcome: AnalysisRunOutcome,
    trigger: AnalysisRunTrigger,
    duration_bucket: DurationBucket,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceMembershipReadyProperties {
    role: WorkspaceRole,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SharedConnectionAccessReadyProperties {
    access_mode: AccessMode,
    engine: AnalyticsEngine,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum BinaryOutcome {
    Success,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum QueryOutcome {
    Success,
    Failed,
    Cancelled,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AgentTurnOutcome {
    Success,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AnalysisRunOutcome {
    Success,
    Failed,
    Cancelled,
    Stale,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AnalyticsEngine {
    Postgres,
    Mysql,
    Sqlite,
    Mongodb,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum CredentialMode {
    Local,
    Managed,
    None,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AccessMode {
    Local,
    Managed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum StatementClass {
    Select,
    Explain,
    Show,
    OtherRead,
    Write,
    Script,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RowCountBucket {
    Zero,
    One,
    #[serde(rename = "2_10")]
    TwoToTen,
    #[serde(rename = "11_100")]
    ElevenToOneHundred,
    #[serde(rename = "101_1000")]
    OneHundredOneToOneThousand,
    #[serde(rename = "over_1000")]
    OverOneThousand,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DurationBucket {
    #[serde(rename = "under_100ms")]
    Under100ms,
    #[serde(rename = "100ms_1s")]
    OneHundredMsToOneSecond,
    #[serde(rename = "1s_10s")]
    OneToTenSeconds,
    #[serde(rename = "10s_60s")]
    TenToSixtySeconds,
    #[serde(rename = "over_60s")]
    Over60s,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum KnowledgeSourceKind {
    Github,
    LocalFolder,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum KnowledgeSyncReason {
    Initial,
    Manual,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AgentProvider {
    Claude,
    Codex,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AnalysisRunTrigger {
    Manual,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum WorkspaceRole {
    Viewer,
    Analyst,
    Editor,
    Admin,
    Owner,
}

impl ProductAnalyticsBatchV1 {
    pub(super) fn validate(&self, now: DateTime<Utc>) -> Result<(), &'static str> {
        if self.schema_version != 1 {
            return Err("product analytics schema version is unsupported");
        }
        if !contract_uuid(&self.installation_id) || !contract_uuid(&self.session_id) {
            return Err("product analytics envelope identity is invalid");
        }
        if self.events.is_empty() || self.events.len() > MAX_BATCH_EVENTS {
            return Err("product analytics batch size is invalid");
        }
        if !valid_app_version(&self.app_version) {
            return Err("product analytics app version is invalid");
        }

        let mut event_ids = HashSet::with_capacity(self.events.len());
        for event in &self.events {
            if !valid_event_id(&event.event_id) || !event_ids.insert(event.event_id.as_str()) {
                return Err("product analytics event id is invalid");
            }
            if event.occurred_at < now - MAX_EVENT_AGE || event.occurred_at > now + MAX_FUTURE_SKEW
            {
                return Err("product analytics timestamp is outside the accepted window");
            }
            if event
                .actor_key
                .as_deref()
                .is_some_and(|value| !is_hash(value))
                || event
                    .workspace_key
                    .as_deref()
                    .is_some_and(|value| !is_hash(value))
            {
                return Err("product analytics identity key is invalid");
            }
            event.validate_identity()?;
        }
        Ok(())
    }
}

impl ProductAnalyticsEventV1 {
    fn validate_identity(&self) -> Result<(), &'static str> {
        match &self.payload {
            ProductAnalyticsPayloadV1::DesktopInstallationReady(_) => {
                if self.actor_key.is_some()
                    || self.workspace_key.is_some()
                    || self.workspace_kind.is_some()
                {
                    return Err(
                        "installation analytics must not carry account or workspace identity",
                    );
                }
            }
            ProductAnalyticsPayloadV1::WorkspaceAuthenticationCompleted(properties) => {
                if self.workspace_key.is_some() || self.workspace_kind.is_some() {
                    return Err("authentication analytics must not carry workspace identity");
                }
                if (properties.outcome == AuthenticationOutcome::Success)
                    != self.actor_key.is_some()
                {
                    return Err("authentication analytics identity does not match its outcome");
                }
            }
            _ => {
                let Some(kind) = self.workspace_kind else {
                    return Err("workspace analytics require a workspace kind");
                };
                if self.workspace_key.is_none() {
                    return Err("workspace analytics require a workspace key");
                }
                match kind {
                    WorkspaceKind::Personal if self.actor_key.is_some() => {
                        return Err("personal analytics must not carry an actor key");
                    }
                    WorkspaceKind::Team if self.actor_key.is_none() => {
                        return Err("team analytics require an actor key");
                    }
                    _ => {}
                }
            }
        }
        if matches!(
            self.payload,
            ProductAnalyticsPayloadV1::WorkspaceMembershipReady(_)
        ) && self.workspace_kind != Some(WorkspaceKind::Team)
        {
            return Err("member analytics require a team workspace");
        }
        Ok(())
    }
}

fn valid_app_version(value: &str) -> bool {
    value.len() <= 128 && semver::Version::parse(value).is_ok()
}

fn valid_event_id(value: &str) -> bool {
    is_hash(value)
}

fn contract_uuid(value: &Uuid) -> bool {
    value.get_variant() == Variant::RFC4122 && (1..=8).contains(&value.get_version_num())
}

fn is_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
pub(crate) fn assert_product_analytics_contract() {
    fn sorted_json_keys(value: &serde_json::Value) -> Vec<String> {
        let mut keys = value
            .as_object()
            .expect("analytics fixture value is an object")
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        keys.sort();
        keys
    }

    fn sorted_keys(values: &[&str]) -> Vec<String> {
        let mut keys = values
            .iter()
            .map(|value| (*value).to_owned())
            .collect::<Vec<_>>();
        keys.sort();
        keys
    }

    let now = Utc::now();
    let mut golden: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/product-analytics-v1.json"
    ))
    .expect("shared product analytics golden parses");
    assert_eq!(
        sorted_json_keys(&golden),
        sorted_keys(&[
            "schemaVersion",
            "installationId",
            "sessionId",
            "appVersion",
            "platform",
            "locale",
            "events",
        ])
    );
    assert!(golden.get("consentGeneration").is_none());
    let expected_names = [
        "desktop_installation_ready",
        "workspace_authentication_completed",
        "workspace_scope_ready",
        "knowledge_environment_created",
        "connection_verification_completed",
        "environment_connection_bound",
        "query_execution_completed",
        "knowledge_source_sync_completed",
        "agent_session_initialization_completed",
        "agent_turn_completed",
        "analysis_article_run_completed",
        "workspace_membership_ready",
        "shared_connection_access_ready",
    ];
    let golden_events = golden["events"]
        .as_array_mut()
        .expect("shared product analytics events are an array");
    assert_eq!(golden_events.len(), expected_names.len());
    for (event, expected_name) in golden_events.iter_mut().zip(expected_names) {
        let name = event["name"]
            .as_str()
            .expect("shared product analytics event has a name");
        assert_eq!(name, expected_name);
        let property_keys: &[&str] = match name {
            "desktop_installation_ready" | "workspace_scope_ready" => &[],
            "workspace_authentication_completed" => &["outcome"],
            "knowledge_environment_created" => &["creationKind"],
            "connection_verification_completed" => &["outcome", "engine", "credentialMode", "ssh"],
            "environment_connection_bound" | "shared_connection_access_ready" => {
                &["accessMode", "engine"]
            }
            "query_execution_completed" => &[
                "outcome",
                "statementClass",
                "rowCountBucket",
                "durationBucket",
                "approvalRequired",
            ],
            "knowledge_source_sync_completed" => &["outcome", "sourceKind", "syncReason"],
            "agent_session_initialization_completed" => &["outcome", "provider"],
            "agent_turn_completed" => &["outcome", "provider", "durationBucket"],
            "analysis_article_run_completed" => &["outcome", "trigger", "durationBucket"],
            "workspace_membership_ready" => &["role"],
            _ => panic!("unexpected product analytics golden event {name}"),
        };
        assert_eq!(
            sorted_json_keys(&event["properties"]),
            sorted_keys(property_keys),
            "{name} property keys drifted"
        );
        let identity_keys: &[&str] = match name {
            "desktop_installation_ready" => &[],
            "workspace_authentication_completed" => &["actorKey"],
            _ if event["workspaceKind"] == "personal" => &["workspaceKey", "workspaceKind"],
            _ => &["actorKey", "workspaceKey", "workspaceKind"],
        };
        let mut event_keys = vec!["eventId", "name", "occurredAt", "properties"];
        event_keys.extend(identity_keys);
        assert_eq!(
            sorted_json_keys(event),
            sorted_keys(&event_keys),
            "{name} identity keys drifted"
        );
        event["occurredAt"] = serde_json::to_value(now).expect("current timestamp serializes");
    }
    assert_eq!(golden["events"][2]["workspaceKind"], "personal");
    assert_eq!(
        golden["events"]
            .as_array()
            .and_then(|events| events.last())
            .and_then(|event| event["workspaceKind"].as_str()),
        Some("team")
    );
    let expected_public_wire = golden.clone();
    golden["consentGeneration"] = serde_json::json!(1);
    let golden_batch: ProductAnalyticsBatchV1 =
        serde_json::from_value(golden).expect("shared analytics golden decodes in native");
    golden_batch
        .validate(now)
        .expect("shared analytics golden validates in native");
    assert_eq!(
        serde_json::to_value(golden_batch).expect("shared analytics golden serializes"),
        expected_public_wire
    );

    let fixture = serde_json::json!({
        "schemaVersion": 1,
        "consentGeneration": 1,
        "installationId": Uuid::new_v4(),
        "sessionId": Uuid::new_v4(),
        "appVersion": "0.3.49",
        "platform": "macos",
        "locale": "ko",
        "events": [{
            "eventId": "c".repeat(64),
            "occurredAt": now,
            "workspaceKey": "a".repeat(64),
            "workspaceKind": "personal",
            "name": "query_execution_completed",
            "properties": {
                "outcome": "success",
                "statementClass": "select",
                "rowCountBucket": "zero",
                "durationBucket": "under_100ms",
                "approvalRequired": false
            }
        }]
    });
    let batch: ProductAnalyticsBatchV1 =
        serde_json::from_value(fixture.clone()).expect("closed analytics fixture decodes");
    batch
        .validate(now)
        .expect("closed analytics fixture validates");
    assert!(batch.authorized_by(ProductAnalyticsConsentState {
        consent: ProductAnalyticsConsent::Granted,
        generation: 1,
    }));
    assert!(!batch.authorized_by(ProductAnalyticsConsentState {
        consent: ProductAnalyticsConsent::Granted,
        generation: 2,
    }));
    assert!(!batch.authorized_by(ProductAnalyticsConsentState {
        consent: ProductAnalyticsConsent::Denied,
        generation: 1,
    }));
    let wire_names = serde_json::to_value(&batch).expect("analytics batch serializes");
    assert_eq!(
        wire_names["events"][0]["properties"]["durationBucket"],
        "under_100ms"
    );
    assert!(wire_names.get("consentGeneration").is_none());
    assert!(wire_names["events"][0].get("actorKey").is_none());

    let installation: ProductAnalyticsBatchV1 = serde_json::from_value(serde_json::json!({
        "schemaVersion": 1,
        "consentGeneration": 1,
        "installationId": Uuid::new_v4(),
        "sessionId": Uuid::new_v4(),
        "appVersion": "0.3.49",
        "platform": "macos",
        "locale": "en",
        "events": [{
            "eventId": "d".repeat(64),
            "occurredAt": now,
            "name": "desktop_installation_ready",
            "properties": {}
        }]
    }))
    .expect("installation analytics fixture decodes");
    installation
        .validate(now)
        .expect("installation analytics fixture validates");
    let installation_wire =
        serde_json::to_value(installation).expect("installation analytics serializes");
    for key in ["actorKey", "workspaceKey", "workspaceKind"] {
        assert!(installation_wire["events"][0].get(key).is_none());
    }

    let mut raw_event_id = fixture.clone();
    raw_event_id["events"][0]["eventId"] = serde_json::json!(Uuid::new_v4());
    let raw_event_id: ProductAnalyticsBatchV1 = serde_json::from_value(raw_event_id)
        .expect("wire shape decodes before event identity validation");
    assert!(raw_event_id.validate(now).is_err());

    let mut forbidden_property = fixture.clone();
    forbidden_property["events"][0]["properties"]["sql"] = serde_json::json!("select secret");
    assert!(serde_json::from_value::<ProductAnalyticsBatchV1>(forbidden_property).is_err());
    let mut forbidden_event_field = fixture;
    forbidden_event_field["events"][0]["url"] = serde_json::json!("https://private.invalid");
    assert!(serde_json::from_value::<ProductAnalyticsBatchV1>(forbidden_event_field).is_err());

    assert!(matches!(
        serde_json::from_value::<RowCountBucket>(serde_json::json!("over_1000")),
        Ok(RowCountBucket::OverOneThousand)
    ));
    assert!(matches!(
        serde_json::from_value::<DurationBucket>(serde_json::json!("over_60s")),
        Ok(DurationBucket::Over60s)
    ));

    let raw_identity = serde_json::json!({
        "schemaVersion": 1,
        "consentGeneration": 1,
        "installationId": Uuid::new_v4(),
        "sessionId": Uuid::new_v4(),
        "appVersion": "0.3.49",
        "platform": "windows",
        "locale": "en",
        "events": [{
            "eventId": "c".repeat(64),
            "occurredAt": now,
            "actorKey": Uuid::new_v4(),
            "workspaceKey": "b".repeat(64),
            "workspaceKind": "team",
            "name": "workspace_scope_ready",
            "properties": {}
        }]
    });
    let raw_identity: ProductAnalyticsBatchV1 = serde_json::from_value(raw_identity)
        .expect("wire shape decodes before semantic validation");
    assert!(raw_identity.validate(now).is_err());

    let personal_actor = serde_json::json!({
        "schemaVersion": 1,
        "consentGeneration": 1,
        "installationId": Uuid::new_v4(),
        "sessionId": Uuid::new_v4(),
        "appVersion": "0.3.49",
        "platform": "macos",
        "locale": "en",
        "events": [{
            "eventId": "c".repeat(64),
            "occurredAt": now,
            "actorKey": "a".repeat(64),
            "workspaceKey": "b".repeat(64),
            "workspaceKind": "personal",
            "name": "workspace_scope_ready",
            "properties": {}
        }]
    });
    let personal_actor: ProductAnalyticsBatchV1 = serde_json::from_value(personal_actor)
        .expect("wire shape decodes before personal identity validation");
    assert!(personal_actor.validate(now).is_err());
}
