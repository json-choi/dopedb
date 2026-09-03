//! Hosted Knowledge environment binding, GitHub, and source operations.

use super::*;

pub(super) async fn list_environment_connections(
    user_id: &str,
    workspace_id: Uuid,
    environment_id: Option<Uuid>,
) -> AppResult<Vec<RemoteEnvironmentConnectionBinding>> {
    let token = bearer(user_id).await?;
    let path = environment_id.map_or_else(
        || format!("/api/v1/workspaces/{workspace_id}/knowledge/environment-connections"),
        |environment_id| {
            format!(
                "/api/v1/workspaces/{workspace_id}/knowledge/environments/{environment_id}/connections"
            )
        },
    );
    let response = client()?
        .get(format!("{}{path}", origin()?))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading Environment connections", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let parsed: EnvironmentConnectionBindingsResponse = if environment_id.is_some() {
        knowledge_response(response, "reading Environment connections").await?
    } else {
        bounded_json_response(
            response,
            "reading Environment connection inventory",
            MAX_KNOWLEDGE_INVENTORY_RESPONSE_BYTES,
        )
        .await?
    };
    let bindings = parsed.bindings;
    let maximum = if environment_id.is_some() {
        1_000
    } else {
        10_000
    };
    if bindings.len() > maximum
        || bindings.iter().any(|binding| {
            environment_id.is_some_and(|id| binding.project_environment_id != id)
                || binding.environment_revision == 0
                || binding.connection_revision <= 0
                || binding.current_connection_revision <= 0
                || binding.connection_content_revision <= 0
                || binding.connection_name.is_empty()
                || binding.connection_name.len() > 512
                || binding.role.is_empty()
                || binding.role.len() > 64
                || binding.alias.is_empty()
                || binding.alias.len() > 128
                || binding.stale
                    != (binding.connection_revision != binding.current_connection_revision)
        })
    {
        return Err(AppError::Network(
            "Project Knowledge returned invalid Environment connections".into(),
        ));
    }
    Ok(bindings)
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn bind_environment_connection(
    user_id: &str,
    workspace_id: Uuid,
    environment_id: Uuid,
    binding_id: Uuid,
    connection_id: Uuid,
    expected_connection_revision: i64,
    role: &str,
    alias: &str,
) -> AppResult<RemoteEnvironmentConnectionBinding> {
    if expected_connection_revision <= 0 {
        return Err(AppError::Config(
            "the Environment connection revision is invalid".into(),
        ));
    }
    let token = bearer(user_id).await?;
    let response = client()?
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/environments/{environment_id}/connections",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(&json!({
            "bindingId": binding_id,
            "connectionId": connection_id,
            "expectedConnectionRevision": expected_connection_revision,
            "role": role,
            "alias": alias,
        }))
        .send()
        .await
        .map_err(|error| request_error("binding an Environment connection", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let binding = knowledge_response::<EnvironmentConnectionBindingResponse>(
        response,
        "reading an Environment connection binding",
    )
    .await?
    .binding;
    if binding.project_environment_id != environment_id
        || binding.connection_id != connection_id
        || binding.connection_revision != expected_connection_revision
        || binding.current_connection_revision != expected_connection_revision
        || binding.connection_content_revision <= 0
        || binding.stale
    {
        return Err(AppError::Network(
            "Project Knowledge changed Environment connection identity or revision".into(),
        ));
    }
    Ok(binding)
}

pub(super) async fn revoke_environment_connection(
    user_id: &str,
    workspace_id: Uuid,
    environment_id: Uuid,
    binding_id: Uuid,
) -> AppResult<()> {
    let token = bearer(user_id).await?;
    let response = client()?
        .delete(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/environments/{environment_id}/connections",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(&json!({ "bindingId": binding_id }))
        .send()
        .await
        .map_err(|error| request_error("removing an Environment connection", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    Ok(())
}

pub(super) async fn begin_knowledge_github_install(
    user_id: &str,
    workspace_id: Uuid,
) -> AppResult<String> {
    let token = bearer(user_id).await?;
    let response = client()?
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/github/install",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(&json!({}))
        .send()
        .await
        .map_err(|error| request_error("starting GitHub Knowledge installation", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let url = knowledge_response::<GithubInstallResponse>(
        response,
        "reading GitHub Knowledge installation",
    )
    .await?
    .authorization_url;
    let parsed = Url::parse(&url)
        .map_err(|_| AppError::Network("GitHub Knowledge returned an invalid URL".into()))?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
        || !parsed.path().starts_with("/apps/")
        || !parsed.path().ends_with("/installations/new")
    {
        return Err(AppError::Network(
            "GitHub Knowledge returned an unsafe installation URL".into(),
        ));
    }
    Ok(url)
}

pub(super) async fn list_knowledge_github_repositories(
    user_id: &str,
    workspace_id: Uuid,
) -> AppResult<Vec<RemoteGithubRepository>> {
    let token = bearer(user_id).await?;
    let response = client()?
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/github/repositories",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading GitHub Knowledge repositories", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let body: GithubRepositoryResponse =
        knowledge_response(response, "reading GitHub Knowledge repositories").await?;
    let mut repositories = Vec::new();
    for installation in body.installations {
        if installation.account_login.is_empty() || installation.account_login.len() > 255 {
            return Err(AppError::Network(
                "GitHub Knowledge returned an invalid installation".into(),
            ));
        }
        for repository in installation.repositories {
            if repositories.len() >= 1_000
                || repository.id.is_empty()
                || repository.id.len() > 32
                || repository.full_name.len() > 512
                || repository.default_branch.len() > 255
            {
                return Err(AppError::Network(
                    "GitHub Knowledge returned an invalid repository inventory".into(),
                ));
            }
            repositories.push(RemoteGithubRepository {
                installation_id: installation.installation_id,
                account_login: installation.account_login.clone(),
                id: repository.id,
                full_name: repository.full_name,
                default_branch: repository.default_branch,
                private: repository.private,
                archived: repository.archived,
            });
        }
    }
    Ok(repositories)
}

pub(super) async fn create_knowledge_source(
    user_id: &str,
    workspace_id: Uuid,
    request: &CreateKnowledgeSourceRequest<'_>,
) -> AppResult<CreatedKnowledgeSource> {
    let token = bearer(user_id).await?;
    let response = client()?
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/sources",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(request)
        .send()
        .await
        .map_err(|error| request_error("creating a Project Knowledge source", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let created = knowledge_response::<CreatedKnowledgeSourceResponse>(
        response,
        "reading the Project Knowledge source",
    )
    .await?
    .source;
    if created.id != request.source_id
        || created.sync_revision == 0
        || created.environment_revision == 0
        || created.commit_sha.as_ref().is_some_and(|value| {
            value.len() != 40 || !value.chars().all(|character| character.is_ascii_hexdigit())
        })
    {
        return Err(AppError::Network(
            "Project Knowledge changed source identity".into(),
        ));
    }
    Ok(created)
}

pub(super) async fn list_remote_knowledge_sources(
    user_id: &str,
    workspace_id: Uuid,
) -> AppResult<Vec<RemoteKnowledgeSource>> {
    let token = bearer(user_id).await?;
    let response = client()?
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/sources",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading workspace Knowledge sources", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let sources = knowledge_response::<RemoteKnowledgeSourcesResponse>(
        response,
        "reading workspace Knowledge sources",
    )
    .await?
    .sources;
    validate_source_inventory(&sources)?;
    Ok(sources)
}

pub(super) fn safe_source_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 4_096
        && !value.starts_with('/')
        && !value.contains('\\')
        && !value.chars().any(char::is_control)
        && value
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

pub(super) async fn search_remote_source(
    request: &PinnedSourceSearchRequest<'_>,
) -> AppResult<RemoteSourceSearchResult> {
    let authority = &request.authority;
    let source = authority.source;
    let limit = request.limit;
    let token = bearer(authority.account_id).await?;
    let mut url = Url::parse(&format!(
        "{}/api/v1/workspaces/{}/knowledge/sources/{}/browse",
        origin()?,
        authority.workspace_id,
        source.source_id,
    ))
    .map_err(|_| AppError::Config("invalid hosted source browse URL".into()))?;
    url.query_pairs_mut()
        .append_pair("environmentId", &authority.environment_id.to_string())
        .append_pair(
            "environmentRevision",
            &authority.environment_revision.to_string(),
        )
        .append_pair("connectionId", &authority.connection_id.to_string())
        .append_pair(
            "connectionRevision",
            &authority.connection_revision.to_string(),
        )
        .append_pair("commitSha", &source.commit_sha)
        .append_pair("query", request.query)
        .append_pair("limit", &limit.to_string());
    let response = client()?
        .get(url)
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("searching the pinned GitHub source", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let result: RemoteSourceSearchResult =
        knowledge_response(response, "reading the pinned GitHub source tree").await?;
    if result.source_id != source.source_id
        || result.repository != source.repository
        || result.ref_name != source.ref_name
        || result.commit_sha != source.commit_sha
        || result.file_count > 100_000
        || result.matches.len() > usize::try_from(limit).unwrap_or(usize::MAX)
        || result.total_matches > result.file_count
        || result.truncated != (result.total_matches > result.matches.len() as u64)
        || result.matches.iter().any(|item| {
            !safe_source_path(&item.path)
                || item.blob_sha.len() != 40
                || !item.blob_sha.bytes().all(|byte| byte.is_ascii_hexdigit())
                || item.bytes > 16 * 1024 * 1024
        })
    {
        return Err(AppError::Network(
            "Project Knowledge returned an invalid GitHub source tree".into(),
        ));
    }
    Ok(result)
}

pub(super) async fn read_remote_source(
    request: &PinnedSourceReadRequest<'_>,
) -> AppResult<RemoteSourceReadResult> {
    let authority = &request.authority;
    let source = authority.source;
    let token = bearer(authority.account_id).await?;
    let response = client()?
        .post(format!(
            "{}/api/v1/workspaces/{}/knowledge/sources/{}/browse",
            origin()?,
            authority.workspace_id,
            source.source_id,
        ))
        .bearer_auth(token.as_str())
        .json(&SourceReadRequest {
            environment_id: authority.environment_id,
            environment_revision: authority.environment_revision,
            connection_id: authority.connection_id,
            connection_revision: authority.connection_revision,
            commit_sha: &source.commit_sha,
            path: request.path,
            line_start: request.line_start,
            line_end: request.line_end,
        })
        .send()
        .await
        .map_err(|error| request_error("reading the pinned GitHub source", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let result: RemoteSourceReadResult =
        knowledge_response(response, "reading the pinned GitHub source file").await?;
    if result.source_id != source.source_id
        || result.repository != source.repository
        || result.commit_sha != source.commit_sha
        || result.path != request.path
        || !safe_source_path(&result.path)
        || result.blob_sha.len() != 40
        || !result.blob_sha.bytes().all(|byte| byte.is_ascii_hexdigit())
        || result.bytes > 1024 * 1024
        || result.line_start == 0
        || result.line_end < result.line_start.saturating_sub(1)
        || result.line_end > request.line_end
        || result.total_lines < result.line_end
        || result.text.len() > 128 * 1024
        || result.text.contains('\0')
    {
        return Err(AppError::Network(
            "Project Knowledge returned an invalid GitHub source file".into(),
        ));
    }
    Ok(result)
}

pub(super) async fn delete_knowledge_source(
    user_id: &str,
    workspace_id: Uuid,
    source_id: Uuid,
) -> AppResult<()> {
    let token = bearer(user_id).await?;
    let response = client()?
        .delete(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/sources/{source_id}",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("revoking a Project Knowledge source", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    Ok(())
}
