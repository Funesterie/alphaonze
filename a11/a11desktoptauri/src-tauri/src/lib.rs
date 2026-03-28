use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const LAUNCHER_TIMEOUT_SEC: u64 = 300;

const DESKTOP_CONFIG_JSON: &str = include_str!("../../desktop.config.json");
const STATUS_LAUNCHER_TIMEOUT_SEC: u64 = 8;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopConfig {
    app_name: String,
    shell_window: WindowConfig,
    chat_window: WindowConfig,
    runtime: RuntimeConfig,
    installer_lite: InstallerLiteConfig,
    model_catalog: Vec<LocalModelConfig>,
    remote_providers: Vec<RemoteProviderConfig>,
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
struct InstallerLiteConfig {
    enabled: bool,
    default_model_id: Option<String>,
    default_model_file_name: String,
    default_model_url: Option<String>,
    download_timeout_sec: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalModelConfig {
    id: String,
    label: String,
    file_name: String,
    download_url: Option<String>,
    size_hint: Option<String>,
    description: Option<String>,
    recommended: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteProviderConfig {
    id: String,
    label: String,
    base_url: Option<String>,
    default_model: Option<String>,
    description: Option<String>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSnapshot {
    app_name: String,
    launcher_mode: String,
    ready: bool,
    ui_url: String,
    logs_dir: String,
    services: Vec<ServiceSnapshot>,
    model_setup: ModelSetupSnapshot,
    local_models: Vec<LocalModelSnapshot>,
    remote_providers: Vec<RemoteProviderSnapshot>,
    remote_setup: RemoteSetupSnapshot,
    operation: Option<RuntimeOperationSnapshot>,
    progress: Option<RuntimeProgressSnapshot>,
    message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherStatusSnapshot {
    ui_url: Option<String>,
    ui_ready: Option<bool>,
    services: Option<Vec<LauncherServiceSnapshot>>,
    operation: Option<LauncherOperationSnapshot>,
    progress: Option<LauncherProgressSnapshot>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherServiceSnapshot {
    key: String,
    state: Option<String>,
    enabled: Option<bool>,
    ready: Option<bool>,
    required: Option<bool>,
    port: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherOperationSnapshot {
    active: Option<bool>,
    command: Option<String>,
    pid: Option<u32>,
    started_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherProgressSnapshot {
    active: Option<bool>,
    phase: Option<String>,
    message: Option<String>,
    service_key: Option<String>,
    service_label: Option<String>,
    updated_at: Option<String>,
    pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelSetupSnapshot {
    installer_lite: bool,
    model_required: bool,
    model_exists: bool,
    model_enabled: bool,
    selected_model_id: String,
    model_path: String,
    model_file_name: String,
    models_directory: String,
    download_configured: bool,
    default_model_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalModelSnapshot {
    id: String,
    label: String,
    file_name: String,
    download_configured: bool,
    size_hint: Option<String>,
    description: Option<String>,
    recommended: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteProviderSnapshot {
    id: String,
    label: String,
    base_url: String,
    default_model: String,
    description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteSetupSnapshot {
    mode: String,
    provider_id: String,
    provider_label: String,
    base_url: String,
    model: String,
    api_key_present: bool,
    configured: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeOperationSnapshot {
    active: bool,
    command: String,
    pid: Option<u32>,
    started_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeProgressSnapshot {
    active: bool,
    phase: String,
    message: String,
    service_key: Option<String>,
    service_label: Option<String>,
    updated_at: Option<String>,
    pid: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteProviderFormInput {
    provider_id: String,
    base_url: String,
    model: String,
    api_key: String,
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

fn current_exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
}

fn is_sharing_violation(error: &io::Error) -> bool {
    matches!(error.raw_os_error(), Some(32) | Some(33))
}

fn copy_file_with_retries(source: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Impossible de creer {}: {error}", parent.display()))?;
    }

    let mut last_error: Option<io::Error> = None;
    for attempt in 0..4 {
        match fs::copy(source, target) {
            Ok(_) => return Ok(()),
            Err(error) => {
                let retryable = is_sharing_violation(&error) || error.kind() == io::ErrorKind::PermissionDenied;
                last_error = Some(error);
                if retryable && attempt < 3 {
                    thread::sleep(Duration::from_millis(250));
                    continue;
                }
                break;
            }
        }
    }

    let error = last_error.unwrap_or_else(|| io::Error::other("copie fichier impossible"));
    Err(format!(
        "Impossible de copier {} vers {}: {}",
        source.display(),
        target.display(),
        error
    ))
}

fn is_mutable_runtime_path(relative_path: &Path) -> bool {
    let normalized = relative_path
        .components()
        .map(|component| component.as_os_str().to_string_lossy().replace('\\', "/"))
        .collect::<Vec<_>>()
        .join("/");

    normalized == "launcher/config/a11-local.env"
        || normalized == "launcher/config"
        || normalized == "launcher/models"
        || normalized.starts_with("launcher/models/")
        || normalized == "launcher/runtime"
        || normalized.starts_with("launcher/runtime/")
        || normalized == "qflush/.qflush"
        || normalized.starts_with("qflush/.qflush/")
}

fn sync_directory(source_root: &Path, source: &Path, target: &Path) -> Result<(), String> {
    if !source.exists() {
        return Err(format!("Ressource packagee introuvable: {}", source.display()));
    }

    fs::create_dir_all(target)
        .map_err(|error| format!("Impossible de creer {}: {error}", target.display()))?;

    for entry in fs::read_dir(source)
        .map_err(|error| format!("Impossible de lire {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("Lecture d'entree impossible: {error}"))?;
        let entry_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Type de fichier indisponible: {error}"))?;
        let relative_path = entry_path
            .strip_prefix(source_root)
            .unwrap_or(&entry_path);

        if file_type.is_dir() {
            if is_mutable_runtime_path(relative_path) && target_path.exists() {
                continue;
            }
            sync_directory(source_root, &entry_path, &target_path)?;
        } else {
            if is_mutable_runtime_path(relative_path) && target_path.exists() {
                continue;
            }

            match copy_file_with_retries(&entry_path, &target_path) {
                Ok(()) => {}
                Err(error) => {
                    let locked = fs::metadata(&target_path)
                        .ok()
                        .is_some()
                        && error.contains("utilisé par un autre processus");
                    if locked {
                        continue;
                    }
                    return Err(error);
                }
            }
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

    if let Some(exe_dir) = current_exe_dir() {
        let exe_candidates = [
            exe_dir.join("resources").join(&config.paths.packaged_root),
            exe_dir
                .join("_up_")
                .join("resources")
                .join(&config.paths.packaged_root),
            exe_dir.join(&config.paths.packaged_root),
        ];
        for candidate in exe_candidates {
            if candidate.exists() {
                return Some(candidate);
            }
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
        sync_directory(source_root, source_root, &writable_root)?;
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
        "Ressource packagee introuvable. Candidates testes: {}, {}, {}, {}",
        app.path()
            .resource_dir()
            .ok()
            .map(|dir| dir.join(&config.paths.packaged_root).display().to_string())
            .unwrap_or_else(|| "(resource_dir indisponible)".to_string()),
        current_exe_dir()
            .map(|dir| dir.join("resources").join(&config.paths.packaged_root).display().to_string())
            .unwrap_or_else(|| "(exe/resources indisponible)".to_string()),
        current_exe_dir()
            .map(|dir| dir.join("_up_").join("resources").join(&config.paths.packaged_root).display().to_string())
            .unwrap_or_else(|| "(exe/_up_/resources indisponible)".to_string()),
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

fn set_env_value(path: &Path, key: &str, value: &str) -> Result<(), String> {
    let content = fs::read_to_string(path).unwrap_or_default();
    let mut lines = content.lines().map(str::to_string).collect::<Vec<_>>();
    let prefix = format!("{key}=");
    let updated_line = format!("{prefix}{value}");

    if let Some(existing) = lines.iter_mut().find(|line| line.starts_with(&prefix)) {
        *existing = updated_line;
    } else {
        lines.push(updated_line);
    }

    let normalized = if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    };

    fs::write(path, normalized)
        .map_err(|error| format!("Impossible de mettre a jour {}: {error}", path.display()))
}

fn launcher_directory(runtime_paths: &RuntimePaths) -> Result<PathBuf, String> {
    runtime_paths
        .launcher_script
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            format!(
                "Dossier launcher introuvable pour {}",
                runtime_paths.launcher_script.display()
            )
        })
}

fn build_local_model_snapshots(config: &DesktopConfig) -> Vec<LocalModelSnapshot> {
    config
        .model_catalog
        .iter()
        .map(|entry| LocalModelSnapshot {
            id: entry.id.clone(),
            label: entry.label.clone(),
            file_name: entry.file_name.clone(),
            download_configured: entry
                .download_url
                .as_ref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false),
            size_hint: entry.size_hint.clone(),
            description: entry.description.clone(),
            recommended: entry.recommended.unwrap_or(false),
        })
        .collect()
}

fn build_remote_provider_snapshots(config: &DesktopConfig) -> Vec<RemoteProviderSnapshot> {
    config
        .remote_providers
        .iter()
        .map(|provider| RemoteProviderSnapshot {
            id: provider.id.clone(),
            label: provider.label.clone(),
            base_url: provider.base_url.clone().unwrap_or_default(),
            default_model: provider.default_model.clone().unwrap_or_default(),
            description: provider.description.clone(),
        })
        .collect()
}

fn default_local_model_id(config: &DesktopConfig) -> String {
    if let Some(default_id) = config
        .installer_lite
        .default_model_id
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return default_id.clone();
    }

    if let Some(recommended) = config
        .model_catalog
        .iter()
        .find(|entry| entry.recommended.unwrap_or(false))
    {
        return recommended.id.clone();
    }

    config
        .model_catalog
        .first()
        .map(|entry| entry.id.clone())
        .unwrap_or_else(|| "default".to_string())
}

fn find_local_model_config<'a>(
    config: &'a DesktopConfig,
    model_id: &str,
) -> Option<&'a LocalModelConfig> {
    config
        .model_catalog
        .iter()
        .find(|entry| entry.id.eq_ignore_ascii_case(model_id))
}

fn find_remote_provider_config<'a>(
    config: &'a DesktopConfig,
    provider_id: &str,
) -> Option<&'a RemoteProviderConfig> {
    config
        .remote_providers
        .iter()
        .find(|entry| entry.id.eq_ignore_ascii_case(provider_id))
}

fn resolve_remote_setup_from_flags(
    config: &DesktopConfig,
    flags: &HashMap<String, String>,
) -> RemoteSetupSnapshot {
    let mode = flags
        .get("A11_CHAT_PROVIDER_MODE")
        .cloned()
        .unwrap_or_else(|| "local".to_string())
        .trim()
        .to_ascii_lowercase();
    let provider_id = flags
        .get("A11_REMOTE_PROVIDER_ID")
        .cloned()
        .unwrap_or_default()
        .trim()
        .to_string();
    let base_url = flags
        .get("OPENAI_BASE_URL")
        .cloned()
        .unwrap_or_default()
        .trim()
        .to_string();
    let model = flags
        .get("OPENAI_MODEL")
        .or_else(|| flags.get("A11_OPENAI_MODEL"))
        .cloned()
        .unwrap_or_default()
        .trim()
        .to_string();
    let api_key_present = flags
        .get("OPENAI_API_KEY")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let provider_label = find_remote_provider_config(config, &provider_id)
        .map(|provider| provider.label.clone())
        .unwrap_or_else(|| provider_id.clone());
    let configured = mode == "remote" && !base_url.is_empty() && api_key_present;

    RemoteSetupSnapshot {
        mode,
        provider_id,
        provider_label,
        base_url,
        model,
        api_key_present,
        configured,
    }
}

fn resolve_model_setup_from_flags(
    config: &DesktopConfig,
    runtime_paths: &RuntimePaths,
    flags: &HashMap<String, String>,
) -> Result<ModelSetupSnapshot, String> {
    let launcher_dir = launcher_directory(runtime_paths)?;
    let selected_model_id = flags
        .get("A11_LLM_MODEL_CATALOG_ID")
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_local_model_id(config));
    let selected_model = find_local_model_config(config, &selected_model_id);
    let configured_model = flags
        .get("A11_LLM_MODEL")
        .cloned()
        .unwrap_or_else(|| {
            selected_model
                .map(|model| format!("models\\{}", model.file_name))
                .unwrap_or_else(|| format!("models\\{}", config.installer_lite.default_model_file_name))
        });
    let model_path = resolve_relative(&launcher_dir, &configured_model);
    let model_file_name = selected_model
        .map(|model| model.file_name.clone())
        .or_else(|| {
            model_path
                .file_name()
                .and_then(|name| name.to_str())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| config.installer_lite.default_model_file_name.clone());
    let models_directory = model_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| launcher_dir.join("models"));
    let installer_lite = flags
        .get("A11_INSTALLER_LITE")
        .map(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(config.installer_lite.enabled && runtime_paths.launcher_mode != "repo");
    let model_enabled = flags
        .get("A11_ENABLE_LLM")
        .map(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(true);
    let default_model_url = flags
        .get("A11_LLM_MODEL_URL")
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            selected_model
                .and_then(|entry| entry.download_url.clone())
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| {
            config
                .installer_lite
                .default_model_url
                .clone()
                .filter(|value| !value.trim().is_empty())
        });
    let model_exists = model_path.exists();

    Ok(ModelSetupSnapshot {
        installer_lite,
        model_required: installer_lite && !model_exists,
        model_exists,
        model_enabled,
        selected_model_id,
        model_path: model_path.display().to_string(),
        model_file_name,
        models_directory: models_directory.display().to_string(),
        download_configured: default_model_url.is_some(),
        default_model_url,
    })
}

fn resolve_model_setup(
    config: &DesktopConfig,
    runtime_paths: &RuntimePaths,
) -> Result<ModelSetupSnapshot, String> {
    let flags = parse_launcher_env(&runtime_paths.launcher_config);
    resolve_model_setup_from_flags(config, runtime_paths, &flags)
}

fn prepare_model_slot(
    config: &DesktopConfig,
    runtime_paths: &RuntimePaths,
    preferred_file_name: Option<&str>,
) -> Result<(ModelSetupSnapshot, PathBuf), String> {
    let launcher_dir = launcher_directory(runtime_paths)?;
    let current = resolve_model_setup(config, runtime_paths)?;
    let model_file_name = preferred_file_name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&current.model_file_name);
    let model_relative = format!("models\\{model_file_name}");
    let model_path = resolve_relative(&launcher_dir, &model_relative);
    if let Some(parent) = model_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Impossible de creer {}: {error}", parent.display()))?;
    }
    set_env_value(&runtime_paths.launcher_config, "A11_LLM_MODEL", &model_relative)?;
    set_env_value(&runtime_paths.launcher_config, "A11_ENABLE_LLM", "1")?;
    set_env_value(&runtime_paths.launcher_config, "A11_INSTALLER_LITE", "1")?;
    let updated = resolve_model_setup(config, runtime_paths)?;
    Ok((updated, model_path))
}

fn apply_local_model_profile(
    config: &DesktopConfig,
    runtime_paths: &RuntimePaths,
    model_id: &str,
) -> Result<ModelSetupSnapshot, String> {
    let model = find_local_model_config(config, model_id)
        .ok_or_else(|| format!("Profil local inconnu: {model_id}"))?;
    let launcher_dir = launcher_directory(runtime_paths)?;
    let model_relative = format!("models\\{}", model.file_name);
    let model_path = resolve_relative(&launcher_dir, &model_relative);
    if let Some(parent) = model_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Impossible de creer {}: {error}", parent.display()))?;
    }

    set_env_value(&runtime_paths.launcher_config, "A11_LLM_MODEL_CATALOG_ID", &model.id)?;
    set_env_value(&runtime_paths.launcher_config, "A11_LLM_MODEL", &model_relative)?;
    set_env_value(
        &runtime_paths.launcher_config,
        "A11_LLM_MODEL_URL",
        model.download_url.as_deref().unwrap_or(""),
    )?;
    set_env_value(&runtime_paths.launcher_config, "A11_CHAT_PROVIDER_MODE", "local")?;
    set_env_value(&runtime_paths.launcher_config, "A11_ENABLE_LLM", "1")?;
    set_env_value(&runtime_paths.launcher_config, "A11_ENABLE_QFLUSH", "1")?;
    set_env_value(&runtime_paths.launcher_config, "A11_INSTALLER_LITE", "1")?;

    resolve_model_setup(config, runtime_paths)
}

fn apply_remote_provider_config(
    runtime_paths: &RuntimePaths,
    provider_id: &str,
    base_url: &str,
    model: &str,
    api_key: &str,
) -> Result<(), String> {
    set_env_value(&runtime_paths.launcher_config, "A11_CHAT_PROVIDER_MODE", "remote")?;
    set_env_value(&runtime_paths.launcher_config, "A11_REMOTE_PROVIDER_ID", provider_id)?;
    set_env_value(&runtime_paths.launcher_config, "OPENAI_BASE_URL", base_url)?;
    set_env_value(&runtime_paths.launcher_config, "OPENAI_MODEL", model)?;
    set_env_value(&runtime_paths.launcher_config, "OPENAI_API_KEY", api_key)?;
    set_env_value(&runtime_paths.launcher_config, "A11_ENABLE_LLM", "0")?;
    set_env_value(&runtime_paths.launcher_config, "A11_ENABLE_QFLUSH", "1")?;
    set_env_value(&runtime_paths.launcher_config, "A11_INSTALLER_LITE", "0")?;
    Ok(())
}

fn reset_remote_provider_config(runtime_paths: &RuntimePaths) -> Result<(), String> {
    set_env_value(&runtime_paths.launcher_config, "A11_CHAT_PROVIDER_MODE", "local")?;
    set_env_value(&runtime_paths.launcher_config, "A11_REMOTE_PROVIDER_ID", "")?;
    set_env_value(&runtime_paths.launcher_config, "OPENAI_BASE_URL", "")?;
    set_env_value(&runtime_paths.launcher_config, "OPENAI_MODEL", "")?;
    set_env_value(&runtime_paths.launcher_config, "OPENAI_API_KEY", "")?;
    set_env_value(&runtime_paths.launcher_config, "A11_ENABLE_LLM", "1")?;
    set_env_value(&runtime_paths.launcher_config, "A11_ENABLE_QFLUSH", "1")?;
    set_env_value(&runtime_paths.launcher_config, "A11_INSTALLER_LITE", "1")?;
    Ok(())
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

fn service_port(config: &DesktopConfig, key: &str) -> Option<u16> {
    config
        .runtime
        .service_ports
        .iter()
        .find(|service| service.key == key)
        .map(|service| service.port)
}

fn is_http_url_ready(url: &str) -> bool {
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };

    match client.get(url).send() {
        Ok(response) => response.status().is_success() || response.status().is_redirection(),
        Err(_) => false,
    }
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

fn run_launcher_json_command<T: for<'de> Deserialize<'de>>(
    runtime_paths: &RuntimePaths,
    command_name: &str,
    extra_args: &[&str],
) -> Result<T, String> {
    let output = run_launcher_command_with_timeout(
        runtime_paths,
        command_name,
        extra_args,
        STATUS_LAUNCHER_TIMEOUT_SEC,
    )?;
    serde_json::from_str::<T>(output.trim()).map_err(|error| {
        format!(
            "Reponse JSON invalide du launcher pour '{command_name}': {error}. Sortie: {}",
            output.trim()
        )
    })
}

fn launcher_snapshot_cache_path(runtime_paths: &RuntimePaths) -> Option<PathBuf> {
    runtime_paths
        .logs_dir
        .parent()
        .map(|runtime_dir| runtime_dir.join("a11-local.snapshot.json"))
}

fn read_cached_launcher_snapshot(runtime_paths: &RuntimePaths) -> Option<LauncherStatusSnapshot> {
    let cache_path = launcher_snapshot_cache_path(runtime_paths)?;
    let raw = fs::read_to_string(cache_path).ok()?;
    serde_json::from_str::<LauncherStatusSnapshot>(&raw).ok()
}

fn ensure_model_target_can_be_updated(config: &DesktopConfig, target_path: &Path) -> Result<(), String> {
    let Some(llm_port) = service_port(config, "llm") else {
        return Ok(());
    };

    if target_path.exists() && is_port_ready(&config.runtime.host, llm_port) {
        return Err(format!(
            "Le LLM local tourne deja sur le port {} et utilise encore ce slot. Arrete ou relance A11 avant de remplacer ce modele.",
            llm_port
        ));
    }

    Ok(())
}

fn build_runtime_snapshot(
    app: &AppHandle,
    message: Option<String>,
) -> Result<RuntimeSnapshot, String> {
    let config = load_desktop_config()?;
    let runtime_paths = resolve_runtime_paths(app, &config)?;
    let flags = parse_launcher_env(&runtime_paths.launcher_config);
    let launcher_status =
        run_launcher_json_command::<LauncherStatusSnapshot>(&runtime_paths, "status-json", &["-NoPause"])
            .ok()
            .or_else(|| read_cached_launcher_snapshot(&runtime_paths));
    let model_setup = resolve_model_setup_from_flags(&config, &runtime_paths, &flags)?;
    let remote_setup = resolve_remote_setup_from_flags(&config, &flags);
    let local_models = build_local_model_snapshots(&config);
    let remote_providers = build_remote_provider_snapshots(&config);
    let operation = launcher_status
        .as_ref()
        .and_then(|status| status.operation.clone())
        .map(|entry| RuntimeOperationSnapshot {
            active: entry.active.unwrap_or(true),
            command: entry.command.unwrap_or_else(|| "start".to_string()),
            pid: entry.pid,
            started_at: entry.started_at,
        })
        .filter(|entry| entry.active);
    let progress = launcher_status
        .as_ref()
        .and_then(|status| status.progress.clone())
        .map(|entry| RuntimeProgressSnapshot {
            active: entry.active.unwrap_or(true),
            phase: entry.phase.unwrap_or_else(|| "pending".to_string()),
            message: entry.message.unwrap_or_else(|| "Le launcher local travaille encore.".to_string()),
            service_key: entry.service_key,
            service_label: entry.service_label,
            updated_at: entry.updated_at,
            pid: entry.pid,
        })
        .filter(|entry| entry.active);

    let services = config
        .runtime
        .service_ports
        .iter()
        .map(|service| {
            let launcher_service = launcher_status
                .as_ref()
                .and_then(|status| status.services.as_ref())
                .and_then(|items| items.iter().find(|entry| entry.key == service.key));

            let enabled = launcher_service
                .and_then(|entry| entry.enabled)
                .unwrap_or_else(|| env_flag(&flags, &service.enable_env_key, true));
            let ready = launcher_service
                .and_then(|entry| entry.ready)
                .unwrap_or_else(|| is_port_ready(&config.runtime.host, service.port));
            let state = launcher_service
                .and_then(|entry| entry.state.clone())
                .unwrap_or_else(|| {
                    if !enabled && ready {
                        "external".to_string()
                    } else if !enabled {
                        "disabled".to_string()
                    } else if ready {
                        "ready".to_string()
                    } else {
                        "offline".to_string()
                    }
                });
            let required = launcher_service
                .and_then(|entry| entry.required)
                .unwrap_or(service.required);
            let port = launcher_service
                .and_then(|entry| entry.port)
                .unwrap_or(service.port);

            ServiceSnapshot {
                key: service.key.clone(),
                label: service.label.clone(),
                port,
                enabled,
                ready,
                required,
                state,
            }
        })
        .collect::<Vec<_>>();

    let required_services_ready = services
        .iter()
        .filter(|service| service.required && service.enabled)
        .all(|service| service.ready);
    let ui_url = launcher_status
        .as_ref()
        .and_then(|status| status.ui_url.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| config.runtime.ui_url.clone());
    let ui_ready = launcher_status
        .as_ref()
        .and_then(|status| status.ui_ready)
        .unwrap_or_else(|| is_http_url_ready(&ui_url));
    let ready = required_services_ready
        && ui_ready
        && (!model_setup.installer_lite || (model_setup.model_exists && model_setup.model_enabled));

    let resolved_message = if let Some(progress_state) = progress.as_ref() {
        Some(progress_state.message.clone())
    } else if let Some(active_operation) = operation.as_ref() {
        if active_operation.command == "restart" {
            Some("Relance de la stack locale en cours...".to_string())
        } else if active_operation.command == "stop" {
            Some("Arret de la stack locale en cours...".to_string())
        } else {
            Some("Demarrage de la stack locale en cours...".to_string())
        }
    } else if ready || !model_setup.installer_lite || model_setup.model_exists {
        message.or_else(|| {
            if !ui_ready {
                Some("Les services repondent mais l'interface termine encore son chargement.".to_string())
            } else if !required_services_ready {
                Some("La stack locale demarre encore sur cette machine. Patiente quelques secondes.".to_string())
            } else {
                None
            }
        })
    } else {
        Some(format!(
            "Modele local requis avant le demarrage du LLM. Ajoute {} puis relance A11.",
            model_setup.model_file_name
        ))
    };

    Ok(RuntimeSnapshot {
        app_name: config.app_name,
        launcher_mode: runtime_paths.launcher_mode,
        ready,
        ui_url,
        logs_dir: runtime_paths.logs_dir.display().to_string(),
        services,
        model_setup,
        local_models,
        remote_providers,
        remote_setup,
        operation,
        progress,
        message: resolved_message,
    })
}

fn run_launcher_command_with_timeout(
    runtime_paths: &RuntimePaths,
    command_name: &str,
    extra_args: &[&str],
    timeout_sec: u64,
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

    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("Impossible d'executer le launcher: {error}"))?;

    let child_pid = child.id();
    let deadline = Instant::now() + Duration::from_secs(timeout_sec);

    loop {
        match child
            .try_wait()
            .map_err(|error| format!("Impossible de surveiller le launcher: {error}"))?
        {
            Some(_) => break,
            None => {
                if Instant::now() >= deadline {
                    #[cfg(target_os = "windows")]
                    {
                        let _ = Command::new("taskkill")
                            .args(["/PID", &child_pid.to_string(), "/T", "/F"])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output();
                    }
                    #[cfg(not(target_os = "windows"))]
                    {
                        let _ = child.kill();
                    }
                    let _ = child.wait();
                    return Err(format!(
                        "Le launcher a depasse le delai de {} secondes pendant '{command_name}'.",
                        timeout_sec
                    ));
                }
                thread::sleep(Duration::from_millis(250));
            }
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Impossible de recuperer la sortie du launcher: {error}"))?;

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

fn run_launcher_command(
    runtime_paths: &RuntimePaths,
    command_name: &str,
    extra_args: &[&str],
) -> Result<String, String> {
    run_launcher_command_with_timeout(
        runtime_paths,
        command_name,
        extra_args,
        LAUNCHER_TIMEOUT_SEC,
    )
}

fn spawn_launcher_command(
    runtime_paths: &RuntimePaths,
    command_name: &str,
    extra_args: &[&str],
) -> Result<(), String> {
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

    command.stdout(Stdio::null());
    command.stderr(Stdio::null());

    command
        .spawn()
        .map_err(|error| format!("Impossible de lancer le launcher en arriere-plan: {error}"))?;
    Ok(())
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
        let existing_snapshot = build_runtime_snapshot(&app, None)?;
        if existing_snapshot.ready {
            let mut snapshot = existing_snapshot.clone();
            snapshot.message = Some("A11 est deja pret. Le chat local peut s'ouvrir tout de suite.".to_string());
            return Ok(snapshot);
        }
        if existing_snapshot
            .operation
            .as_ref()
            .map(|operation| operation.active)
            .unwrap_or(false)
            || existing_snapshot
                .progress
                .as_ref()
                .map(|progress| progress.active)
                .unwrap_or(false)
        {
            let mut snapshot = existing_snapshot.clone();
            if snapshot.message.is_none() {
                snapshot.message = Some("Le launcher travaille deja sur le demarrage local.".to_string());
            }
            return Ok(snapshot);
        }

        let config = load_desktop_config()?;
        let runtime_paths = resolve_runtime_paths(&app, &config)?;
        let model_setup = resolve_model_setup(&config, &runtime_paths)?;
        if model_setup.installer_lite && (!model_setup.model_exists || !model_setup.model_enabled) {
            return build_runtime_snapshot(
                &app,
                Some(format!(
                    "Modele local requis avant le demarrage du LLM. Ajoute {} puis relance A11.",
                    model_setup.model_file_name
                )),
            );
        }
        let mut extra_args = vec!["-NoPause", "-NoOpen"];
        if runtime_paths.skip_ui_build {
            extra_args.push("-SkipUiBuild");
        }
        spawn_launcher_command(&runtime_paths, "start", &extra_args)?;
        build_runtime_snapshot(
            &app,
            Some("Demarrage de la stack locale en cours...".to_string()),
        )
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
async fn restart_stack(app: AppHandle) -> Result<RuntimeSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let existing_snapshot = build_runtime_snapshot(&app, None)?;
        if existing_snapshot
            .operation
            .as_ref()
            .map(|operation| operation.active)
            .unwrap_or(false)
            || existing_snapshot
                .progress
                .as_ref()
                .map(|progress| progress.active)
                .unwrap_or(false)
        {
            let mut snapshot = existing_snapshot.clone();
            if snapshot.message.is_none() {
                snapshot.message = Some("Le launcher travaille deja sur la stack locale.".to_string());
            }
            return Ok(snapshot);
        }

        let config = load_desktop_config()?;
        let runtime_paths = resolve_runtime_paths(&app, &config)?;
        let model_setup = resolve_model_setup(&config, &runtime_paths)?;
        if model_setup.installer_lite && (!model_setup.model_exists || !model_setup.model_enabled) {
            return build_runtime_snapshot(
                &app,
                Some(format!(
                    "Modele local requis avant le redemarrage du LLM. Ajoute {} puis relance A11.",
                    model_setup.model_file_name
                )),
            );
        }
        let mut extra_args = vec!["-NoPause", "-NoOpen"];
        if runtime_paths.skip_ui_build {
            extra_args.push("-SkipUiBuild");
        }
        spawn_launcher_command(&runtime_paths, "restart", &extra_args)?;
        build_runtime_snapshot(
            &app,
            Some("Relance de la stack locale en cours...".to_string()),
        )
    })
    .await
    .map_err(|error| format!("Relance impossible: {error}"))?
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
fn open_model_directory(app: AppHandle) -> Result<(), String> {
    let config = load_desktop_config()?;
    let runtime_paths = resolve_runtime_paths(&app, &config)?;
    let model_setup = resolve_model_setup(&config, &runtime_paths)?;
    let target_dir = PathBuf::from(&model_setup.models_directory);

    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|error| {
            format!(
                "Impossible de creer le dossier modele {}: {error}",
                target_dir.display()
            )
        })?;
    }

    let mut command = Command::new("explorer.exe");
    command.arg(&target_dir);

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .spawn()
        .map_err(|error| format!("Impossible d'ouvrir le dossier modele: {error}"))?;

    Ok(())
}

#[tauri::command]
async fn import_external_model(app: AppHandle) -> Result<RuntimeSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = load_desktop_config()?;
        let runtime_paths = resolve_runtime_paths(&app, &config)?;
        let source_path = rfd::FileDialog::new()
            .add_filter("GGUF", &["gguf"])
            .set_title("Choisir un modele GGUF pour A11")
            .pick_file()
            .ok_or_else(|| "Aucun modele GGUF selectionne.".to_string())?;
        let current_setup = resolve_model_setup(&config, &runtime_paths)?;
        let target_file_name = if current_setup.model_file_name.trim().is_empty() {
            source_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(&config.installer_lite.default_model_file_name)
                .to_string()
        } else {
            current_setup.model_file_name.clone()
        };
        let launcher_dir = launcher_directory(&runtime_paths)?;
        let prospective_target = resolve_relative(&launcher_dir, &format!("models\\{target_file_name}"));
        ensure_model_target_can_be_updated(&config, &prospective_target)?;
        let (_model_setup, target_path) =
            prepare_model_slot(&config, &runtime_paths, Some(&target_file_name))?;

        if source_path != target_path {
            fs::copy(&source_path, &target_path).map_err(|error| {
                format!(
                    "Impossible de copier {} vers {}: {error}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
        }

        build_runtime_snapshot(
            &app,
            Some(format!("Modele importe: {}", target_path.display())),
        )
    })
    .await
    .map_err(|error| format!("Import modele impossible: {error}"))?
}

#[tauri::command]
async fn download_default_model(app: AppHandle) -> Result<RuntimeSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = load_desktop_config()?;
        let runtime_paths = resolve_runtime_paths(&app, &config)?;
        let current_setup = resolve_model_setup(&config, &runtime_paths)?;
        let download_url = current_setup
            .default_model_url
            .clone()
            .ok_or_else(|| "Aucune URL de telechargement de modele n'est configuree pour cet installeur lite.".to_string())?;
        let timeout = config.installer_lite.download_timeout_sec.unwrap_or(14_400);
        ensure_model_target_can_be_updated(&config, Path::new(&current_setup.model_path))?;
        let (_updated_setup, target_path) = prepare_model_slot(
            &config,
            &runtime_paths,
            Some(&current_setup.model_file_name),
        )?;

        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(timeout))
            .build()
            .map_err(|error| format!("Client HTTP modele indisponible: {error}"))?;

        let mut response = client
            .get(&download_url)
            .send()
            .map_err(|error| format!("Telechargement modele impossible: {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Telechargement modele en echec: HTTP {}",
                response.status()
            ));
        }

        let temp_path = target_path.with_extension("gguf.part");
        if let Some(parent) = temp_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("Impossible de creer {}: {error}", parent.display())
            })?;
        }
        let mut output = fs::File::create(&temp_path)
            .map_err(|error| format!("Impossible de creer {}: {error}", temp_path.display()))?;
        io::copy(&mut response, &mut output)
            .map_err(|error| format!("Ecriture modele impossible: {error}"))?;
        fs::rename(&temp_path, &target_path).map_err(|error| {
            format!(
                "Impossible de finaliser le modele {}: {error}",
                target_path.display()
            )
        })?;

        build_runtime_snapshot(
            &app,
            Some(format!("Modele telecharge: {}", target_path.display())),
        )
    })
    .await
    .map_err(|error| format!("Installation modele impossible: {error}"))?
}

