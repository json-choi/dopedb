//! Provider CLI process-boundary contract coverage.

use super::*;

pub(crate) async fn assert_process_boundary() {
    use uuid::Uuid;

    let fixture_path = if cfg!(windows) {
        r"C:\Windows\System32\fixture.exe"
    } else {
        "/usr/bin/fixture"
    };
    let fixture_executable = ProvisioningExecutableIdentity {
        provider: LocalProvider::GcpCloudSql,
        canonical_path: fixture_path.into(),
        sha256: "ab".repeat(32),
        byte_length: 1,
    };
    assert!(ProvisioningCliCommand::new(
        LocalProvider::GcpCloudSql,
        fixture_executable.clone(),
        vec!["unsafe\u{202e}argument".into()],
        vec![],
        ProvisioningCliOutputSchema::Empty,
        Duration::from_secs(2),
    )
    .is_err());
    let traversal = if cfg!(windows) {
        r"C:\Windows\System32\..\Temp"
    } else {
        "/tmp/../provider"
    };
    assert!(ProvisioningCliCommand::new(
        LocalProvider::GcpCloudSql,
        fixture_executable,
        vec!["status".into()],
        vec![ProvisioningCliEnvironment::Home(traversal.into())],
        ProvisioningCliOutputSchema::Empty,
        Duration::from_secs(2),
    )
    .is_err());

    for (schema, output) in [
        (
            ProvisioningCliOutputSchema::JsonObject,
            br#"{"ready":true,"ready":false}"#.as_slice(),
        ),
        (
            ProvisioningCliOutputSchema::JsonObject,
            br#"{"target":{"id":"one","id":"two"}}"#.as_slice(),
        ),
        (
            ProvisioningCliOutputSchema::JsonArray,
            br#"[{"id":"one","id":"two"}]"#.as_slice(),
        ),
        (
            ProvisioningCliOutputSchema::JsonLines,
            b"{\"ready\":true,\"ready\":false}\n".as_slice(),
        ),
        (
            ProvisioningCliOutputSchema::JsonObject,
            b"\x1b[32m{\"ready\":true}\x1b[0m".as_slice(),
        ),
        (
            ProvisioningCliOutputSchema::JsonObject,
            b"progress\n{\"ready\":true}".as_slice(),
        ),
        (
            ProvisioningCliOutputSchema::JsonObject,
            b"{\"ready\":true".as_slice(),
        ),
    ] {
        assert_eq!(
            parse_output(schema, Zeroizing::new(output.to_vec())),
            Err(ProvisioningProcessFailure::OutputRejected),
        );
    }

    let secret = "provider-secret-must-not-escape";
    let authentication =
        format!("Reauthentication failed. Please run: gcloud auth login. {secret}");
    let authentication_failure = classify_exit_failure(authentication.as_bytes());
    assert_eq!(
        authentication_failure,
        ProvisioningProcessFailure::AuthenticationRequired
    );
    assert!(!authentication_failure.to_string().contains(secret));
    assert_eq!(
        classify_exit_failure(b"MFA required; authentication required"),
        ProvisioningProcessFailure::MultiFactorRequired
    );
    assert_eq!(
        classify_exit_failure(b"RESOURCE_EXHAUSTED: quota exceeded"),
        ProvisioningProcessFailure::RateLimited
    );
    assert_eq!(
        classify_exit_failure(b"403 Forbidden: permission denied"),
        ProvisioningProcessFailure::PermissionDenied
    );
    assert_eq!(
        classify_exit_failure(b"connection refused: network is unreachable"),
        ProvisioningProcessFailure::NetworkUnavailable
    );
    assert_eq!(
        classify_exit_failure(b"unclassified Provider failure"),
        ProvisioningProcessFailure::ExitStatusRejected
    );

    #[cfg(windows)]
    {
        let system_root = PathBuf::from(r"C:\Windows\System32");
        let ping_path = system_root.join("ping.exe");
        let executable = ProvisioningExecutableIdentity::audit(
            LocalProvider::GcpCloudSql,
            &system_root.join("cmd.exe"),
            std::slice::from_ref(&system_root),
            &["cmd.exe"],
        )
        .await
        .expect("audit the fixed Windows descendant fixture launcher");
        let marker_path = std::env::temp_dir().join(format!(
            "dopedb-provider-grandchild-{}.ready",
            Uuid::new_v4()
        ));
        let marker = marker_path.to_string_lossy();
        assert!(!marker.chars().any(|character| {
            character.is_control()
                || matches!(character, '"' | '&' | '|' | '<' | '>' | '^' | '%' | '!')
        }));
        // `Command` quotes every argument for the MSVC parser, which escapes an
        // embedded quote as `\"`. cmd.exe does not understand that escape, so a
        // single script string with quoted paths reaches the shell malformed and
        // the fixture never launches. Passing the script as separate arguments
        // leaves Rust only plain quotes to add, which cmd.exe does read, so a
        // temp directory containing a space still resolves.
        let ping = ping_path.display().to_string();
        let argv = [
            "/D",
            "/S",
            "/C",
            "start",
            "/B",
            ping.as_str(),
            "127.0.0.1",
            "-n",
            "30",
            ">NUL",
            "&",
            "echo",
            "ready>",
            marker.as_ref(),
            "&",
            ping.as_str(),
            "127.0.0.1",
            "-n",
            "30",
            ">NUL",
        ]
        .map(str::to_owned)
        .to_vec();
        let command = ProvisioningCliCommand::new(
            LocalProvider::GcpCloudSql,
            executable,
            argv,
            vec![ProvisioningCliEnvironment::SafePath],
            ProvisioningCliOutputSchema::Empty,
            Duration::from_secs(10),
        )
        .expect("construct Windows grandchild interruption fixture");
        let permit = ProvisioningExecutionPermit::issue(
            Uuid::from_u128(55),
            LocalProvider::GcpCloudSql,
            "ef".repeat(32),
            command.execution_sha256().unwrap(),
        );
        let cancellation = CancellationToken::new();
        let run_cancellation = cancellation.clone();
        let execution = tokio::spawn(async move { command.run(&permit, &run_cancellation).await });
        let mut descendant_started = false;
        for _ in 0..100 {
            if marker_path.is_file() {
                descendant_started = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        cancellation.cancel();
        let outcome = execution
            .await
            .expect("join Windows grandchild interruption fixture");
        let _ = std::fs::remove_file(&marker_path);
        assert!(
            descendant_started,
            "Windows grandchild fixture never started"
        );
        assert_eq!(outcome, Err(ProvisioningProcessFailure::Cancelled));
    }

    #[cfg(unix)]
    {
        let executable = ProvisioningExecutableIdentity::audit(
            LocalProvider::GcpCloudSql,
            Path::new("/usr/bin/printf"),
            &[PathBuf::from("/usr/bin")],
            &["printf"],
        )
        .await
        .expect("audit a fixed native fixture executable");
        let command = ProvisioningCliCommand::new(
            LocalProvider::GcpCloudSql,
            executable.clone(),
            vec![r#"{"target":"$(echo injected); | & ../../escape ' quoted"}"#.into()],
            vec![ProvisioningCliEnvironment::SafePath],
            ProvisioningCliOutputSchema::JsonObject,
            Duration::from_secs(2),
        )
        .expect("construct fixed argv fixture");
        let output = command
            .run(
                &ProvisioningExecutionPermit::issue(
                    Uuid::from_u128(51),
                    LocalProvider::GcpCloudSql,
                    "ef".repeat(32),
                    command.execution_sha256().unwrap(),
                ),
                &CancellationToken::new(),
            )
            .await
            .expect("execute fixed argv fixture");
        assert_eq!(
            output.value()["target"],
            "$(echo injected); | & ../../escape ' quoted"
        );
        assert_eq!(command.execution_sha256().unwrap().len(), 64);
        assert!(!command
            .redacted_plan()
            .to_string()
            .contains("provider-secret"));

        assert!(ProvisioningCliCommand::new(
            LocalProvider::GcpCloudSql,
            executable.clone(),
            vec!["bad\nargument".into()],
            vec![ProvisioningCliEnvironment::SafePath],
            ProvisioningCliOutputSchema::Empty,
            Duration::from_secs(2),
        )
        .is_err());

        let failing_executable = ProvisioningExecutableIdentity::audit(
            LocalProvider::GcpCloudSql,
            Path::new("/usr/bin/false"),
            &[PathBuf::from("/usr/bin")],
            &["false"],
        )
        .await
        .expect("audit a fixed failing fixture executable");
        let failing_command = ProvisioningCliCommand::new(
            LocalProvider::GcpCloudSql,
            failing_executable,
            vec!["--".into()],
            vec![ProvisioningCliEnvironment::SafePath],
            ProvisioningCliOutputSchema::Empty,
            Duration::from_secs(2),
        )
        .expect("construct fixed failing fixture");
        assert_eq!(
            failing_command
                .run(
                    &ProvisioningExecutionPermit::issue(
                        Uuid::from_u128(53),
                        LocalProvider::GcpCloudSql,
                        "ef".repeat(32),
                        failing_command.execution_sha256().unwrap(),
                    ),
                    &CancellationToken::new(),
                )
                .await,
            Err(ProvisioningProcessFailure::ExitStatusRejected)
        );
        let accepted_action_required = ProvisioningCliCommand::new(
            LocalProvider::GcpCloudSql,
            ProvisioningExecutableIdentity::audit(
                LocalProvider::GcpCloudSql,
                Path::new("/usr/bin/false"),
                &[PathBuf::from("/usr/bin")],
                &["false"],
            )
            .await
            .expect("audit a fixed action-required fixture"),
            vec!["--".into()],
            vec![ProvisioningCliEnvironment::SafePath],
            ProvisioningCliOutputSchema::Empty,
            Duration::from_secs(2),
        )
        .expect("construct action-required fixture")
        .with_accepted_exit_codes([0, 1])
        .expect("pin documented action-required exit code");
        accepted_action_required
            .run(
                &ProvisioningExecutionPermit::issue(
                    Uuid::from_u128(54),
                    LocalProvider::GcpCloudSql,
                    "ef".repeat(32),
                    accepted_action_required.execution_sha256().unwrap(),
                ),
                &CancellationToken::new(),
            )
            .await
            .expect("accept an explicitly hashed action-required exit code");
        Box::pin(assert_natural_exit_after_eof()).await;
        assert!(ProvisioningCliCommand::new(
            LocalProvider::GcpCloudSql,
            executable.clone(),
            vec!["x".into()],
            vec![
                ProvisioningCliEnvironment::SafePath,
                ProvisioningCliEnvironment::SafePath,
            ],
            ProvisioningCliOutputSchema::Empty,
            Duration::from_secs(2),
        )
        .is_err());

        let cancelled = CancellationToken::new();
        cancelled.cancel();
        let cancelled_command = ProvisioningCliCommand::new(
            LocalProvider::GcpCloudSql,
            executable,
            vec!["x".into()],
            vec![],
            ProvisioningCliOutputSchema::Empty,
            Duration::from_secs(2),
        )
        .expect("construct cancellation fixture");
        assert_eq!(
            cancelled_command
                .run(
                    &ProvisioningExecutionPermit::issue(
                        Uuid::from_u128(52),
                        LocalProvider::GcpCloudSql,
                        "ef".repeat(32),
                        cancelled_command.execution_sha256().unwrap(),
                    ),
                    &cancelled,
                )
                .await,
            Err(ProvisioningProcessFailure::Cancelled)
        );

        let drift_directory = std::env::temp_dir().join(format!(
            "dopedb-provisioning-executable-drift-{}",
            Uuid::new_v4()
        ));
        tokio::fs::create_dir(&drift_directory)
            .await
            .expect("create executable drift fixture directory");
        let drift_path = drift_directory.join("fixture-cli");
        tokio::fs::write(&drift_path, b"first")
            .await
            .expect("write executable drift fixture");
        let drift_identity = ProvisioningExecutableIdentity::audit(
            LocalProvider::GcpCloudSql,
            &drift_path,
            std::slice::from_ref(&drift_directory),
            &["fixture-cli"],
        )
        .await
        .expect("audit executable drift fixture");
        tokio::fs::write(&drift_path, b"other")
            .await
            .expect("replace executable drift fixture");
        assert_eq!(
            drift_identity.revalidate().await,
            Err(ProvisioningProcessFailure::ExecutableChanged)
        );
        tokio::fs::remove_file(&drift_path)
            .await
            .expect("remove executable drift fixture");
        tokio::fs::remove_dir(&drift_directory)
            .await
            .expect("remove executable drift fixture directory");
    }
}

#[cfg(unix)]
async fn assert_natural_exit_after_eof() {
    use uuid::Uuid;

    let delayed_exit = ProvisioningCliCommand::new(
        LocalProvider::GcpCloudSql,
        ProvisioningExecutableIdentity::audit(
            LocalProvider::GcpCloudSql,
            Path::new("/bin/sh"),
            &[PathBuf::from("/bin")],
            &["sh"],
        )
        .await
        .expect("audit the fixed EOF-before-exit fixture"),
        vec![
            "-c".into(),
            "exec 1>&- 2>&-; /bin/sleep 0.05; exit 1".into(),
        ],
        vec![ProvisioningCliEnvironment::SafePath],
        ProvisioningCliOutputSchema::Empty,
        Duration::from_secs(2),
    )
    .expect("construct EOF-before-exit fixture")
    .with_accepted_exit_codes([1])
    .expect("pin the fixture's natural exit code");
    delayed_exit
        .run(
            &ProvisioningExecutionPermit::issue(
                Uuid::from_u128(55),
                LocalProvider::GcpCloudSql,
                "ef".repeat(32),
                delayed_exit.execution_sha256().unwrap(),
            ),
            &CancellationToken::new(),
        )
        .await
        .expect("EOF must not kill a CLI before its accepted exit");
}
