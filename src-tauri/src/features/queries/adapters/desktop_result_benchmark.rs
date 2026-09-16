//! Packaged result-store benchmark fixtures and cancellable export probes.

use super::*;

#[derive(Debug)]
pub(crate) struct PackagedResultStoreMetric {
    pub(crate) first_row_ms: Option<f64>,
    pub(crate) elapsed_ms: f64,
    pub(crate) encoded_bytes: u64,
    pub(crate) retained_bytes: u64,
    pub(crate) row_count: u64,
    pub(crate) transaction_count: u64,
}

#[cfg(feature = "packaged-benchmark")]
#[derive(Clone)]
struct PackagedResultArtifact {
    operation_id: OperationId,
    capability: String,
    store: DesktopSqlResultStore,
    cancellable_export: Arc<Mutex<Option<PackagedCancellableExport>>>,
    retained_bytes: u64,
}

#[cfg(feature = "packaged-benchmark")]
struct PackagedCancellableExport {
    export_id: Uuid,
    cancelled: Arc<AtomicBool>,
    destination: PathBuf,
    worker: std::thread::JoinHandle<AppResult<()>>,
}

#[cfg(feature = "packaged-benchmark")]
static PACKAGED_RESULT_ARTIFACT: std::sync::OnceLock<Mutex<Option<PackagedResultArtifact>>> =
    std::sync::OnceLock::new();

#[cfg(feature = "packaged-benchmark")]
pub(crate) fn run_packaged_result_store_benchmark(
    action: &str,
) -> AppResult<PackagedResultStoreMetric> {
    match action {
        "query-page-store-1m" => create_packaged_result_artifact(),
        "query-start-cancellable-export" => start_packaged_cancellable_export(),
        "query-cancel" => cancel_packaged_result_export(),
        "query-export" => export_packaged_result_artifact(),
        _ => Err(AppError::Config(
            "unsupported packaged result-store action".into(),
        )),
    }
}

#[cfg(feature = "packaged-benchmark")]
fn packaged_result_artifact() -> AppResult<PackagedResultArtifact> {
    PACKAGED_RESULT_ARTIFACT
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
        .ok_or_else(|| AppError::Config("packaged result fixture is not prepared".into()))
}

#[cfg(feature = "packaged-benchmark")]
fn create_packaged_result_artifact() -> AppResult<PackagedResultStoreMetric> {
    use std::time::Instant;

    const ROW_COUNT: usize = 1_000_000;
    const OWNER: &str = "main";
    const CAPABILITY: &str = "packaged-benchmark-result-capability";

    let operation_id = OperationId::from(Uuid::new_v4());
    let started = Instant::now();
    let mut writer = DesktopSqlResultWriter::begin_with_authority(
        operation_id,
        Uuid::from_u128(1),
        "personal",
        Uuid::from_u128(0xbed0_0000_0000_0000_0000_0000_0000_0001),
        1,
        OWNER,
        CAPABILITY,
    )
    .map_err(|error| AppError::Safety(error.to_string()))?;
    let first_row_ms = elapsed_ms(started);
    let columns = vec!["id".to_string(), "bucket".to_string()];
    let mut retained_bytes = 0_u64;
    for (sequence, row_start) in (0..ROW_COUNT).step_by(RESULT_PAGE_ROWS).enumerate() {
        let row_end = (row_start + RESULT_PAGE_ROWS).min(ROW_COUNT);
        let batch = DesktopSqlStreamBatch {
            operation_id,
            sequence: sequence as u64,
            columns: columns.clone(),
            rows: (row_start..row_end)
                .map(|row| {
                    vec![
                        serde_json::Value::from(row as u64),
                        serde_json::Value::from((row % 1_000) as u64),
                    ]
                })
                .collect(),
            unreadable: Vec::new(),
        };
        let encoded = serde_json::to_vec(&batch)?;
        retained_bytes = retained_bytes.saturating_add(encoded.len() as u64);
        writer
            .write_page(&batch, &encoded)
            .map_err(|error| AppError::Safety(error.to_string()))?;
    }
    writer
        .complete(ROW_COUNT, false, elapsed_ms(started) as u64)
        .map_err(|error| AppError::Safety(error.to_string()))?;
    let store = DesktopSqlResultStore::default();
    let elapsed = elapsed_ms(started);
    let artifact = PackagedResultArtifact {
        operation_id,
        capability: CAPABILITY.to_string(),
        store,
        cancellable_export: Arc::new(Mutex::new(None)),
        retained_bytes,
    };
    *PACKAGED_RESULT_ARTIFACT
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(artifact);
    Ok(PackagedResultStoreMetric {
        first_row_ms: Some(first_row_ms),
        elapsed_ms: elapsed,
        encoded_bytes: 0,
        retained_bytes,
        row_count: ROW_COUNT as u64,
        transaction_count: 0,
    })
}

