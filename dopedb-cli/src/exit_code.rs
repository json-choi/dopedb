use dopedb_protocol::ErrorCode;

use crate::client::ClientError;

pub(crate) const SUCCESS: u8 = 0;
pub(crate) const USAGE: u8 = 2;
pub(crate) const RUNTIME_UNAVAILABLE: u8 = 3;
pub(crate) const AUTHENTICATION_DENIED: u8 = 4;
pub(crate) const POLICY_BLOCKED: u8 = 5;
pub(crate) const OPERATION_CONFLICT: u8 = 6;
pub(crate) const CANCELLED: u8 = 7;
pub(crate) const TARGET_EXECUTION_FAILED: u8 = 8;
pub(crate) const PROTOCOL_MISMATCH: u8 = 9;
pub(crate) const INTERNAL: u8 = 10;

pub(crate) fn for_client_error(error: &ClientError) -> u8 {
    match error {
        ClientError::InvalidArguments
        | ClientError::AgentConfigExists
        | ClientError::AgentConfigNotFound
        | ClientError::AgentConfigInvalid
        | ClientError::ConnectionNotFound
        | ClientError::AmbiguousConnection(_) => USAGE,
        ClientError::AgentProviderUnavailable => RUNTIME_UNAVAILABLE,
        ClientError::AgentExited(Some(code)) if (1..=255).contains(code) => *code as u8,
        ClientError::AgentExited(_) => TARGET_EXECUTION_FAILED,
        ClientError::RuntimeUnavailable | ClientError::ResponseUnavailable => RUNTIME_UNAVAILABLE,
        ClientError::AuthenticationUnavailable => AUTHENTICATION_DENIED,
        ClientError::ProtocolMismatch => PROTOCOL_MISMATCH,
        ClientError::InvalidResponse | ClientError::Internal => INTERNAL,
        ClientError::Remote(remote) => match remote.code() {
            ErrorCode::InvalidRequest => USAGE,
            ErrorCode::RuntimeUnavailable => RUNTIME_UNAVAILABLE,
            ErrorCode::AuthenticationDenied | ErrorCode::ScopeDenied => AUTHENTICATION_DENIED,
            ErrorCode::PolicyBlocked => POLICY_BLOCKED,
            ErrorCode::OperationExpired | ErrorCode::OperationConflict => OPERATION_CONFLICT,
            ErrorCode::Cancelled | ErrorCode::Timeout => CANCELLED,
            ErrorCode::TargetExecutionFailed => TARGET_EXECUTION_FAILED,
            ErrorCode::ProtocolMismatch => PROTOCOL_MISMATCH,
            ErrorCode::ResponseTooLarge | ErrorCode::Internal => INTERNAL,
        },
    }
}
