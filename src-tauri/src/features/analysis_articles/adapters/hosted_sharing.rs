//! Private share links and invitations. The hosted origin and current account own authority.
use super::*;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArticleInvitation {
    pub(crate) id: Uuid,
    pub(crate) recipient_email: String,
    pub(crate) expires_at: String,
    pub(crate) accepted_at: Option<String>,
    pub(crate) revoked_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArticleSharing {
    pub(crate) workspace_id: Uuid,
    pub(crate) article_id: Uuid,
    pub(crate) project_environment_id: Uuid,
    pub(crate) title: String,
    pub(crate) workspace_name: String,
    pub(crate) connection_name: String,
    pub(crate) credential_mode: String,
    pub(crate) can_invite: bool,
    pub(crate) url: String,
    pub(crate) invitations: Vec<ArticleInvitation>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArticleInvitationLink {
    pub(crate) id: Uuid,
    pub(crate) url: String,
}

pub(crate) async fn article_sharing(
    user_id: &str,
    workspace_id: Uuid,
    article_id: Uuid,
) -> AppResult<ArticleSharing> {
    let token = token(user_id).await?;
    let raw = client()?
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses/{article_id}/sharing",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading Article sharing", error))?;
    let body: ArticleSharing = response(raw, user_id, "Article sharing", 64 * 1024).await?;
    if body.workspace_id != workspace_id
        || body.article_id != article_id
        || body.url != format!("{}/open-article/{workspace_id}/{article_id}", origin()?)
        || body.invitations.len() > 50
        || body.title.chars().count() > 160
    {
        return Err(AppError::Network(
            "Article sharing returned an invalid scope".into(),
        ));
    }
    Ok(body)
}

pub(crate) async fn invite_to_article(
    user_id: &str,
    workspace_id: Uuid,
    article_id: Uuid,
    email: &str,
) -> AppResult<ArticleInvitationLink> {
    if email.len() > 254 || email.trim().is_empty() {
        return Err(AppError::Config(
            "Enter the recipient's email address".into(),
        ));
    }
    let token = token(user_id).await?;
    let raw = client()?
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses/{article_id}/sharing",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(&json!({ "email": email }))
        .send()
        .await
        .map_err(|error| request_error("creating an Article invitation", error))?;
    let body: ArticleInvitationLink = response(raw, user_id, "Article invitation", 4096).await?;
    if body.url != format!("{}/article-invitations/{}", origin()?, body.id) {
        return Err(AppError::Network(
            "Article invitation returned an invalid link".into(),
        ));
    }
    Ok(body)
}

pub(crate) async fn revoke_article_invitation(
    user_id: &str,
    workspace_id: Uuid,
    article_id: Uuid,
    invitation_id: Uuid,
) -> AppResult<()> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Revoked {
        id: Uuid,
    }
    let token = token(user_id).await?;
    let raw = client()?
        .delete(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses/{article_id}/sharing",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(&json!({ "id": invitation_id }))
        .send()
        .await
        .map_err(|error| request_error("cancelling an Article invitation", error))?;
    let body: Revoked = response(raw, user_id, "Article invitation cancellation", 4096).await?;
    if body.id != invitation_id {
        return Err(AppError::Network(
            "Article invitation cancellation changed identity".into(),
        ));
    }
    Ok(())
}
