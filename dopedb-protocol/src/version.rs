//! Protocol and command-schema version negotiation.

use thiserror::Error;

pub const PROTOCOL_MIN: u16 = 1;
pub const PROTOCOL_MAX: u16 = 1;
/// 18: `OperationSummary.decisionReason` and the version-2 schema diff
/// (`materializedView`, expression index keys, `scope`) are not decodable by a
/// version-17 peer, whose closed DTOs deny unknown fields and values.
pub const COMMAND_SCHEMA_VERSION: u16 = 18;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[error(
    "no compatible DopeDB protocol (runtime {runtime_min}-{runtime_max}, client {client_min}-{client_max})"
)]
pub struct ProtocolVersionMismatch {
    pub runtime_min: u16,
    pub runtime_max: u16,
    pub client_min: u16,
    pub client_max: u16,
}

/// Select the highest version supported by both peers.
pub fn negotiate_protocol(
    runtime_min: u16,
    runtime_max: u16,
    client_min: u16,
    client_max: u16,
) -> Result<u16, ProtocolVersionMismatch> {
    let lower = runtime_min.max(client_min);
    let upper = runtime_max.min(client_max);
    if lower <= upper {
        Ok(upper)
    } else {
        Err(ProtocolVersionMismatch {
            runtime_min,
            runtime_max,
            client_min,
            client_max,
        })
    }
}
