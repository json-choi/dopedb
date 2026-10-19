//! Hosted control-plane adapter for direct shared databases.
//!
//! Every request goes through the workspace-administration transport, which reads the
//! account's Bearer session from the OS credential store for one request and never
//! returns it. Paths are built only from literals and typed UUIDs, bodies carry public
//! verifiers, receipts, and ids, and responses are parsed through the shared protocol
//! types that reject unknown fields.

use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use dopedb_protocol::{
    DirectLevel, DirectProvisioningStatus, DirectReceiptRequest, DirectRevocationEntry,
    DirectRevocationKind, DirectVerifierRequest, DirectWorkList, DirectWorkListItem,
};

use crate::error::{AppError, AppResult};
use crate::features::workspace_admin::domain::{
    AdminRoute, WorkspaceAdminOperation, WorkspaceAdminResponse,
};
use crate::features::workspace_admin::{HostedWorkspaceAdmin, WorkspaceAdminControlPlanePort};
use crate::kernel::identity::{AccountId, ConnectionId, WorkspaceId};

use super::super::ports::{DirectControlPlanePort, MutationOutcome, RevocationSettle};
use super::super::types::DirectScope;

const LARGE_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Copy, Default)]
pub(crate) struct HostedDirectControlPlane {
    admin: HostedWorkspaceAdmin,
}

fn workspace_path(workspace_id: WorkspaceId, rest: &[&str]) -> Vec<String> {
    let mut path = vec!["api".to_owned(), "v1".to_owned(), "workspaces".to_owned()];
    path.push(workspace_id.to_string());
    path.extend(rest.iter().map(|part| (*part).to_owned()));
    path
}

fn direct_path(scope: &DirectScope, rest: &[&str]) -> Vec<String> {
    let connection = scope.connection_id.to_string();
    let mut parts = vec!["connections", connection.as_str(), "direct"];
    parts.extend_from_slice(rest);
    workspace_path(scope.workspace_id, &parts)
}

