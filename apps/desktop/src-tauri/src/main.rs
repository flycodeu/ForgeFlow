#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use std::{io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, Command, Stdio}, sync::{Arc, Mutex}};
use tauri::{Manager, menu::{Menu, MenuItem}, tray::{TrayIconBuilder, TrayIconEvent, MouseButton}, WebviewUrl, WebviewWindowBuilder};

struct Runtime(Mutex<Option<Child>>);
mod storage;

#[derive(Default)]
struct TrustedOrigin(Option<String>);

impl TrustedOrigin {
    // Called only for readiness received from the private bridge, after its identity handshake.
    fn authenticated_ready(&mut self, value: &str) -> Option<tauri::Url> {
        let url = tauri::Url::parse(value).ok()?;
        if url.scheme() != "http" || url.host_str() != Some("127.0.0.1")
            || url.port().is_none() || !url.username().is_empty() || url.password().is_some() {
            return None;
        }
        self.0 = Some(url.origin().ascii_serialization());
        Some(url)
    }

    fn allows(&self, url: &tauri::Url) -> bool {
        self.0.as_deref() == Some(url.origin().ascii_serialization().as_str())
    }
}

fn node_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") { PathBuf::from(format!(r"\\{}", rest)) }
    else if let Some(rest) = text.strip_prefix(r"\\?\") { PathBuf::from(rest) }
    else { path }
}

fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        storage::show(app);
    }
}

