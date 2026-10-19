//! Direct access contract checks, run from the shared domain mega-test.
//!
//! Covers the security and wire invariants of the pure rules: verifier formats
//! against independent vectors, identifier and scope validation, SQL plan shape,
//! the ownership proof, and the effective-level mapping.

use super::domain::*;
use super::ownership::*;
use super::plan::*;
use super::verifier::*;

fn name() -> PrincipalName {
    PrincipalName::parse("dopedb_0123456789abcdef0123").unwrap()
}

fn marker() -> Marker {
    Marker::parse("Zm9vYmFyYmF6cXV4MTIz").unwrap()
}

pub(crate) async fn assert_direct_access_contract() {
    super::application_contract::assert_revocation_ordering_contract().await;
    // Public test vectors live in fixtures/verifier-vectors.json (RFC 7677 SCRAM
    // example credentials and the sha256-crypt specification), not in source.
    let vectors: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/verifier-vectors.json")).unwrap();
    let text = |value: &serde_json::Value| value.as_str().unwrap().to_owned();
    let scram_vector = &vectors["scram"];
    let salt: [u8; 16] = base64_decode(&text(&scram_vector["saltBase64"]))
        .try_into()
        .unwrap();
    let scram = postgres_scram_verifier_with_salt(&text(&scram_vector["password"]), &salt).unwrap();
    assert_eq!(scram, text(&scram_vector["verifier"]));
    assert!(is_valid_verifier(VerifierKind::ScramSha256, &scram));
    assert_eq!(
        postgres_scram_verifier_with_salt(&text(&scram_vector["nonAsciiPassword"]), &salt),
        Err(VerifierError::NonAscii)
    );

    // sha256-crypt: rounds 5000 is the default and the MySQL round count; 10000
    // checks the explicit-rounds path.
    for case in vectors["sha256Crypt"].as_array().unwrap() {
        assert_eq!(
            sha256_crypt_digest(
                text(&case["password"]).as_bytes(),
                text(&case["salt"]).as_bytes(),
                case["rounds"].as_u64().unwrap() as u32,
            ),
            text(&case["digest"])
        );
    }
    let mysql_vector = &vectors["mysql"];
    let mysql_salt = text(&mysql_vector["salt"]);
    let mysql = mysql_caching_sha2_verifier_with_salt(
        &text(&mysql_vector["password"]),
        mysql_salt.as_bytes().try_into().unwrap(),
    )
    .unwrap();
    assert!(mysql.starts_with(&format!("$A$005${mysql_salt}")));
    assert_eq!(mysql.len(), 7 + 20 + 43);
    assert!(is_valid_verifier(VerifierKind::CachingSha2, &mysql));
    let generated = generate_member_password().unwrap();
    assert!(is_valid_verifier(
        VerifierKind::CachingSha2,
        &mysql_caching_sha2_verifier(&generated).unwrap()
    ));
    let password = generate_member_password().unwrap();
    assert_eq!(password.len(), 43);
    assert_ne!(*password, *generate_member_password().unwrap());
    assert!(is_valid_verifier(
        VerifierKind::ScramSha256,
        &postgres_scram_verifier(&password).unwrap()
    ));

    // Validators reject anything outside the exact formats (quote injection included).
    for bad in [
        "",
        "SCRAM-SHA-256$4097:W22ZaJ0SNY7soEsUEjb6gQ==$WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=:wfPLwcE6nTWhTAmQ7tl2KeoiWGPlZqQxSrmfPwDl2dU=",
        "SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=",
        "SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=:wfPLwcE6nTWhTAmQ7tl2KeoiWGPlZqQxSrmfPwDl2d'=",
        "SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=:wfPLwcE6nTWhTAmQ7tl2KeoiWGPlZqQxSrmfPwDl2dU=;",
    ] {
        assert!(!is_valid_verifier(VerifierKind::ScramSha256, bad), "{bad}");
    }
    for bad in [
        String::new(),
        mysql.replacen("$A$005$", "$A$006$", 1),
        mysql.replacen("abcdefghijklmnopqrst", "abcdefghijklmnopqrs'", 1),
        mysql.replacen("abcdefghijklmnopqrst", "abcdefghijklmnopqrs$", 1),
        mysql[..mysql.len() - 1].to_owned(),
    ] {
        assert!(!is_valid_verifier(VerifierKind::CachingSha2, &bad), "{bad}");
    }

    // Names, markers, version gate, scope.
    assert!(PrincipalName::parse("dopedb_0123456789abcdef0123").is_some());
    for bad in [
        "dopedb_0123456789ABCDEF0123",
        "dopedb_0123456789abcdef012",
        "dopedb_0123456789abcdef01234",
        "dopedb_0123456789abcdef012\"",
        "xdopedb_0123456789abcdef0123",
        "postgres",
    ] {
        assert!(PrincipalName::parse(bad).is_none(), "{bad}");
    }
    assert!(serde_json::from_str::<PrincipalName>("\"dopedb_x\"").is_err());
    assert!(Marker::parse("short").is_none());
    assert!(Marker::parse("quote'quote'quote'quote").is_none());
    let marker = marker();
    assert_eq!(
        Marker::from_postgres_comment(&marker.postgres_comment()),
        Some(marker.clone())
    );
    assert_eq!(
        Marker::from_mysql_attribute(&marker.mysql_attribute()),
        Some(marker.clone())
    );
    assert!(
        Marker::from_mysql_attribute("{\"dopedb\":{\"v\":2,\"m\":\"Zm9vYmFyYmF6cXV4MTIz\"}}")
            .is_none()
    );
    assert_eq!(
        serde_json::to_string(&FailureCode::NameConflict).unwrap(),
        "\"name_conflict\""
    );
    assert_eq!(
        serde_json::to_string(&VerifierKind::ScramSha256).unwrap(),
        "\"scram-sha-256\""
    );

    for (engine, ok, bad) in [
        (
            DirectEngine::Postgres,
            ["14.0", "140005", "16.2 (Debian 16.2-1)"],
            ["13.9", "90624", "130014"],
        ),
        (
            DirectEngine::Mysql,
            ["8.0.21", "8.4.0", "9.1.0-log"],
            ["8.0.20", "5.7.44", "8.0.x"],
        ),
    ] {
        for version in ok {
            assert!(ServerVersion::check(engine, version).is_ok(), "{version}");
        }
        for version in bad {
            assert_eq!(
                ServerVersion::check(engine, version),
                Err(FailureCode::VersionUnsupported),
                "{version}"
            );
        }
    }
    assert!(ServerVersion::check(DirectEngine::Mysql, "10.11.2-MariaDB").is_err());
    assert!(ServerVersion::check(DirectEngine::Mysql, "8.0.35-MariaDB-log").is_err());

    assert!(Scope::new(
        DirectEngine::Postgres,
        vec!["public".into(), "Sales Data".into()]
    )
    .is_some());
    assert!(Scope::new(DirectEngine::Postgres, vec![]).is_none());
    assert!(Scope::new(DirectEngine::Postgres, vec!["a".into(), "a".into()]).is_none());
    assert!(Scope::new(DirectEngine::Postgres, vec!["pg_catalog".into()]).is_none());
    assert!(Scope::new(DirectEngine::Postgres, vec!["x".repeat(64)]).is_none());
    assert!(Scope::new(DirectEngine::Postgres, vec!["a\"b".into()]).is_none());
    assert!(Scope::new(DirectEngine::Mysql, vec!["mysql".into()]).is_none());
    assert!(Scope::new(DirectEngine::Mysql, vec!["a%".into()]).is_none());
    assert!(Scope::new(DirectEngine::Mysql, vec!["a\0b".into()]).is_none());
    assert!(Scope::new(DirectEngine::Mysql, vec!["é".repeat(64)]).is_some());
    assert!(Scope::new(
        DirectEngine::Mysql,
        (0..=MAX_SCOPE_ENTRIES).map(|i| format!("db{i}")).collect()
    )
    .is_none());

    // Effective level mapping.
    assert_eq!(effective_level(None, true), AccessLevel::None);
    assert_eq!(
        effective_level(Some(GrantMode::View), true),
        AccessLevel::None
    );
    assert_eq!(
        effective_level(Some(GrantMode::Read), true),
        AccessLevel::Read
    );
    assert_eq!(
        effective_level(Some(GrantMode::Write), true),
        AccessLevel::Write
    );
    assert_eq!(
        effective_level(Some(GrantMode::Manage), false),
        AccessLevel::Read
    );
    assert!(lowers_access(AccessLevel::Write, AccessLevel::Read));
    assert!(!lowers_access(AccessLevel::None, AccessLevel::Read));

    // Plans: ordered fixed templates, validated identifiers only.
    let pg_scope = Scope::new(
        DirectEngine::Postgres,
        vec!["public".into(), "we\u{e9}rd".into()],
    )
    .unwrap();
    let version = ServerVersion::check(DirectEngine::Postgres, "16.1").unwrap();
    let pg = Planner::new(DirectEngine::Postgres, version, pg_scope.clone()).unwrap();
    let created = pg
        .create(&name(), &marker, &scram, AccessLevel::Write)
        .unwrap();
    assert!(created[0]
        .sql
        .starts_with("CREATE ROLE \"dopedb_0123456789abcdef0123\" LOGIN PASSWORD 'SCRAM-SHA-256$"));
    assert!(created[0].sql.contains("NOSUPERUSER") && created[0].sql.contains("NOBYPASSRLS"));
    assert_eq!(
        created[1].sql,
        "COMMENT ON ROLE \"dopedb_0123456789abcdef0123\" IS 'dopedb:v1:Zm9vYmFyYmF6cXV4MTIz'"
    );
    assert!(created
        .iter()
        .all(|s| !s.sql.contains("DEFAULT PRIVILEGES")));
    assert!(created
        .iter()
        .filter(|s| s.schema.is_some())
        .all(|s| s.sql.contains(SCHEMA_SLOT)));
    assert_eq!(
        created
            .iter()
            .filter(|s| s.sql.contains("INSERT, UPDATE, DELETE"))
            .count(),
        2
    );
    let sequence = created
        .iter()
        .find(|s| s.sql.contains("SEQUENCES"))
        .unwrap();
    assert_eq!(
        sequence
            .render(Some("\"public\""), None)
            .unwrap()
            .matches("\"public\"")
            .count(),
        1
    );
    assert!(created
        .iter()
        .find(|s| s.uses_database)
        .unwrap()
        .render(Some("x"), None)
        .is_none());
    assert!(pg
        .create(&name(), &marker, "x'; DROP ROLE x; --", AccessLevel::Read)
        .is_err());
    assert!(pg
        .create(&name(), &marker, &mysql, AccessLevel::Read)
        .is_err());
    let lowered = pg.change_level(&name(), AccessLevel::Write, AccessLevel::Read);
    assert_eq!(lowered.len(), 4);
    assert!(lowered
        .iter()
        .all(|s| s.sql.starts_with("REVOKE") && !s.sql.contains("SELECT")));
    assert!(pg
        .change_level(&name(), AccessLevel::Read, AccessLevel::Read)
        .is_empty());
    let dropped = pg.drop_principal(&name(), AccessLevel::Write);
    assert!(dropped
        .last()
        .unwrap()
        .sql
        .starts_with("DROP ROLE \"dopedb_"));
    assert!(dropped
        .iter()
        .any(|s| s.sql.starts_with("REVOKE CONNECT ON DATABASE")));
    let sessions = pg.sessions_to_terminate(&name());
    assert_eq!(sessions.binds, vec![name().as_str().to_owned()]);
    assert!(sessions.sql.contains("pg_terminate_backend"));
    assert!(Planner::new(
        DirectEngine::Postgres,
        ServerVersion {
            major: 13,
            minor: 0,
            patch: 0
        },
        pg_scope
    )
    .is_err());

    let my_scope = Scope::new(DirectEngine::Mysql, vec!["sales_db".into(), "a-b".into()]).unwrap();
    let my_version = ServerVersion::check(DirectEngine::Mysql, "8.0.35").unwrap();
    let my = Planner::new(DirectEngine::Mysql, my_version, my_scope).unwrap();
    let created = my
        .create(&name(), &marker, &mysql, AccessLevel::Read)
        .unwrap();
    assert!(created[0].sql.starts_with("CREATE USER 'dopedb_0123456789abcdef0123'@'%' IDENTIFIED WITH caching_sha2_password AS '$A$005$"));
    assert!(created[0]
        .sql
        .ends_with("ATTRIBUTE '{\"dopedb\":{\"v\":1,\"m\":\"Zm9vYmFyYmF6cXV4MTIz\"}}'"));
    assert_eq!(
        created[1].sql,
        "GRANT SELECT ON `sales\\_db`.* TO 'dopedb_0123456789abcdef0123'@'%'"
    );
    assert_eq!(
        created[2].sql,
        "GRANT SELECT ON `a-b`.* TO 'dopedb_0123456789abcdef0123'@'%'"
    );
    let raised = my.change_level(&name(), AccessLevel::Read, AccessLevel::Write);
    assert!(raised[0]
        .sql
        .starts_with("GRANT INSERT, UPDATE, DELETE ON `sales"));
    let lowered = my.change_level(&name(), AccessLevel::Write, AccessLevel::None);
    assert!(lowered[0]
        .sql
        .starts_with("REVOKE SELECT, INSERT, UPDATE, DELETE ON"));
    assert_eq!(
        my.drop_principal(&name(), AccessLevel::Read)[0].sql,
        "DROP USER 'dopedb_0123456789abcdef0123'@'%'"
    );
    assert_eq!(kill_connection(42).sql, "KILL CONNECTION 42");
    assert!(my.lock(&name()).sql.ends_with("ACCOUNT LOCK"));
    assert!(Planner::new(
        DirectEngine::Mysql,
        ServerVersion {
            major: 8,
            minor: 0,
            patch: 20
        },
        Scope::new(DirectEngine::Mysql, vec!["x".into()]).unwrap()
    )
    .is_err());

    assert_ownership_rules();
}

