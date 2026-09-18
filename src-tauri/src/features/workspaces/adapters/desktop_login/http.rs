//! Bounded HTTP callback parsing; only a matching single-use state completes login.

use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures::{stream::FuturesUnordered, StreamExt};
use sha2::{Digest, Sha256};
use std::time::Duration;
use subtle::ConstantTimeEq;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use zeroize::Zeroizing;

const MAX_HEADERS: usize = 8192;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_CONNECTIONS: usize = 8;

// Static categories only: never include a URL, header, state, or authorization code.
#[derive(Debug, PartialEq)]
pub(super) enum CallbackError {
    Request,
    Path,
    Parameters,
    State,
    Code,
}

impl CallbackError {
    fn diagnostic(&self) -> &'static str {
        match self {
            Self::Request => "LOGIN_REQUEST",
            Self::Path => "LOGIN_PATH",
            Self::Parameters => "LOGIN_PARAMETERS",
            Self::State => "LOGIN_STATE",
            Self::Code => "LOGIN_CODE",
        }
    }
}

pub(super) async fn receive(
    listener: TcpListener,
    state: &str,
    id: &str,
    authorization_url: &str,
    app_url: &str,
) -> AppResult<Option<Zeroizing<String>>> {
    let host = listener.local_addr()?.to_string();
    // Poll bounded reads together: a browser preconnect must not hold the
    // actual callback behind an empty socket. Dropping this set closes every
    // pending socket on success, cancellation, replacement, or expiry.
    let mut requests = FuturesUnordered::new();
    loop {
        let (mut stream, request) = tokio::select! {
            biased;
            Some(completed) = requests.next(), if !requests.is_empty() => completed,
            accepted = listener.accept(), if requests.len() < MAX_CONNECTIONS => {
                let (mut stream, peer) = accepted?;
                if peer.ip().is_loopback() {
                    requests.push(async move {
                        let request = tokio::time::timeout(REQUEST_TIMEOUT, read_request(&mut stream)).await;
                        (stream, request)
                    });
                }
                continue;
            }
        };
        let parsed = match request {
            Ok(Ok(request)) => {
                let target = request_target(&request, &host);
                if target
                    .as_ref()
                    .is_ok_and(|target| *target == format!("/start/{id}"))
                {
                    let response = format!("HTTP/1.1 303 See Other\r\nLocation: {authorization_url}\r\nContent-Length: 0\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n");
                    let _ = tokio::time::timeout(
                        REQUEST_TIMEOUT,
                        stream.write_all(response.as_bytes()),
                    )
                    .await;
                    continue;
                }
                if target.as_ref().is_ok_and(|target| *target == "/complete") {
                    respond(&mut stream, "incomplete", "", app_url).await;
                    continue;
                }
                if target
                    .as_ref()
                    .is_ok_and(|target| *target == "/favicon.ico")
                {
                    let _ = stream
                        .write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")
                        .await;
                    continue;
                }
                parse(&request, &host, state)
            }
            // No complete HTTP request exists yet. An unsolicited 400 would
            // turn speculative connection setup into an OAuth failure page.
            Ok(Err(_)) | Err(_) => continue,
        };
        let accepted = parsed.is_ok();
        // Release the listening socket before acknowledging a valid callback.
        if accepted {
            drop(listener);
            drop(requests);
            let page = if matches!(&parsed, Ok(Some(_))) {
                "received"
            } else {
                "denied"
            };
            respond(&mut stream, page, "", app_url).await;
            return Ok(parsed.expect("accepted callback"));
        }
        respond(
            &mut stream,
            "invalid",
            parsed.unwrap_err().diagnostic(),
            app_url,
        )
        .await;
    }
}

