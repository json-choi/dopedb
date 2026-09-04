//! Hosted runner registration, discovery, and revocation operations.

use super::*;

// Every request below uses the shared origin validator, which rejects cleartext
// outside a debug-only loopback origin; the release client is HTTPS-only too.

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteAnalysisRunner {
    pub(crate) id: Uuid,
    pub(crate) device_id: String,
    pub(crate) display_name: String,
    pub(crate) runner_capability_generation: u64,
    pub(crate) last_seen_at: DateTime<Utc>,
    pub(crate) online: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RunnerResponse {
    runner: RemoteAnalysisRunner,
    #[serde(
        rename = "runnerCapability",
        default,
        deserialize_with = "deserialize_optional_secret"
    )]
    runner_capability: Option<Zeroizing<String>>,
}

pub(crate) struct RegisteredAnalysisRunner {
    pub(crate) runner: RemoteAnalysisRunner,
    capability: Zeroizing<String>,
}

impl RegisteredAnalysisRunner {
    pub(crate) fn capability(&self) -> &str {
        self.capability.as_str()
    }

    pub(crate) fn generation(&self) -> u64 {
        self.runner.runner_capability_generation
    }
}

pub(crate) async fn analysis_runner_registration_guard() -> tokio::sync::MutexGuard<'static, ()> {
    ANALYSIS_RUNNER_REGISTRATION_LOCK.lock().await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunnerCollectionResponse {
    workspace_id: Uuid,
    runners: Vec<RemoteAnalysisRunner>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnalysisRunnerRevocation {
    pub(crate) id: Uuid,
    pub(crate) active_run_count: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RunnerRevocationResponse {
    revoked: AnalysisRunnerRevocation,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunnerRegistrationRequest<'a> {
    device_id: &'a str,
    display_name: &'a str,
}

pub(crate) async fn register_analysis_runner(
    user_id: &str,
    workspace_id: Uuid,
    device_id: &str,
) -> AppResult<RegisteredAnalysisRunner> {
    let token = token(user_id).await?;
    let device_id = Uuid::parse_str(device_id)
        .map_err(|_| AppError::Config("Analysis runner device id is invalid".into()))?;
    let device_id_string = device_id.to_string();
    let display_name = format!("DopeDB on {}", std::env::consts::OS);
    let existing = list_analysis_runners(user_id, workspace_id)
        .await?
        .into_iter()
        .find(|runner| runner.device_id == device_id_string);
    let existing_capability = match existing.as_ref() {
        Some(runner) => {
            fetch_analysis_runner_capability(user_id, workspace_id, device_id, runner.id)?
        }
        None => None,
    };
    if let Some(runner) = existing.as_ref().filter(|_| existing_capability.is_none()) {
        revoke_analysis_runner(user_id, workspace_id, runner.id).await?;
        delete_analysis_runner_capability(user_id, workspace_id, device_id, runner.id)?;
        return Err(AppError::Blocked {
            reason: ANALYSIS_RUNNER_CAPABILITY_MISSING.into(),
        });
    }
    let mut request = client()?
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses/runners",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .header(
            ANALYSIS_RUNNER_CAPABILITY_VERSION_HEADER,
            ANALYSIS_RUNNER_CAPABILITY_VERSION,
        )
        .json(&RunnerRegistrationRequest {
            device_id: &device_id_string,
            display_name: &display_name,
        });
    if let Some(capability) = existing_capability.as_deref() {
        request = request.header(ANALYSIS_RUNNER_CAPABILITY_HEADER, capability);
    }
    let raw = request
        .send()
        .await
        .map_err(|error| request_error("registering an Analysis runner", error))?;
    if raw.status() == StatusCode::PRECONDITION_REQUIRED
        || (raw.status() == StatusCode::FORBIDDEN && existing.is_some())
    {
        if let Some(runner) = existing.as_ref() {
            revoke_analysis_runner(user_id, workspace_id, runner.id).await?;
            delete_analysis_runner_capability(user_id, workspace_id, device_id, runner.id)?;
        }
        return Err(AppError::Blocked {
            reason: ANALYSIS_RUNNER_CAPABILITY_MISSING.into(),
        });
    }
    let body: RunnerResponse = response(
        raw,
        user_id,
        "Analysis runner registration",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    if body.runner.device_id != device_id_string
        || body.runner.display_name != display_name
        || !body.runner.online
        || body.runner.last_seen_at < Utc::now() - chrono::Duration::minutes(2)
        || body.runner.last_seen_at > Utc::now() + chrono::Duration::seconds(30)
    {
        return Err(AppError::Network(
            "Analysis runner registration changed local identity".into(),
        ));
    }
    if body.runner.runner_capability_generation == 0 {
        return Err(AppError::Network(
            "Analysis runner registration changed possession generation".into(),
        ));
    }
    let capability = match (body.runner_capability, existing_capability) {
        (Some(capability), None)
            if capability.len() == 64
                && capability
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) =>
        {
            if let Err(error) = store_analysis_runner_capability(
                user_id,
                workspace_id,
                device_id,
                body.runner.id,
                capability.as_str(),
            ) {
                let cleanup = revoke_analysis_runner(user_id, workspace_id, body.runner.id).await;
                if let Err(cleanup_error) = cleanup {
                    tracing::warn!(
                        error_kind = cleanup_error.kind(),
                        "unusable Analysis runner could not be revoked after credential-store failure"
                    );
                }
                return Err(error);
            }
            capability
        }
        (None, Some(capability)) => capability,
        _ => {
            return Err(AppError::Network(
                "Analysis runner registration returned invalid possession authority".into(),
            ));
        }
    };
    Ok(RegisteredAnalysisRunner {
        runner: body.runner,
        capability,
    })
}

pub(crate) async fn list_analysis_runners(
    user_id: &str,
    workspace_id: Uuid,
) -> AppResult<Vec<RemoteAnalysisRunner>> {
    let token = token(user_id).await?;
    let raw = client()?
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses/runners",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading Analysis runners", error))?;
    let body: RunnerCollectionResponse = response(
        raw,
        user_id,
        "Analysis runner inventory",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    if body.workspace_id != workspace_id
        || body.runners.len() > 128
        || body.runners.iter().any(|runner| {
            runner.device_id.trim().is_empty()
                || runner.device_id.len() > 256
                || runner.display_name.trim().is_empty()
                || runner.display_name.len() > 256
                || runner.last_seen_at > Utc::now() + chrono::Duration::seconds(30)
        })
    {
        return Err(AppError::Network(
            "Analysis runner inventory returned invalid identity".into(),
        ));
    }
    Ok(body.runners)
}

pub(crate) async fn revoke_analysis_runner(
    user_id: &str,
    workspace_id: Uuid,
    runner_id: Uuid,
) -> AppResult<AnalysisRunnerRevocation> {
    let token = token(user_id).await?;
    let raw = client()?
        // codeql[rust/cleartext-transmission]
        .delete(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses/runners/{runner_id}",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("revoking an Analysis runner", error))?;
    let body: RunnerRevocationResponse = response(
        raw,
        user_id,
        "Analysis runner revocation",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    if body.revoked.id != runner_id || body.revoked.active_run_count > 10_000 {
        return Err(AppError::Network(
            "Analysis runner revocation returned invalid evidence".into(),
        ));
    }
    Ok(body.revoked)
}
