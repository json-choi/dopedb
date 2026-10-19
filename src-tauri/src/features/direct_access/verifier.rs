//! Member password generation and public password verifiers.
//!
//! The member password never leaves the member's device; the server only ever sees a
//! verifier derived from it: a PostgreSQL SCRAM-SHA-256 verifier or a MySQL
//! `caching_sha2_password` authentication string. Generators produce the exact
//! formats the database stores, and the validators accept exactly those formats so
//! adapters interpolate only validated literals into `PASSWORD '...'` /
//! `IDENTIFIED ... AS '...'` (every accepted character is quote-safe).

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use super::domain::VerifierKind;

type HmacSha256 = Hmac<Sha256>;

const PG_ITERATIONS: u32 = 4096;
const PG_SALT_LEN: usize = 16;
const MYSQL_SALT_LEN: usize = 20;
const MYSQL_ROUNDS: u32 = 5000;
const MYSQL_PREFIX: &str = "$A$005$";
const CRYPT_ALPHABET: &[u8; 64] =
    b"./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// Verifier generation failed without revealing why.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum VerifierError {
    /// The password has non-ASCII bytes, where SASLprep would not be the identity.
    NonAscii,
    /// The operating system random source failed.
    Entropy,
}

/// Generate a member password: 32 random bytes as unpadded base64url (43 ASCII chars).
pub(crate) fn generate_member_password() -> Result<Zeroizing<String>, VerifierError> {
    let mut bytes = Zeroizing::new([0u8; 32]);
    getrandom::fill(bytes.as_mut()).map_err(|_| VerifierError::Entropy)?;
    Ok(Zeroizing::new(URL_SAFE_NO_PAD.encode(bytes.as_ref())))
}

fn hmac(key: &[u8], data: &[u8]) -> [u8; 32] {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data);
    mac.finalize().into_bytes().into()
}

/// PBKDF2-HMAC-SHA256 for one 32-byte block (dkLen = hLen), RFC 8018 section 5.2.
fn pbkdf2_sha256_block(password: &[u8], salt: &[u8], iterations: u32) -> Zeroizing<[u8; 32]> {
    let mut seed = salt.to_vec();
    seed.extend_from_slice(&1u32.to_be_bytes());
    let mut u = hmac(password, &seed);
    let mut out = Zeroizing::new(u);
    for _ in 1..iterations {
        u = hmac(password, &u);
        for (acc, byte) in out.iter_mut().zip(u) {
            *acc ^= byte;
        }
    }
    u.zeroize();
    out
}

/// Build the PostgreSQL verifier for `password` with an explicit salt.
pub(crate) fn postgres_scram_verifier_with_salt(
    password: &str,
    salt: &[u8; PG_SALT_LEN],
) -> Result<String, VerifierError> {
    if !password.is_ascii() {
        return Err(VerifierError::NonAscii);
    }
    let salted = pbkdf2_sha256_block(password.as_bytes(), salt, PG_ITERATIONS);
    let client_key = Zeroizing::new(hmac(salted.as_ref(), b"Client Key"));
    let stored_key = Sha256::digest(client_key.as_ref());
    let server_key = hmac(salted.as_ref(), b"Server Key");
    Ok(format!(
        "SCRAM-SHA-256${PG_ITERATIONS}:{}${}:{}",
        STANDARD.encode(salt),
        STANDARD.encode(stored_key),
        STANDARD.encode(server_key),
    ))
}

/// Build the PostgreSQL verifier with a fresh random salt.
pub(crate) fn postgres_scram_verifier(password: &str) -> Result<String, VerifierError> {
    let mut salt = [0u8; PG_SALT_LEN];
    getrandom::fill(&mut salt).map_err(|_| VerifierError::Entropy)?;
    postgres_scram_verifier_with_salt(password, &salt)
}