fn assert_ownership_rules() {
    let identity = ServerIdentity::PostgresRoleOid(16_500);
    let receipt = Receipt {
        state: PrincipalState::Ready,
        name: name(),
        marker: marker(),
        identity: Some(identity.clone()),
    };
    let owned = ObservedPrincipal {
        name_exists: true,
        marker: Some(marker()),
        identity: Some(identity.clone()),
        owned_objects: 0,
        unexpected_memberships: 0,
    };
    let proof = prove_ownership(&receipt, &owned).unwrap();
    assert_eq!(proof.name(), &name());
    assert_eq!(proof.identity(), &identity);

    let failure = |receipt: &Receipt, observed: &ObservedPrincipal| {
        prove_ownership(receipt, observed).unwrap_err()
    };
    let mut observed = owned.clone();
    observed.marker = None;
    assert_eq!(failure(&receipt, &observed), FailureCode::NameConflict);
    observed.marker = Marker::parse("AnotherMarker12345678");
    assert_eq!(failure(&receipt, &observed), FailureCode::MarkerMismatch);
    let mut observed = owned.clone();
    observed.identity = Some(ServerIdentity::PostgresRoleOid(1));
    assert_eq!(failure(&receipt, &observed), FailureCode::OidMismatch);
    observed.identity = Some(ServerIdentity::MysqlServerUuid("u".into()));
    assert_eq!(failure(&receipt, &observed), FailureCode::OidMismatch);
    let mut observed = owned.clone();
    observed.owned_objects = 1;
    assert_eq!(failure(&receipt, &observed), FailureCode::OwnsObjects);
    let mut observed = owned.clone();
    observed.unexpected_memberships = 1;
    assert_eq!(
        failure(&receipt, &observed),
        FailureCode::UnexpectedMembership
    );
    let mut observed = owned.clone();
    observed.name_exists = false;
    assert_eq!(failure(&receipt, &observed), FailureCode::MarkerMismatch);
    for state in [PrincipalState::Requested, PrincipalState::Dropped] {
        let mut stale = receipt.clone();
        stale.state = state;
        assert_eq!(failure(&stale, &owned), FailureCode::MarkerMismatch);
    }
    // The identity may be learned only during the first apply.
    let mut first = receipt.clone();
    first.identity = None;
    assert_eq!(failure(&first, &owned), FailureCode::OidMismatch);
    first.state = PrincipalState::Applying;
    assert!(prove_ownership(&first, &owned).is_ok());

    // Create path: a free name is created, our marked leftover resumes, any other
    // object with the name is a conflict that is never touched.
    let mut requested = first.clone();
    requested.state = PrincipalState::Requested;
    let mut free = owned.clone();
    free.name_exists = false;
    assert_eq!(
        check_creatable(&requested, &free),
        Ok(CreateDecision::Create)
    );
    assert!(matches!(
        check_creatable(&requested, &owned),
        Ok(CreateDecision::ResumeOwned(_))
    ));
    let mut foreign = owned.clone();
    foreign.marker = None;
    assert_eq!(
        check_creatable(&requested, &foreign),
        Err(FailureCode::NameConflict)
    );
    foreign.marker = Marker::parse("AnotherMarker12345678");
    assert_eq!(
        check_creatable(&requested, &foreign),
        Err(FailureCode::NameConflict)
    );
    assert_eq!(
        check_creatable(&receipt, &free),
        Err(FailureCode::MarkerMismatch)
    );
}

fn base64_decode(value: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(value)
        .unwrap()
}
