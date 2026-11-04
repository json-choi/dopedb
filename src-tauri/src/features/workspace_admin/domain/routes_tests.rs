//! Route catalog contract for workspace administration.
//!
//! Every operation reaches exactly one control-plane method, path, query and body;
//! closed values travel with their exact spelling; bounded text, opaque tokens and
//! provider payloads fail closed; and debug output never carries a secret or body.

use std::time::Duration;

use serde_json::{json, Map, Value};
use uuid::Uuid;

use crate::error::AppError;
use crate::kernel::identity::AccountId;

use super::super::{
    require_signed_in_account, validate_operation, AdminMethod, AdminRoute,
    ProviderAuthorizationRequest, WorkspaceAdminOperation, CONNECTION_LIST_RESPONSE_BYTES,
    DEFAULT_RESPONSE_BYTES, DEFAULT_TIMEOUT, DISCOVERY_TIMEOUT, KEY_ROTATION_TIMEOUT,
    LARGE_RESPONSE_BYTES, PROVIDER_MUTATION_TIMEOUT,
};

const W: Uuid = Uuid::from_u128(0x1111_1111_1111_4111_8111_1111_1111_1111);
const C: Uuid = Uuid::from_u128(0x2222_2222_2222_4222_8222_2222_2222_2222);
const I: Uuid = Uuid::from_u128(0x3333_3333_3333_4333_8333_3333_3333_3333);
const X: Uuid = Uuid::from_u128(0x4444_4444_4444_4444_8444_4444_4444_4444);

fn ws(rest: &str) -> String {
    format!("api/v1/workspaces/{W}/{rest}")
}

fn integration(rest: &str) -> String {
    ws(&format!("provider-integrations/{I}/{rest}"))
}

fn decode(label: &str, operation: Value) -> WorkspaceAdminOperation {
    serde_json::from_value(operation).unwrap_or_else(|error| panic!("{label}: decodes: {error}"))
}

fn route_of(label: &str, operation: Value) -> AdminRoute {
    decode(label, operation)
        .route()
        .unwrap_or_else(|error| panic!("{label}: routes: {error:?}"))
}

fn body_of(route: &AdminRoute) -> Option<Value> {
    route
        .body
        .as_deref()
        .map(|bytes| serde_json::from_slice(bytes).expect("route body is JSON"))
}

fn query_value_of(route: &AdminRoute, key: &str) -> Option<String> {
    route
        .query
        .iter()
        .find(|(name, _)| *name == key)
        .map(|(_, value)| value.clone())
}

fn insert(mut value: Value, pointer: &str, key: &str, field: Value) -> Value {
    value
        .pointer_mut(pointer)
        .and_then(Value::as_object_mut)
        .unwrap_or_else(|| panic!("{pointer} is an object"))
        .insert(key.to_string(), field);
    value
}

fn set(mut value: Value, pointer: &str, replacement: Value) -> Value {
    *value
        .pointer_mut(pointer)
        .unwrap_or_else(|| panic!("{pointer} exists")) = replacement;
    value
}

struct Expected {
    method: AdminMethod,
    path: String,
    query: Vec<(&'static str, String)>,
    body: Option<Value>,
    timeout: Duration,
    max_response_bytes: usize,
    expected_revision: Option<i64>,
}

fn expect(method: AdminMethod, path: String) -> Expected {
    Expected {
        method,
        path,
        query: Vec::new(),
        body: None,
        timeout: DEFAULT_TIMEOUT,
        max_response_bytes: DEFAULT_RESPONSE_BYTES,
        expected_revision: None,
    }
}

impl Expected {
    fn body(mut self, body: Value) -> Self {
        self.body = Some(body);
        self
    }

    fn query(mut self, key: &'static str, value: &str) -> Self {
        self.query.push((key, value.to_string()));
        self
    }

    fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    fn bytes(mut self, maximum: usize) -> Self {
        self.max_response_bytes = maximum;
        self
    }

