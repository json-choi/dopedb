//! Release-profile packaged benchmark transport.
//!
//! The command is inert in ordinary builds. The feature build uses an isolated
//! application identity/data root, accepts only numeric renderer measurements, emits
//! one bounded JSON line, and exits. It never serializes SQL, rows, prompts, paths, or
//! credentials into the artifact.

use serde::{Deserialize, Serialize};
use tauri::State;

#[cfg(feature = "packaged-benchmark")]
use std::collections::HashMap;
#[cfg(feature = "packaged-benchmark")]
use std::fs::OpenOptions;
#[cfg(feature = "packaged-benchmark")]
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Once,
};
#[cfg(feature = "packaged-benchmark")]
use std::thread;
#[cfg(feature = "packaged-benchmark")]
use std::time::{Duration, Instant};
#[cfg(feature = "packaged-benchmark")]
use uuid::Uuid;

#[cfg(feature = "packaged-benchmark")]
use futures::TryStreamExt;
#[cfg(feature = "packaged-benchmark")]
use sqlx::{AssertSqlSafe, Connection, Row};
#[cfg(feature = "packaged-benchmark")]
use tauri::Manager;

use crate::error::{AppError, AppResult};
#[cfg(feature = "packaged-benchmark")]
use crate::startup::StartupSummary;
use crate::state::AppState;

#[path = "packaged_benchmark_fixtures.rs"]
#[cfg(feature = "packaged-benchmark")]
mod fixtures;
#[path = "packaged_benchmark_metrics.rs"]
#[cfg(feature = "packaged-benchmark")]
mod metrics;
#[path = "packaged_benchmark_receipts.rs"]
#[cfg(feature = "packaged-benchmark")]
mod receipts;

#[cfg(feature = "packaged-benchmark")]
pub(crate) use fixtures::prepare_fixture_if_requested;
#[cfg(feature = "packaged-benchmark")]
use metrics::*;
#[cfg(feature = "packaged-benchmark")]
use receipts::*;

