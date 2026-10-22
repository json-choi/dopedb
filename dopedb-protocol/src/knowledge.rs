//! Secret-free GitHub source identities pinned to one exact repository commit.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

const MAX_KNOWLEDGE_STRING_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeSourceProvider {
    Github,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SourceRevisionIdentity {
    Github {
        repository_id: String,
        repository: String,
        ref_name: String,
        commit_sha: String,
    },
}

impl SourceRevisionIdentity {
    pub fn validate(&self) -> bool {
        match self {
            Self::Github {
                repository_id,
                repository,
                ref_name,
                commit_sha,
            } => {
                safe_text(repository_id)
                    && safe_repository(repository)
                    && safe_ref(ref_name)
                    && sha1(commit_sha)
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeSourceBindingV1 {
    pub source_id: Uuid,
    pub project_id: Uuid,
    pub project_environment_id: Uuid,
    pub provider: KnowledgeSourceProvider,
    pub display_name: String,
    pub revision: SourceRevisionIdentity,
}

impl KnowledgeSourceBindingV1 {
    pub fn validate(&self) -> bool {
        safe_text(&self.display_name) && self.revision.validate()
    }
}

fn safe_repository(value: &str) -> bool {
    let mut parts = value.split('/');
    parts.next().is_some_and(safe_slug)
        && parts.next().is_some_and(safe_slug)
        && parts.next().is_none()
}

fn safe_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn safe_ref(value: &str) -> bool {
    safe_text(value)
        && !value.starts_with(['/', '.'])
        && !value.ends_with(['/', '.'])
        && !value.contains("..")
        && !value.contains("//")
        && !value.contains("@{")
        && !value.contains(['\\', '~', '^', ':', '?', '*', '['])
}

fn safe_text(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_KNOWLEDGE_STRING_BYTES
        && !value.contains('\0')
        && !value.chars().any(char::is_control)
}

fn sha1(value: &str) -> bool {
    value.len() == 40 && lower_hex(value)
}

fn lower_hex(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
