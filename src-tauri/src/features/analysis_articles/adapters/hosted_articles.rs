//! Hosted article and immutable publication operations.

use super::*;

// Every request below uses the shared origin validator, which rejects cleartext
// outside a debug-only loopback origin; the release client is HTTPS-only too.

pub(crate) async fn list_analysis_articles(
    user_id: &str,
    workspace_id: Uuid,
    environment_id: Option<Uuid>,
) -> AppResult<Vec<AnalysisArticleRecord>> {
    let token = token(user_id).await?;
    let mut url = Url::parse(&format!(
        "{}/api/v1/workspaces/{workspace_id}/analyses",
        origin()?
    ))
    .map_err(|_| AppError::Config("Analysis Article endpoint is invalid".into()))?;
    if let Some(environment_id) = environment_id {
        url.query_pairs_mut()
            .append_pair("environmentId", &environment_id.to_string());
    }
    let raw = client()?
        .get(url)
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading Analysis Articles", error))?;
    let body: ArticleCollectionResponse = response(
        raw,
        user_id,
        "Analysis Article collection",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    if body.workspace_id != workspace_id || body.articles.len() > 1_000 {
        return Err(AppError::Network(
            "Analysis Article collection changed workspace identity".into(),
        ));
    }
    for article in &body.articles {
        validate_article(article, None)?;
    }
    Ok(body.articles)
}

pub(crate) async fn get_analysis_article(
    user_id: &str,
    workspace_id: Uuid,
    article_id: Uuid,
) -> AppResult<AnalysisArticleRecord> {
    let token = token(user_id).await?;
    let raw = client()?
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses/{article_id}",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading an Analysis Article", error))?;
    let body: ArticleResponse = response(
        raw,
        user_id,
        "Analysis Article",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    validate_article(&body.article, Some(article_id))?;
    Ok(body.article)
}

