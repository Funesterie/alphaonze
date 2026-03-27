use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const DESKTOP_CONFIG_JSON: &str = include_str!("../../desktop.config.json");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopConfig {
    app_name: String,
    shell_window: WindowConfig,
    chat_window: WindowConfig,
    runtime: RuntimeConfig,
    paths: PathConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowConfig {
    label: String,
    title: String,
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig {
    host: String,
    ui_url: String,
    service_ports: Vec<ServicePortConfig>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServicePortConfig {
    key: String,
    label: String,
    port: u16,
    required: bool,
    enable_env_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathConfig {
    repo_launcher_script: String,
    repo_launcher_config: String,
    repo_logs_dir: String,
    packaged_root: String,
    packaged_launcher_script: String,
    packaged_launcher_config: String,
    packaged_logs_dir: String,
}

#[derive(Debug, Clone)]
struct RuntimePaths {
    launcher_mode: String,
    launcher_script: PathBuf,
    launcher_config: PathBuf,
    logs_dir: PathBuf,
    skip_ui_build: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSnapshot {
    app_name: String,
    launcher_mode: String,
    ready: bool,
    ui_url: String,
    logs_dir: String,
    services: Vec<ServiceSnapshot>,
    message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceSnapshot {
    key: String,
    label: String,
    port: u16,
    enabled: bool,
    ready: bool,
    required: bool,
    state: String,
}

fn load_desktop_config() -> Result<DesktopConfig, String> {
    serde_json::from_str(DESKTOP_CONFIG_JSON)
        .map_err(|error| format!("Desktop config invalide: {error}"))
}

fn resolve_relative(base: &Path, value: &str) -> PathBuf {
    let candidate = PathBuf::from(value);
    if candidate.is_absolute() {
        candidate
    } else {
        base.join(candidate)
    }
}

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
}

fn copy_directory(source: &Path, target: &Path) -> Result<(), String> {
    if !source.exists() {
        return Err(format!("Ressource packagee introuvable: {}", source.display()));
    }

    if !target.exists() {
        fs::create_dir_all(target)
            .map_err(|error| format!("Impossible de creer {}: {error}", target.display()))?;
    }

    for entry in fs::read_dir(source)
        .map_err(|error| format!("Impossible de lire {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("Lecture d'entree impossible: {error}"))?;
        let entry_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Type de fichier indisponible: {error}"))?;

        if file_type.is_dir() {
            copy_directory(&entry_path, &target_path)?;
        } else {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("Impossible de creer {}: {error}", parent.display())
                })?;
            }
            fs::copy(&entry_path, &target_path).map_err(|error| {
                format!(
                    "Impossible de copier {} vers {}: {error}",
                    entry_path.display(),
                    target_path.display()
                )
            })?;
        }
    }

    Ok(())
}

fn should_refresh_runtime_copy(source_root: &Path, target_root: &Path) -> bool {
    let source_plan = source_root.join("PACKAGE_LAYOUT_PLAN.md");
    let target_plan = target_root.join("PACKAGE_LAYOUT_PLAN.md");

    if !target_root.exists() || !target_plan.exists() {
        return true;
    }

    let Ok(source_meta) = fs::metadata(source_plan) else {
        return false;
    };
    let Ok(target_meta) = fs::metadata(target_plan) else {
        return true;
    };
    let Ok(source_modified) = source_meta.modified() else {
        return false;
    };
    let Ok(target_modified) = target_meta.modified() else {
        return true;
    };

    source_modified > target_modified
}

fn resolve_release_source_root(app: &AppHandle, config: &DesktopConfig) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_root = resource_dir.join(&config.paths.packaged_root);
        if bundled_root.exists() {
            return Some(bundled_root);
        }
    }

    let project_resources = project_root()
        .join("resources")
        .join(&config.paths.packaged_root);
    if project_resources.exists() {
        return Some(project_resources);
    }

    None
}

fn ensure_packaged_runtime(
    app: &AppHandle,
    config: &DesktopConfig,
    source_root: &Path,
) -> Result<PathBuf, String> {
    let local_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("App local data dir introuvable: {error}"))?;
    let writable_root = local_data_dir.join(&config.paths.packaged_root);
    let writable_launcher = writable_root.join(&config.paths.packaged_launcher_script);

    if should_refresh_runtime_copy(source_root, &writable_root) || !writable_launcher.exists() {
        if writable_root.exists() {
            fs::remove_dir_all(&writable_root).map_err(|error| {
                format!(
                    "Impossible de reinitialiser la copie runtime {}: {error}",
                    writable_root.display()
                )
            })?;
        }
        copy_directory(source_root, &writable_root)?;
    }

    Ok(writable_root)
}