    fn revision(mut self, revision: i64) -> Self {
        self.expected_revision = Some(revision);
        self
    }
}

fn vault_operation() -> Value {
    json!({
        "kind": "connectVault",
        "workspaceId": W,
        "configuration": {
            "address": " https://vault.example.test:8200 ",
            "namespace": "",
            "authMount": "approle",
            "roleId": " role-id-value ",
            "secretId": "secret-id-value",
            "databaseMount": "database",
            "databaseConnection": "orders",
            "readRole": "orders-read",
            "writeRole": "orders-write",
            "target": {
                "host": "db.example.test",
                "port": 5432,
                "database": "orders",
                "engine": "postgres",
                "production": true,
            },
        },
    })
}

fn gcp_prepare_operation() -> Value {
    json!({
        "kind": "prepareGcpSetup",
        "workspaceId": W,
        "setupId": X,
        "projectId": " orders-prod ",
        "projectNumber": "123456789",
        "instanceId": "orders-sql",
        "environmentClassification": "production",
        "approveProduction": true,
        "approveIamAuthenticationChange": true,
        "approveIamRoleGrant": false,
        "schemaAuthority": { "database": "orders", "owner": "orders_owner" },
        "approveSchemaDelegation": true,
        "repairIntegrationId": I,
    })
}

#[test]
fn every_operation_maps_to_its_exact_control_plane_route() {
    use AdminMethod::{Delete, Get, Patch, Post};

    let neon_key = "neon-key-0123456789ab";
    let ticket = "t".repeat(80);
    let plan = "p".repeat(80);
    let proof = "proof+/=.~0123456";
    let hash = "sha256-0123456789";
    let candidate_at_limit = json!({ "k": "x".repeat(16 * 1024 - 8) });
    let neon_request_at_limit = json!({ "k": "x".repeat(12 * 1024 - 8) });
    let cases: Vec<(&str, Value, Expected)> = vec![
        (
            "list account sessions",
            json!({ "kind": "listAccountSessions" }),
            expect(Get, "api/v1/account/sessions".into()),
        ),
        (
            "revoke account session",
            json!({ "kind": "revokeAccountSession", "sessionId": X }),
            expect(Delete, format!("api/v1/account/sessions/{X}")),
        ),
        (
            "list workspaces",
            json!({ "kind": "listWorkspaces" }),
            expect(Get, "api/v1/workspaces".into()),
        ),
        (
            "create workspace trims its display name",
            json!({ "kind": "createWorkspace", "name": "  Team  " }),
            expect(Post, "api/v1/workspaces".into()).body(json!({ "name": "Team" })),
        ),
        (
            "workspace name is measured in UTF-16 units",
            json!({ "kind": "createWorkspace", "name": "😀".repeat(60) }),
            expect(Post, "api/v1/workspaces".into()).body(json!({ "name": "😀".repeat(60) })),
        ),
        (
            "list members",
            json!({ "kind": "listMembers", "workspaceId": W }),
            expect(Get, ws("members")),
        ),
        (
            "invite member trims the email",
            json!({
                "kind": "inviteMember", "workspaceId": W,
                "email": " member@example.test ", "role": "admin",
            }),
            expect(Post, ws("members"))
                .body(json!({ "email": "member@example.test", "role": "admin" })),
        ),
        (
            "change member role",
            json!({
                "kind": "changeMemberRole", "workspaceId": W, "memberId": X, "role": "analyst",
            }),
            expect(Patch, ws("members")).body(json!({ "memberId": X, "role": "analyst" })),
        ),
        (
            "remove member",
            json!({ "kind": "removeMember", "workspaceId": W, "memberId": X }),
            expect(Delete, ws("members")).body(json!({ "memberId": X })),
        ),
        (
            "cancel invitation",
            json!({ "kind": "cancelInvitation", "workspaceId": W, "invitationId": X }),
            expect(Delete, ws("members")).body(json!({ "invitationId": X })),
        ),
        (
            "list connections",
            json!({ "kind": "listConnections", "workspaceId": W }),
            expect(Get, ws("connections")).bytes(CONNECTION_LIST_RESPONSE_BYTES),
        ),
        (
            "list member grants",
            json!({ "kind": "listMemberGrants", "workspaceId": W }),
            expect(Get, ws("member-grants")).bytes(CONNECTION_LIST_RESPONSE_BYTES),
        ),
        (
            "grant connection access",
            json!({
                "kind": "grantConnectionAccess", "workspaceId": W, "connectionId": C,
                "memberId": X, "capability": "manage",
            }),
            expect(Post, ws(&format!("connections/{C}/grants")))
                .body(json!({ "memberId": X, "capability": "manage" })),
        ),
        (
            "lower connection access",
            json!({
                "kind": "lowerConnectionAccess", "workspaceId": W, "connectionId": C,
                "memberId": X, "capability": "view",
            }),
            expect(Patch, ws(&format!("connections/{C}/grants")))
                .body(json!({ "memberId": X, "capability": "view" })),
        ),
        (
            "remove connection access names the member only in the query",
            json!({
                "kind": "removeConnectionAccess", "workspaceId": W, "connectionId": C,
                "memberId": X,
            }),
            expect(Delete, ws(&format!("connections/{C}/grants")))
                .query("memberId", &X.to_string()),
        ),
        (
            "set team read access",
            json!({
                "kind": "setTeamReadAccess", "workspaceId": W, "connectionId": C,
                "enabled": false,
            }),
            expect(Post, ws(&format!("connections/{C}/grants")))
                .body(json!({ "teamReadEnabled": false })),
        ),
        (
            "list connection conflicts",
            json!({ "kind": "listConnectionConflicts", "workspaceId": W }),
            expect(Get, ws("connections/conflicts")).bytes(LARGE_RESPONSE_BYTES),
        ),
        (
            "resolve connection conflict",
            json!({
                "kind": "resolveConnectionConflict", "workspaceId": W, "conflictId": X,
                "resolution": "dismissed",
            }),
            expect(Post, ws(&format!("connections/conflicts/{X}")))
                .body(json!({ "resolution": "dismissed" })),
        ),
        (
            "apply connection candidate pins the revision and keeps the payload",
            json!({
                "kind": "applyConnectionCandidate", "workspaceId": W, "connectionId": C,
                "expectedRevision": 7, "payload": candidate_at_limit.clone(),
            }),
            expect(Patch, ws(&format!("connections/{C}")))
                .body(candidate_at_limit)
                .revision(7),
        ),
        (
            "delete shared connection pins the revision",
            json!({
                "kind": "deleteSharedConnection", "workspaceId": W, "connectionId": C,
                "expectedRevision": 3,
            }),
            expect(Delete, ws(&format!("connections/{C}"))).revision(3),
        ),
        (
            "get lifecycle",
            json!({ "kind": "getLifecycle", "workspaceId": W }),
            expect(Get, ws("lifecycle")),
        ),
        (
            "schedule workspace deletion",
            json!({
                "kind": "scheduleWorkspaceDeletion", "workspaceId": W, "requestId": X,
                "confirmation": "Team",
            }),
            expect(Post, ws("lifecycle")).body(json!({
                "action": "schedule_deletion", "requestId": X, "confirmation": "Team",
            })),
        ),
        (
            "cancel workspace deletion",
            json!({ "kind": "cancelWorkspaceDeletion", "workspaceId": W, "requestId": X }),
            expect(Post, ws("lifecycle"))
                .body(json!({ "action": "cancel_deletion", "requestId": X })),
        ),
        (
            "list backups",
            json!({ "kind": "listBackups", "workspaceId": W }),
            expect(Get, ws("backups")),
        ),
        (
            "create backup has no body",
            json!({ "kind": "createBackup", "workspaceId": W }),
            expect(Post, ws("backups")).timeout(DISCOVERY_TIMEOUT),
        ),
        (
            "delete backup",
            json!({ "kind": "deleteBackup", "workspaceId": W, "backupId": X }),
            expect(Delete, ws(&format!("backups/{X}"))),
        ),
        (
            "restore backup pins revision zero",
            json!({
                "kind": "restoreBackup", "workspaceId": W, "backupId": X, "expectedRevision": 0,
            }),
            expect(Post, ws(&format!("backups/{X}/restore")))
                .timeout(DISCOVERY_TIMEOUT)
                .revision(0),
        ),
        (
            "get key rotation",
            json!({ "kind": "getKeyRotation", "workspaceId": W }),
            expect(Get, ws("backups/key-rotation")),
        ),
        (
            "rotate key waits past the server claim",
            json!({ "kind": "rotateKey", "workspaceId": W, "requestId": X }),
            expect(Post, ws("backups/key-rotation"))
                .body(json!({ "requestId": X }))
                .timeout(KEY_ROTATION_TIMEOUT),
        ),
        (
            "list provider integrations without managed connections",
            json!({
                "kind": "listProviderIntegrations", "workspaceId": W,
                "includeManagedConnections": false,
            }),
            expect(Get, ws("provider-integrations")).bytes(LARGE_RESPONSE_BYTES),
        ),
        (
            "list provider integrations with managed connections",
            json!({
                "kind": "listProviderIntegrations", "workspaceId": W,
                "includeManagedConnections": true,
            }),
            expect(Get, ws("provider-integrations"))
                .query("includeManagedConnections", "1")
                .bytes(LARGE_RESPONSE_BYTES),
        ),
        (
            "connect Neon trims the key and optional identifiers",
            json!({
                "kind": "connectNeon", "workspaceId": W, "apiKey": format!(" {neon_key} "),
                "projectId": " orders-project ", "organizationId": "org-1",
            }),
            expect(Post, ws("provider-integrations"))
                .body(json!({
                    "provider": "neon",
                    "configuration": {
                        "apiKey": neon_key, "projectId": "orders-project",
                        "organizationId": "org-1",
                    },
                }))
                .timeout(PROVIDER_MUTATION_TIMEOUT),
        ),
        (
            "connect Neon omits blank optional identifiers",
            json!({
                "kind": "connectNeon", "workspaceId": W, "apiKey": "k".repeat(512),
                "projectId": "   ", "organizationId": null,
            }),
            expect(Post, ws("provider-integrations"))
                .body(json!({
                    "provider": "neon", "configuration": { "apiKey": "k".repeat(512) },
                }))
                .timeout(PROVIDER_MUTATION_TIMEOUT),
        ),
        (
            "connect Vault always requires verified TLS",
            vault_operation(),
            expect(Post, ws("provider-integrations"))
                .body(json!({
                    "provider": "vault",
                    "configuration": {
                        "kind": "appRole",
                        "schemaVersion": 1,
                        "address": "https://vault.example.test:8200",
                        "namespace": null,
                        "authMount": "approle",
                        "roleId": "role-id-value",
                        "secretId": "secret-id-value",
                        "databaseMount": "database",
                        "databaseConnection": "orders",
                        "readRole": "orders-read",
                        "writeRole": "orders-write",
                        "target": {
                            "host": "db.example.test",
                            "port": 5432,
                            "database": "orders",
                            "engine": "postgres",
                            "sslmode": "verify-full",
                            "production": true,
                        },
                    },
                }))
                .timeout(PROVIDER_MUTATION_TIMEOUT),
        ),
        (
            "save GCP integration for a repair",
            json!({
                "kind": "saveGcpIntegration", "workspaceId": W, "setupId": X,
                "bootstrapTicket": ticket.clone(), "repairIntegrationId": I,
            }),
            expect(Post, ws("provider-integrations"))
                .body(json!({
                    "provider": "gcpCloudSql", "setupId": X, "bootstrapTicket": ticket.clone(),
                    "repairIntegrationId": I,
                }))
                .timeout(PROVIDER_MUTATION_TIMEOUT),
        ),
        (
            "save new GCP integration omits the repair target",
            json!({
                "kind": "saveGcpIntegration", "workspaceId": W, "setupId": X,
                "bootstrapTicket": "b".repeat(32_768), "repairIntegrationId": null,
            }),
            expect(Post, ws("provider-integrations"))
                .body(json!({
                    "provider": "gcpCloudSql", "setupId": X,
                    "bootstrapTicket": "b".repeat(32_768),
                }))
                .timeout(PROVIDER_MUTATION_TIMEOUT),
        ),
        (
            "disconnect provider integration",
            json!({
                "kind": "disconnectProviderIntegration", "workspaceId": W, "integrationId": I,
            }),
            expect(Delete, ws(&format!("provider-integrations/{I}")))
                .timeout(PROVIDER_MUTATION_TIMEOUT),
        ),
        (
            "list provider resources orders the selection after the kind",
            json!({
                "kind": "listProviderResources", "workspaceId": W, "integrationId": I,
                "resourceKind": "databases",
                "selection": { "networkMode": "public", "project": "가".repeat(512) },
            }),
            expect(Get, integration("resources"))
                .query("kind", "databases")
                .query("project", &"가".repeat(512))
                .query("networkMode", "public")
                .timeout(DISCOVERY_TIMEOUT)
                .bytes(LARGE_RESPONSE_BYTES),
        ),
        (
            "claim provider resource passes the proof unchanged",
            json!({
                "kind": "claimProviderResource", "workspaceId": W, "integrationId": I,
                "selectionProof": proof,
            }),
            expect(Post, integration("resources"))
                .body(json!({ "selectionProof": proof }))
                .timeout(DISCOVERY_TIMEOUT),
        ),
        (
            "import provider resource",
            json!({
                "kind": "importProviderResource", "workspaceId": W, "integrationId": I,
                "receipt": X, "idempotencyKey": "Aa0-_".repeat(4), "name": " Orders ",
                "environment": "staging", "productionApproved": false,
            }),
            expect(Post, integration("imports"))
                .body(json!({
                    "receipt": X, "idempotencyKey": "Aa0-_".repeat(4), "name": "Orders",
                    "environment": "staging", "productionApproved": false,
                }))
                .timeout(PROVIDER_MUTATION_TIMEOUT),
        ),
        (
            "preflight Neon bootstrap with a classification",
            json!({
                "kind": "preflightNeonBootstrap", "workspaceId": W, "integrationId": I,
                "selectionProof": "q".repeat(16 * 1024), "environment": "development",
            }),
            expect(Post, integration("neon-bootstrap"))
                .body(json!({
                    "action": "preflight", "selectionProof": "q".repeat(16 * 1024),
                    "environment": "development",
                }))
                .timeout(PROVIDER_MUTATION_TIMEOUT),
        ),
        (
            "preflight Neon bootstrap without a classification",
            json!({
                "kind": "preflightNeonBootstrap", "workspaceId": W, "integrationId": I,
                "selectionProof": proof,
            }),
            expect(Post, integration("neon-bootstrap"))
                .body(
                    json!({ "action": "preflight", "selectionProof": proof, "environment": null }),
                )
                .timeout(PROVIDER_MUTATION_TIMEOUT),
        ),
        (
            "apply Neon bootstrap carries both approvals",
            json!({
                "kind": "applyNeonBootstrap", "workspaceId": W, "integrationId": I,
                "plan": plan.clone(), "idempotencyKey": X, "publicAclApproved": true,
                "productionApproved": false,
            }),
            expect(Post, integration("neon-bootstrap"))
                .body(json!({
                    "action": "apply", "plan": plan.clone(), "idempotencyKey": X,
                    "publicAclApproved": true, "productionApproved": false,
                }))
                .timeout(PROVIDER_MUTATION_TIMEOUT),
        ),
        (
            "list Neon branches",
            json!({
                "kind": "listNeonBranches", "workspaceId": W, "integrationId": I,
                "projectId": " orders-project ",
            }),
            expect(Get, integration("neon-branches"))
                .query("project", "orders-project")
                .timeout(DISCOVERY_TIMEOUT)
                .bytes(LARGE_RESPONSE_BYTES),
        ),
        (
            "list Neon branch operations",
            json!({ "kind": "listNeonBranchOperations", "workspaceId": W, "integrationId": I }),
            expect(Get, integration("neon-branches/operations"))
                .timeout(DISCOVERY_TIMEOUT)
                .bytes(LARGE_RESPONSE_BYTES),
        ),
        (
            "plan Neon branch operation keeps the bounded request",
            json!({
                "kind": "planNeonBranchOperation", "workspaceId": W, "integrationId": I,
                "action": "planSwitch", "request": neon_request_at_limit.clone(),
            }),
            expect(Post, integration("neon-branches/operations"))
                .body(json!({ "action": "planSwitch", "request": neon_request_at_limit }))
                .timeout(DISCOVERY_TIMEOUT),
        ),
        (
            "decide Neon branch operation",
            json!({
                "kind": "decideNeonBranchOperation", "workspaceId": W, "integrationId": I,
                "action": "decideDelete", "operationId": X, "planHash": hash,
                "decision": "rejected",
            }),
            expect(Post, integration("neon-branches/operations")).body(json!({
                "action": "decideDelete", "operationId": X, "planHash": hash,
                "decision": "rejected",
            })),
        ),
        (
            "execute Neon branch operation",
            json!({
                "kind": "executeNeonBranchOperation", "workspaceId": W, "integrationId": I,
                "action": "executeCreate", "operationId": X, "planHash": "h".repeat(256),
            }),
            expect(Post, integration("neon-branches/operations"))
                .body(json!({
                    "action": "executeCreate", "operationId": X, "planHash": "h".repeat(256),
                }))
                .timeout(DISCOVERY_TIMEOUT),
        ),
        (
            "list GCP setups",
            json!({ "kind": "listGcpSetups", "workspaceId": W }),
            expect(Get, ws("provider-integrations/gcp-setup")),
        ),
        (
            "GCP project inventory never forwards a project",
            json!({
                "kind": "listGcpSetupInventory", "workspaceId": W, "setupId": X,
                "inventory": "projects", "projectId": "ignored-project",
            }),
            expect(Get, ws(&format!("provider-integrations/gcp-setup/{X}")))
                .query("kind", "projects")
                .timeout(DISCOVERY_TIMEOUT)
                .bytes(LARGE_RESPONSE_BYTES),
        ),
        (
            "GCP instance inventory is scoped to one project",
            json!({
                "kind": "listGcpSetupInventory", "workspaceId": W, "setupId": X,
                "inventory": "instances", "projectId": " orders-prod ",
            }),
            expect(Get, ws(&format!("provider-integrations/gcp-setup/{X}")))
                .query("kind", "instances")
                .query("project", "orders-prod")
                .timeout(DISCOVERY_TIMEOUT)
                .bytes(LARGE_RESPONSE_BYTES),
        ),
        (
            "prepare GCP setup with schema delegation and repair",
            gcp_prepare_operation(),
            expect(Post, ws(&format!("provider-integrations/gcp-setup/{X}")))
                .body(json!({
                    "projectId": "orders-prod",
                    "projectNumber": "123456789",
                    "instanceId": "orders-sql",
                    "environmentClassification": "production",
                    "approveProduction": true,
                    "approveIamAuthenticationChange": true,
                    "approveIamRoleGrant": false,
                    "schemaAuthority": { "database": "orders", "owner": "orders_owner" },
                    "approveSchemaDelegation": true,
                    "repairIntegrationId": I,
                }))
                .timeout(PROVIDER_MUTATION_TIMEOUT),
        ),
        (
            "schema delegation approval never travels without a schema authority",
            set(
                set(
                    set(gcp_prepare_operation(), "/schemaAuthority", Value::Null),
                    "/environmentClassification",
                    Value::Null,
                ),
                "/repairIntegrationId",
                Value::Null,
            ),
            expect(Post, ws(&format!("provider-integrations/gcp-setup/{X}")))
                .body(json!({
                    "projectId": "orders-prod",
                    "projectNumber": "123456789",
                    "instanceId": "orders-sql",
                    "environmentClassification": null,
                    "approveProduction": true,
                    "approveIamAuthenticationChange": true,
                    "approveIamRoleGrant": false,
                }))
                .timeout(PROVIDER_MUTATION_TIMEOUT),
        ),
    ];

    for (label, operation, expected) in cases {
        let route = route_of(label, operation);
        assert_eq!(route.method, expected.method, "{label}: method");
        assert_eq!(
            route.segments,
            expected.path.split('/').collect::<Vec<_>>(),
            "{label}: path segments"
        );
        assert_eq!(route.query, expected.query, "{label}: query");
        assert_eq!(body_of(&route), expected.body, "{label}: body");
        assert_eq!(route.timeout, expected.timeout, "{label}: timeout");
        assert_eq!(
            route.max_response_bytes, expected.max_response_bytes,
            "{label}: response cap"
        );
        assert_eq!(
            route.expected_revision, expected.expected_revision,
            "{label}: expected revision"
        );
    }

    // The direct-access adapter replaces a record with PUT and its exact body.
    let put = AdminRoute::put(vec!["api".into(), "v1".into()], json!({ "revision": 2 }))
        .expect("put route");
    assert_eq!(put.method, AdminMethod::Put);
    assert_eq!(body_of(&put), Some(json!({ "revision": 2 })));
}

#[test]
fn closed_values_travel_with_their_exact_spelling_and_reject_others() {
    type Build = fn(&str) -> Value;
    type Read = fn(&AdminRoute) -> Option<String>;
    type Family = (
        &'static str,
        &'static [&'static str],
        &'static [&'static str],
        Build,
        Read,
    );
    let families: Vec<Family> = vec![
        (
            "assignable workspace role",
            &["viewer", "analyst", "editor", "admin"],
            &["owner", "Admin", "ADMIN", ""],
            |role| {
                json!({
                    "kind": "inviteMember", "workspaceId": W,
                    "email": "member@example.test", "role": role,
                })
            },
            |route| body_of(route).and_then(|body| body["role"].as_str().map(str::to_string)),
        ),
        (
            "lowered connection capability",
            &["view", "read", "use"],
            &["manage", "View", "write"],
            |capability| {
                json!({
                    "kind": "lowerConnectionAccess", "workspaceId": W, "connectionId": C,
                    "memberId": X, "capability": capability,
                })
            },
            |route| body_of(route).and_then(|body| body["capability"].as_str().map(str::to_string)),
        ),
        (
            "connection capability",
            &["view", "read", "use", "manage"],
            &["admin", "owner", "Manage"],
            |capability| {
                json!({
                    "kind": "grantConnectionAccess", "workspaceId": W, "connectionId": C,
                    "memberId": X, "capability": capability,
                })
            },
            |route| body_of(route).and_then(|body| body["capability"].as_str().map(str::to_string)),
        ),
        (
            "conflict resolution",
            &["server", "candidate", "dismissed"],
            &["merge", "Server"],
            |resolution| {
                json!({
                    "kind": "resolveConnectionConflict", "workspaceId": W, "conflictId": X,
                    "resolution": resolution,
                })
            },
            |route| body_of(route).and_then(|body| body["resolution"].as_str().map(str::to_string)),
        ),
        (
            "provider resource kind",
            &[
                "organizations",
                "projects",
                "databases",
                "branches",
                "instances",
                "brokers",
                "targets",
            ],
            &["tables", "Projects", "project"],
            |kind| {
                json!({
                    "kind": "listProviderResources", "workspaceId": W, "integrationId": I,
                    "resourceKind": kind, "selection": {},
                })
            },
            |route| query_value_of(route, "kind"),
        ),
        (
            "provider selection key",
            &[
                "organization",
                "project",
                "database",
                "branch",
                "instance",
                "engine",
                "networkMode",
                "broker",
                "target",
            ],
            // A selection can never add a second `kind` or an arbitrary query key.
            &["kind", "network_mode", "path", "includeManagedConnections"],
            |key| {
                let mut selection = Map::new();
                selection.insert(key.to_string(), json!("value"));
                json!({
                    "kind": "listProviderResources", "workspaceId": W, "integrationId": I,
                    "resourceKind": "projects", "selection": selection,
                })
            },
            |route| {
                assert_eq!(route.query.len(), 2, "one kind and one selection pair");
                route
                    .query
                    .iter()
                    .find(|(key, value)| *key != "kind" && value == "value")
                    .map(|(key, _)| (*key).to_string())
            },
        ),
        (
            "environment classification",
            &["development", "production"],
            &["staging", "prod", "Production"],
            |environment| {
                json!({
                    "kind": "preflightNeonBootstrap", "workspaceId": W, "integrationId": I,
                    "selectionProof": "p".repeat(16), "environment": environment,
                })
            },
            |route| {
                body_of(route).and_then(|body| body["environment"].as_str().map(str::to_string))
            },
        ),
        (
            "Neon plan action",
            &["planCreate", "planDelete", "planSwitch"],
            &["create", "decideCreate", "executeCreate", "plancreate"],
            |action| {
                json!({
                    "kind": "planNeonBranchOperation", "workspaceId": W, "integrationId": I,
                    "action": action, "request": {},
                })
            },
            |route| body_of(route).and_then(|body| body["action"].as_str().map(str::to_string)),
        ),
        (
            "Neon decide action",
            &["decideCreate", "decideDelete", "decideSwitch"],
            &["delete", "planDelete", "executeDelete"],
            |action| {
                json!({
                    "kind": "decideNeonBranchOperation", "workspaceId": W, "integrationId": I,
                    "action": action, "operationId": X, "planHash": "h".repeat(16),
                    "decision": "approved",
                })
            },
            |route| body_of(route).and_then(|body| body["action"].as_str().map(str::to_string)),
        ),
        (
            "Neon execute action",
            &["executeCreate", "executeDelete", "executeSwitch"],
            &["switch", "planSwitch", "decideSwitch"],
            |action| {
                json!({
                    "kind": "executeNeonBranchOperation", "workspaceId": W, "integrationId": I,
                    "action": action, "operationId": X, "planHash": "h".repeat(16),
                })
            },
            |route| body_of(route).and_then(|body| body["action"].as_str().map(str::to_string)),
        ),
        (
            "Neon decision",
            &["approved", "rejected"],
            &["pending", "Approved", "approve"],
            |decision| {
                json!({
                    "kind": "decideNeonBranchOperation", "workspaceId": W, "integrationId": I,
                    "action": "decideCreate", "operationId": X, "planHash": "h".repeat(16),
                    "decision": decision,
                })
            },
            |route| body_of(route).and_then(|body| body["decision"].as_str().map(str::to_string)),
        ),
        (
            "GCP setup inventory",
            &["projects", "instances", "permissions"],
            &["roles", "Instances"],
            |inventory| {
                json!({
                    "kind": "listGcpSetupInventory", "workspaceId": W, "setupId": X,
                    "inventory": inventory, "projectId": "orders-prod",
                })
            },
            |route| query_value_of(route, "kind"),
        ),
        (
            "Vault target engine",
            &["postgres", "mysql"],
            &["sqlite", "Postgres", "postgresql"],
            |engine| {
                set(
                    vault_operation(),
                    "/configuration/target/engine",
                    json!(engine),
                )
            },
            |route| {
                body_of(route).and_then(|body| {
                    body.pointer("/configuration/target/engine")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
            },
        ),
    ];

    for (family, accepted, rejected, build, read) in families {
        for spelling in accepted {
            let label = format!("{family} {spelling:?}");
            let route = route_of(&label, build(spelling));
            assert_eq!(
                read(&route).as_deref(),
                Some(*spelling),
                "{label}: wire spelling"
            );
        }
        for spelling in rejected {
            assert!(
                serde_json::from_value::<WorkspaceAdminOperation>(build(spelling)).is_err(),
                "{family} {spelling:?} must not decode"
            );
        }
    }

    // OAuth authorization is offered only for the two redirect-based providers.
    let authorization = |provider: &str| json!({ "accountId": "account-1", "workspaceId": W, "provider": provider });
    for provider in ["planetScale", "gcpCloudSql"] {
        let request: ProviderAuthorizationRequest =
            serde_json::from_value(authorization(provider)).expect("authorization decodes");
        let route = request.route().expect("authorization route");
        assert_eq!(route.method, AdminMethod::Post, "{provider}: method");
        assert_eq!(
            route.segments,
            ws("provider-integrations").split('/').collect::<Vec<_>>(),
            "{provider}: path"
        );
        assert_eq!(
            body_of(&route),
            Some(json!({ "provider": provider })),
            "{provider}: body"
        );
        assert_eq!(route.timeout, DEFAULT_TIMEOUT, "{provider}: timeout");
    }
    for provider in ["neon", "vault", "PlanetScale", "gcp_cloud_sql"] {
        assert!(
            serde_json::from_value::<ProviderAuthorizationRequest>(authorization(provider))
                .is_err(),
            "OAuth provider {provider:?} must not decode"
        );
    }
    let mut redirected = authorization("planetScale");
    redirected["redirectUrl"] = json!("https://evil.example.test");
    assert!(serde_json::from_value::<ProviderAuthorizationRequest>(redirected).is_err());
}

#[test]
fn malformed_text_tokens_and_payloads_fail_closed() {
    let invite = |email: Value| json!({ "kind": "inviteMember", "workspaceId": W, "email": email, "role": "viewer" });
    let deletion = |confirmation: String| {
        json!({
            "kind": "scheduleWorkspaceDeletion", "workspaceId": W, "requestId": X,
            "confirmation": confirmation,
        })
    };
    let candidate = |revision: i64, payload: Value| {
        json!({
            "kind": "applyConnectionCandidate", "workspaceId": W, "connectionId": C,
            "expectedRevision": revision, "payload": payload,
        })
    };
    let neon = |key: String, project: Value| {
        json!({
            "kind": "connectNeon", "workspaceId": W, "apiKey": key, "projectId": project,
            "organizationId": null,
        })
    };
    let vault = |pointer: &str, value: Value| set(vault_operation(), pointer, value);
    let ticket = |value: String| {
        json!({
            "kind": "saveGcpIntegration", "workspaceId": W, "setupId": X,
            "bootstrapTicket": value,
        })
    };
    let selection = |value: String| {
        json!({
            "kind": "listProviderResources", "workspaceId": W, "integrationId": I,
            "resourceKind": "projects", "selection": { "organization": value },
        })
    };
    let claim = |proof: String| {
        json!({
            "kind": "claimProviderResource", "workspaceId": W, "integrationId": I,
            "selectionProof": proof,
        })
    };
    let import = |key: String, name: &str| {
        json!({
            "kind": "importProviderResource", "workspaceId": W, "integrationId": I,
            "receipt": X, "idempotencyKey": key, "name": name, "environment": "development",
            "productionApproved": false,
        })
    };
    let bootstrap = |plan: String| {
        json!({
            "kind": "applyNeonBootstrap", "workspaceId": W, "integrationId": I, "plan": plan,
            "idempotencyKey": X, "publicAclApproved": false, "productionApproved": false,
        })
    };
    let neon_plan = |request: Value| {
        json!({
            "kind": "planNeonBranchOperation", "workspaceId": W, "integrationId": I,
            "action": "planCreate", "request": request,
        })
    };
    let decide = |hash: String| {
        json!({
            "kind": "decideNeonBranchOperation", "workspaceId": W, "integrationId": I,
            "action": "decideCreate", "operationId": X, "planHash": hash,
            "decision": "approved",
        })
    };
    let execute = |hash: String| {
        json!({
            "kind": "executeNeonBranchOperation", "workspaceId": W, "integrationId": I,
            "action": "executeCreate", "operationId": X, "planHash": hash,
        })
    };
    let inventory = |kind: &str, project: Value| {
        json!({
            "kind": "listGcpSetupInventory", "workspaceId": W, "setupId": X,
            "inventory": kind, "projectId": project,
        })
    };
    let prepare = |pointer: &str, value: Value| set(gcp_prepare_operation(), pointer, value);

    // Each operation decodes, but its route refuses before anything is sent.
    let refused: Vec<(&str, Value)> = vec![
        (
            "blank workspace name",
            json!({ "kind": "createWorkspace", "name": "   " }),
        ),
        (
            "workspace name with a control character",
            json!({ "kind": "createWorkspace", "name": "Team\u{7}" }),
        ),
        (
            "workspace name over 120 UTF-16 units",
            json!({ "kind": "createWorkspace", "name": "😀".repeat(61) }),
        ),
        ("email without @", invite(json!("member.example.test"))),
        (
            "email with inner whitespace",
            invite(json!("mem ber@example.test")),
        ),
        (
            "email with a control character",
            invite(json!("member@exa\u{0}mple.test")),
        ),
        (
            "email over 320 units",
            invite(json!(format!("{}@example.test", "m".repeat(309)))),
        ),
        ("empty deletion confirmation", deletion(String::new())),
        (
            "deletion confirmation with a newline",
            deletion("Team\n".into()),
        ),
        (
            "deletion confirmation over 120 units",
            deletion("t".repeat(121)),
        ),
        (
            "candidate payload that is not an object",
            candidate(1, json!(["name"])),
        ),
        (
            "candidate payload that is a string",
            candidate(1, json!("name")),
        ),
        (
            "candidate payload one byte over 16 KiB",
            candidate(1, json!({ "k": "x".repeat(16 * 1024 - 7) })),
        ),
        ("negative candidate revision", candidate(-1, json!({}))),
        (
            "negative delete revision",
            json!({
                "kind": "deleteSharedConnection", "workspaceId": W, "connectionId": C,
                "expectedRevision": -1,
            }),
        ),
        (
            "negative restore revision",
            json!({
                "kind": "restoreBackup", "workspaceId": W, "backupId": X, "expectedRevision": -1,
            }),
        ),
        ("Neon key under 20 bytes", neon("k".repeat(19), Value::Null)),
        (
            "Neon key over 512 bytes",
            neon("k".repeat(513), Value::Null),
        ),
        (
            "Neon key with inner whitespace",
            neon(
                format!("{} {}", "k".repeat(10), "k".repeat(10)),
                Value::Null,
            ),
        ),
        (
            "Neon project id with a control character",
            neon("k".repeat(20), json!("orders\u{1b}")),
        ),
        (
            "Neon project id over 128 units",
            neon("k".repeat(20), json!("p".repeat(129))),
        ),
        (
            "Vault target port zero",
            vault("/configuration/target/port", json!(0)),
        ),
        (
            "blank Vault address",
            vault("/configuration/address", json!("  ")),
        ),
        (
            "blank Vault role id",
            vault("/configuration/roleId", json!(" \t ")),
        ),
        (
            "Vault secret id over 2048 bytes",
            vault("/configuration/secretId", json!("s".repeat(2049))),
        ),
        (
            "Vault secret id with a control character",
            vault("/configuration/secretId", json!("se\u{7f}cret")),
        ),
        (
            "Vault namespace with a control character",
            vault("/configuration/namespace", json!("ns\u{0}")),
        ),
        (
            "Vault write role over 512 units",
            vault("/configuration/writeRole", json!("w".repeat(513))),
        ),
        (
            "Vault target host over 512 units",
            vault("/configuration/target/host", json!("h".repeat(513))),
        ),
        (
            "blank Vault target database",
            vault("/configuration/target/database", json!("")),
        ),
        ("bootstrap ticket under 80 bytes", ticket("t".repeat(79))),
        ("bootstrap ticket over 32 KiB", ticket("t".repeat(32_769))),
        (
            "bootstrap ticket with whitespace",
            ticket(format!("{} {}", "t".repeat(40), "t".repeat(40))),
        ),
        (
            "selection value over 512 characters",
            selection("가".repeat(513)),
        ),
        (
            "selection value with a newline",
            selection("org\nkind=projects".into()),
        ),
        ("selection proof under 16 bytes", claim("p".repeat(15))),
        (
            "selection proof over 16 KiB",
            claim("p".repeat(16 * 1024 + 1)),
        ),
        (
            "selection proof with a tab",
            claim(format!("{}\t{}", "p".repeat(8), "p".repeat(8))),
        ),
        (
            "idempotency key under 16 bytes",
            import("k".repeat(15), "Orders"),
        ),
        (
            "idempotency key over 128 bytes",
            import("k".repeat(129), "Orders"),
        ),
        (
            "idempotency key with a dot",
            import(format!("{}.", "k".repeat(16)), "Orders"),
        ),
        (
            "idempotency key with non-ASCII letters",
            import("ü".repeat(8), "Orders"),
        ),
        ("blank import name", import("k".repeat(16), " ")),
        (
            "Neon bootstrap plan under 80 bytes",
            bootstrap("p".repeat(79)),
        ),
        (
            "Neon bootstrap plan over 64 KiB",
            bootstrap("p".repeat(64 * 1024 + 1)),
        ),
        (
            "Neon bootstrap plan with a space",
            bootstrap(format!("{} {}", "p".repeat(40), "p".repeat(40))),
        ),
        (
            "preflight proof with a newline",
            json!({
                "kind": "preflightNeonBootstrap", "workspaceId": W, "integrationId": I,
                "selectionProof": format!("{}\n", "p".repeat(16)),
            }),
        ),
        (
            "blank Neon branch project",
            json!({
                "kind": "listNeonBranches", "workspaceId": W, "integrationId": I, "projectId": "",
            }),
        ),
        (
            "Neon branch plan that is not an object",
            neon_plan(json!([1])),
        ),
        (
            "Neon branch plan one byte over 12 KiB",
            neon_plan(json!({ "k": "x".repeat(12 * 1024 - 7) })),
        ),
        ("plan hash under 16 bytes", decide("h".repeat(15))),
        ("plan hash over 256 bytes", decide("h".repeat(257))),
        (
            "plan hash with a space",
            decide(format!("{} {}", "h".repeat(8), "h".repeat(8))),
        ),
        (
            "execute plan hash with a control character",
            execute(format!("{}\u{1}", "h".repeat(16))),
        ),
        (
            "GCP instances without a project",
            inventory("instances", Value::Null),
        ),
        (
            "GCP permissions with a blank project",
            inventory("permissions", json!(" ")),
        ),
        ("blank GCP project id", prepare("/projectId", json!(""))),
        (
            "GCP project number over 64 units",
            prepare("/projectNumber", json!("1".repeat(65))),
        ),
        (
            "GCP instance with a control character",
            prepare("/instanceId", json!("sql\u{0}")),
        ),
        (
            "blank GCP schema owner",
            prepare("/schemaAuthority/owner", json!(" ")),
        ),
        (
            "GCP schema database over 128 units",
            prepare("/schemaAuthority/database", json!("d".repeat(129))),
        ),
    ];
    for (label, operation) in refused {
        assert!(
            validate_operation(&operation).is_err(),
            "{label}: validation must refuse"
        );
        assert!(
            decode(label, operation).route().is_err(),
            "{label}: route must refuse"
        );
    }

    // Shapes outside the closed catalog never decode, so no route is ever built.
    let undecodable: Vec<(&str, Value)> = vec![
        ("missing kind", json!({ "workspaceId": W })),
        (
            "unknown kind",
            json!({ "kind": "proxy", "path": "/api/v1/workspaces" }),
        ),
        (
            "non-UUID workspace",
            json!({ "kind": "listMembers", "workspaceId": "../members" }),
        ),
        (
            "non-UUID Neon idempotency key",
            set(
                bootstrap("p".repeat(80)),
                "/idempotencyKey",
                json!("retry-key-0001"),
            ),
        ),
        (
            "caller-chosen Vault TLS mode",
            insert(
                vault_operation(),
                "/configuration",
                "sslmode",
                json!("disable"),
            ),
        ),
        (
            "unknown Vault target field",
            insert(
                vault_operation(),
                "/configuration/target",
                "sslmode",
                json!("disable"),
            ),
        ),
        (
            "unknown schema authority field",
            insert(
                gcp_prepare_operation(),
                "/schemaAuthority",
                "grantAll",
                json!(true),
            ),
        ),
        (
            "non-integer expected revision",
            set(candidate(1, json!({})), "/expectedRevision", json!("1")),
        ),
    ];
    for (label, operation) in undecodable {
        assert!(
            serde_json::from_value::<WorkspaceAdminOperation>(operation.clone()).is_err(),
            "{label}: must not decode"
        );
        assert!(
            validate_operation(&operation).is_err(),
            "{label}: validation must refuse"
        );
    }
    assert!(validate_operation(&json!({ "kind": "listWorkspaces" })).is_ok());

    // Only an account signed in on this device may authorize an operation.
    let signed_in = AccountId::new("account-1").expect("account");
    let other = AccountId::new("account-2").expect("account");
    assert!(require_signed_in_account(std::slice::from_ref(&signed_in), &signed_in).is_ok());
    assert!(matches!(
        require_signed_in_account(&[signed_in], &other),
        Err(AppError::AuthenticationRequired(_))
    ));
    assert!(matches!(
        require_signed_in_account(&[], &other),
        Err(AppError::AuthenticationRequired(_))
    ));
}

#[test]
fn debug_output_never_carries_secrets_query_values_or_bodies() {
    let neon = decode(
        "Neon",
        json!({
            "kind": "connectNeon", "workspaceId": W, "apiKey": "neon-api-key-SECRET-0001",
        }),
    );
    let vault = decode(
        "Vault",
        set(
            set(
                vault_operation(),
                "/configuration/roleId",
                json!("role-SECRET"),
            ),
            "/configuration/secretId",
            json!("secret-SECRET"),
        ),
    );
    let resources = decode(
        "resources",
        json!({
            "kind": "listProviderResources", "workspaceId": W, "integrationId": I,
            "resourceKind": "projects", "selection": { "organization": "org-SECRET" },
        }),
    );
    for (label, operation) in [("Neon", neon), ("Vault", vault), ("resources", resources)] {
        let route = operation.route().expect("route");
        let operation_debug = format!("{operation:?}");
        let route_debug = format!("{route:?}");
        if label != "resources" {
            assert!(
                operation_debug.contains("SecretText([redacted])"),
                "{label}: secrets are redacted in {operation_debug}"
            );
            assert!(
                !operation_debug.contains("SECRET"),
                "{label}: {operation_debug}"
            );
        }
        assert!(!route_debug.contains("SECRET"), "{label}: {route_debug}");
        assert!(route_debug.contains("has_body"), "{label}: {route_debug}");
    }
    let route = route_of(
        "query keys",
        json!({
            "kind": "listProviderResources", "workspaceId": W, "integrationId": I,
            "resourceKind": "projects", "selection": { "organization": "org-SECRET" },
        }),
    );
    let debug = format!("{route:?}");
    assert!(
        debug.contains("query_keys: [\"kind\", \"organization\"]"),
        "{debug}"
    );
    assert!(debug.contains("has_body: false"), "{debug}");
}
