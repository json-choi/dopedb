//! Native login security cases folded into the existing critical contract test.

use super::*;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

const CODE: &str = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

fn request(target: &str, host: &str) -> String {
    format!("GET {target} HTTP/1.1\r\nHost: {host}\r\n\r\n")
}

async fn send(host: &str, request: &str) -> String {
    let mut stream = TcpStream::connect(host).await.unwrap();
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut response = String::new();
    tokio::time::timeout(Duration::from_secs(3), stream.read_to_string(&mut response))
        .await
        .unwrap()
        .unwrap();
    response
}

fn handoff(value: &WorkspaceDesktopAuthorization) -> (String, String) {
    let url = url::Url::parse(&value.authorization_url).unwrap();
    let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    let redirect = url::Url::parse(&pairs["redirect_uri"]).unwrap();
    assert_eq!(redirect.host_str(), Some("127.0.0.1"));
    assert_eq!(redirect.path(), "/callback");
    assert_ne!(redirect.port(), Some(0));
    assert_eq!(pairs["code_challenge_method"], "S256");
    assert_eq!(pairs["client_id"], "dopedb-desktop");
    assert_eq!(pairs["response_type"], "code");
    assert!(!pairs.contains_key("code_verifier"));
    (
        format!("127.0.0.1:{}", redirect.port().unwrap()),
        pairs["state"].clone(),
    )
}

pub(crate) async fn assert_desktop_login_contract() {
    // RFC 7636 S256 example guards the encoding shared with the server.
    assert_eq!(
        URL_SAFE_NO_PAD.encode(Sha256::digest(
            b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        )),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
    let host = "127.0.0.1:32123";
    let state = "sample-state";
    let valid = format!("/callback?state={state}&code={CODE}");
    assert!(http::parse(&request(&valid, host), host, state)
        .unwrap()
        .is_some());
    for target in [
        format!("/callback?state=other&code={CODE}"),
        format!("/callback?state={state}&state={state}&code={CODE}"),
        format!("/callback?state={state}&code={CODE}&code={CODE}"),
        format!("/callback?state={state}&code={CODE}&error=access_denied"),
        format!("/callback?state={state}&code={CODE}&token=secret"),
        format!("/callback?state={state}&code={CODE}#fragment"),
        format!("/other?state={state}&code={CODE}"),
        format!("/callback?state={state}&code=short"),
    ] {
        assert!(http::parse(&request(&target, host), host, state).is_err());
    }
    for altered in [
        request(&valid, "localhost:32123"),
        request(&valid, "[::1]:32123"),
        request(&valid, host).replace("GET ", "POST "),
        request(&valid, host).replace("\r\n\r\n", "\r\nHost: 127.0.0.1:32123\r\n\r\n"),
        request(&valid, host).replace("\r\n\r\n", "\r\nTransfer-Encoding: chunked\r\n\r\n"),
    ] {
        assert!(http::parse(&altered, host, state).is_err());
    }

    let runtime = DesktopLoginRuntime::default();
    let first = runtime
        .begin_at("https://app.dopedb.dev", LIFETIME)
        .await
        .unwrap();
    let (host, state) = handoff(&first);
    let invalid = send(
        &host,
        &request(&format!("/callback?state=wrong&code={CODE}"), &host),
    )
    .await;
    assert!(invalid.starts_with("HTTP/1.1 400"));
    let response = send(
        &host,
        &request(&format!("/callback?state={state}&code={CODE}"), &host),
    )
    .await;
    assert!(response.starts_with("HTTP/1.1 200"));
    assert!(response.contains("Cache-Control: no-store"));
    assert!(response.contains("Referrer-Policy: no-referrer"));
    assert!(!response.contains(CODE));
    assert!(TcpStream::connect(&host).await.is_err());
    let DesktopCallback::Code(code) = runtime.wait(&first.attempt_id).await.unwrap() else {
        panic!("code expected")
    };
    let url = url::Url::parse(&first.authorization_url).unwrap();
    let challenge = url
        .query_pairs()
        .find(|(key, _)| key == "code_challenge")
        .unwrap()
        .1
        .into_owned();
    assert_eq!(
        URL_SAFE_NO_PAD.encode(Sha256::digest(code.verifier.as_bytes())),
        challenge
    );
    assert_eq!(code.code.as_str(), CODE);
    assert!(runtime.wait(&first.attempt_id).await.is_err());
    runtime
        .commit(&first.attempt_id, async { Ok(()) })
        .await
        .unwrap();
    assert!(runtime
        .commit(&first.attempt_id, async { Ok(()) })
        .await
        .is_err());

    // A valid but not-yet-committed callback cannot sign in after replacement.
    let superseded = runtime
        .begin_at("https://app.dopedb.dev", LIFETIME)
        .await
        .unwrap();
    let (host, state) = handoff(&superseded);
    send(
        &host,
        &request(&format!("/callback?state={state}&code={CODE}"), &host),
    )
    .await;
    assert!(matches!(
        runtime.wait(&superseded.attempt_id).await.unwrap(),
        DesktopCallback::Code(_)
    ));
    let replacement = runtime
        .begin_at("https://app.dopedb.dev", LIFETIME)
        .await
        .unwrap();
    let mut committed = false;
    assert!(runtime
        .commit(&superseded.attempt_id, async {
            committed = true;
            Ok(())
        })
        .await
        .is_err());
    assert!(!committed);
    runtime.cancel(&replacement.attempt_id).await;

    let old = runtime
        .begin_at("https://app.dopedb.dev", LIFETIME)
        .await
        .unwrap();
    let pending = runtime.clone();
    let old_id = old.attempt_id.clone();
    let waiter = tokio::spawn(async move { pending.wait(&old_id).await });
    tokio::task::yield_now().await;
    let new = runtime
        .begin_at("https://app.dopedb.dev", LIFETIME)
        .await
        .unwrap();
    assert!(waiter.await.unwrap().is_err());
    runtime.cancel(&old.attempt_id).await;
    assert!(runtime
        .commit(&old.attempt_id, async { Ok(()) })
        .await
        .is_err());
    let (cancelled_host, _) = handoff(&new);
    runtime.cancel(&new.attempt_id).await;
    assert!(TcpStream::connect(&cancelled_host).await.is_err());
    runtime.cancel(&new.attempt_id).await;
    assert!(runtime.wait(&new.attempt_id).await.is_err());

    let expired = runtime
        .begin_at("https://app.dopedb.dev", Duration::from_millis(100))
        .await
        .unwrap();
    let (host, _) = handoff(&expired);
    let mut stalled = TcpStream::connect(&host).await.unwrap();
    stalled
        .write_all(b"GET /callback?state=unfinished")
        .await
        .unwrap();
    assert!(matches!(
        runtime.wait(&expired.attempt_id).await.unwrap(),
        DesktopCallback::Expired
    ));
    assert!(TcpStream::connect(&host).await.is_err());
    let stopped = runtime
        .begin_at("https://app.dopedb.dev", LIFETIME)
        .await
        .unwrap();
    let (host, _) = handoff(&stopped);
    runtime.shutdown().await;
    assert!(TcpStream::connect(&host).await.is_err());
    assert!(runtime.wait(&stopped.attempt_id).await.is_err());
}