fn resolve_runtime_paths(app: &AppHandle, config: &DesktopConfig) -> Result<RuntimePaths, String> {
    if cfg!(debug_assertions) {
        let root = project_root();
        let launcher_script = resolve_relative(&root, &config.paths.repo_launcher_script);
        let launcher_config = resolve_relative(&root, &config.paths.repo_launcher_config);
        let logs_dir = resolve_relative(&root, &config.paths.repo_logs_dir);
        return Ok(RuntimePaths {
            launcher_mode: "repo".to_string(),
            launcher_script,
            launcher_config,
            logs_dir,
            skip_ui_build: false,
        });
    }

    if let Some(source_root) = resolve_release_source_root(app, config) {
        let packaged_root = ensure_packaged_runtime(app, config, &source_root)?;
        return Ok(RuntimePaths {
            launcher_mode: "packaged".to_string(),
            launcher_script: packaged_root.join(&config.paths.packaged_launcher_script),
            launcher_config: packaged_root.join(&config.paths.packaged_launcher_config),
            logs_dir: packaged_root.join(&config.paths.packaged_logs_dir),
            skip_ui_build: true,
        });
    }

    let root = project_root();
    let launcher_script = resolve_relative(&root, &config.paths.repo_launcher_script);
    let launcher_config = resolve_relative(&root, &config.paths.repo_launcher_config);
    let logs_dir = resolve_relative(&root, &config.paths.repo_logs_dir);
    if launcher_script.exists() && launcher_config.exists() {
        return Ok(RuntimePaths {
            launcher_mode: "repo-fallback".to_string(),
            launcher_script,
            launcher_config,
            logs_dir,
            skip_ui_build: false,
        });
    }

    Err(format!(
        "Ressource packagee introuvable: {}",
        project_root()
            .join("resources")
            .join(&config.paths.packaged_root)
            .display()
    ))
}

fn parse_launcher_env(path: &Path) -> HashMap<String, String> {
    let mut values = HashMap::new();

    let Ok(content) = fs::read_to_string(path) else {
        return values;
    };

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some(separator) = line.find('=') else {
            continue;
        };
        let key = line[..separator].trim().to_string();
        let mut value = line[separator + 1..].trim().to_string();
        let quoted =
            (value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\''));
        if quoted && value.len() >= 2 {
            value = value[1..value.len() - 1].to_string();
        }
        values.insert(key, value);
    }

    values
}

fn env_flag(values: &HashMap<String, String>, key: &str, default: bool) -> bool {
    values
        .get(key)
        .map(|value| match value.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => true,
            "0" | "false" | "no" | "off" => false,
            _ => default,
        })
        .unwrap_or(default)
}

fn is_port_ready(host: &str, port: u16) -> bool {
    let endpoint = format!("{host}:{port}");
    let Ok(addresses) = endpoint.to_socket_addrs() else {
        return false;
    };

    addresses.into_iter().any(|address| {
        TcpStream::connect_timeout(&address, Duration::from_millis(350)).is_ok()
    })
}

fn build_runtime_snapshot(
    app: &AppHandle,
    message: Option<String>,
) -> Result<RuntimeSnapshot, String> {
    let config = load_desktop_config()?;
    let runtime_paths = resolve_runtime_paths(app, &config)?;
    let flags = parse_launcher_env(&runtime_paths.launcher_config);

    let services = config
        .runtime
        .service_ports
        .iter()
        .map(|service| {
            let enabled = env_flag(&flags, &service.enable_env_key, true);
            let ready = is_port_ready(&config.runtime.host, service.port);
            let state = if !enabled && ready {
                "external"
            } else if !enabled {
                "disabled"
            } else if ready {
                "ready"
            } else {
                "offline"
            };

            ServiceSnapshot {
                key: service.key.clone(),
                label: service.label.clone(),
                port: service.port,
                enabled,
                ready,
                required: service.required,
                state: state.to_string(),
            }
        })
        .collect::<Vec<_>>();

    let ready = services
        .iter()
        .filter(|service| service.required && service.enabled)
        .all(|service| service.ready);

    Ok(RuntimeSnapshot {
        app_name: config.app_name,
        launcher_mode: runtime_paths.launcher_mode,
        ready,
        ui_url: config.runtime.ui_url,
        logs_dir: runtime_paths.logs_dir.display().to_string(),
        services,
        message,
    })
}

