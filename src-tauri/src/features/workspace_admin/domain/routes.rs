//! Projects each administration operation onto exactly one control-plane route.
//!
//! Paths are built from literals and UUIDs only; text is bounded the way the
//! control plane measures it, and opaque server values pass through unchanged.

use serde_json::{json, Map, Value};

use crate::error::AppResult;
use crate::kernel::identity::{ConnectionId, ProviderIntegrationId, WorkspaceId};

use super::operation::WorkspaceAdminOperation;
use super::values::{
    EnvironmentClassification, GcpSetupInventory, SecretText, VaultAppRoleConfiguration,
};
use super::{
    invalid, AdminRoute, CONNECTION_LIST_RESPONSE_BYTES, DISCOVERY_TIMEOUT, KEY_ROTATION_TIMEOUT,
    LARGE_RESPONSE_BYTES, MAX_CANDIDATE_PAYLOAD_BYTES, MAX_NEON_PLAN_REQUEST_BYTES,
    MAX_QUERY_VALUE_CHARS, PROVIDER_MUTATION_TIMEOUT,
};

fn segments(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_string()).collect()
}

pub(super) fn workspace_path(workspace_id: WorkspaceId, rest: &[&str]) -> Vec<String> {
    let mut path = segments(&["api", "v1", "workspaces"]);
    path.push(workspace_id.to_string());
    path.extend(rest.iter().map(|part| (*part).to_string()));
    path
}

fn integration_path(
    workspace_id: WorkspaceId,
    integration_id: ProviderIntegrationId,
    rest: &[&str],
) -> Vec<String> {
    let mut path = workspace_path(workspace_id, &["provider-integrations"]);
    path.push(integration_id.to_string());
    path.extend(rest.iter().map(|part| (*part).to_string()));
    path
}

fn connection_path(
    workspace_id: WorkspaceId,
    connection_id: ConnectionId,
    rest: &[&str],
) -> Vec<String> {
    let mut path = workspace_path(workspace_id, &["connections"]);
    path.push(connection_id.to_string());
    path.extend(rest.iter().map(|part| (*part).to_string()));
    path
}

fn has_control(value: &str) -> bool {
    value.chars().any(char::is_control)
}

/// Single-line display text measured in UTF-16 units, matching the control plane.
fn display_text(value: &str, maximum: usize, field: &str) -> AppResult<String> {
    let trimmed = value.trim();
    let units = trimmed.encode_utf16().count();
    if units == 0 || units > maximum || has_control(trimmed) {
        return Err(invalid(field));
    }
    Ok(trimmed.to_string())
}

/// Text compared exactly by the control plane (for example a deletion
/// confirmation); it is bounded but never trimmed or normalized.
fn exact_text(value: &str, maximum: usize, field: &str) -> AppResult<String> {
    let units = value.encode_utf16().count();
    if units == 0 || units > maximum || has_control(value) {
        return Err(invalid(field));
    }
    Ok(value.to_string())
}

/// Opaque server-issued values (proofs, plans, tickets) pass through unchanged.
fn opaque_token(value: &str, minimum: usize, maximum: usize, field: &str) -> AppResult<String> {
    if value.len() < minimum
        || value.len() > maximum
        || value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err(invalid(field));
    }
    Ok(value.to_string())
}

fn query_value(value: &str, field: &str) -> AppResult<String> {
    if value.chars().count() > MAX_QUERY_VALUE_CHARS || has_control(value) {
        return Err(invalid(field));
    }
    Ok(value.to_string())
}

fn optional_identifier(value: &Option<String>, field: &str) -> AppResult<Option<String>> {
    match value.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) => Ok(Some(display_text(text, 128, field)?)),
    }
}

fn bounded_object(value: &Value, maximum: usize, field: &str) -> AppResult<Value> {
    if !value.is_object() || serde_json::to_vec(value)?.len() > maximum {
        return Err(invalid(field));
    }
    Ok(value.clone())
}

