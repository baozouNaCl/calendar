// Chronicle Calendar desktop runtime entry.
// This file owns the Tauri shell wiring: it exposes lightweight desktop
// commands, loads the SQL plugin, and starts the application with the
// capabilities declared in tauri.conf.json.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const RELATIVE_DB_PATH: &str = "database/data/chronicle-calendar.db";
const MOUNT_CONFIG_FILE: &str = "database_mount.json";

#[derive(serde::Serialize, serde::Deserialize)]
struct DatabaseMountConfig {
    package_root: String,
}

#[derive(Serialize)]
struct DesktopHealth {
    ok: bool,
    runtime: &'static str,
    storage_plan: &'static str,
}

#[derive(Serialize)]
struct DatabaseMountStatus {
    configured: bool,
    package_root: Option<String>,
    app_db_path: String,
    active_db_url: String,
    note: String,
}

#[tauri::command]
fn desktop_health() -> DesktopHealth {
    DesktopHealth {
        ok: true,
        runtime: "tauri",
        storage_plan: "sqlite",
    }
}

#[tauri::command]
fn prepare_database_mount(app: AppHandle) -> Result<DatabaseMountStatus, String> {
    let app_db_path = resolve_app_db_path(&app)?;
    let active_db_url = format!("sqlite:{RELATIVE_DB_PATH}");
    if let Some(config) = read_mount_config(&app)? {
        ensure_external_mount(&app_db_path, &PathBuf::from(&config.package_root), true)?;
        return Ok(DatabaseMountStatus {
            configured: true,
            package_root: Some(config.package_root),
            app_db_path: app_db_path.display().to_string(),
            active_db_url,
            note: "当前已挂载外部 database package。".into(),
        });
    }

    ensure_parent_dir(&app_db_path)?;
    Ok(DatabaseMountStatus {
        configured: false,
        package_root: None,
        app_db_path: app_db_path.display().to_string(),
        active_db_url,
        note: "当前使用应用默认数据目录。".into(),
    })
}

#[tauri::command]
fn get_database_mount_status(app: AppHandle) -> Result<DatabaseMountStatus, String> {
    let app_db_path = resolve_app_db_path(&app)?;
    let active_db_url = format!("sqlite:{RELATIVE_DB_PATH}");
    let config = read_mount_config(&app)?;
    Ok(DatabaseMountStatus {
        configured: config.is_some(),
        package_root: config.map(|item| item.package_root),
        app_db_path: app_db_path.display().to_string(),
        active_db_url,
        note: if is_symlink(&app_db_path) {
            "当前数据库文件通过符号链接挂载到外部 package。".into()
        } else {
            "当前数据库文件位于应用默认数据目录。".into()
        },
    })
}

#[tauri::command]
fn configure_database_mount(app: AppHandle, package_root: String) -> Result<DatabaseMountStatus, String> {
    let trimmed = package_root.trim();
    if trimmed.is_empty() {
        return Err("请先填写 database package 的绝对路径。".into());
    }

    let package_root_path = PathBuf::from(trimmed);
    if !package_root_path.is_absolute() {
        return Err("当前只支持填写绝对路径。".into());
    }

    let app_db_path = resolve_app_db_path(&app)?;
    ensure_external_mount(&app_db_path, &package_root_path, false)?;
    write_mount_config(&app, &DatabaseMountConfig {
        package_root: package_root_path.display().to_string(),
    })?;

    Ok(DatabaseMountStatus {
        configured: true,
        package_root: Some(package_root_path.display().to_string()),
        app_db_path: app_db_path.display().to_string(),
        active_db_url: format!("sqlite:{RELATIVE_DB_PATH}"),
        note: "外部 database package 挂载已生效。".into(),
    })
}

