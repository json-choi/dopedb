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
    app.deep_link().on_open_url(move |event| {
        let recognized = event
            .urls()
            .iter()
            .any(|url| is_workspace_login_callback(url, &identifier));
        if !recognized {
            tracing::warn!("ignored an unrecognized desktop callback URL");
            return;
        }

        if let Some(window) = handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
        if handle.emit(LOGIN_CALLBACK_EVENT, ()).is_err() {
            tracing::warn!("could not notify the renderer about the workspace login callback");
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
    callback_scheme(identifier) == Some(url.scheme())
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str() == Some(LOGIN_CALLBACK_HOST)
        && url.port().is_none()
        && url.path() == LOGIN_CALLBACK_PATH
        && url.query().is_none()
        && url.fragment().is_none()
}

#[cfg(test)]
pub(crate) fn assert_workspace_login_callback_contract() {
    for (identifier, scheme) in [
        ("dev.dopedb.desktop", "dopedb"),
        ("dev.dopedb.desktop.dev", "dopedb-dev"),
        ("dev.dopedb.desktop.benchmark", "dopedb-benchmark"),
    ] {
        let valid = Url::parse(&format!("{scheme}://auth/device-complete")).unwrap();
        assert!(is_workspace_login_callback(&valid, identifier));
        assert!(valid.query().is_none());
        assert!(valid.fragment().is_none());
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
}
