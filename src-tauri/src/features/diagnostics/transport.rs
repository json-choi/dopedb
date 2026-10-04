//! Desktop-only local diagnostics commands; the Broker has no diagnostics API.

use super::{FrontendEntry, Snapshot};

#[tauri::command]
pub(crate) fn diagnostics_snapshot() -> Snapshot {
    super::snapshot()
}

#[tauri::command]
pub(crate) fn diagnostics_set_enabled(enabled: bool) -> Snapshot {
    super::set_enabled(enabled)
}

#[tauri::command]
pub(crate) fn diagnostics_clear() -> Snapshot {
    super::clear()
}

#[tauri::command]
pub(crate) fn diagnostics_append(generation: u64, entries: Vec<FrontendEntry>) {
    super::append(generation, entries);
}
