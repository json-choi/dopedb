//! Bounded, token-free navigation inbox. A link never changes account or executes work.
use serde::Serialize;
use std::sync::Mutex;
use url::Url;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopArticleLink {
    request_id: Uuid,
    workspace_id: Uuid,
    article_id: Uuid,
}

static PENDING: Mutex<Option<DesktopArticleLink>> = Mutex::new(None);
pub(crate) const ARTICLE_LINK_EVENT: &str = "analysis-article:open-link";

pub(crate) fn receive_article_link(url: &Url, expected_scheme: Option<&str>) -> bool {
    let Some(link) = parse_article_link(url, expected_scheme) else {
        return false;
    };
    if let Ok(mut pending) = PENDING.lock() {
        *pending = Some(link);
        return true;
    }
    false
}

fn parse_article_link(url: &Url, expected_scheme: Option<&str>) -> Option<DesktopArticleLink> {
    if expected_scheme != Some(url.scheme())
        || url.host_str() != Some("article")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let mut segments = url.path().strip_prefix('/')?.split('/');
    let workspace_id = segments.next()?.parse::<Uuid>().ok()?;
    let article_id = segments.next()?.parse::<Uuid>().ok()?;
    if segments.next().is_some() || workspace_id.is_nil() || article_id.is_nil() {
        return None;
    }
    // Reject encoded and noncanonical UUID spellings at this public entry point.
    if url.path() != format!("/{workspace_id}/{article_id}") {
        return None;
    }
    Some(DesktopArticleLink {
        request_id: Uuid::new_v4(),
        workspace_id,
        article_id,
    })
}

#[tauri::command]
pub(crate) fn pending_article_link_command() -> Option<DesktopArticleLink> {
    PENDING.lock().ok().and_then(|pending| pending.clone())
}

#[tauri::command]
pub(crate) fn dismiss_article_link_command(request_id: Uuid) {
    if let Ok(mut pending) = PENDING.lock() {
        if pending
            .as_ref()
            .is_some_and(|link| link.request_id == request_id)
        {
            *pending = None;
        }
    }
}

#[cfg(test)]
pub(crate) fn assert_article_link_contract() {
    let path = "/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000002";
    let valid = format!("dopedb://article{path}");
    assert!(parse_article_link(&Url::parse(&valid).unwrap(), Some("dopedb")).is_some());
    for invalid in [
        format!("{valid}?token=value"),
        format!("{valid}#fragment"),
        format!("{valid}/"),
        format!("dopedb://user@article{path}"),
        format!("https://article{path}"),
        "dopedb://article/not-a-workspace/not-an-article".into(),
    ] {
        assert!(parse_article_link(&Url::parse(&invalid).unwrap(), Some("dopedb")).is_none());
    }
    assert!(parse_article_link(&Url::parse(&valid).unwrap(), Some("dopedb-dev")).is_none());
    assert!(parse_article_link(&Url::parse(&valid).unwrap(), None).is_none());
}