async fn read_request(stream: &mut TcpStream) -> AppResult<Zeroizing<String>> {
    let mut bytes = Zeroizing::new(Vec::with_capacity(1024));
    loop {
        let mut chunk = Zeroizing::new([0u8; 512]);
        let length = stream.read(chunk.as_mut()).await?;
        if length == 0 || bytes.len() + length > MAX_HEADERS {
            return Err(invalid());
        }
        bytes.extend_from_slice(&chunk[..length]);
        if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            if end + 4 != bytes.len() {
                return Err(invalid());
            }
            return Ok(Zeroizing::new(
                std::str::from_utf8(&bytes)
                    .map_err(|_| invalid())?
                    .to_owned(),
            ));
        }
    }
}

fn invalid() -> AppError {
    AppError::Config("invalid workspace login callback".into())
}

fn request_target<'a>(request: &'a str, host: &str) -> AppResult<&'a str> {
    let mut lines = request.split("\r\n");
    let parts: Vec<_> = lines.next().ok_or_else(invalid)?.split(' ').collect();
    if parts.len() != 3 || parts[0] != "GET" || parts[2] != "HTTP/1.1" || !parts[1].starts_with('/')
    {
        return Err(invalid());
    }
    let mut hosts = 0;
    for line in lines.take_while(|line| !line.is_empty()) {
        let (name, value) = line.split_once(':').ok_or_else(invalid)?;
        if name.eq_ignore_ascii_case("host") {
            hosts += 1;
            if value.trim() != host {
                return Err(invalid());
            }
        }
        if name.eq_ignore_ascii_case("transfer-encoding")
            || (name.eq_ignore_ascii_case("content-length") && value.trim() != "0")
        {
            return Err(invalid());
        }
    }
    if hosts != 1 {
        return Err(invalid());
    }
    Ok(parts[1])
}

pub(super) fn parse(
    request: &str,
    host: &str,
    state: &str,
) -> Result<Option<Zeroizing<String>>, CallbackError> {
    let target = request_target(request, host).map_err(|_| CallbackError::Request)?;
    if !target.starts_with("/callback?") {
        return Err(CallbackError::Path);
    }
    let url =
        url::Url::parse(&format!("http://{host}{target}")).map_err(|_| CallbackError::Path)?;
    if url.path() != "/callback" || url.fragment().is_some() {
        return Err(CallbackError::Path);
    }
    let mut returned_state = None;
    let mut code = None;
    let mut error = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "state" if returned_state.is_none() => {
                returned_state = Some(Zeroizing::new(value.into_owned()))
            }
            "code" if code.is_none() => code = Some(Zeroizing::new(value.into_owned())),
            "error" if error.is_none() => error = Some(value.into_owned()),
            _ => return Err(CallbackError::Parameters),
        }
    }
    let returned_state = returned_state.ok_or(CallbackError::State)?;
    if !bool::from(returned_state.as_bytes().ct_eq(state.as_bytes())) {
        return Err(CallbackError::State);
    }
    match (code, error.as_deref()) {
        (Some(code), None)
            if (20..=512).contains(&code.len())
                && code
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') =>
        {
            Ok(Some(code))
        }
        (None, Some("access_denied")) => Ok(None),
        _ => Err(CallbackError::Code),
    }
}

async fn respond(stream: &mut TcpStream, page: &str, diagnostic: &str, app_url: &str) {
    let status = if page == "invalid" {
        "400 Bad Request"
    } else {
        "200 OK"
    };
    let body = include_str!("page.html")
        .replace("__PAGE__", page)
        .replace("__DIAGNOSTIC__", diagnostic)
        .replace("__APP_URL__", app_url);
    let hash = |tag: &str| {
        let content = body
            .split_once(&format!("<{tag}>"))
            .unwrap()
            .1
            .split_once(&format!("</{tag}>"))
            .unwrap()
            .0;
        STANDARD.encode(Sha256::digest(content.as_bytes()))
    };
    let style_hash = hash("style");
    let script_hash = hash("script");
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'sha256-{style_hash}'; script-src 'sha256-{script_hash}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = tokio::time::timeout(REQUEST_TIMEOUT, stream.write_all(response.as_bytes())).await;
}