#[tauri::command]
async fn select_local_model_profile(
    app: AppHandle,
    model_id: String,
) -> Result<RuntimeSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = load_desktop_config()?;
        let runtime_paths = resolve_runtime_paths(&app, &config)?;
        let applied = apply_local_model_profile(&config, &runtime_paths, model_id.trim())?;
        build_runtime_snapshot(
            &app,
            Some(format!(
                "Profil local selectionne: {}",
                applied.model_file_name
            )),
        )
    })
    .await
    .map_err(|error| format!("Selection du profil local impossible: {error}"))?
}

#[tauri::command]
async fn save_remote_provider_config(
    app: AppHandle,
    input: RemoteProviderFormInput,
) -> Result<RuntimeSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = load_desktop_config()?;
        let runtime_paths = resolve_runtime_paths(&app, &config)?;
        let existing_flags = parse_launcher_env(&runtime_paths.launcher_config);
        let provider_id = input.provider_id.trim().to_string();
        let preset = find_remote_provider_config(&config, &provider_id);
        let base_url = if input.base_url.trim().is_empty() {
            preset
                .and_then(|entry| entry.base_url.clone())
                .unwrap_or_default()
        } else {
            input.base_url.trim().to_string()
        };
        let model = if input.model.trim().is_empty() {
            preset
                .and_then(|entry| entry.default_model.clone())
                .unwrap_or_default()
        } else {
            input.model.trim().to_string()
        };
        let api_key = if input.api_key.trim().is_empty() {
            existing_flags
                .get("OPENAI_API_KEY")
                .cloned()
                .unwrap_or_default()
                .trim()
                .to_string()
        } else {
            input.api_key.trim().to_string()
        };

        if base_url.trim().is_empty() {
            return Err("Base URL du fournisseur distant requise.".to_string());
        }
        if model.trim().is_empty() {
            return Err("Nom du modele distant requis.".to_string());
        }
        if api_key.trim().is_empty() {
            return Err("Cle API requise pour le fournisseur distant.".to_string());
        }

        apply_remote_provider_config(
            &runtime_paths,
            &provider_id,
            &base_url,
            &model,
            &api_key,
        )?;

        build_runtime_snapshot(
            &app,
            Some(format!(
                "Fournisseur distant configure: {}",
                preset
                    .map(|entry| entry.label.clone())
                    .unwrap_or_else(|| provider_id.clone())
            )),
        )
    })
    .await
    .map_err(|error| format!("Configuration du fournisseur distant impossible: {error}"))?
}