#[cfg(not(feature = "packaged-benchmark"))]
const DISABLED: &str = "packaged benchmark transport is disabled";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RendererMetrics {
    renderer_elapsed_ms: f64,
    react_commit_count: u64,
    react_commit_duration_ms: f64,
    max_react_commit_duration_ms: f64,
    long_task_supported: bool,
    long_task_count: u64,
    max_long_task_ms: f64,
    frame_sample_count: u64,
    frame_over_50_ms_count: u64,
    max_frame_gap_ms: f64,
    ipc_call_count: u64,
    ipc_total_duration_ms: f64,
    viewport_width: u32,
    viewport_height: u32,
    device_pixel_ratio: f64,
    webview_engine: String,
    webview_version: String,
    actions: Vec<ActionMetrics>,
    idle_observation_ms: f64,
    idle_ipc_call_count: u64,
    webview_heap_bytes: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActionMetrics {
    name: String,
    samples_ms: Vec<f64>,
    react_commit_count: u64,
    react_commit_duration_ms: f64,
    max_frame_gap_ms: f64,
    frame_sample_count: u64,
    dropped_frame_count: u64,
    ipc_call_count: u64,
    ipc_duration_ms: f64,
    ipc_payload_bytes: u64,
    sqlite_transaction_count: u64,
    retained_bytes: u64,
    backend_request_to_first_row_ms: Option<f64>,
    backend_first_row_to_ipc_batch_ms: Option<f64>,
    ipc_batch_to_react_commit_ms: Option<f64>,
    #[serde(default)]
    backend_request_to_first_row_samples_ms: Vec<f64>,
    #[serde(default)]
    backend_first_row_to_ipc_batch_samples_ms: Vec<f64>,
    #[serde(default)]
    ipc_batch_to_react_commit_samples_ms: Vec<f64>,
    operation_claim_ms: Option<f64>,
    pool_connect_start_ms: Option<f64>,
    pool_connect_ready_ms: Option<f64>,
    backend_execute_start_ms: Option<f64>,
    first_row_ms: Option<f64>,
    first_ipc_batch_ms: Option<f64>,
    #[serde(default)]
    operation_claim_samples_ms: Vec<f64>,
    #[serde(default)]
    pool_connect_start_samples_ms: Vec<f64>,
    #[serde(default)]
    pool_connect_ready_samples_ms: Vec<f64>,
    #[serde(default)]
    backend_execute_start_samples_ms: Vec<f64>,
    #[serde(default)]
    first_row_samples_ms: Vec<f64>,
    #[serde(default)]
    first_ipc_batch_samples_ms: Vec<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackagedBenchmarkConfig {
    scenario: String,
    kind: &'static str,
    phase: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackagedBackendReceipt {
    action: String,
    backend_request_to_first_row_ms: Option<f64>,
    backend_first_row_to_ipc_batch_ms: Option<f64>,
    ipc_payload_bytes: u64,
    sqlite_transaction_count: u64,
    retained_bytes: u64,
    row_count: u64,
    columns: Vec<String>,
    rows: Vec<Vec<i64>>,
}

#[cfg(feature = "packaged-benchmark")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PackagedBenchmarkReport<'a> {
    schema_version: u32,
    measurement_scope: &'static str,
    app_version: &'static str,
    scenario: &'a str,
    connection_count: u32,
    process_tree_rss_bytes: Option<u64>,
    startup: StartupSummary,
    renderer: &'a RendererMetrics,
}

#[tauri::command]
pub(crate) async fn packaged_benchmark_config(
    app: tauri::AppHandle,
) -> AppResult<PackagedBenchmarkConfig> {
    #[cfg(not(feature = "packaged-benchmark"))]
    {
        let _ = app;
        Err(AppError::NotFound(DISABLED.into()))
    }
    #[cfg(feature = "packaged-benchmark")]
    {
        let scenario = benchmark_scenario()?;
        let kind = if scenario.starts_with("connections-") {
            "startup"
        } else if WORKLOAD_SCENARIOS.contains(&scenario.as_str()) {
            "workload"
        } else if QA_SCENARIOS.contains(&scenario.as_str()) {
            "qa"
        } else {
            return Err(AppError::Config(
                "packaged benchmark scenario is unsupported".into(),
            ));
        };
        start_packaged_process_tree_rss_sampler();
        // Every measured process must own a visible paint clock. In particular,
        // repeated cold/warm startup launches can otherwise be left inactive by
        // macOS before the renderer records its first-shell frame.
        focus_benchmark_window(&app).await?;
        let phase = benchmark_phase(&scenario)?;
        Ok(PackagedBenchmarkConfig {
            scenario,
            kind,
            phase,
        })
    }
}

#[tauri::command]
pub(crate) async fn prepare_packaged_benchmark_workload(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> AppResult<()> {
    #[cfg(not(feature = "packaged-benchmark"))]
    {
        let _ = (state, app);
        Err(AppError::NotFound(DISABLED.into()))
    }
    #[cfg(feature = "packaged-benchmark")]
    {
        let scenario = benchmark_scenario()?;
        if !WORKLOAD_SCENARIOS.contains(&scenario.as_str()) {
            return Err(AppError::Config(
                "packaged benchmark workload preparation requires a workload scenario".into(),
            ));
        }
        if scenario == "table-first-row" {
            relocate_table_fixture_connection(state.packaged_benchmark_store()).await?;
        }
        // The config command runs before React mounts. CI launchers can activate a
        // later process between that early call and the first rendered workload,
        // which suspends WKWebView's first paint clock. Reassert focus only after
        // the scenario surface is ready so every measured process owns the same
        // visible-window condition as a user interaction.
        focus_benchmark_window(&app).await?;
        #[cfg(target_os = "macos")]
        {
            // NSApplication activation and the key-window transition complete
            // after set_focus returns. Keep that native transition outside the
            // first measured editor/tree/grid action instead of attributing a
            // one-off activation frame gap to the product interaction.
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        Ok(())
    }
}

#[cfg(feature = "packaged-benchmark")]
async fn relocate_table_fixture_connection(store: &crate::store::Store) -> AppResult<()> {
    let connection_id = Uuid::from_u128(0xbed0_0000_0000_0000_0000_0000_0000_0001);
    let database = crate::app_paths::data_root()?.join("fixture-00.sqlite");
    if !database.is_file() {
        return Err(AppError::Config(
            "packaged table fixture database is unavailable".into(),
        ));
    }
    let mut profile = store.get_connection(connection_id).await?;
    profile.database = database.to_string_lossy().into_owned();
    store.upsert_connection(&profile).await.map(|_| ())
}

#[tauri::command]
pub(crate) async fn set_packaged_benchmark_compact_window(
    app: tauri::AppHandle,
    compact: bool,
) -> AppResult<()> {
    #[cfg(not(feature = "packaged-benchmark"))]
    {
        let _ = (app, compact);
        Err(AppError::NotFound(DISABLED.into()))
    }
    #[cfg(feature = "packaged-benchmark")]
    {
        if benchmark_scenario()? != "agent-tools" {
            return Err(AppError::Config(
                "compact benchmark window requires the agent-tools scenario".into(),
            ));
        }
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| AppError::Config("packaged benchmark window is unavailable".into()))?;
        let (minimum, size) = if compact {
            ((360.0, 520.0), (360.0, 640.0))
        } else {
            ((420.0, 520.0), (1200.0, 800.0))
        };
        window
            .set_min_size(Some(tauri::LogicalSize::new(minimum.0, minimum.1)))
            .map_err(|_| AppError::Config("packaged benchmark minimum size failed".into()))?;
        window
            .set_size(tauri::LogicalSize::new(size.0, size.1))
            .map_err(|_| AppError::Config("packaged benchmark resize failed".into()))?;
        focus_benchmark_window(&app).await
    }
}

#[tauri::command]
pub(crate) async fn run_packaged_benchmark_backend(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    action: String,
) -> AppResult<PackagedBackendReceipt> {
    #[cfg(not(feature = "packaged-benchmark"))]
    {
        let _ = (state, app, action);
        Err(AppError::NotFound(DISABLED.into()))
    }
    #[cfg(feature = "packaged-benchmark")]
    {
        let scenario = benchmark_scenario()?;
        let allowed = match scenario.as_str() {
            "query-result" => matches!(
                action.as_str(),
                "query-first-batch"
                    | "query-page-store-1m"
                    | "query-start-cancellable-export"
                    | "query-cancel"
                    | "query-export"
            ),
            "agent-transcript" => action == "agent-stream-10k",
            "agent-tools" => action == "agent-skill-reload",
            "long-lived-data" => matches!(
                action.as_str(),
                "history-10k"
                    | "audit-100k"
                    | "local-history-50"
                    | "analysis-article-local-results"
            ),
            _ => false,
        };
        if !allowed {
            return Err(AppError::Config(
                "packaged benchmark action does not match its scenario".into(),
            ));
        }
        let needs_focus_recovery = action == "query-page-store-1m";
        if needs_focus_recovery {
            focus_benchmark_window(&app).await?;
        }
        benchmark_progress(&action, "start")?;
        let receipt = if matches!(
            action.as_str(),
            "query-page-store-1m"
                | "query-start-cancellable-export"
                | "query-cancel"
                | "query-export"
        ) {
            let action_for_worker = action.clone();
            let metric = tokio::task::spawn_blocking(move || {
                crate::features::queries::run_packaged_result_store_benchmark(&action_for_worker)
            })
            .await
            .map_err(|_| AppError::Config("packaged result worker stopped".into()))??;
            packaged_result_receipt(action.clone(), metric)?
        } else if action == "agent-stream-10k" {
            packaged_agent_receipt(state.packaged_benchmark_store(), action.clone()).await?
        } else if action == "agent-skill-reload" {
            let action_for_worker = action.clone();
            tokio::task::spawn_blocking(move || packaged_skill_reload_receipt(action_for_worker))
                .await
                .map_err(|_| AppError::Config("packaged Skill reload worker stopped".into()))??
        } else {
            packaged_read_receipt(state.packaged_benchmark_store(), action.clone()).await?
        };
        benchmark_progress(&action, "complete")?;
        if needs_focus_recovery {
            focus_benchmark_window(&app).await?;
        }
        Ok(receipt)
    }
}

#[tauri::command]
pub(crate) async fn complete_packaged_benchmark(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    metrics: RendererMetrics,
) -> AppResult<()> {
    #[cfg(not(feature = "packaged-benchmark"))]
    {
        let _ = (state, app, metrics);
        Err(AppError::NotFound(DISABLED.into()))
    }
    #[cfg(feature = "packaged-benchmark")]
    {
        validate_metrics(&metrics)?;
        state.wait_for_post_paint_recovery().await?;
        let scenario = benchmark_scenario()?;
        let connection_count = benchmark_connection_count()?;
        let process_tree_rss_bytes = maximum_packaged_process_tree_rss_bytes();
        let report = PackagedBenchmarkReport {
            schema_version: 2,
            measurement_scope: "packaged_release_user_journeys",
            app_version: env!("CARGO_PKG_VERSION"),
            scenario: &scenario,
            connection_count,
            process_tree_rss_bytes,
            startup: state.startup_trace.summary(),
            renderer: &metrics,
        };
        let payload = serde_json::to_string(&report)?;
        if payload.len() > 64 * 1024 {
            return Err(AppError::Config(
                "packaged benchmark report is too large".into(),
            ));
        }
        println!("DOPEDB_PACKAGED_BENCHMARK:{payload}");
        use std::io::Write;
        std::io::stdout().flush()?;
        app.exit(0);
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn fail_packaged_benchmark(
    app: tauri::AppHandle,
    phase: String,
    reason: String,
) -> AppResult<()> {
    #[cfg(not(feature = "packaged-benchmark"))]
    {
        let _ = (app, phase, reason);
        Err(AppError::NotFound(DISABLED.into()))
    }
    #[cfg(feature = "packaged-benchmark")]
    {
        if phase != "scenario-setup" && !ACTION_NAMES.contains(&phase.as_str()) {
            return Err(AppError::Config(
                "packaged benchmark failure phase is invalid".into(),
            ));
        }
        if !matches!(
            reason.as_str(),
            "surface_unavailable"
                | "paint_timeout"
                | "backend_command"
                | "accessibility_contract"
                | "viewport_contract"
                | "locale_contract"
                | "keyboard_contract"
                | "skill_state"
                | "type_error"
                | "range_error"
                | "unexpected"
        ) {
            return Err(AppError::Config(
                "packaged benchmark failure reason is invalid".into(),
            ));
        }
        let payload = serde_json::to_string(&serde_json::json!({
            "schemaVersion": 2,
            "phase": phase,
            "reason": reason,
        }))?;
        println!("DOPEDB_PACKAGED_BENCHMARK_FAILURE:{payload}");
        use std::io::Write;
        std::io::stdout().flush()?;
        app.exit(2);
        Ok(())
    }
}

#[cfg(feature = "packaged-benchmark")]
const WORKLOAD_SCENARIOS: [&str; 9] = [
    "sql-editor",
    "explorer-search",
    "query-result",
    "table-first-row",
    "agent-transcript",
    "agent-tools",
    "long-lived-data",
    "interaction-surfaces",
    "idle-runtime",
];

#[cfg(feature = "packaged-benchmark")]
const QA_SCENARIOS: [&str; 1] = ["publication-snapshot-qa"];

#[cfg(feature = "packaged-benchmark")]
const ACTION_NAMES: [&str; 37] = [
    "sql-editor-10k-type",
    "sql-editor-10k-cursor",
    "sql-editor-10k-format",
    "sql-editor-10k-run",
    "sql-editor-100k-type",
    "sql-editor-100k-cursor",
    "sql-editor-100k-format",
    "sql-editor-100k-run",
    "sql-editor-1m-type",
    "sql-editor-1m-cursor",
    "sql-editor-1m-format",
    "sql-editor-1m-run",
    "sql-editor-1m-scroll",
    "explorer-first-expand",
    "explorer-secondary-expand",
    "search-everywhere",
    "query-first-batch",
    "query-grid-scroll-50k",
    "query-page-store-1m",
    "query-cancel",
    "query-export",
    "table-first-page-cold",
    "table-first-page",
    "agent-stream-10k",
    "agent-manual-scroll",
    "agent-permission",
    "agent-reconnect",
    "agent-skill-install-all",
    "agent-skill-reload",
    "agent-skill-remove-all",
    "history-10k",
    "audit-100k",
    "local-history-50",
    "analysis-article-local-results",
    "erd-drag-1k",
    "grid-and-pane-resize",
    "workbench-scroll-continuity",
];

#[cfg(feature = "packaged-benchmark")]
fn valid_action_metrics(measurement: &ActionMetrics) -> bool {
    let valid_duration = |value: &f64| value.is_finite() && *value >= 0.0 && *value <= 600_000.0;
    let duration_samples_valid = [
        &measurement.backend_request_to_first_row_samples_ms,
        &measurement.backend_first_row_to_ipc_batch_samples_ms,
        &measurement.ipc_batch_to_react_commit_samples_ms,
        &measurement.operation_claim_samples_ms,
        &measurement.pool_connect_start_samples_ms,
        &measurement.pool_connect_ready_samples_ms,
        &measurement.backend_execute_start_samples_ms,
        &measurement.first_row_samples_ms,
        &measurement.first_ipc_batch_samples_ms,
    ]
    .iter()
    .all(|samples| samples.len() <= 128 && samples.iter().all(&valid_duration));
    let durations_valid = measurement.samples_ms.len() <= 128
        && measurement.samples_ms.iter().all(&valid_duration)
        && duration_samples_valid
        && [
            measurement.react_commit_duration_ms,
            measurement.max_frame_gap_ms,
            measurement.ipc_duration_ms,
        ]
        .iter()
        .all(&valid_duration)
        && [
            measurement.backend_request_to_first_row_ms,
            measurement.backend_first_row_to_ipc_batch_ms,
            measurement.ipc_batch_to_react_commit_ms,
            measurement.operation_claim_ms,
            measurement.pool_connect_start_ms,
            measurement.pool_connect_ready_ms,
            measurement.backend_execute_start_ms,
            measurement.first_row_ms,
            measurement.first_ipc_batch_ms,
        ]
        .iter()
        .flatten()
        .all(valid_duration);
    let counts_valid = [
        measurement.react_commit_count,
        measurement.frame_sample_count,
        measurement.dropped_frame_count,
        measurement.ipc_call_count,
        measurement.sqlite_transaction_count,
    ]
    .iter()
    .all(|value| *value <= 100_000_000)
        && measurement.ipc_payload_bytes <= 16 * 1024 * 1024 * 1024
        && measurement.retained_bytes <= 64 * 1024 * 1024 * 1024;
    ACTION_NAMES.contains(&measurement.name.as_str()) && durations_valid && counts_valid
}

#[cfg(feature = "packaged-benchmark")]
fn safe_version(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

#[cfg(feature = "packaged-benchmark")]
fn benchmark_progress(action: &str, status: &str) -> AppResult<()> {
    let payload = serde_json::to_string(&serde_json::json!({
        "action": action,
        "status": status,
    }))?;
    println!("DOPEDB_PACKAGED_BENCHMARK_PROGRESS:{payload}");
    use std::io::Write;
    std::io::stdout().flush()?;
    Ok(())
}

#[cfg(feature = "packaged-benchmark")]
async fn focus_benchmark_window(app: &tauri::AppHandle) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        let (activation_sent, activation_received) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            let activated = if let Some(main_thread) = objc2::MainThreadMarker::new() {
                let application = objc2_app_kit::NSApplication::sharedApplication(main_thread);
                // Directly launching the bundle executable repeatedly can leave the
                // next process visible but inactive after its predecessor exits.
                // WKWebView then suspends requestAnimationFrame and produces a false
                // paint timeout.
                #[allow(deprecated)]
                application.activateIgnoringOtherApps(true);
                true
            } else {
                false
            };
            let _ = activation_sent.send(activated);
        })
        .map_err(|_| AppError::Config("packaged benchmark app could not be activated".into()))?;
        let activated = tokio::time::timeout(Duration::from_secs(5), activation_received)
            .await
            .map_err(|_| AppError::Config("packaged benchmark activation timed out".into()))?
            .map_err(|_| AppError::Config("packaged benchmark activation stopped".into()))?;
        if !activated {
            return Err(AppError::Config(
                "packaged benchmark activation left the main thread".into(),
            ));
        }
    }
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::Config("packaged benchmark window is unavailable".into()))?;
    window
        .show()
        .map_err(|_| AppError::Config("packaged benchmark window could not be shown".into()))?;
    window
        .set_focus()
        .map_err(|_| AppError::Config("packaged benchmark window could not be focused".into()))?;
    Ok(())
}
