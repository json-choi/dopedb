use crate::error::{AppError, AppResult};
use crate::kernel::environment::EnvironmentKind;

pub(super) type EnvironmentConnectionRow = (
    String,
    String,
    String,
    i64,
    String,
    i64,
    i64,
    String,
    String,
    String,
);
pub(super) type KnowledgeScopeRow = (String, String, i64, String, String, i64, i64, String);
pub(super) fn checked_name(value: &str) -> AppResult<&str> {
    let value = value.trim();
    if value.is_empty() || value.len() > 512 || value.chars().any(char::is_control) {
        return Err(AppError::Config(
            "the Project Knowledge name is invalid".into(),
        ));
    }
    Ok(value)
}

pub(super) fn provider_value(provider: dopedb_protocol::KnowledgeSourceProvider) -> &'static str {
    match provider {
        dopedb_protocol::KnowledgeSourceProvider::Github => "github",
    }
}

pub(super) fn parse_environment_kind(value: &str) -> AppResult<EnvironmentKind> {
    EnvironmentKind::parse(value)
        .ok_or_else(|| AppError::Config("the stored Project Environment kind is invalid".into()))
}

pub(super) fn u64_to_i64(value: u64, field: &str) -> AppResult<i64> {
    i64::try_from(value).map_err(|_| AppError::Config(format!("{field} is too large")))
}

pub(super) fn positive_revision(value: i64, field: &str) -> AppResult<u64> {
    let value = u64::try_from(value)
        .map_err(|_| AppError::Config(format!("the stored {field} is invalid")))?;
    if value == 0 {
        return Err(AppError::Config(format!("the stored {field} is invalid")));
    }
    Ok(value)
}