#[tauri::command]
async fn switch_back_to_local_llm(app: AppHandle) -> Result<RuntimeSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = load_desktop_config()?;
        let runtime_paths = resolve_runtime_paths(&app, &config)?;
        reset_remote_provider_config(&runtime_paths)?;
        let current_id = resolve_model_setup(&config, &runtime_paths)?.selected_model_id;
        let _ = apply_local_model_profile(&config, &runtime_paths, &current_id)?;
        build_runtime_snapshot(&app, Some("Retour au moteur local A11.".to_string()))
    })
    .await
    .map_err(|error| format!("Retour au moteur local impossible: {error}"))?
}

#[tauri::command]
fn open_chat_window(app: AppHandle) -> Result<(), String> {
    let config = load_desktop_config()?;
    let snapshot = build_runtime_snapshot(&app, None)?;

    if !snapshot.ready {
        return Err("A11 local n'est pas encore pret.".to_string());
    }

    let mut target_url =
        Url::parse(&snapshot.ui_url).map_err(|error| format!("URL locale invalide: {error}"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());
    target_url
        .query_pairs_mut()
        .append_pair("desktop", "1")
        .append_pair("ts", &timestamp);

    if let Some(window) = app.get_webview_window(&config.chat_window.label) {
        let _ = window.navigate(target_url.clone());
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

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
            .destroy()
            .map_err(|error| format!("Impossible de fermer le shell: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn quit_application(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_runtime_snapshot,
            start_stack,
            stop_stack,
            restart_stack,
            open_logs_directory,
            open_model_directory,
            import_external_model,
            download_default_model,
            select_local_model_profile,
            save_remote_provider_config,
            switch_back_to_local_llm,
            open_chat_window,
            close_shell_window,
            quit_application
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_, _| {});
}