/// SHA-256 crypt (Drepper, "Unix crypt using SHA-256 and SHA-512") digest encoding
/// with a caller-supplied round count and no salt truncation, as MySQL uses it.
pub(crate) fn sha256_crypt_digest(password: &[u8], salt: &[u8], rounds: u32) -> String {
    let digest = |parts: &[&[u8]]| -> [u8; 32] {
        let mut hasher = Sha256::new();
        for part in parts {
            hasher.update(part);
        }
        hasher.finalize().into()
    };
    let b = digest(&[password, salt, password]);
    let mut a_input: Vec<&[u8]> = vec![password, salt];
    let mut remaining = password.len();
    while remaining >= 32 {
        a_input.push(&b);
        remaining -= 32;
    }
    a_input.push(&b[..remaining]);
    let mut bits = password.len();
    while bits > 0 {
        a_input.push(if bits & 1 == 1 { &b[..] } else { password });
        bits >>= 1;
    }
    let mut a = digest(&a_input);

    let mut dp_hasher = Sha256::new();
    for _ in 0..password.len() {
        dp_hasher.update(password);
    }
    let dp: [u8; 32] = dp_hasher.finalize().into();
    let p: Vec<u8> = dp.iter().copied().cycle().take(password.len()).collect();

    let mut ds_hasher = Sha256::new();
    for _ in 0..(16 + usize::from(a[0])) {
        ds_hasher.update(salt);
    }
    let ds: [u8; 32] = ds_hasher.finalize().into();
    let s: Vec<u8> = ds.iter().copied().cycle().take(salt.len()).collect();

    for round in 0..rounds {
        let mut hasher = Sha256::new();
        hasher.update(if round & 1 == 1 { &p[..] } else { &a[..] });
        if round % 3 != 0 {
            hasher.update(&s);
        }
        if round % 7 != 0 {
            hasher.update(&p);
        }
        hasher.update(if round & 1 == 1 { &a[..] } else { &p[..] });
        a = hasher.finalize().into();
    }

    let mut out = String::with_capacity(43);
    let mut emit = |b2: u8, b1: u8, b0: u8, count: usize| {
        let mut word = (u32::from(b2) << 16) | (u32::from(b1) << 8) | u32::from(b0);
        for _ in 0..count {
            out.push(char::from(CRYPT_ALPHABET[(word & 0x3f) as usize]));
            word >>= 6;
        }
    };
    const ORDER: [(usize, usize, usize); 10] = [
        (0, 10, 20),
        (21, 1, 11),
        (12, 22, 2),
        (3, 13, 23),
        (24, 4, 14),
        (15, 25, 5),
        (6, 16, 26),
        (27, 7, 17),
        (18, 28, 8),
        (9, 19, 29),
    ];
    for (i2, i1, i0) in ORDER {
        emit(a[i2], a[i1], a[i0], 4);
    }
    emit(0, a[31], a[30], 3);
    a.zeroize();
    out
}

/// Build the MySQL `caching_sha2_password` authentication string with an explicit
/// salt (20 characters from `./0-9A-Za-z`, a quote-safe subset of what MySQL accepts).
pub(crate) fn mysql_caching_sha2_verifier_with_salt(
    password: &str,
    salt: &[u8; MYSQL_SALT_LEN],
) -> Result<String, VerifierError> {
    if !password.is_ascii() {
        return Err(VerifierError::NonAscii);
    }
    let digest = sha256_crypt_digest(password.as_bytes(), salt, MYSQL_ROUNDS);
    let salt_text = std::str::from_utf8(salt).map_err(|_| VerifierError::NonAscii)?;
    Ok(format!("{MYSQL_PREFIX}{salt_text}{digest}"))
}

/// Build the MySQL authentication string with a fresh random salt.
pub(crate) fn mysql_caching_sha2_verifier(password: &str) -> Result<String, VerifierError> {
    let mut raw = [0u8; MYSQL_SALT_LEN];
    getrandom::fill(&mut raw).map_err(|_| VerifierError::Entropy)?;
    let salt = raw.map(|byte| CRYPT_ALPHABET[usize::from(byte & 0x3f)]);
    mysql_caching_sha2_verifier_with_salt(password, &salt)
}

/// True when `value` is exactly a well-formed verifier of `kind`.
pub(crate) fn is_valid_verifier(kind: VerifierKind, value: &str) -> bool {
    match kind {
        VerifierKind::ScramSha256 => is_valid_scram(value),
        VerifierKind::CachingSha2 => is_valid_caching_sha2(value),
    }
}

fn is_base64_of(value: &str, bytes: usize) -> bool {
    value.len() == bytes.div_ceil(3) * 4
        && STANDARD
            .decode(value)
            .is_ok_and(|decoded| decoded.len() == bytes)
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
}

/// `SCRAM-SHA-256$4096:<b64 16-byte salt>$<b64 32-byte StoredKey>:<b64 32-byte ServerKey>`
fn is_valid_scram(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("SCRAM-SHA-256$4096:") else {
        return false;
    };
    let Some((salt, keys)) = rest.split_once('$') else {
        return false;
    };
    let Some((stored, server)) = keys.split_once(':') else {
        return false;
    };
    is_base64_of(salt, PG_SALT_LEN) && is_base64_of(stored, 32) && is_base64_of(server, 32)
}

/// `$A$005$` + 20 salt chars from `./0-9A-Za-z` + 43 sha256-crypt chars.
fn is_valid_caching_sha2(value: &str) -> bool {
    let Some(rest) = value.strip_prefix(MYSQL_PREFIX) else {
        return false;
    };
    rest.len() == MYSQL_SALT_LEN + 43 && rest.bytes().all(|b| CRYPT_ALPHABET.contains(&b))
}
