//! Desktop deep-link adapter for returning from browser device authorization.
//! The URL carries no login material; the existing server poll remains authoritative.

use tauri::{App, Emitter, Manager, Runtime};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

const LOGIN_CALLBACK_EVENT: &str = "workspace-login:callback";
const LOGIN_CALLBACK_HOST: &str = "auth";
const LOGIN_CALLBACK_PATH: &str = "/device-complete";

pub(crate) fn register_workspace_login_callback<R: Runtime>(app: &App<R>) {
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
            let event_name = if is_workspace_login_callback(&url, &identifier) {
                Some(LOGIN_CALLBACK_EVENT)
            } else if is_workspace_access_callback(&url, &identifier) {
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

fn is_workspace_login_callback(url: &Url, identifier: &str) -> bool {
    is_callback(url, identifier, LOGIN_CALLBACK_HOST, LOGIN_CALLBACK_PATH)
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
pub(crate) fn assert_workspace_login_callback_contract() {
    crate::features::analysis_articles::desktop_links::assert_article_link_contract();
    for (identifier, scheme) in [
        ("dev.dopedb.desktop", "dopedb"),
        ("dev.dopedb.desktop.dev", "dopedb-dev"),
        ("dev.dopedb.desktop.benchmark", "dopedb-benchmark"),
    ] {
        let valid = Url::parse(&format!("{scheme}://auth/device-complete")).unwrap();
        assert!(is_workspace_login_callback(&valid, identifier));
        assert!(valid.query().is_none());
        assert!(valid.fragment().is_none());
        let access = Url::parse(&format!("{scheme}://workspace/access-complete")).unwrap();
        assert!(is_workspace_access_callback(&access, identifier));
        assert!(!is_workspace_login_callback(&access, identifier));
        for suffix in ["?token=value", "#fragment", "/", "?connection=other"] {
            assert!(!is_workspace_access_callback(
                &Url::parse(&format!("{access}{suffix}")).unwrap(),
                identifier
            ));
        }
    }

    for invalid in [
        "dopedb://auth/device-complete?device_code=secret",
        "dopedb://auth/device-complete#token",
        "dopedb://user@auth/device-complete",
        "dopedb://auth:443/device-complete",
        "dopedb://auth/device-complete/",
        "dopedb://auth/other",
        "https://auth/device-complete",
    ] {
        assert!(!is_workspace_login_callback(
            &Url::parse(invalid).unwrap(),
            "dev.dopedb.desktop",
        ));
    }

    let production = Url::parse("dopedb://auth/device-complete").unwrap();
    assert!(!is_workspace_login_callback(
        &production,
        "dev.dopedb.desktop.dev",
    ));
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