pub(crate) async fn create_analysis_article(
    user_id: &str,
    workspace_id: Uuid,
    article: &SharedAnalysisArticleCreate,
) -> AppResult<AnalysisArticleRecord> {
    if !article.validate() {
        return Err(AppError::Config(
            "Analysis Article create contract is invalid".into(),
        ));
    }
    let token = token(user_id).await?;
    let raw = client()?
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .header(EXPECTED_REVISION_HEADER, "0")
        .json(article)
        .send()
        .await
        .map_err(|error| request_error("creating an Analysis Article", error))?;
    let body: ArticleResponse = article_mutation_response(
        raw,
        user_id,
        "created Analysis Article",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    validate_article(&body.article, Some(article.id))?;
    Ok(body.article)
}

pub(crate) async fn mutate_analysis_article(
    user_id: &str,
    workspace_id: Uuid,
    article_id: Uuid,
    expected_revision: i64,
    article: &SharedAnalysisArticleCreate,
) -> AppResult<AnalysisArticleRecord> {
    if expected_revision < 1 {
        return Err(AppError::Config(
            "Analysis Article expected revision must be positive".into(),
        ));
    }
    if article.id != article_id || !article.validate() {
        return Err(AppError::Config(
            "Analysis Article update contract is invalid".into(),
        ));
    }
    let body = json!({ "action": "update", "article": article });
    let token = token(user_id).await?;
    let raw = client()?
        .patch(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses/{article_id}",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .header(EXPECTED_REVISION_HEADER, expected_revision)
        .json(&body)
        .send()
        .await
        .map_err(|error| request_error("updating an Analysis Article", error))?;
    let body: ArticleResponse = article_mutation_response(
        raw,
        user_id,
        "updated Analysis Article",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    validate_article(&body.article, Some(article_id))?;
    Ok(body.article)
}

pub(crate) async fn delete_analysis_article(
    user_id: &str,
    workspace_id: Uuid,
    article_id: Uuid,
    expected_revision: i64,
) -> AppResult<i64> {
    let token = token(user_id).await?;
    let raw = client()?
        // codeql[rust/cleartext-transmission]
        .delete(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses/{article_id}",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .header(EXPECTED_REVISION_HEADER, expected_revision)
        .send()
        .await
        .map_err(|error| request_error("deleting an Analysis Article", error))?;
    let body: DeletedArticleResponse = response(
        raw,
        user_id,
        "deleted Analysis Article",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    if !body.deleted || body.revision <= expected_revision {
        return Err(AppError::Network(
            "Analysis Article deletion returned invalid revision evidence".into(),
        ));
    }
    Ok(body.revision)
}

pub(crate) async fn list_analysis_article_revisions(
    user_id: &str,
    workspace_id: Uuid,
    article_id: Uuid,
) -> AppResult<Vec<RemoteAnalysisArticleRevision>> {
    let token = token(user_id).await?;
    let raw = client()?
        // codeql[rust/cleartext-transmission]
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses/{article_id}/revisions",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading Analysis Article history", error))?;
    let body: RevisionCollectionResponse = response(
        raw,
        user_id,
        "Analysis Article history",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    if body.article_id != article_id
        || body.revisions.len() > 200
        || body.revisions.iter().any(|revision| {
            revision.revision < 1
                || revision.payload.id != article_id
                || revision.payload_hash.len() != 64
        })
    {
        return Err(AppError::Network(
            "Analysis Article history returned invalid revision evidence".into(),
        ));
    }
    Ok(body.revisions)
}

pub(crate) async fn list_analysis_publications(
    user_id: &str,
    workspace_id: Uuid,
    article_id: Uuid,
) -> AppResult<Vec<RemoteAnalysisPublication>> {
    let token = token(user_id).await?;
    let raw = client()?
        // codeql[rust/cleartext-transmission]
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses/{article_id}/publications",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading Analysis publications", error))?;
    let body: PublicationCollectionResponse = response(
        raw,
        user_id,
        "Analysis publication collection",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    if body.publications.len() > 500 {
        return Err(AppError::Network(
            "Analysis publication collection is oversized".into(),
        ));
    }
    for publication in &body.publications {
        validate_publication(publication, None)?;
    }
    Ok(body.publications)
}

pub(crate) async fn create_analysis_publication(
    user_id: &str,
    workspace_id: Uuid,
    article_id: Uuid,
    request: &AnalysisPublicationRequest,
) -> AppResult<RemoteAnalysisPublication> {
    let token = token(user_id).await?;
    let raw = client()?
        // codeql[rust/cleartext-transmission]
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses/{article_id}/publications",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(request)
        .send()
        .await
        .map_err(|error| request_error("publishing an Analysis Article", error))?;
    let body: PublicationResponse = response(
        raw,
        user_id,
        "created Analysis publication",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    validate_publication(&body.publication, Some(request.id))?;
    if body.publication.slug != request.slug || body.publication.source_run_id != request.run_id {
        return Err(AppError::Network(
            "Analysis publication changed its requested identity".into(),
        ));
    }
    Ok(body.publication)
}

pub(crate) async fn revoke_analysis_publication(
    user_id: &str,
    workspace_id: Uuid,
    article_id: Uuid,
    publication_id: Uuid,
) -> AppResult<DateTime<Utc>> {
    let token = token(user_id).await?;
    let raw = client()?
        // codeql[rust/cleartext-transmission]
        .delete(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses/{article_id}/publications/{publication_id}",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("revoking an Analysis publication", error))?;
    let body: PublicationRevocationResponse = response(
        raw,
        user_id,
        "revoked Analysis publication",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    if body.id != publication_id || body.revoked_at > Utc::now() + chrono::Duration::seconds(30) {
        return Err(AppError::Network(
            "Analysis publication revocation changed identity".into(),
        ));
    }
    Ok(body.revoked_at)
}

pub(crate) fn analysis_publication_url(slug: &str) -> AppResult<String> {
    let valid = slug.len() >= 8
        && slug.len() <= 128
        && slug.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        });
    if !valid {
        return Err(AppError::Config("invalid Analysis publication slug".into()));
    }
    Ok(format!("{}/analyses/{slug}", origin()?))
}
