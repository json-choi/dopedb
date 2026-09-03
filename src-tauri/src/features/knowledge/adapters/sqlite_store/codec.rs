use dopedb_protocol::{GraphBuildArtifactV1, KnowledgeSourceProvider, KnowledgeSourceVisibility};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::features::knowledge::domain::EnvironmentRiskClass;

const MAX_GRAPH_ARTIFACT_JSON_BYTES: usize = 256 * 1024 * 1024;

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
pub(super) type KnowledgeScopeRow = (
    String,
    String,
    i64,
    String,
    String,
    String,
    i64,
    i64,
    String,
);
pub(super) fn checked_name(value: &str) -> AppResult<&str> {
    let value = value.trim();
    if value.is_empty() || value.len() > 512 || value.chars().any(char::is_control) {
        return Err(AppError::Config(
            "the Project Knowledge name is invalid".into(),
        ));
    }
    Ok(value)
}

pub(super) fn provider_value(provider: KnowledgeSourceProvider) -> &'static str {
    match provider {
        KnowledgeSourceProvider::Github => "github",
        KnowledgeSourceProvider::LocalFolder => "local_folder",
    }
}

pub(super) fn visibility_value(visibility: KnowledgeSourceVisibility) -> &'static str {
    match visibility {
        KnowledgeSourceVisibility::LocalOnly => "local_only",
        KnowledgeSourceVisibility::SharedGraph => "shared_graph",
    }
}

pub(super) fn risk_class_value(risk_class: EnvironmentRiskClass) -> &'static str {
    match risk_class {
        EnvironmentRiskClass::Production => "production",
        EnvironmentRiskClass::Staging => "staging",
        EnvironmentRiskClass::Development => "development",
        EnvironmentRiskClass::Test => "test",
        EnvironmentRiskClass::Custom => "custom",
    }
}

pub(super) fn parse_risk_class(value: &str) -> AppResult<EnvironmentRiskClass> {
    match value {
        "production" => Ok(EnvironmentRiskClass::Production),
        "staging" => Ok(EnvironmentRiskClass::Staging),
        "development" => Ok(EnvironmentRiskClass::Development),
        "test" => Ok(EnvironmentRiskClass::Test),
        "custom" => Ok(EnvironmentRiskClass::Custom),
        _ => Err(AppError::Config(
            "the stored Project Environment risk class is invalid".into(),
        )),
    }
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

pub(super) fn artifact_json(artifact: &GraphBuildArtifactV1) -> AppResult<(String, String)> {
    if !artifact.validate() {
        return Err(AppError::Blocked {
            reason: "an unhealthy Knowledge graph candidate cannot be staged".into(),
        });
    }
    let json = serde_json::to_string(artifact)?;
    if json.len() > MAX_GRAPH_ARTIFACT_JSON_BYTES {
        return Err(AppError::Config(
            "the Knowledge graph candidate exceeds the local storage limit".into(),
        ));
    }
    let sha256 = hex::encode(Sha256::digest(json.as_bytes()));
    Ok((json, sha256))
}

pub(super) fn parse_artifact(json: String) -> AppResult<GraphBuildArtifactV1> {
    if json.len() > MAX_GRAPH_ARTIFACT_JSON_BYTES {
        return Err(AppError::Config(
            "the stored Knowledge graph exceeds the local storage limit".into(),
        ));
    }
    let artifact: GraphBuildArtifactV1 = serde_json::from_str(&json)?;
    if !artifact.validate() {
        return Err(AppError::Config(
            "the stored Knowledge graph failed integrity validation".into(),
        ));
    }
    Ok(artifact)
}