fn stop(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<Runtime>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(b"{\"type\":\"shutdown\"}\n");
                }
                // The bridge owns and gracefully closes only its own server.
                let _ = child.wait();
            }
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_dialog::init())
        .manage(Runtime(Mutex::new(None)))
        .manage(storage::StorageState(Mutex::new(serde_json::json!({"info":null,"stage":null,"error":null,"busy":false,"ready":false}))))
        .invoke_handler(tauri::generate_handler![storage::storage_snapshot, storage::storage_apply, storage::storage_pick, storage::storage_close])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "打开主界面", true, None::<&str>)?;
            let status = MenuItem::with_id(app, "status", "本地服务启动中", false, None::<&str>)?;
            let data = MenuItem::with_id(app, "storage", "数据存储位置…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "停止后台并退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &data, &status, &quit])?;
            let mut pixels = vec![0u8; 32 * 32 * 4];
            for y in 0..32 { for x in 0..32 {
                let i = (y * 32 + x) * 4;
                let letter = (9..13).contains(&x) && (7..26).contains(&y)
                    || (9..24).contains(&x) && (7..11).contains(&y)
                    || (9..21).contains(&x) && (15..19).contains(&y);
                pixels[i..i+4].copy_from_slice(if letter { &[255,255,255,255] } else { &[45,103,86,255] });
            }}
            TrayIconBuilder::new().icon(tauri::image::Image::new_owned(pixels, 32, 32))
                .tooltip("ForgeFlow · 关闭窗口后仍在后台运行")
                .menu(&menu).show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show(app),
                    "storage" => { let _ = storage::send(app, serde_json::json!({"type":"storage-info"})); storage::show(app); },
                    "quit" => { let app = app.clone(); std::thread::spawn(move || { stop(&app); app.exit(0); }); },
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } = event { show(tray.app_handle()); }
                }).build(app)?;

            let resource = app.path().resource_dir()?;
            let root = node_path(std::env::var_os("FORGEFLOW_RUNTIME_ROOT").map(PathBuf::from)
                .unwrap_or_else(|| resource.join("runtime")));
            eprintln!("ForgeFlow runtime resources: {}", root.display());
            let node = root.join("node.exe");
            let bridge = root.join("scripts/desktop-service.mjs");
            if !node.is_file() || !bridge.is_file() { return Err("缺少桌面运行资源，请先运行桌面打包准备命令".into()); }
            let mut command = Command::new(node);
            command.arg(bridge).env("FORGEFLOW_RUNTIME_ROOT", &root)
                .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
            #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
            let mut child = command.spawn()?;
            let stdout = child.stdout.take().ok_or("本地服务启动管道不可用")?;
            *app.state::<Runtime>().0.lock().unwrap() = Some(child);
            let handle = app.handle().clone();
            let trusted_origin = Arc::new(Mutex::new(TrustedOrigin::default()));
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    let Ok(message) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
                    storage::message(&handle, &message);
                    match message["type"].as_str() {
                        Some("setup-required") => { let _ = status.set_text("请选择数据存储位置"); storage::show(&handle); }
                        Some("open-storage") => { let _ = storage::send(&handle, serde_json::json!({"type":"storage-info"})); storage::show(&handle); }
                        Some("storage-progress") => { let _ = status.set_text("数据目录处理中，请勿退出"); }
                        Some("storage-error") => { storage::show(&handle); let _ = status.set_text("存储操作未完成，请查看说明"); }
                        Some("ready") => {
                            let Some(url) = message["url"].as_str().and_then(|value| {
                                trusted_origin.lock().ok()?.authenticated_ready(value)
                            }) else { continue };
                            let _ = status.set_text("本地服务运行中");
                            if let Some(window) = handle.get_webview_window("main") { let _ = window.navigate(url); }
                            else {
                                let navigation_origin = Arc::clone(&trusted_origin);
                                let _ = WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(url))
                                    .title("ForgeFlow · 关闭窗口收至托盘")
                                    .inner_size(1180.0, 780.0).min_inner_size(640.0, 480.0)
                                    .on_navigation(move |url| navigation_origin.lock().map(|origin| origin.allows(url)).unwrap_or(false))
                                    .build();
                                if handle.get_webview_window("main").is_some() {
                                    if let Some(setup) = handle.get_webview_window("storage") { let _ = setup.destroy(); }
                                }
                            }
                        }
                        Some("error") => {
                            eprintln!("ForgeFlow service error: {}", message["reason"]);
                            let _ = status.set_text("本地服务异常，请退出后检查运行日志");
                            if handle.get_webview_window("main").is_none() {
                                let _ = WebviewWindowBuilder::new(&handle, "main", WebviewUrl::App("index.html".into()))
                                    .title("ForgeFlow · 本地服务启动失败").inner_size(680.0, 480.0).build();
                            }
                        }
                        _ => {}
                    }
                }
                let _ = status.set_text("本地服务已停止");
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" { api.prevent_close(); let _ = window.hide(); }
                else if window.label() == "storage" {
                    let busy = window.state::<storage::StorageState>().0.lock().map(|state| state["busy"] == true).unwrap_or(true);
                    if busy { api.prevent_close(); }
                    else if window.app_handle().get_webview_window("main").is_none() {
                        let app = window.app_handle().clone(); std::thread::spawn(move || { stop(&app); app.exit(0); });
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("ForgeFlow 桌面启动失败")
        .run(|app, event| { if let tauri::RunEvent::Exit = event { stop(app); } });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_extended_paths_are_node_compatible() {
        assert_eq!(node_path(PathBuf::from(r"\\?\D:\App\runtime")), PathBuf::from(r"D:\App\runtime"));
        assert_eq!(node_path(PathBuf::from(r"\\?\UNC\server\share")), PathBuf::from(r"\\server\share"));
        assert_eq!(node_path(PathBuf::from(r"D:\App\runtime")), PathBuf::from(r"D:\App\runtime"));
    }

    #[test]
    fn authenticated_restart_replaces_the_allowed_origin() {
        let mut origin = TrustedOrigin::default();
        let first = tauri::Url::parse("http://127.0.0.1:41001/").unwrap();
        let next = tauri::Url::parse("http://127.0.0.1:41002/").unwrap();
        assert!(!origin.allows(&first));
        origin.authenticated_ready(first.as_str()).unwrap();
        assert!(origin.allows(&first));
        assert!(!origin.allows(&next));
        origin.authenticated_ready(next.as_str()).unwrap();
        assert!(origin.allows(&next));
        assert!(!origin.allows(&first));
        assert!(origin.allows(&tauri::Url::parse("http://127.0.0.1:41002/?view=archive").unwrap()));
    }

    #[test]
    fn rejected_readiness_cannot_change_navigation_permissions() {
        let mut origin = TrustedOrigin::default();
        let valid = origin.authenticated_ready("http://127.0.0.1:41001/").unwrap();
        for input in ["https://example.com:41001/", "http://localhost:41001/", "file:///C:/file", "http://user@127.0.0.1:41002/"] {
            assert!(origin.authenticated_ready(input).is_none());
            assert!(origin.allows(&valid));
        }
        assert!(!origin.allows(&tauri::Url::parse("https://127.0.0.1:41001/").unwrap()));
    }
}