fn run_launcher_command(
    runtime_paths: &RuntimePaths,
    command_name: &str,
    extra_args: &[&str],
) -> Result<String, String> {
    if !runtime_paths.launcher_script.exists() {
        return Err(format!(
            "Launcher introuvable: {}",
            runtime_paths.launcher_script.display()
        ));
    }
    if !runtime_paths.launcher_config.exists() {
        return Err(format!(
            "Config launcher introuvable: {}",
            runtime_paths.launcher_config.display()
        ));
    }

    let mut command = Command::new("powershell.exe");
    command.arg("-NoProfile");
    command.arg("-ExecutionPolicy");
    command.arg("Bypass");
    command.arg("-File");
    command.arg(&runtime_paths.launcher_script);
    command.arg(command_name);
    command.arg("-ConfigPath");
    command.arg(&runtime_paths.launcher_config);

    for arg in extra_args {
        command.arg(arg);
    }

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command
        .output()
        .map_err(|error| format!("Impossible d'executer le launcher: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        if !stderr.is_empty() {
            Ok(format!("{stdout}\n{stderr}").trim().to_string())
        } else {
            Ok(stdout)
        }
    } else {
        let details = format!("{stdout}\n{stderr}").trim().to_string();
        Err(if details.is_empty() {
            format!("Le launcher a echoue avec le code {:?}", output.status.code())
        } else {
            details
        })
    }
}

fn stop_stack_best_effort(app: &AppHandle) -> Result<(), String> {
    let config = load_desktop_config()?;
    let runtime_paths = resolve_runtime_paths(app, &config)?;
    run_launcher_command(&runtime_paths, "stop", &[]).map(|_| ())
}

#[tauri::command]
async fn get_runtime_snapshot(app: AppHandle) -> Result<RuntimeSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || build_runtime_snapshot(&app, None))
        .await
        .map_err(|error| format!("Lecture runtime impossible: {error}"))?
}

#[tauri::command]
async fn start_stack(app: AppHandle) -> Result<RuntimeSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = load_desktop_config()?;
        let runtime_paths = resolve_runtime_paths(&app, &config)?;
        let mut extra_args = vec!["-NoPause", "-NoOpen"];
        if runtime_paths.skip_ui_build {
            extra_args.push("-SkipUiBuild");
        }
        let message = run_launcher_command(&runtime_paths, "start", &extra_args)?;
        build_runtime_snapshot(&app, Some(message))
    })
    .await
    .map_err(|error| format!("Demarrage impossible: {error}"))?
}

#[tauri::command]
async fn stop_stack(app: AppHandle) -> Result<RuntimeSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = load_desktop_config()?;
        let runtime_paths = resolve_runtime_paths(&app, &config)?;
        let message = run_launcher_command(&runtime_paths, "stop", &[])?;
        build_runtime_snapshot(&app, Some(message))
    })
    .await
    .map_err(|error| format!("Arret impossible: {error}"))?
}

#[tauri::command]
fn open_logs_directory(app: AppHandle) -> Result<(), String> {
    let config = load_desktop_config()?;
    let runtime_paths = resolve_runtime_paths(&app, &config)?;

    if !runtime_paths.logs_dir.exists() {
        fs::create_dir_all(&runtime_paths.logs_dir).map_err(|error| {
            format!(
                "Impossible de creer le dossier de logs {}: {error}",
                runtime_paths.logs_dir.display()
            )
        })?;
    }

    let mut command = Command::new("explorer.exe");
    command.arg(&runtime_paths.logs_dir);

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .spawn()
        .map_err(|error| format!("Impossible d'ouvrir les logs: {error}"))?;
    Ok(())
}

#[tauri::command]
fn open_chat_window(app: AppHandle) -> Result<(), String> {
    let config = load_desktop_config()?;
    let snapshot = build_runtime_snapshot(&app, None)?;

    if !snapshot.ready {
        return Err("A11 local n'est pas encore pret.".to_string());
    }

    if let Some(window) = app.get_webview_window(&config.chat_window.label) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    let target_url =
        Url::parse(&snapshot.ui_url).map_err(|error| format!("URL locale invalide: {error}"))?;

    WebviewWindowBuilder::new(&app, &config.chat_window.label, WebviewUrl::External(target_url))
        .title(&config.chat_window.title)
        .inner_size(config.chat_window.width, config.chat_window.height)
        .min_inner_size(config.chat_window.min_width, config.chat_window.min_height)
        .center()
        .build()
        .map_err(|error| format!("Impossible d'ouvrir la fenetre A11: {error}"))?;

    Ok(())
}

#[tauri::command]
fn close_shell_window(app: AppHandle) -> Result<(), String> {
    let config = load_desktop_config()?;
    if let Some(window) = app.get_webview_window(&config.shell_window.label) {
        window
            .close()
            .map_err(|error| format!("Impossible de fermer le shell: {error}"))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_runtime_snapshot,
            start_stack,
            stop_stack,
            open_logs_directory,
            open_chat_window,
            close_shell_window
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let _ = stop_stack_best_effort(app);
            }
        });
}
