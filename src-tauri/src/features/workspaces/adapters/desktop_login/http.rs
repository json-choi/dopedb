//! Bounded HTTP callback parsing; only a matching single-use state completes login.

use crate::error::{AppError, AppResult};
use std::time::Duration;
use subtle::ConstantTimeEq;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use zeroize::Zeroizing;

const MAX_HEADERS: usize = 8192;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(2);

pub(super) async fn receive(
    listener: TcpListener,
    state: &str,
) -> AppResult<Option<Zeroizing<String>>> {
    let host = listener.local_addr()?.to_string();
    loop {
        let (mut stream, peer) = listener.accept().await?;
        if !peer.ip().is_loopback() {
            continue;
        }
        let parsed =
            tokio::time::timeout(REQUEST_TIMEOUT, read_request(&mut stream, &host, state)).await;
        let accepted = matches!(&parsed, Ok(Ok(_)));
        // Release the listening socket before acknowledging a valid callback.
        if accepted {
            drop(listener);
            respond(&mut stream, true).await;
            return parsed.expect("accepted callback has a result");
        }
        respond(&mut stream, false).await;
    }
}

async fn read_request(
    stream: &mut TcpStream,
    host: &str,
    state: &str,
) -> AppResult<Option<Zeroizing<String>>> {
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
            return parse(
                std::str::from_utf8(&bytes).map_err(|_| invalid())?,
                host,
                state,
            );
        }
    }
}

fn invalid() -> AppError {
    AppError::Config("invalid workspace login callback".into())
}

pub(super) fn parse(
    request: &str,
    host: &str,
    state: &str,
) -> AppResult<Option<Zeroizing<String>>> {
    let mut lines = request.split("\r\n");
    let parts: Vec<_> = lines.next().ok_or_else(invalid)?.split(' ').collect();
    if parts.len() != 3
        || parts[0] != "GET"
        || parts[2] != "HTTP/1.1"
        || !parts[1].starts_with("/callback?")
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
    let url = url::Url::parse(&format!("http://{host}{}", parts[1])).map_err(|_| invalid())?;
    if url.path() != "/callback" || url.fragment().is_some() {
        return Err(invalid());
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
            _ => return Err(invalid()),
        }
    }
    let returned_state = returned_state.ok_or_else(invalid)?;
    if !bool::from(returned_state.as_bytes().ct_eq(state.as_bytes())) {
        return Err(invalid());
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
        _ => Err(invalid()),
    }
}

async fn respond(stream: &mut TcpStream, accepted: bool) {
    let (status, body) = if accepted {
        ("200 OK", "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>DopeDB</title><p>You can return to DopeDB.</p></html>")
    } else {
        ("400 Bad Request", "Invalid login callback.")
    };
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = tokio::time::timeout(REQUEST_TIMEOUT, stream.write_all(response.as_bytes())).await;
}