fn error_code(response: &WorkspaceAdminResponse) -> Option<&str> {
    let body = response.body.as_ref()?;
    ["code", "error"]
        .iter()
        .filter_map(|key| body.get(*key)?.as_str())
        .find(|code| code.len() <= 64 && code.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'))
}

/// Success body, or a categorical error that never repeats server text.
fn success(response: WorkspaceAdminResponse) -> AppResult<Value> {
    match response.status {
        200..=299 => Ok(response.body.unwrap_or(Value::Null)),
        401 | 403 => Err(AppError::AuthenticationRequired("workspace".into())),
        404 => Err(AppError::NotFound("direct shared database".into())),
        400 | 409 | 422 => Err(AppError::Blocked {
            reason: match error_code(&response) {
                Some(code) => format!("the workspace service refused the request: {code}"),
                None => "the workspace service refused the request".into(),
            },
        }),
        _ => Err(AppError::Network(
            "the workspace service could not complete the request".into(),
        )),
    }
}

fn invalid() -> AppError {
    AppError::Network("the workspace service returned an invalid direct access response".into())
}

fn parse<T: DeserializeOwned>(value: Value) -> AppResult<T> {
    serde_json::from_value(value).map_err(|_| invalid())
}

/// Accept either a bare array or an object holding it under one of `keys`.
fn array_of(body: Value, keys: &[&str]) -> AppResult<Vec<Value>> {
    match body {
        Value::Array(items) => Ok(items),
        Value::Object(mut object) => keys
            .iter()
            .find_map(|key| match object.remove(*key) {
                Some(Value::Array(items)) => Some(items),
                _ => None,
            })
            .ok_or_else(invalid),
        _ => Err(invalid()),
    }
}

fn status_of(body: Value) -> AppResult<DirectProvisioningStatus> {
    let value = match body {
        Value::Object(mut object) if object.contains_key("provisioning") => {
            object.remove("provisioning").unwrap_or(Value::Null)
        }
        other => other,
    };
    let status: DirectProvisioningStatus = parse(value)?;
    status.validate().then_some(status).ok_or_else(invalid)
}

fn entries_of(body: Value) -> AppResult<Vec<DirectRevocationEntry>> {
    array_of(body, &["revocations", "entries", "items"])?
        .into_iter()
        .map(|value| {
            let entry: DirectRevocationEntry = parse(value)?;
            entry.validate().then_some(entry).ok_or_else(invalid)
        })
        .collect()
}

impl HostedDirectControlPlane {
    async fn call(&self, account_id: &AccountId, route: AdminRoute) -> AppResult<Value> {
        success(self.admin.execute(account_id, route).await?)
    }
}

impl DirectControlPlanePort for HostedDirectControlPlane {
    async fn register(
        &self,
        account_id: &AccountId,
        workspace_id: WorkspaceId,
        body: Value,
    ) -> AppResult<(ConnectionId, i64)> {
        let route = AdminRoute::post(
            workspace_path(workspace_id, &["connections", "direct"]),
            body,
        )?
        .with_expected_revision(0)?;
        let response = self.call(account_id, route).await?;
        let connection = response.get("connection").unwrap_or(&response);
        let id = connection
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| uuid::Uuid::parse_str(id).ok())
            .ok_or_else(invalid)?;
        let revision = connection
            .get("revision")
            .and_then(Value::as_i64)
            .filter(|revision| *revision >= 1)
            .ok_or_else(invalid)?;
        Ok((ConnectionId::from(id), revision))
    }

    async fn principal_status(&self, scope: &DirectScope) -> AppResult<DirectProvisioningStatus> {
        let route = AdminRoute::get(direct_path(scope, &["principal"]));
        status_of(self.call(&scope.account_id, route).await?)
    }

    async fn put_verifier(
        &self,
        scope: &DirectScope,
        request: &DirectVerifierRequest,
    ) -> AppResult<DirectProvisioningStatus> {
        let route = AdminRoute::put(
            direct_path(scope, &["principal"]),
            serde_json::to_value(request)?,
        )?;
        status_of(self.call(&scope.account_id, route).await?)
    }

    async fn work(&self, scope: &DirectScope) -> AppResult<DirectWorkList> {
        let route = AdminRoute::get(direct_path(scope, &["work"]))
            .with_max_response_bytes(LARGE_RESPONSE_BYTES);
        let list: DirectWorkList = parse(self.call(&scope.account_id, route).await?)?;
        if !list.validate() || list.connection_id != scope.connection_id.to_string() {
            return Err(invalid());
        }
        Ok(list)
    }

    async fn claim(
        &self,
        scope: &DirectScope,
        device_id: &str,
        principal_ids: &[String],
    ) -> AppResult<Vec<DirectWorkListItem>> {
        let route = AdminRoute::post(
            direct_path(scope, &["claims"]),
            json!({ "deviceId": device_id, "principalIds": principal_ids }),
        )?
        .with_max_response_bytes(LARGE_RESPONSE_BYTES);
        array_of(
            self.call(&scope.account_id, route).await?,
            &["items", "claimed"],
        )?
        .into_iter()
        .map(parse)
        .collect()
    }

    async fn receipt(&self, scope: &DirectScope, request: &DirectReceiptRequest) -> AppResult<()> {
        if !request.validate() {
            return Err(AppError::Config(
                "the direct access receipt is invalid".into(),
            ));
        }
        let route = AdminRoute::post(
            direct_path(scope, &["receipts"]),
            serde_json::to_value(request)?,
        )?;
        self.call(&scope.account_id, route).await.map(|_| ())
    }

    async fn list_revocations(
        &self,
        account_id: &AccountId,
        workspace_id: WorkspaceId,
    ) -> AppResult<Vec<DirectRevocationEntry>> {
        let route = AdminRoute::get(workspace_path(workspace_id, &["direct", "revocations"]));
        entries_of(self.call(account_id, route).await?)
    }

    async fn create_revocations(
        &self,
        scope: &DirectScope,
        kind: DirectRevocationKind,
        member_ids: &[String],
        target_level: DirectLevel,
    ) -> AppResult<Vec<DirectRevocationEntry>> {
        let route = AdminRoute::post(
            workspace_path(scope.workspace_id, &["direct", "revocations"]),
            json!({
                "connectionId": scope.connection_id,
                "kind": kind,
                "memberIds": member_ids,
                "targetLevel": target_level,
            }),
        )?;
        entries_of(self.call(&scope.account_id, route).await?)
    }

    async fn settle_revocation(
        &self,
        account_id: &AccountId,
        workspace_id: WorkspaceId,
        revocation_id: &str,
        state: RevocationSettle,
    ) -> AppResult<()> {
        let uuid = uuid::Uuid::parse_str(revocation_id)
            .map_err(|_| AppError::Config("the revocation id is invalid".into()))?
            .to_string();
        let route = AdminRoute::post(
            workspace_path(workspace_id, &["direct", "revocations", uuid.as_str()]),
            json!({
                "state": match state {
                    RevocationSettle::Applied => "applied",
                    RevocationSettle::Cancelled => "cancelled",
                }
            }),
        )?;
        self.call(account_id, route).await.map(|_| ())
    }

    async fn mutate(&self, account_id: &AccountId, operation: Value) -> AppResult<MutationOutcome> {
        let route = serde_json::from_value::<WorkspaceAdminOperation>(operation)
            .map_err(|_| AppError::Config("the administration operation is invalid".into()))?
            .route()?;
        let response = self.admin.execute(account_id, route).await?;
        Ok(match response.status {
            200..=299 => MutationOutcome::Done,
            409 if error_code(&response) == Some("direct_revocation_required") => {
                MutationOutcome::RevocationRequired
            }
            401 | 403 => return Err(AppError::AuthenticationRequired("workspace".into())),
            status => MutationOutcome::Rejected(status),
        })
    }
}
