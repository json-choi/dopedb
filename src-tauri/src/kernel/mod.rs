//! Small cross-feature domain primitives with no platform dependencies.

pub(crate) mod access;
pub(crate) mod agent_policy;
pub(crate) mod environment;
pub(crate) mod identity;
pub(crate) mod sql_namespace;
pub(crate) mod sync;
mod terminal_authority;

pub(crate) use terminal_authority::TerminalAuthority;

#[cfg(test)]
mod tests {
    use super::environment::{effective_environment, EnvironmentKind};
    use super::identity::{AccountId, AccountScopeId, ConnectionId};
    use super::sql_namespace::{normalize_sql_namespace_bounded, quote_postgres_identifier};
    use crate::error::AppError;

    #[test]
    fn identities_namespaces_and_environment_labels_fail_closed() {
        // Account ids from the hosted authority are bounded and contain no
        // whitespace or control characters, whether built or decoded from JSON.
        let longest = "a".repeat(255);
        assert_eq!(AccountId::new(longest.clone()).unwrap().as_str(), longest);
        let account = serde_json::from_value::<AccountId>(serde_json::json!("acct_01")).unwrap();
        assert_eq!(account.to_string(), "acct_01");
        assert_eq!(&*account, "acct_01");
        for invalid in [
            String::new(),
            "a".repeat(256),
            "acct 01".into(),
            "acct\t01".into(),
            "acct\u{7}01".into(),
            "acct\u{2028}01".into(),
        ] {
            assert!(AccountId::new(invalid.clone()).is_none(), "{invalid:?}");
            assert!(
                serde_json::from_value::<AccountId>(serde_json::json!(invalid)).is_err(),
                "{invalid:?} must not decode"
            );
        }
        assert!(AccountScopeId::new("").is_none());
        assert_eq!(AccountScopeId::new("scope").unwrap().as_str(), "scope");

        // Typed UUID identities keep the bare UUID wire shape.
        let raw = uuid::Uuid::new_v4();
        let connection = ConnectionId::from(raw);
        assert_eq!(
            serde_json::to_value(connection).unwrap(),
            serde_json::json!(raw.to_string())
        );
        assert_eq!(connection.to_string(), raw.to_string());
        assert_eq!(uuid::Uuid::from(connection), raw);

        // A namespace is trimmed data, bounded in bytes, and never carries a
        // control character; the executor quotes it as one identifier.
        assert_eq!(normalize_sql_namespace_bounded(None, 8).unwrap(), None);
        assert_eq!(
            normalize_sql_namespace_bounded(Some(" \n ".into()), 8).unwrap(),
            None
        );
        assert_eq!(
            normalize_sql_namespace_bounded(Some("  analytics ".into()), 9).unwrap(),
            Some("analytics".into())
        );
        for (value, maximum) in [
            ("analytics", 8),
            ("분석", 5),
            ("tenant\u{0}", 64),
            ("tenant\nDROP", 64),
        ] {
            assert!(
                matches!(
                    normalize_sql_namespace_bounded(Some(value.into()), maximum),
                    Err(AppError::Config(_))
                ),
                "{value:?} within {maximum} bytes must be rejected"
            );
        }
        assert_eq!(
            quote_postgres_identifier(r#"a"; DROP SCHEMA x; --"#),
            r#""a""; DROP SCHEMA x; --""#
        );

        // Stored labels map onto the fixed list; production keeps its `prod`
        // wire token, and a development binding never lowers a production label.
        for kind in [
            EnvironmentKind::Production,
            EnvironmentKind::Staging,
            EnvironmentKind::Test,
            EnvironmentKind::Development,
        ] {
            assert_eq!(EnvironmentKind::parse(kind.as_str()), Some(kind));
            assert_eq!(EnvironmentKind::parse(kind.wire_token()), Some(kind));
            assert_eq!(
                serde_json::to_value(kind).unwrap(),
                serde_json::json!(kind.as_str())
            );
        }
        assert_eq!(EnvironmentKind::Production.wire_token(), "prod");
        assert_eq!(
            EnvironmentKind::parse(" PROD "),
            Some(EnvironmentKind::Production)
        );
        for retired in ["custom", "prd", "", "production-eu"] {
            assert_eq!(EnvironmentKind::parse(retired), None, "{retired:?}");
        }
        assert_eq!(
            effective_environment(
                Some(EnvironmentKind::Production),
                [EnvironmentKind::Development]
            ),
            Some(EnvironmentKind::Production)
        );
        assert_eq!(
            effective_environment(
                Some(EnvironmentKind::Development),
                [EnvironmentKind::Test, EnvironmentKind::Staging]
            ),
            Some(EnvironmentKind::Staging)
        );
        assert_eq!(effective_environment(None, []), None);

        #[derive(serde::Deserialize)]
        struct Label {
            #[serde(
                default,
                deserialize_with = "super::environment::deserialize_optional_kind"
            )]
            env: Option<EnvironmentKind>,
        }
        for (value, expected) in [
            (serde_json::json!("prod"), Some(EnvironmentKind::Production)),
            (serde_json::json!("custom"), None),
            (serde_json::Value::Null, None),
        ] {
            let label: Label = serde_json::from_value(serde_json::json!({ "env": value })).unwrap();
            assert_eq!(label.env, expected, "{value}");
        }
    }
}
