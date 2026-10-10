//! Tauri adapter for the close/quit confirmation while manual transactions are
//! open. It maps window close, programmatic exit, and the macOS Quit menu item
//! onto the runtime's Tauri-free exit decision, asks the renderer through
//! `manual-transaction:exit-requested`, and carries out a confirmed exit. A
//! confirmed exit rolls every transaction back first; nothing is ever committed.
//!
//! Guarded: the main window's close (button, Cmd+W), Cmd+Q and the app menu's
//! Quit item on macOS, and `AppHandle::exit`. Not guarded, because they cannot
//! be held: Dock Quit and logout/shutdown on macOS (the process terminates
//! directly), a restart, and an exit after every window is gone. Each of those
//! still rolls back in the application exit hook.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::AppResult;
use crate::state::AppState;

use super::manual_transaction::{ExitDecision, ExitIntent};

const EXIT_REQUESTED_EVENT: &str = "manual-transaction:exit-requested";
const MAIN_WINDOW: &str = "main";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitRequested {
    count: usize,
}

/// The renderer's answer to a close/quit prompt.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ExitPromptResponse {
    /// The prompt is on screen.
    Shown,
    Cancelled,
    Confirmed,
}

/// Whether to hold a close or quit request; when held, the renderer is asked.
fn hold(app: &AppHandle, intent: ExitIntent) -> bool {
    // Before setup finishes there is no runtime and nothing to roll back.
    let Some(state) = app.try_state::<AppState>() else {
        return false;
    };
    let runtime = state.services.queries.manual_transactions();
    match tauri::async_runtime::block_on(runtime.exit_decision(intent)) {
        ExitDecision::Proceed => false,
        ExitDecision::Ask(count) => {
            let _ = app.emit(EXIT_REQUESTED_EVENT, ExitRequested { count });
            true
        }
    }
}

/// `Builder::on_window_event` hook: hold the main window's close request.
pub(crate) fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == MAIN_WINDOW && hold(window.app_handle(), ExitIntent::CloseWindow) {
            api.prevent_close();
        }
    }
}

/// `RunEvent::ExitRequested` hook. Only a programmatic exit can still be held:
/// with every window gone there is nowhere to ask, and a restart ignores
/// `prevent_exit`. Both proceed, and the exit hook rolls back.
pub(crate) fn on_exit_requested(app: &AppHandle, code: Option<i32>, api: &tauri::ExitRequestApi) {
    if code.is_some_and(|code| code != tauri::RESTART_EXIT_CODE) && hold(app, ExitIntent::Quit) {
        api.prevent_exit();
    }
}

/// Setup hook. macOS: the default menu's predefined Quit item (Cmd+Q)
/// terminates the process without an exit request, so nothing could ask first.
/// Swap only that item for one with the same title and accelerator that goes
/// through the same decision; every other default item and accelerator stays
/// native. A failed swap keeps the native item (unguarded, still rolls back).
pub(crate) fn guard_quit_menu_item(app: &tauri::App) {
    #[cfg(target_os = "macos")]
    if let Err(error) = swap_quit_menu_item(app) {
        tracing::warn!(%error, "could not guard the Quit menu item");
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(target_os = "macos")]
fn swap_quit_menu_item(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuItem, MenuItemKind};

    const QUIT_MENU_ID: &str = "dopedb:quit";
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() else {
        return Ok(());
    };
    let quit = app_menu
        .items()?
        .into_iter()
        .enumerate()
        .rev()
        .find_map(|(position, item)| match item {
            MenuItemKind::Predefined(item) => item
                .text()
                .ok()
                .filter(|text| text.starts_with("Quit"))
                .map(|text| (position, text)),
            _ => None,
        });
    let Some((position, text)) = quit else {
        return Ok(());
    };
    let guarded = MenuItem::with_id(app, QUIT_MENU_ID, text, true, Some("CmdOrCtrl+Q"))?;
    // Insert first so a failure never leaves the menu without a Quit item.
    app_menu.insert(&guarded, position)?;
    app_menu.remove_at(position + 1)?;
    app.on_menu_event(|app, event| {
        if event.id() == QUIT_MENU_ID && !hold(app, ExitIntent::Quit) {
            app.exit(0);
        }
    });
    Ok(())
}

#[tauri::command]
pub(crate) async fn respond_manual_transaction_exit(
    app: AppHandle,
    state: State<'_, AppState>,
    response: ExitPromptResponse,
) -> AppResult<()> {
    let runtime = state.services.queries.manual_transactions();
    match response {
        ExitPromptResponse::Shown => runtime.exit_prompt_shown(),
        ExitPromptResponse::Cancelled => runtime.exit_cancelled(),
        ExitPromptResponse::Confirmed => match runtime.confirm_exit().await {
            ExitIntent::CloseWindow => {
                let closed = app
                    .get_webview_window(MAIN_WINDOW)
                    .is_some_and(|window| window.close().is_ok());
                if !closed {
                    app.exit(0);
                }
            }
            ExitIntent::Quit => app.exit(0),
        },
    }
    Ok(())
}
