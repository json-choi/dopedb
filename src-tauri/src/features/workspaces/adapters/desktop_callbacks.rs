//! Desktop access and article navigation deep links.
//! Navigation signals never establish a session or grant authority.

use tauri::{App, Emitter, Manager, Runtime};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

pub(crate) fn register_workspace_callbacks<R: Runtime>(app: &App<R>) {
    let identifier = app.config().identifier.clone();
    let handle = app.handle().clone();
    // Retain cold-start links until the renderer has mounted its listener.
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls {
            crate::features::analysis_articles::desktop_links::receive_article_link(
                &url,
                callback_scheme(&identifier),
            );
        }
    }
    app.deep_link().on_open_url(move |event| {
        let mut recognized = false;
        for url in event.urls() {
            let event_name = if is_workspace_access_callback(&url, &identifier) {
                Some("workspace-access:callback")
            } else if crate::features::analysis_articles::desktop_links::receive_article_link(
                &url,
                callback_scheme(&identifier),
            ) {
                Some(crate::features::analysis_articles::desktop_links::ARTICLE_LINK_EVENT)
            } else {
                None
            };
            if let Some(event_name) = event_name {
                recognized = true;
                let _ = handle.emit(event_name, ());
            }
        }
        if recognized {
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    });
}

fn callback_scheme(identifier: &str) -> Option<&'static str> {
    match identifier {
        "dev.dopedb.desktop" => Some("dopedb"),
        "dev.dopedb.desktop.dev" => Some("dopedb-dev"),
        "dev.dopedb.desktop.benchmark" => Some("dopedb-benchmark"),
        _ => None,
    }
}

fn is_workspace_access_callback(url: &Url, identifier: &str) -> bool {
    is_callback(url, identifier, "workspace", "/access-complete")
}

fn is_callback(url: &Url, identifier: &str, host: &str, path: &str) -> bool {
    callback_scheme(identifier) == Some(url.scheme())
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str() == Some(host)
        && url.port().is_none()
        && url.path() == path
        && url.query().is_none()
        && url.fragment().is_none()
}

#[cfg(test)]
pub(crate) fn assert_workspace_callback_contract() {
    crate::features::analysis_articles::desktop_links::assert_article_link_contract();
    for (identifier, scheme) in [
        ("dev.dopedb.desktop", "dopedb"),
        ("dev.dopedb.desktop.dev", "dopedb-dev"),
        ("dev.dopedb.desktop.benchmark", "dopedb-benchmark"),
    ] {
        let access = Url::parse(&format!("{scheme}://workspace/access-complete")).unwrap();
        assert!(is_workspace_access_callback(&access, identifier));
        for suffix in ["?token=value", "#fragment", "/", "?connection=other"] {
            assert!(!is_workspace_access_callback(
                &Url::parse(&format!("{access}{suffix}")).unwrap(),
                identifier
            ));
        }
    }

    assert!(callback_scheme("unrecognized.bundle").is_none());
    for invalid in [
        "dopedb://user@workspace/access-complete",
        "dopedb://workspace:443/access-complete",
        "https://workspace/access-complete",
        "dopedb-dev://workspace/access-complete",
        "dopedb://workspace/other",
    ] {
        assert!(!is_workspace_access_callback(
            &Url::parse(invalid).unwrap(),
            "dev.dopedb.desktop"
        ));
    }
}
