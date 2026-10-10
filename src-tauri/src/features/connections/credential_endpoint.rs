//! The rule that binds a saved local credential to where it was entered.
//!
//! A saved password is reused only for the same engine, host, port, user, and SSH
//! alias, and only over transport security at least as strong as the stored
//! profile's. Any other draft is refused before the OS credential store is read,
//! so a crafted draft can neither redirect the secret nor strip the channel that
//! protects it.

use crate::connection::providers;
use crate::connection::ssh::SSH_ALIAS_PARAMETER;
use crate::model::{ConnectionProfile, Engine, Provider};

/// Options that choose the certificate authority a verifying SQL mode trusts.
const SQL_TRUST_ANCHORS: [&str; 2] = ["sslrootcert", "sslrootcert_pem"];
/// The MongoDB option that chooses the trusted certificate authority.
const MONGO_TRUST_ANCHORS: [&str; 1] = ["tlscafile"];
/// The lowest rank at which the server certificate is verified, so the trust
/// anchor decides which server may receive the credential.
const VERIFIED_RANK: u8 = 3;

/// Whether a draft still names the endpoint its saved credential was stored for,
/// over transport security that is at least as strong. Only the target database
/// may differ: another database on the same server and account does not move the
/// credential anywhere new.
pub(crate) fn same_credential_endpoint(
    stored: &ConnectionProfile,
    draft: &ConnectionProfile,
) -> bool {
    fn ssh_alias(profile: &ConnectionProfile) -> Option<&str> {
        profile
            .extra_params
            .get(SSH_ALIAS_PARAMETER)
            .map(|alias| alias.trim())
            .filter(|alias| !alias.is_empty())
    }
    stored.engine == draft.engine
        && stored.host.trim().eq_ignore_ascii_case(draft.host.trim())
        && stored.port == draft.port
        && stored.username == draft.username
        && ssh_alias(stored) == ssh_alias(draft)
        && keeps_transport_security(stored, draft)
}

/// How strongly a profile protects the channel that carries its credential.
#[derive(Debug)]
struct TransportSecurity {
    /// 0 no TLS, 1 opportunistic TLS, 2 TLS without certificate verification,
    /// 3 verified certificate, 4 verified certificate and host name.
    rank: u8,
    /// Sorted, lower-cased trust anchor options and their values.
    anchors: Vec<(String, String)>,
}

/// A stronger or equal channel keeps the credential. While the stored profile
/// verifies the server, the trust anchor must also stay the same, because a
/// different certificate authority could vouch for another server.
fn keeps_transport_security(stored: &ConnectionProfile, draft: &ConnectionProfile) -> bool {
    let (Some(stored), Some(draft)) = (transport_security(stored), transport_security(draft))
    else {
        return false;
    };
    draft.rank >= stored.rank && (stored.rank < VERIFIED_RANK || draft.anchors == stored.anchors)
}

/// `None` for a setting the driver would reject; it never keeps a credential.
fn transport_security(profile: &ConnectionProfile) -> Option<TransportSecurity> {
    match profile.engine {
        Engine::Postgres | Engine::Mysql => Some(TransportSecurity {
            rank: sql_rank(profile)?,
            anchors: trust_anchors(profile, &SQL_TRUST_ANCHORS),
        }),
        Engine::Mongodb => Some(TransportSecurity {
            rank: mongo_rank(profile)?,
            anchors: trust_anchors(profile, &MONGO_TRUST_ANCHORS),
        }),
        // A SQLite file and a CLI-authenticated BigQuery profile never send a
        // saved database password over the network.
        Engine::Sqlite | Engine::Bigquery => Some(TransportSecurity {
            rank: 0,
            anchors: Vec::new(),
        }),
    }
}

/// PostgreSQL and MySQL `sslmode`: disable < allow/prefer < require < verify-ca <
/// verify-full, accepting exactly the spellings each driver accepts.
fn sql_rank(profile: &ConnectionProfile) -> Option<u8> {
    let mode = profile.sslmode.trim().to_ascii_lowercase();
    let rank = match (profile.engine, mode.as_str()) {
        (Engine::Postgres, "disable") | (Engine::Mysql, "disable" | "disabled") => 0,
        (Engine::Postgres, "" | "allow" | "prefer")
        | (Engine::Mysql, "" | "prefer" | "preferred") => 1,
        (Engine::Postgres, "require") | (Engine::Mysql, "require" | "required") => 2,
        (Engine::Postgres | Engine::Mysql, "verify-ca" | "verify_ca") => 3,
        (Engine::Postgres, "verify-full" | "verify_full")
        | (Engine::Mysql, "verify-identity" | "verify_identity" | "verify-full") => 4,
        _ => return None,
    };
    // PlanetScale always negotiates an identity-verified channel.
    let forced_identity =
        profile.engine == Engine::Mysql && providers::resolve(profile) == Provider::PlanetScale;
    Some(if forced_identity { 4 } else { rank })
}

/// MongoDB URI options, whose names the driver matches case-insensitively: `tls`
/// or `ssl` (on by default for the `srv` scheme), and the options that relax
/// certificate or host name verification. Any explicit `false` turns TLS off.
fn mongo_rank(profile: &ConnectionProfile) -> Option<u8> {
    // The URI builder reads exactly this key to choose the `mongodb+srv` scheme.
    let srv = profile
        .extra_params
        .get("srv")
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("true"));
    let mut explicit_tls: Option<bool> = None;
    let mut relaxed_certificates = false;
    let mut relaxed_host_names = false;
    for (key, value) in &profile.extra_params {
        let key = key.to_ascii_lowercase();
        if !matches!(
            key.as_str(),
            "tls"
                | "ssl"
                | "tlsinsecure"
                | "tlsallowinvalidcertificates"
                | "tlsallowinvalidhostnames"
        ) {
            continue;
        }
        let flag = match value.trim().to_ascii_lowercase().as_str() {
            "true" => true,
            "false" => false,
            _ => return None,
        };
        match key.as_str() {
            "tls" | "ssl" => explicit_tls = Some(explicit_tls.unwrap_or(true) && flag),
            "tlsinsecure" | "tlsallowinvalidcertificates" => relaxed_certificates |= flag,
            _ => relaxed_host_names |= flag,
        }
    }
    Some(
        match (
            explicit_tls.unwrap_or(srv),
            relaxed_certificates,
            relaxed_host_names,
        ) {
            (false, _, _) => 0,
            (true, true, _) => 2,
            (true, false, true) => 3,
            (true, false, false) => 4,
        },
    )
}

fn trust_anchors(profile: &ConnectionProfile, keys: &[&str]) -> Vec<(String, String)> {
    let mut anchors: Vec<(String, String)> = profile
        .extra_params
        .iter()
        .map(|(key, value)| (key.to_ascii_lowercase(), value.trim().to_owned()))
        .filter(|(key, _)| keys.contains(&key.as_str()))
        .collect();
    anchors.sort();
    anchors
}