fn idempotency_key(value: &str) -> AppResult<String> {
    let valid = (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if !valid {
        return Err(invalid("idempotency key"));
    }
    Ok(value.to_string())
}

fn plan_hash(value: &str) -> AppResult<String> {
    opaque_token(value, 16, 256, "plan hash")
}

fn vault_configuration(configuration: &VaultAppRoleConfiguration) -> AppResult<Value> {
    let optional = |value: &Option<String>, field: &str| -> AppResult<Value> {
        Ok(match value.as_deref().map(str::trim) {
            None | Some("") => Value::Null,
            Some(text) => Value::String(display_text(text, 512, field)?),
        })
    };
    let secret = |value: &SecretText, field: &str| -> AppResult<String> {
        let trimmed = value.as_str().trim();
        if trimmed.is_empty() || trimmed.len() > 2048 || has_control(trimmed) {
            return Err(invalid(field));
        }
        Ok(trimmed.to_string())
    };
    if configuration.target.port == 0 {
        return Err(invalid("Vault target port"));
    }
    Ok(json!({
        "kind": "appRole",
        "schemaVersion": 1,
        "address": display_text(&configuration.address, 2048, "Vault address")?,
        "namespace": optional(&configuration.namespace, "Vault namespace")?,
        "authMount": display_text(&configuration.auth_mount, 512, "Vault auth mount")?,
        "roleId": secret(&configuration.role_id, "Vault role id")?,
        "secretId": secret(&configuration.secret_id, "Vault secret id")?,
        "databaseMount": display_text(&configuration.database_mount, 512, "Vault database mount")?,
        "databaseConnection": display_text(
            &configuration.database_connection,
            512,
            "Vault database connection",
        )?,
        "readRole": display_text(&configuration.read_role, 512, "Vault read role")?,
        "writeRole": optional(&configuration.write_role, "Vault write role")?,
        "target": {
            "host": display_text(&configuration.target.host, 512, "Vault target host")?,
            "port": configuration.target.port,
            "database": display_text(&configuration.target.database, 512, "Vault target database")?,
            "engine": configuration.target.engine.as_str(),
            "sslmode": "verify-full",
            "production": configuration.target.production,
        },
    }))
}

impl WorkspaceAdminOperation {
    /// Projects the operation onto its single control-plane route.
    pub(crate) fn route(&self) -> AppResult<AdminRoute> {
        use WorkspaceAdminOperation as Op;
        Ok(match self {
            Op::ListAccountSessions => {
                AdminRoute::get(segments(&["api", "v1", "account", "sessions"]))
            }
            Op::RevokeAccountSession { session_id } => {
                let mut path = segments(&["api", "v1", "account", "sessions"]);
                path.push(session_id.to_string());
                AdminRoute::delete(path)
            }
            Op::ListWorkspaces => AdminRoute::get(segments(&["api", "v1", "workspaces"])),
            Op::CreateWorkspace { name } => AdminRoute::post(
                segments(&["api", "v1", "workspaces"]),
                json!({ "name": display_text(name, 120, "workspace name")? }),
            )?,
            Op::ListMembers { workspace_id } => {
                AdminRoute::get(workspace_path(*workspace_id, &["members"]))
            }
            Op::InviteMember {
                workspace_id,
                email,
                role,
            } => {
                let email = display_text(email, 320, "invitation email")?;
                if !email.contains('@') || email.chars().any(char::is_whitespace) {
                    return Err(invalid("invitation email"));
                }
                AdminRoute::post(
                    workspace_path(*workspace_id, &["members"]),
                    json!({ "email": email, "role": role.as_str() }),
                )?
            }
            Op::ChangeMemberRole {
                workspace_id,
                member_id,
                role,
            } => AdminRoute::patch(
                workspace_path(*workspace_id, &["members"]),
                json!({ "memberId": member_id, "role": role.as_str() }),
            )?,
            Op::RemoveMember {
                workspace_id,
                member_id,
            } => AdminRoute::delete_with_body(
                workspace_path(*workspace_id, &["members"]),
                json!({ "memberId": member_id }),
            )?,
            Op::CancelInvitation {
                workspace_id,
                invitation_id,
            } => AdminRoute::delete_with_body(
                workspace_path(*workspace_id, &["members"]),
                json!({ "invitationId": invitation_id }),
            )?,
            Op::ListConnections { workspace_id } => {
                AdminRoute::get(workspace_path(*workspace_id, &["connections"]))
                    .with_max_response_bytes(CONNECTION_LIST_RESPONSE_BYTES)
            }
            Op::ListConnectionGrants {
                workspace_id,
                connection_id,
            } => AdminRoute::get(connection_path(*workspace_id, *connection_id, &["grants"])),
            Op::GrantConnectionAccess {
                workspace_id,
                connection_id,
                member_id,
                capability,
            } => AdminRoute::post(
                connection_path(*workspace_id, *connection_id, &["grants"]),
                json!({ "memberId": member_id, "capability": capability.as_str() }),
            )?,
            Op::RemoveConnectionAccess {
                workspace_id,
                connection_id,
                member_id,
            } => AdminRoute::delete(connection_path(*workspace_id, *connection_id, &["grants"]))
                .with_query("memberId", member_id.to_string()),
            Op::SetTeamReadAccess {
                workspace_id,
                connection_id,
                enabled,
            } => AdminRoute::post(
                connection_path(*workspace_id, *connection_id, &["grants"]),
                json!({ "teamReadEnabled": enabled }),
            )?,
            Op::ListConnectionConflicts { workspace_id } => {
                AdminRoute::get(workspace_path(*workspace_id, &["connections", "conflicts"]))
                    .with_max_response_bytes(LARGE_RESPONSE_BYTES)
            }
            Op::ResolveConnectionConflict {
                workspace_id,
                conflict_id,
                resolution,
            } => {
                let mut path = workspace_path(*workspace_id, &["connections", "conflicts"]);
                path.push(conflict_id.to_string());
                AdminRoute::post(path, json!({ "resolution": resolution.as_str() }))?
            }
            Op::ApplyConnectionCandidate {
                workspace_id,
                connection_id,
                expected_revision,
                payload,
            } => AdminRoute::patch(
                connection_path(*workspace_id, *connection_id, &[]),
                bounded_object(payload, MAX_CANDIDATE_PAYLOAD_BYTES, "connection candidate")?,
            )?
            .with_expected_revision(*expected_revision)?,
            Op::DeleteSharedConnection {
                workspace_id,
                connection_id,
                expected_revision,
            } => AdminRoute::delete(connection_path(*workspace_id, *connection_id, &[]))
                .with_expected_revision(*expected_revision)?,
            Op::GetLifecycle { workspace_id } => {
                AdminRoute::get(workspace_path(*workspace_id, &["lifecycle"]))
            }
            Op::ScheduleWorkspaceDeletion {
                workspace_id,
                request_id,
                confirmation,
            } => AdminRoute::post(
                workspace_path(*workspace_id, &["lifecycle"]),
                json!({
                    "action": "schedule_deletion",
                    "requestId": request_id,
                    "confirmation": exact_text(confirmation, 120, "deletion confirmation")?,
                }),
            )?,
            Op::CancelWorkspaceDeletion {
                workspace_id,
                request_id,
            } => AdminRoute::post(
                workspace_path(*workspace_id, &["lifecycle"]),
                json!({ "action": "cancel_deletion", "requestId": request_id }),
            )?,
            Op::ListBackups { workspace_id } => {
                AdminRoute::get(workspace_path(*workspace_id, &["backups"]))
            }
            Op::CreateBackup { workspace_id } => {
                AdminRoute::post_empty(workspace_path(*workspace_id, &["backups"]))
                    .with_timeout(DISCOVERY_TIMEOUT)
            }
            Op::DeleteBackup {
                workspace_id,
                backup_id,
            } => {
                let mut path = workspace_path(*workspace_id, &["backups"]);
                path.push(backup_id.to_string());
                AdminRoute::delete(path)
            }
            Op::RestoreBackup {
                workspace_id,
                backup_id,
                expected_revision,
            } => {
                let mut path = workspace_path(*workspace_id, &["backups"]);
                path.push(backup_id.to_string());
                path.push("restore".to_string());
                AdminRoute::post_empty(path)
                    .with_timeout(DISCOVERY_TIMEOUT)
                    .with_expected_revision(*expected_revision)?
            }
            Op::GetKeyRotation { workspace_id } => {
                AdminRoute::get(workspace_path(*workspace_id, &["backups", "key-rotation"]))
            }
            Op::RotateKey {
                workspace_id,
                request_id,
            } => AdminRoute::post(
                workspace_path(*workspace_id, &["backups", "key-rotation"]),
                json!({ "requestId": request_id }),
            )?
            .with_timeout(KEY_ROTATION_TIMEOUT),
            Op::ListProviderIntegrations {
                workspace_id,
                include_managed_connections,
            } => {
                let route = AdminRoute::get(workspace_path(
                    *workspace_id,
                    &["provider-integrations"],
                ))
                .with_max_response_bytes(LARGE_RESPONSE_BYTES);
                if *include_managed_connections {
                    route.with_query("includeManagedConnections", "1".to_string())
                } else {
                    route
                }
            }
            Op::ConnectNeon {
                workspace_id,
                api_key,
                project_id,
                organization_id,
            } => {
                let key = api_key.as_str().trim();
                if !(20..=512).contains(&key.len()) || key.chars().any(char::is_whitespace) {
                    return Err(invalid("Neon API key"));
                }
                let mut configuration = Map::new();
                configuration.insert("apiKey".into(), Value::String(key.to_string()));
                if let Some(project) = optional_identifier(project_id, "Neon project id")? {
                    configuration.insert("projectId".into(), Value::String(project));
                }
                if let Some(organization) =
                    optional_identifier(organization_id, "Neon organization id")?
                {
                    configuration.insert("organizationId".into(), Value::String(organization));
                }
                AdminRoute::post(
                    workspace_path(*workspace_id, &["provider-integrations"]),
                    json!({ "provider": "neon", "configuration": Value::Object(configuration) }),
                )?
                .with_timeout(PROVIDER_MUTATION_TIMEOUT)
            }
            Op::ConnectVault {
                workspace_id,
                configuration,
            } => AdminRoute::post(
                workspace_path(*workspace_id, &["provider-integrations"]),
                json!({ "provider": "vault", "configuration": vault_configuration(configuration)? }),
            )?
            .with_timeout(PROVIDER_MUTATION_TIMEOUT),
            Op::SaveGcpIntegration {
                workspace_id,
                setup_id,
                bootstrap_ticket,
                repair_integration_id,
            } => {
                let mut body = Map::new();
                body.insert("provider".into(), Value::String("gcpCloudSql".into()));
                body.insert("setupId".into(), Value::String(setup_id.to_string()));
                body.insert(
                    "bootstrapTicket".into(),
                    Value::String(opaque_token(bootstrap_ticket, 80, 32_768, "bootstrap ticket")?),
                );
                if let Some(integration) = repair_integration_id {
                    body.insert(
                        "repairIntegrationId".into(),
                        Value::String(integration.to_string()),
                    );
                }
                AdminRoute::post(
                    workspace_path(*workspace_id, &["provider-integrations"]),
                    Value::Object(body),
                )?
                .with_timeout(PROVIDER_MUTATION_TIMEOUT)
            }
            Op::DisconnectProviderIntegration {
                workspace_id,
                integration_id,
            } => AdminRoute::delete(integration_path(*workspace_id, *integration_id, &[]))
                .with_timeout(PROVIDER_MUTATION_TIMEOUT),
            Op::ListProviderResources {
                workspace_id,
                integration_id,
                resource_kind,
                selection,
            } => {
                let mut route =
                    AdminRoute::get(integration_path(*workspace_id, *integration_id, &["resources"]))
                        .with_query("kind", resource_kind.as_str().to_string())
                        .with_timeout(DISCOVERY_TIMEOUT)
                        .with_max_response_bytes(LARGE_RESPONSE_BYTES);
                for (key, value) in selection {
                    route = route.with_query(key.as_str(), query_value(value, key.as_str())?);
                }
                route
            }
            Op::ClaimProviderResource {
                workspace_id,
                integration_id,
                selection_proof,
            } => AdminRoute::post(
                integration_path(*workspace_id, *integration_id, &["resources"]),
                json!({
                    "selectionProof": opaque_token(selection_proof, 16, 16 * 1024, "selection proof")?,
                }),
            )?
            .with_timeout(DISCOVERY_TIMEOUT),
            Op::ImportProviderResource {
                workspace_id,
                integration_id,
                receipt,
                idempotency_key: key,
                name,
                production_approved,
            } => AdminRoute::post(
                integration_path(*workspace_id, *integration_id, &["imports"]),
                json!({
                    "receipt": receipt,
                    "idempotencyKey": idempotency_key(key)?,
                    "name": display_text(name, 120, "connection name")?,
                    "productionApproved": production_approved,
                }),
            )?
            .with_timeout(PROVIDER_MUTATION_TIMEOUT),
            Op::PreflightNeonBootstrap {
                workspace_id,
                integration_id,
                selection_proof,
                environment,
            } => AdminRoute::post(
                integration_path(*workspace_id, *integration_id, &["neon-bootstrap"]),
                json!({
                    "action": "preflight",
                    "selectionProof": opaque_token(selection_proof, 16, 16 * 1024, "selection proof")?,
                    "environment": environment.map(EnvironmentClassification::as_str),
                }),
            )?
            .with_timeout(PROVIDER_MUTATION_TIMEOUT),
            Op::ApplyNeonBootstrap {
                workspace_id,
                integration_id,
                plan,
                idempotency_key: key,
                public_acl_approved,
                production_approved,
            } => AdminRoute::post(
                integration_path(*workspace_id, *integration_id, &["neon-bootstrap"]),
                json!({
                    "action": "apply",
                    "plan": opaque_token(plan, 80, 64 * 1024, "Neon bootstrap plan")?,
                    "idempotencyKey": key,
                    "publicAclApproved": public_acl_approved,
                    "productionApproved": production_approved,
                }),
            )?
            .with_timeout(PROVIDER_MUTATION_TIMEOUT),
            Op::ListNeonBranches {
                workspace_id,
                integration_id,
                project_id,
            } => AdminRoute::get(integration_path(
                *workspace_id,
                *integration_id,
                &["neon-branches"],
            ))
            .with_query("project", display_text(project_id, 128, "Neon project id")?)
            .with_timeout(DISCOVERY_TIMEOUT)
            .with_max_response_bytes(LARGE_RESPONSE_BYTES),
            Op::ListNeonBranchOperations {
                workspace_id,
                integration_id,
            } => AdminRoute::get(integration_path(
                *workspace_id,
                *integration_id,
                &["neon-branches", "operations"],
            ))
            .with_timeout(DISCOVERY_TIMEOUT)
            .with_max_response_bytes(LARGE_RESPONSE_BYTES),
            Op::PlanNeonBranchOperation {
                workspace_id,
                integration_id,
                action,
                request,
            } => AdminRoute::post(
                integration_path(*workspace_id, *integration_id, &["neon-branches", "operations"]),
                json!({
                    "action": action.as_str(),
                    "request": bounded_object(request, MAX_NEON_PLAN_REQUEST_BYTES, "Neon branch plan")?,
                }),
            )?
            .with_timeout(DISCOVERY_TIMEOUT),
            Op::DecideNeonBranchOperation {
                workspace_id,
                integration_id,
                action,
                operation_id,
                plan_hash: hash,
                decision,
            } => AdminRoute::post(
                integration_path(*workspace_id, *integration_id, &["neon-branches", "operations"]),
                json!({
                    "action": action.as_str(),
                    "operationId": operation_id,
                    "planHash": plan_hash(hash)?,
                    "decision": decision.as_str(),
                }),
            )?,
            Op::ExecuteNeonBranchOperation {
                workspace_id,
                integration_id,
                action,
                operation_id,
                plan_hash: hash,
            } => AdminRoute::post(
                integration_path(*workspace_id, *integration_id, &["neon-branches", "operations"]),
                json!({
                    "action": action.as_str(),
                    "operationId": operation_id,
                    "planHash": plan_hash(hash)?,
                }),
            )?
            .with_timeout(DISCOVERY_TIMEOUT),
            Op::ListGcpSetups { workspace_id } => AdminRoute::get(workspace_path(
                *workspace_id,
                &["provider-integrations", "gcp-setup"],
            )),
            Op::ListGcpSetupInventory {
                workspace_id,
                setup_id,
                inventory,
                project_id,
            } => {
                let mut path = workspace_path(*workspace_id, &["provider-integrations", "gcp-setup"]);
                path.push(setup_id.to_string());
                let route = AdminRoute::get(path)
                    .with_query("kind", inventory.as_str().to_string())
                    .with_timeout(DISCOVERY_TIMEOUT)
                    .with_max_response_bytes(LARGE_RESPONSE_BYTES);
                match (inventory, project_id) {
                    (GcpSetupInventory::Projects, _) => route,
                    (_, Some(project)) => route.with_query(
                        "project",
                        display_text(project, 128, "Google Cloud project id")?,
                    ),
                    (_, None) => return Err(invalid("Google Cloud project id")),
                }
            }
            Op::PrepareGcpSetup {
                workspace_id,
                setup_id,
                project_id,
                project_number,
                instance_id,
                environment_classification,
                approve_production,
                approve_iam_authentication_change,
                approve_iam_role_grant,
                schema_authority,
                approve_schema_delegation,
                repair_integration_id,
            } => {
                let mut body = Map::new();
                body.insert(
                    "projectId".into(),
                    Value::String(display_text(project_id, 128, "Google Cloud project id")?),
                );
                body.insert(
                    "projectNumber".into(),
                    Value::String(display_text(project_number, 64, "Google Cloud project number")?),
                );
                body.insert(
                    "instanceId".into(),
                    Value::String(display_text(instance_id, 256, "Cloud SQL instance")?),
                );
                body.insert(
                    "environmentClassification".into(),
                    environment_classification
                        .map(|value| Value::String(value.as_str().into()))
                        .unwrap_or(Value::Null),
                );
                body.insert("approveProduction".into(), Value::Bool(*approve_production));
                body.insert(
                    "approveIamAuthenticationChange".into(),
                    Value::Bool(*approve_iam_authentication_change),
                );
                body.insert("approveIamRoleGrant".into(), Value::Bool(*approve_iam_role_grant));
                if let Some(authority) = schema_authority {
                    body.insert(
                        "schemaAuthority".into(),
                        json!({
                            "database": display_text(&authority.database, 128, "schema database")?,
                            "owner": display_text(&authority.owner, 128, "schema owner")?,
                        }),
                    );
                    body.insert(
                        "approveSchemaDelegation".into(),
                        Value::Bool(*approve_schema_delegation),
                    );
                }
                if let Some(integration) = repair_integration_id {
                    body.insert(
                        "repairIntegrationId".into(),
                        Value::String(integration.to_string()),
                    );
                }
                let mut path = workspace_path(*workspace_id, &["provider-integrations", "gcp-setup"]);
                path.push(setup_id.to_string());
                AdminRoute::post(path, Value::Object(body))?
                    .with_timeout(PROVIDER_MUTATION_TIMEOUT)
            }
        })
    }
}