#[tauri::command]
fn clear_database_mount(app: AppHandle) -> Result<DatabaseMountStatus, String> {
    let app_db_path = resolve_app_db_path(&app)?;
    if let Some(config) = read_mount_config(&app)? {
        let target_db_path = PathBuf::from(config.package_root).join("data").join("chronicle-calendar.db");
        if is_symlink(&app_db_path) {
          let persisted_bytes = fs::read(&target_db_path).map_err(|error| format!("读取外部数据库失败：{error}"))?;
          remove_path_if_exists(&app_db_path)?;
          ensure_parent_dir(&app_db_path)?;
          fs::write(&app_db_path, persisted_bytes).map_err(|error| format!("恢复本地数据库失败：{error}"))?;
        }
        remove_mount_config(&app)?;
    }

    Ok(DatabaseMountStatus {
        configured: false,
        package_root: None,
        app_db_path: app_db_path.display().to_string(),
        active_db_url: format!("sqlite:{RELATIVE_DB_PATH}"),
        note: "已取消外部挂载，数据库恢复到应用默认数据目录。".into(),
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            desktop_health,
            prepare_database_mount,
            get_database_mount_status,
            configure_database_mount,
            clear_database_mount
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Chronicle Calendar desktop shell");
}

fn resolve_app_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法解析应用数据目录：{error}"))?;
    Ok(app_data_dir.join(RELATIVE_DB_PATH))
}

fn resolve_mount_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法解析应用数据目录：{error}"))?;
    Ok(app_data_dir.join(MOUNT_CONFIG_FILE))
}

fn read_mount_config(app: &AppHandle) -> Result<Option<DatabaseMountConfig>, String> {
    let config_path = resolve_mount_config_path(app)?;
    if !config_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(config_path).map_err(|error| format!("读取挂载配置失败：{error}"))?;
    let parsed = serde_json::from_str::<DatabaseMountConfig>(&content)
        .map_err(|error| format!("解析挂载配置失败：{error}"))?;
    Ok(Some(parsed))
}

fn write_mount_config(app: &AppHandle, config: &DatabaseMountConfig) -> Result<(), String> {
    let config_path = resolve_mount_config_path(app)?;
    ensure_parent_dir(&config_path)?;
    let content = serde_json::to_string_pretty(config).map_err(|error| format!("序列化挂载配置失败：{error}"))?;
    fs::write(config_path, content).map_err(|error| format!("写入挂载配置失败：{error}"))?;
    Ok(())
}

fn remove_mount_config(app: &AppHandle) -> Result<(), String> {
    let config_path = resolve_mount_config_path(app)?;
    if config_path.exists() {
        fs::remove_file(config_path).map_err(|error| format!("删除挂载配置失败：{error}"))?;
    }
    Ok(())
}

fn ensure_external_mount(app_db_path: &Path, package_root: &Path, preserve_existing_symlink: bool) -> Result<(), String> {
    let target_db_path = package_root.join("data").join("chronicle-calendar.db");
    ensure_parent_dir(&target_db_path)?;

    if app_db_path.exists() && !is_symlink(app_db_path) && !target_db_path.exists() {
        ensure_parent_dir(&target_db_path)?;
        fs::copy(app_db_path, &target_db_path).map_err(|error| format!("复制现有数据库到外部 package 失败：{error}"))?;
    }

    if !target_db_path.exists() {
        ensure_parent_dir(&target_db_path)?;
        fs::File::create(&target_db_path).map_err(|error| format!("创建外部数据库文件失败：{error}"))?;
    }

    if is_symlink(app_db_path) {
        if preserve_existing_symlink {
            let linked = fs::read_link(app_db_path).map_err(|error| format!("读取现有数据库挂载失败：{error}"))?;
            if linked == target_db_path {
                return Ok(());
            }
        }
        remove_path_if_exists(app_db_path)?;
    } else if app_db_path.exists() {
        remove_path_if_exists(app_db_path)?;
    }

    ensure_parent_dir(app_db_path)?;
    create_file_symlink(&target_db_path, app_db_path)?;
    Ok(())
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建目录失败：{error}"))?;
    }
    Ok(())
}

fn remove_path_if_exists(path: &Path) -> Result<(), String> {
    if !path.exists() && !is_symlink(path) {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| format!("读取路径元信息失败：{error}"))?;
    if metadata.file_type().is_dir() {
        fs::remove_dir_all(path).map_err(|error| format!("删除目录失败：{error}"))?;
    } else {
        fs::remove_file(path).map_err(|error| format!("删除文件失败：{error}"))?;
    }
    Ok(())
}

fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
}

#[cfg(unix)]
fn create_file_symlink(original: &Path, link: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(original, link).map_err(|error| format!("创建符号链接失败：{error}"))
}

#[cfg(windows)]
fn create_file_symlink(original: &Path, link: &Path) -> Result<(), String> {
    std::os::windows::fs::symlink_file(original, link).map_err(|error| format!("创建符号链接失败：{error}"))
}
