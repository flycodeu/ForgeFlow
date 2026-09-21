use std::{io::Write, sync::Mutex};
use serde_json::{json, Value};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use crate::Runtime;

pub struct StorageState(pub Mutex<Value>);

fn authorize(window: &WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "无法确认窗口来源")?;
    if window.label() != "storage" || !(url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")) {
        return Err("只能从本机存储设置窗口操作".into());
    }
    Ok(())
}

pub fn send(app: &tauri::AppHandle, message: Value) -> Result<(), String> {
    let runtime = app.state::<Runtime>();
    let mut guard = runtime.0.lock().map_err(|_| "后台忙，请稍后重试")?;
    let stdin = guard.as_mut().and_then(|child| child.stdin.as_mut()).ok_or("后台连接已关闭")?;
    writeln!(stdin, "{}", message).map_err(|_| "无法连接后台".to_string())
}

pub fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("storage") {
        let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus();
    } else {
        let _ = WebviewWindowBuilder::new(app, "storage", WebviewUrl::App("storage.html".into()))
            .title("ForgeFlow · 数据存储").inner_size(680.0, 630.0).min_inner_size(440.0, 420.0)
            .on_navigation(|url| url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost"))
            .build();
    }
}

pub fn message(app: &tauri::AppHandle, message: &Value) {
    let store = app.state::<StorageState>();
    if let Ok(mut state) = store.0.lock() {
        match message["type"].as_str() {
            Some("setup-required") => { state["info"] = message.clone(); state["ready"] = json!(false); state["busy"] = json!(false); }
            Some("storage-info") => { state["info"] = message.clone(); state["busy"] = json!(false); state["stage"] = Value::Null; }
            Some("storage-progress") => { state["stage"] = message["stage"].clone(); state["busy"] = json!(message["stage"] != "complete"); state["error"] = Value::Null; }
            Some("storage-error") => { state["error"] = message["message"].clone(); state["busy"] = json!(false); state["stage"] = Value::Null; }
            Some("ready") => { state["ready"] = json!(true); }
            _ => {}
        }
    };
}

#[tauri::command]
pub fn storage_snapshot(window: WebviewWindow, app: tauri::AppHandle) -> Result<Value, String> {
    authorize(&window)?;
    app.state::<StorageState>().0.lock().map(|value| value.clone()).map_err(|_| "无法读取状态".into())
}

#[tauri::command]
pub fn storage_apply(window: WebviewWindow, app: tauri::AppHandle, path: String, reuse_existing: bool) -> Result<(), String> {
    authorize(&window)?;
    if path.trim().is_empty() || path.len() > 2048 { return Err("请选择有效目录".into()); }
    let kind;
    {
        let store = app.state::<StorageState>();
        let mut state = store.0.lock().map_err(|_| "后台忙")?;
        if state["busy"] == true { return Err("正在处理，请稍候".into()); }
        if state["info"]["override"] == true { return Err("环境变量指定了数据目录，不能在此迁移".into()); }
        kind = if state["info"]["type"] == "setup-required" { "choose-storage" } else { "migrate-storage" };
        state["busy"] = json!(true); state["error"] = Value::Null; state["stage"] = json!("validating");
    }
    let result = send(&app, json!({"type":kind,"path":path,"reuseExisting":reuse_existing}));
    if result.is_err() { message(&app, &json!({"type":"storage-error","message":"后台连接已关闭，请退出后重试"})); }
    result
}

#[tauri::command]
pub async fn storage_pick(window: WebviewWindow, app: tauri::AppHandle) -> Result<Option<String>, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_title("选择 ForgeFlow 专用数据目录")
        .blocking_pick_folder().map(|path| path.to_string())).await.map_err(|_| "无法打开目录选择器".into())
}

#[tauri::command]
pub fn storage_close(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    authorize(&window)?;
    if app.state::<StorageState>().0.lock().map_err(|_| "后台忙")?["busy"] == true { return Err("迁移进行中，请等待结果".into()); }
    if app.get_webview_window("main").is_some() { crate::show(&app); window.destroy().map_err(|_| "无法关闭窗口".into()) }
    else { std::thread::spawn(move || { crate::stop(&app); app.exit(0); }); Ok(()) }
}