#[cfg(feature = "packaged-benchmark")]
fn start_packaged_cancellable_export() -> AppResult<PackagedResultStoreMetric> {
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    let artifact = packaged_result_artifact()?;
    let mut active = artifact
        .cancellable_export
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if active.is_some() {
        return Err(AppError::Config(
            "packaged cancellable export is already active".into(),
        ));
    }
    let export_id = Uuid::new_v4();
    let destination = crate::app_paths::data_root()?.join("benchmark-cancel-export.csv");
    let cancelled = artifact.store.start_export(
        export_id,
        artifact.operation_id,
        &artifact.capability,
        "main",
    )?;
    let worker_store = artifact.store.clone();
    let worker_capability = artifact.capability.clone();
    let worker_destination = destination.clone();
    let worker_cancelled = Arc::clone(&cancelled);
    let operation_id = artifact.operation_id;
    let (started_tx, started_rx) = mpsc::sync_channel(1);
    let started = Instant::now();
    let worker = std::thread::spawn(move || {
        let mut first_page = true;
        let result = worker_store.export_to_path(
            export_id,
            operation_id,
            &worker_capability,
            "main",
            DesktopSqlResultExportFormat::Csv,
            worker_destination.clone(),
            worker_cancelled,
            |_| {
                if first_page {
                    first_page = false;
                    let _ = started_tx.try_send(());
                }
                Ok(())
            },
        );
        worker_store.finish_export(export_id);
        if result.is_ok() {
            let _ = fs::remove_file(&worker_destination);
        }
        result.map(|_| ())
    });
    if started_rx.recv_timeout(Duration::from_secs(5)).is_err() {
        cancelled.store(true, Ordering::Release);
        let _ = worker.join();
        return Err(AppError::Config(
            "packaged cancellable export did not reach its first page".into(),
        ));
    }
    *active = Some(PackagedCancellableExport {
        export_id,
        cancelled,
        destination,
        worker,
    });
    Ok(PackagedResultStoreMetric {
        first_row_ms: Some(elapsed_ms(started)),
        elapsed_ms: elapsed_ms(started),
        encoded_bytes: 0,
        retained_bytes: artifact.retained_bytes,
        row_count: 0,
        transaction_count: 0,
    })
}

#[cfg(feature = "packaged-benchmark")]
fn cancel_packaged_result_export() -> AppResult<PackagedResultStoreMetric> {
    use std::time::Instant;

    let artifact = packaged_result_artifact()?;
    let active = artifact
        .cancellable_export
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take()
        .ok_or_else(|| AppError::Config("packaged cancellable export is not active".into()))?;
    let started = Instant::now();
    if !artifact.store.cancel_export(
        active.export_id,
        artifact.operation_id,
        &artifact.capability,
        "main",
    ) {
        let _ = active.worker.join();
        return Err(AppError::Config(
            "packaged result export cancellation was not accepted".into(),
        ));
    }
    if !active.cancelled.load(Ordering::Acquire) {
        let _ = active.worker.join();
        return Err(AppError::Config(
            "packaged result export cancellation did not reach its stop handle".into(),
        ));
    }
    let outcome = active
        .worker
        .join()
        .map_err(|_| AppError::Config("packaged cancellable export worker panicked".into()))?;
    if !matches!(
        outcome,
        Err(AppError::Safety(ref message)) if message == "SQL result export cancelled"
    ) {
        return Err(AppError::Config(
            "packaged result export did not stop at the cancellation boundary".into(),
        ));
    }
    let partial = active
        .destination
        .parent()
        .ok_or_else(|| {
            AppError::Config("packaged cancellable export destination is invalid".into())
        })?
        .join(format!(".dopedb-result-{}.partial", active.export_id));
    if active.destination.exists() || partial.exists() {
        return Err(AppError::Config(
            "packaged cancelled export left an output artifact".into(),
        ));
    }
    let elapsed = elapsed_ms(started);
    Ok(PackagedResultStoreMetric {
        first_row_ms: None,
        elapsed_ms: elapsed,
        encoded_bytes: 0,
        retained_bytes: artifact.retained_bytes,
        row_count: 0,
        transaction_count: 0,
    })
}

#[cfg(feature = "packaged-benchmark")]
fn export_packaged_result_artifact() -> AppResult<PackagedResultStoreMetric> {
    use std::time::Instant;

    let artifact = packaged_result_artifact()?;
    let export_id = Uuid::new_v4();
    let destination = crate::app_paths::data_root()?.join("benchmark-export.csv");
    let started = Instant::now();
    let cancelled = artifact.store.start_export(
        export_id,
        artifact.operation_id,
        &artifact.capability,
        "main",
    )?;
    let mut first_page_ms = None;
    let receipt = artifact.store.export_to_path(
        export_id,
        artifact.operation_id,
        &artifact.capability,
        "main",
        DesktopSqlResultExportFormat::Csv,
        destination.clone(),
        cancelled,
        |_| {
            first_page_ms.get_or_insert_with(|| elapsed_ms(started));
            Ok(())
        },
    );
    artifact.store.finish_export(export_id);
    let receipt = receipt?;
    let encoded_bytes = fs::metadata(&destination)?.len();
    fs::remove_file(destination)?;
    Ok(PackagedResultStoreMetric {
        first_row_ms: first_page_ms,
        elapsed_ms: elapsed_ms(started),
        encoded_bytes,
        retained_bytes: artifact.retained_bytes,
        row_count: receipt.rows_written as u64,
        transaction_count: 0,
    })
}

#[cfg(feature = "packaged-benchmark")]
fn elapsed_ms(started: std::time::Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1_000.0
}
