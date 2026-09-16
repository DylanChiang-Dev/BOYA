mod agent_runtime;
mod auth;
mod provider;

use agent_runtime::AgentRuntimeState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(AgentRuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            auth::desktop_auth_login,
            auth::desktop_auth_get_account,
            auth::desktop_auth_logout,
            agent_runtime::agent_api_key_status,
            agent_runtime::agent_set_api_key,
            agent_runtime::agent_remove_api_key,
            agent_runtime::agent_get_provider_settings,
            agent_runtime::agent_save_provider_settings,
            agent_runtime::agent_save_workspace,
            agent_runtime::agent_fetch_provider_models,
            agent_runtime::agent_parse_ccswitch_import,
            agent_runtime::agent_snapshot,
            agent_runtime::agent_start,
            agent_runtime::agent_stop,
            agent_runtime::agent_prompt,
            agent_runtime::agent_abort,
            agent_runtime::agent_list_sessions,
            agent_runtime::agent_new_session,
            agent_runtime::agent_switch_session,
            agent_runtime::agent_rename_session,
            agent_runtime::agent_archive_session,
            agent_runtime::agent_get_messages,
            agent_runtime::agent_list_models,
            agent_runtime::agent_set_model,
            agent_runtime::agent_reply_approval,
            agent_runtime::agent_versions,
            agent_runtime::agent_pick_workspace,
        ])
        .build(tauri::generate_context!())
        .expect("error while building BOYA Desktop")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                agent_runtime::kill_runtime(&app.state::<AgentRuntimeState>());
            }
        });
}
