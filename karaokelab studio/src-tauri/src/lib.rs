use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};
use base64::prelude::*;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncFilePayload {
    pub name: String,
    pub data_base64: Option<String>,
    pub text_content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WriteSyncResult {
    pub success: bool,
    pub error: Option<String>,
    pub count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncedSongPayload {
    pub folder_name: String,
    pub json_content: Option<String>,
    pub lrc_content: Option<String>,
    pub instrumental_base64: Option<String>,
    pub vocals_base64: Option<String>,
    pub audio_base64: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncedFolderReadResult {
    pub success: bool,
    pub error: Option<String>,
    pub manifest_content: Option<String>,
    pub songs: Vec<SyncedSongPayload>,
}

#[tauri::command]
fn select_sync_folder() -> Option<String> {
    let folder = rfd::FileDialog::new()
        .set_title("Seleccionar Carpeta del KaraokeLab Player o Memoria USB")
        .pick_folder();
    
    folder.map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn read_sync_manifest(folder_path: String) -> Option<String> {
    let manifest_path = Path::new(&folder_path).join("manifest.json");
    if manifest_path.exists() {
        fs::read_to_string(manifest_path).ok()
    } else {
        None
    }
}

#[tauri::command]
fn write_sync_files(folder_path: String, files: Vec<SyncFilePayload>) -> WriteSyncResult {
    let base_dir = Path::new(&folder_path);
    if !base_dir.exists() {
        if let Err(e) = fs::create_dir_all(base_dir) {
            return WriteSyncResult {
                success: false,
                error: Some(format!("Error creando directorio: {}", e)),
                count: 0,
            };
        }
    }

    let mut written_count = 0;
    for file in files {
        let file_path = base_dir.join(&file.name);
        if let Some(parent) = file_path.parent() {
            if !parent.exists() {
                let _ = fs::create_dir_all(parent);
            }
        }
        if let Some(text) = file.text_content {
            if let Err(e) = fs::write(&file_path, text) {
                return WriteSyncResult {
                    success: false,
                    error: Some(format!("Error escribiendo archivo {}: {}", file.name, e)),
                    count: written_count,
                };
            }
            written_count += 1;
        } else if let Some(b64) = file.data_base64 {
            match BASE64_STANDARD.decode(b64) {
                Ok(bytes) => {
                    if let Err(e) = fs::write(&file_path, bytes) {
                        return WriteSyncResult {
                            success: false,
                            error: Some(format!("Error escribiendo binario {}: {}", file.name, e)),
                            count: written_count,
                        };
                    }
                    written_count += 1;
                }
                Err(e) => {
                    return WriteSyncResult {
                        success: false,
                        error: Some(format!("Error decodificando base64 {}: {}", file.name, e)),
                        count: written_count,
                    };
                }
            }
        }
    }

    WriteSyncResult {
        success: true,
        error: None,
        count: written_count,
    }
}

#[tauri::command]
fn read_synced_folder_all_songs(folder_path: String) -> SyncedFolderReadResult {
    let base_dir = Path::new(&folder_path);
    if !base_dir.exists() || !base_dir.is_dir() {
        return SyncedFolderReadResult {
            success: false,
            error: Some("La carpeta seleccionada no existe o no es un directorio válido".to_string()),
            manifest_content: None,
            songs: Vec::new(),
        };
    }

    let manifest_path = base_dir.join("manifest.json");
    let manifest_content = if manifest_path.exists() {
        fs::read_to_string(manifest_path).ok()
    } else {
        None
    };

    let mut songs = Vec::new();

    // Read all subdirectories inside folder_path
    if let Ok(entries) = fs::read_dir(base_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let folder_name = entry.file_name().to_string_lossy().to_string();
                let json_path = path.join("song.json");
                let json_content = if json_path.exists() {
                    fs::read_to_string(json_path).ok()
                } else {
                    None
                };

                let lrc_path = path.join("lyrics.lrc");
                let lrc_content = if lrc_path.exists() {
                    fs::read_to_string(lrc_path).ok()
                } else {
                    None
                };

                let inst_path = path.join("instrumental.mp3");
                let instrumental_base64 = if inst_path.exists() {
                    fs::read(inst_path).ok().map(|b| BASE64_STANDARD.encode(b))
                } else {
                    None
                };

                let voc_path = path.join("vocals.mp3");
                let vocals_base64 = if voc_path.exists() {
                    fs::read(voc_path).ok().map(|b| BASE64_STANDARD.encode(b))
                } else {
                    None
                };

                let audio_path = path.join("audio.mp3");
                let audio_base64 = if audio_path.exists() {
                    fs::read(audio_path).ok().map(|b| BASE64_STANDARD.encode(b))
                } else {
                    None
                };

                if json_content.is_some() || instrumental_base64.is_some() || audio_base64.is_some() || lrc_content.is_some() {
                    songs.push(SyncedSongPayload {
                        folder_name,
                        json_content,
                        lrc_content,
                        instrumental_base64,
                        vocals_base64,
                        audio_base64,
                    });
                }
            }
        }
    }

    SyncedFolderReadResult {
        success: true,
        error: None,
        manifest_content,
        songs,
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DroppedFilePayload {
    pub name: String,
    pub data_base64: String,
}

#[tauri::command]
fn read_file_as_base64(path: String) -> Result<DroppedFilePayload, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Archivo no encontrado".to_string());
    }
    let file_name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    Ok(DroppedFilePayload {
        name: file_name,
        data_base64: BASE64_STANDARD.encode(bytes),
    })
}

#[tauri::command]
fn open_folder_in_finder(folder_path: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(true)
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(true)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(false)
    }
}

#[tauri::command]
async fn open_native_tv_window(app: tauri::AppHandle) -> Result<bool, String> {
    if let Some(tv_win) = app.get_webview_window("tv_display") {
        let _ = tv_win.show();
        let _ = tv_win.set_focus();
        return Ok(true);
    }

    let monitors = app.available_monitors().unwrap_or_default();
    let primary_monitor = app.primary_monitor().ok().flatten();

    // Look for an external screen/TV (e.g. HDMI or AirPlay extended display)
    let external_monitor = monitors.iter().find(|m| {
        if let Some(ref p) = primary_monitor {
            m.name() != p.name()
        } else {
            false
        }
    });

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        "tv_display",
        tauri::WebviewUrl::App("index.html?mode=tv_display".into()),
    )
    .title("KaraokeLab // Pantalla TV")
    .resizable(true);

    if let Some(ext) = external_monitor {
        let pos = ext.position();
        let size = ext.size();
        builder = builder
            .position(pos.x as f64, pos.y as f64)
            .inner_size(size.width as f64, size.height as f64)
            .fullscreen(true);
    } else {
        builder = builder.inner_size(1280.0, 720.0);
    }

    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay);

    builder.build().map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn open_in_chrome_cast(url: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let res = std::process::Command::new("open")
            .args(["-a", "Google Chrome", &url])
            .spawn();
        if res.is_ok() {
            return Ok(true);
        }
        let _ = std::process::Command::new("open").arg(&url).spawn();
        Ok(true)
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "chrome", &url])
            .spawn();
        Ok(true)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(false)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())
    .invoke_handler(tauri::generate_handler![
        select_sync_folder,
        read_sync_manifest,
        write_sync_files,
        read_synced_folder_all_songs,
        read_file_as_base64,
        open_folder_in_finder,
        open_native_tv_window,
        open_in_chrome_cast
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
