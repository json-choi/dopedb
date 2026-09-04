//! Transport-independent contracts shared by the DopeDB Desktop runtime and CLI.
//! This crate deliberately has no database, credential-store, Tauri, or network
//! dependencies so adapters cannot accidentally become a second execution path.

pub mod acp_plugin;
pub mod analysis_article;
pub mod analysis_article_command;
mod analysis_article_sql;
mod analysis_article_validation;
pub mod catalog;
pub mod catalog_command;
pub mod command;
pub mod connection;
pub mod control_plane;
pub mod ddl;
pub mod discovery;
pub mod document_command;
pub mod error;
pub mod external_agent;
pub mod frame;
pub mod knowledge;
pub mod knowledge_command;
pub mod operation;
pub mod operation_command;
pub mod query_command;
pub mod request;
pub mod response;
pub mod skill_command;
pub mod version;

pub use acp_plugin::*;
pub use analysis_article::*;
pub use analysis_article_command::*;
pub use catalog::*;
pub use catalog_command::*;
pub use command::{
    decode_arguments, AgentSessionRegisterArguments, AgentSessionRegisterCommand, AppOpenArguments,
    AppOpenCommand, AppOpenResult, AuthenticationRequirement, CommandPayloadError, CommandSpec,
    EmptyArguments, StatusCommand, StatusResult, VersionCommand, VersionResult,
    MAX_AGENT_LAUNCHER_PATH_BYTES,
};
pub use connection::*;
pub use control_plane::*;
pub use ddl::*;
pub use discovery::{
    RuntimeDiscovery, RuntimeDiscoveryError, RUNTIME_DIRECTORY_NAME, RUNTIME_FILE_NAME,
    RUNTIME_SCHEMA_VERSION,
};
pub use document_command::*;
pub use error::{ErrorCode, ProtocolError};
pub use external_agent::*;
pub use frame::{decode_frame, encode_frame, parse_frame_length, FrameError, FramePayload};
pub use knowledge::*;
pub use knowledge_command::*;
pub use operation::{
    OperationActorKind, OperationEventKind, OperationKind, OperationRiskLevel, OperationState,
};
pub use operation_command::*;
pub use query_command::*;
pub use request::{CommandName, RequestEnvelope, SessionAuthentication};
pub use response::ResponseEnvelope;
pub use skill_command::*;
pub use version::{
    negotiate_protocol, ProtocolVersionMismatch, COMMAND_SCHEMA_VERSION, PROTOCOL_MAX, PROTOCOL_MIN,
};

/// Broker request payload cap. Large row/file/terminal streams use dedicated channels.
pub const MAX_REQUEST_BYTES: usize = 1024 * 1024;
/// Broker response payload cap. Query result services apply a smaller semantic cap too.
pub const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
/// Maximum accepted JSON nesting before command decoding.
pub const MAX_JSON_DEPTH: usize = 32;
/// Maximum collection length accepted by one control message.
pub const MAX_COLLECTION_ITEMS: usize = 10_000;
/// Maximum total JSON values, including the envelope root.
pub const MAX_JSON_VALUES: usize = 10_000;
/// Maximum UTF-8 bytes accepted in one control-message string.
pub const MAX_STRING_BYTES: usize = 256 * 1024;
