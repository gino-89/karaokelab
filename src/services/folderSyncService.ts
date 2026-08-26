import { SongItem, SingerProfile } from '../types';
import { formatLRC } from './lrcParser';
import { convertWavBlobToMp3_320kbps } from './mp3Encoder';
import { exportFullLibraryWithAudioZip } from './libraryBackup';

const SYNC_FOLDER_KEY = 'karaokelab_sync_folder_path';
const SYNC_LAST_TS_KEY = 'karaokelab_sync_last_timestamp';

let _browserDirHandle: any = null;

export interface FolderSyncResult {
  success: boolean;
  syncedCount: number;
  totalInFolder: number;
  folderPath: string;
  error?: string;
}

export function getSavedSyncFolderPath(): string {
  try {
    return localStorage.getItem(SYNC_FOLDER_KEY) || '';
  } catch {
    return '';
  }
}

export function setSavedSyncFolderPath(path: string): void {
  try {
    localStorage.setItem(SYNC_FOLDER_KEY, path);
  } catch (_) {}
}

export function getLastFolderSyncTimestamp(): number {
  try {
    const raw = localStorage.getItem(SYNC_LAST_TS_KEY);
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

export function setLastFolderSyncTimestamp(ts: number = Date.now()): void {
  try {
    localStorage.setItem(SYNC_LAST_TS_KEY, String(ts));
  } catch (_) {}
}

async function invokeTauri<T>(cmd: string, args: Record<string, any> = {}): Promise<T | null> {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__?.invoke) {
    return await (window as any).__TAURI_INTERNALS__.invoke(cmd, args);
  }
  return null;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result as string;
      const b64 = res.includes(',') ? res.split(',')[1] : res;
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(b64: string, mimeType = 'audio/mp3'): Blob {
  const byteChars = atob(b64);
  const byteNums = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNums[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNums);
  return new Blob([byteArray], { type: mimeType });
}

function cleanFolderName(title: string, artist?: string): string {
  const combined = artist ? `${artist.trim()} - ${title.trim()}` : title.trim();
  return combined.replace(/[/\\?%*:|"<>]/g, '_').trim();
}

/**
 * Lets user choose a sync folder/USB drive and saves it for 1-click sync.
 */
export async function chooseSyncFolder(): Promise<string | null> {
  // 1. Try Tauri Native Folder Dialog (macOS NSOpenPanel / Windows Dialog)
  try {
    const tauriFolder = await invokeTauri<string>('select_sync_folder');
    if (tauriFolder) {
      setSavedSyncFolderPath(tauriFolder);
      return tauriFolder;
    }
  } catch (_) {}

  // 2. Try Electron Dialog
  if (typeof window !== 'undefined' && window.electronAPI?.selectFolderDialog) {
    const res = await window.electronAPI.selectFolderDialog({
      title: 'Seleccionar Carpeta del KaraokeLab Player o Memoria USB',
      defaultPath: getSavedSyncFolderPath() || undefined,
    });
    if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
      const selected = res.filePaths[0];
      setSavedSyncFolderPath(selected);
      return selected;
    }
  }

  // 3. Try Browser HTML5 Directory Picker (Chrome/Edge/Opera)
  if (typeof window !== 'undefined' && (window as any).showDirectoryPicker) {
    try {
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
      });
      _browserDirHandle = dirHandle;
      const folderName = dirHandle.name || 'Carpeta Seleccionada';
      setSavedSyncFolderPath(folderName);
      return folderName;
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.warn('showDirectoryPicker error:', e);
      }
      return null;
    }
  }

  return getSavedSyncFolderPath() || null;
}

/**
 * 1-Click Fast Incremental Sync:
 * Saves each song in its own dedicated clean folder:
 * 📁 [Artista - Titulo]/
 *   ├── instrumental.mp3  (Pista de audio / instrumental)
 *   ├── vocals.mp3        (Pista de voz / si existe)
 *   ├── lyrics.lrc        (Letras sincronizadas)
 *   └── song.json         (Toda la metadata, BPM, Key, offsets, automatizaciones)
 * 📄 manifest.json        (Catálogo general con perfiles)
 */
export async function syncSongsToFolder(
  allSongs: SongItem[],
  profiles: SingerProfile[],
  onProgress?: (percent: number, message: string) => void,
  targetFolder?: string
): Promise<FolderSyncResult> {
  let folderPath = targetFolder || getSavedSyncFolderPath();
  if (!folderPath) {
    folderPath = (await chooseSyncFolder()) || '';
    if (!folderPath) {
      throw new Error('No hay una carpeta de destino seleccionada.');
    }
  }

  if (onProgress) onProgress(5, 'Comprobando canciones existentes en el destino...');

  // 1. Check existing manifest on destination disk/USB
  let existingFolderSongs: any[] = [];

  // Check Tauri Native Manifest
  if (folderPath && (folderPath.startsWith('/') || folderPath.includes(':\\') || folderPath.includes(':/'))) {
    try {
      const rawManifest = await invokeTauri<string>('read_sync_manifest', { folderPath });
      if (rawManifest) {
        const manifestObj = JSON.parse(rawManifest);
        if (manifestObj.songs && Array.isArray(manifestObj.songs)) {
          existingFolderSongs = manifestObj.songs;
        }
      }
    } catch (_) {}
  }

  // Check Electron Manifest
  if (typeof window !== 'undefined' && window.electronAPI?.syncReadFolderInfo) {
    const folderInfo = await window.electronAPI.syncReadFolderInfo(folderPath);
    if (folderInfo?.manifest?.songs) {
      existingFolderSongs = folderInfo.manifest.songs;
    }
  }

  // Check Browser Directory Handle Manifest
  if (_browserDirHandle) {
    try {
      const manifestHandle = await _browserDirHandle.getFileHandle('manifest.json');
      const manifestFile = await manifestHandle.getFile();
      const manifestJson = JSON.parse(await manifestFile.text());
      if (manifestJson.songs && Array.isArray(manifestJson.songs)) {
        existingFolderSongs = manifestJson.songs;
      }
    } catch (_) {}
  }

  // 2. Filter ONLY songs that are missing on disk or were modified after being saved to disk
  const songsToSync = allSongs.filter((s) => {
    const diskSong = existingFolderSongs.find(
      (d: any) =>
        d.id === s.id ||
        (d.title?.toLowerCase().trim() === s.title?.toLowerCase().trim() &&
          (d.artist || '').toLowerCase().trim() === (s.artist || '').toLowerCase().trim())
    );
    if (!diskSong) return true; // Song not on disk -> needs sync!
    const localTime = s.updatedAt || s.createdAt || 0;
    const diskTime = diskSong.updatedAt || diskSong.createdAt || 0;
    return localTime > diskTime; // Modified locally -> needs sync!
  });

  if (songsToSync.length === 0) {
    setLastFolderSyncTimestamp();
    return {
      success: true,
      syncedCount: 0,
      totalInFolder: existingFolderSongs.length || allSongs.length,
      folderPath,
    };
  }

  if (onProgress) onProgress(10, `Sincronizando ${songsToSync.length} canciones nuevas...`);

  // ── STRATEGY A: TAURI NATIVE DIRECT FILE SYNC (0 ZIPs!) ──
  const isTauriEnvironment = typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);
  if (isTauriEnvironment || (folderPath.startsWith('/') || folderPath.includes(':\\') || folderPath.includes(':/'))) {
    const syncFilesPayload: Array<{
      name: string;
      data_base64?: string;
      text_content?: string;
    }> = [];

    const updatedManifestSongs = [...existingFolderSongs];

    for (let i = 0; i < songsToSync.length; i++) {
      const song = songsToSync[i];
      const p = 10 + Math.round(((i + 1) / songsToSync.length) * 75);
      if (onProgress) onProgress(p, `Organizando: ${song.title} (${i + 1}/${songsToSync.length})`);

      const songFolder = cleanFolderName(song.title, song.artist);
      const audioFileName = `${songFolder}/instrumental.mp3`;
      const lrcFileName = `${songFolder}/lyrics.lrc`;
      const jsonFileName = `${songFolder}/song.json`;
      const vocalsFileName = song.stems?.vocalsBlob ? `${songFolder}/vocals.mp3` : undefined;

      const existingDiskSong = existingFolderSongs.find(
        (d: any) =>
          d.id === song.id ||
          (d.title?.toLowerCase().trim() === song.title?.toLowerCase().trim() &&
            (d.artist || '').toLowerCase().trim() === (song.artist || '').toLowerCase().trim())
      );

      // Only re-encode / write heavy audio files if they don't exist on disk yet!
      const isAudioAlreadyOnDisk = !!existingDiskSong;

      if (!isAudioAlreadyOnDisk) {
        // 1. Instrumental / Audio MP3
        const mp3Blob = song.stems?.instrumentalBlob
          ? await convertWavBlobToMp3_320kbps(song.stems.instrumentalBlob)
          : (song.audioBlob?.type.includes('wav') || song.originalFileName?.toLowerCase().endsWith('.wav')
              ? await convertWavBlobToMp3_320kbps(song.audioBlob)
              : (song.audioBlob || new Blob()));

        const audioB64 = await blobToBase64(mp3Blob);
        syncFilesPayload.push({
          name: audioFileName,
          data_base64: audioB64,
        });

        // 2. Vocals MP3 (if present)
        if (song.stems?.vocalsBlob) {
          const vocMp3 = await convertWavBlobToMp3_320kbps(song.stems.vocalsBlob);
          const vocB64 = await blobToBase64(vocMp3);
          syncFilesPayload.push({
            name: vocalsFileName!,
            data_base64: vocB64,
          });
        }
      }

      // 3. LRC Lyrics (Always fast text write)
      const lrcText = formatLRC(song.lyrics || []);
      syncFilesPayload.push({
        name: lrcFileName,
        text_content: lrcText,
      });

      // 4. Complete individual song.json (Always fast JSON write)
      const songMetadata = {
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        genre: song.genre,
        duration: song.duration,
        bpm: song.bpm,
        key: song.key,
        syncOffset: song.syncOffset,
        artistsList: song.artistsList,
        isDuet: song.isDuet,
        videoBgId: song.videoBgId,
        videoBgTitle: song.videoBgTitle,
        videoBgMode: song.videoBgMode,
        videoBgCustomUrl: song.videoBgCustomUrl,
        vocalAutomation: song.vocalAutomation,
        audioFile: 'instrumental.mp3',
        vocalsFile: song.stems?.vocalsBlob ? 'vocals.mp3' : undefined,
        lrcFile: 'lyrics.lrc',
        lyrics: song.lyrics || [],
        createdAt: song.createdAt || Date.now(),
        updatedAt: song.updatedAt || Date.now(),
      };

      syncFilesPayload.push({
        name: jsonFileName,
        text_content: JSON.stringify(songMetadata, null, 2),
      });

      // 5. Global Manifest Entry
      const manifestEntry = {
        ...songMetadata,
        folder: songFolder,
        audioFile: audioFileName,
        lrcFile: lrcFileName,
        vocalsFile: vocalsFileName,
      };

      const matchIdx = updatedManifestSongs.findIndex(
        (m: any) => m.id === song.id || (m.title?.toLowerCase() === song.title.toLowerCase() && (m.artist || '').toLowerCase() === (song.artist || '').toLowerCase())
      );
      if (matchIdx >= 0) {
        updatedManifestSongs[matchIdx] = manifestEntry;
      } else {
        updatedManifestSongs.push(manifestEntry);
      }
    }

    // 6. Add root manifest.json payload
    syncFilesPayload.push({
      name: 'manifest.json',
      text_content: JSON.stringify({
        version: '1.0.0',
        updatedAt: Date.now(),
        profiles,
        songs: updatedManifestSongs,
      }, null, 2),
    });

    if (onProgress) onProgress(90, 'Escribiendo cambios en el disco...');

    const res = await invokeTauri<{ success: boolean; error?: string; count: number }>('write_sync_files', {
      folderPath,
      files: syncFilesPayload,
    });

    if (res && res.success) {
      setLastFolderSyncTimestamp();
      if (onProgress) onProgress(100, `✓ ¡${songsToSync.length} canciones sincronizadas!`);
      return {
        success: true,
        syncedCount: songsToSync.length,
        totalInFolder: updatedManifestSongs.length,
        folderPath,
      };
    }
  }

  // ── STRATEGY B: BROWSER HTML5 DIRECT FILE SYSTEM (0 ZIPs!) ──
  if (_browserDirHandle) {
    if (onProgress) onProgress(85, 'Escribiendo cambios directamente en la carpeta...');

    const updatedManifestSongs = [...existingFolderSongs];

    for (let i = 0; i < songsToSync.length; i++) {
      const song = songsToSync[i];
      const p = 85 + Math.round(((i + 1) / songsToSync.length) * 12);
      if (onProgress) onProgress(p, `Actualizando: ${song.title}...`);

      const songFolder = cleanFolderName(song.title, song.artist);
      const songDirHandle = await _browserDirHandle.getDirectoryHandle(songFolder, { create: true });

      const existingDiskSong = existingFolderSongs.find(
        (d: any) =>
          d.id === song.id ||
          (d.title?.toLowerCase().trim() === song.title?.toLowerCase().trim() &&
            (d.artist || '').toLowerCase().trim() === (song.artist || '').toLowerCase().trim())
      );
      const isAudioAlreadyOnDisk = !!existingDiskSong;

      if (!isAudioAlreadyOnDisk) {
        // 1. Write Audio MP3 only if not on disk
        const audioBlob = song.stems?.instrumentalBlob 
          ? await convertWavBlobToMp3_320kbps(song.stems.instrumentalBlob)
          : (song.audioBlob?.type.includes('wav') 
              ? await convertWavBlobToMp3_320kbps(song.audioBlob) 
              : song.audioBlob);

        if (audioBlob) {
          const audioHandle = await songDirHandle.getFileHandle('instrumental.mp3', { create: true });
          const audioWritable = await audioHandle.createWritable();
          await audioWritable.write(audioBlob);
          await audioWritable.close();
        }

        // 2. Write Vocals stem if present
        if (song.stems?.vocalsBlob) {
          const vocBlob = await convertWavBlobToMp3_320kbps(song.stems.vocalsBlob);
          const vocHandle = await songDirHandle.getFileHandle('vocals.mp3', { create: true });
          const vocWritable = await vocHandle.createWritable();
          await vocWritable.write(vocBlob);
          await vocWritable.close();
        }
      }

      // 3. Write LRC lyrics file (Always fast text)
      const lrcText = formatLRC(song.lyrics || []);
      const lrcHandle = await songDirHandle.getFileHandle('lyrics.lrc', { create: true });
      const lrcWritable = await lrcHandle.createWritable();
      await lrcWritable.write(lrcText);
      await lrcWritable.close();

      // 4. Write individual song.json (Always fast JSON)
      const songMetadata = {
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        genre: song.genre,
        duration: song.duration,
        bpm: song.bpm,
        key: song.key,
        syncOffset: song.syncOffset,
        artistsList: song.artistsList,
        isDuet: song.isDuet,
        videoBgId: song.videoBgId,
        videoBgTitle: song.videoBgTitle,
        videoBgMode: song.videoBgMode,
        videoBgCustomUrl: song.videoBgCustomUrl,
        vocalAutomation: song.vocalAutomation,
        audioFile: 'instrumental.mp3',
        vocalsFile: song.stems?.vocalsBlob ? 'vocals.mp3' : undefined,
        lrcFile: 'lyrics.lrc',
        lyrics: song.lyrics || [],
        createdAt: song.createdAt || Date.now(),
        updatedAt: song.updatedAt || Date.now(),
      };

      const jsonHandle = await songDirHandle.getFileHandle('song.json', { create: true });
      const jsonWritable = await jsonHandle.createWritable();
      await jsonWritable.write(JSON.stringify(songMetadata, null, 2));
      await jsonWritable.close();

      // 5. Update global manifest entry
      const manifestEntry = {
        ...songMetadata,
        folder: songFolder,
        audioFile: `${songFolder}/instrumental.mp3`,
        lrcFile: `${songFolder}/lyrics.lrc`,
        vocalsFile: song.stems?.vocalsBlob ? `${songFolder}/vocals.mp3` : undefined,
      };

      const matchIdx = updatedManifestSongs.findIndex(
        (m: any) => m.id === song.id || (m.title?.toLowerCase() === song.title.toLowerCase() && (m.artist || '').toLowerCase() === (song.artist || '').toLowerCase())
      );
      if (matchIdx >= 0) {
        updatedManifestSongs[matchIdx] = manifestEntry;
      } else {
        updatedManifestSongs.push(manifestEntry);
      }
    }

    // 6. Write root manifest.json
    const manifestHandle = await _browserDirHandle.getFileHandle('manifest.json', { create: true });
    const manifestWritable = await manifestHandle.createWritable();
    await manifestWritable.write(JSON.stringify({
      version: '1.0.0',
      updatedAt: Date.now(),
      profiles,
      songs: updatedManifestSongs,
    }, null, 2));
    await manifestWritable.close();

    setLastFolderSyncTimestamp();
    if (onProgress) onProgress(100, `✓ ¡${songsToSync.length} canciones organizadas y sincronizadas!`);

    return {
      success: true,
      syncedCount: songsToSync.length,
      totalInFolder: updatedManifestSongs.length,
      folderPath: _browserDirHandle.name || folderPath,
    };
  }

  // ── STRATEGY C: ZIP Fallback only if no directory access ──
  if (onProgress) onProgress(90, 'Generando archivo de sincronización (.ZIP)...');
  await exportFullLibraryWithAudioZip(allSongs, profiles, onProgress);
  setLastFolderSyncTimestamp();
  if (onProgress) onProgress(100, `✓ ¡${allSongs.length} canciones sincronizadas y descargadas!`);

  return {
    success: true,
    syncedCount: allSongs.length,
    totalInFolder: allSongs.length,
    folderPath: folderPath || 'Descargas',
  };
}

/**
 * Reads and hydrates the entire song library directly from a synced folder / USB into the Player DB.
 */
export async function importSongsFromFolder(
  onProgress?: (percent: number, message: string) => void,
  folderPathOverride?: string
): Promise<{
  importedCount: number;
  allSongs: SongItem[];
  allProfiles: SingerProfile[];
}> {
  let targetPath = folderPathOverride || getSavedSyncFolderPath();
  if (!targetPath && !_browserDirHandle) {
    targetPath = (await chooseSyncFolder()) || '';
    if (!targetPath) {
      throw new Error('No se seleccionó ninguna carpeta.');
    }
  }

  if (onProgress) onProgress(20, 'Leyendo biblioteca desde carpeta o memoria USB...');

  // 1. Tauri Native Reader
  if (targetPath && (targetPath.startsWith('/') || targetPath.includes(':\\') || targetPath.includes(':/'))) {
    const res = await invokeTauri<{
      success: boolean;
      error?: string;
      manifest_content?: string;
      songs: Array<{
        folder_name: string;
        json_content?: string;
        lrc_content?: string;
        instrumental_base64?: string;
        vocals_base64?: string;
        audio_base64?: string;
      }>;
    }>('read_synced_folder_all_songs', { folderPath: targetPath });

    if (res && res.success && res.songs.length > 0) {
      const { getSongsFromDB, saveSongToDB, getProfilesFromStorage, saveProfilesToStorage } = await import('./db');
      const existingSongs = await getSongsFromDB();
      const mergedSongs: SongItem[] = [...existingSongs];
      let importedCount = 0;

      for (let i = 0; i < res.songs.length; i++) {
        const item = res.songs[i];
        if (onProgress) {
          const p = 25 + Math.round(((i + 1) / res.songs.length) * 65);
          onProgress(p, `Cargando: ${item.folder_name} (${i + 1}/${res.songs.length})`);
        }

        let parsedMeta: any = {};
        if (item.json_content) {
          try {
            parsedMeta = JSON.parse(item.json_content);
          } catch (_) {}
        }

        let instBlob: Blob | undefined;
        let vocBlob: Blob | undefined;
        let audioBlob: Blob | undefined;

        if (item.instrumental_base64) instBlob = base64ToBlob(item.instrumental_base64, 'audio/mp3');
        if (item.vocals_base64) vocBlob = base64ToBlob(item.vocals_base64, 'audio/mp3');
        if (item.audio_base64) audioBlob = base64ToBlob(item.audio_base64, 'audio/mp3');

        const title = parsedMeta.title || item.folder_name.split(' - ').pop() || item.folder_name;
        const artist = parsedMeta.artist || (item.folder_name.includes(' - ') ? item.folder_name.split(' - ')[0] : undefined);

        const songItem: SongItem = {
          id: parsedMeta.id || `song_synced_${Date.now()}_${i}`,
          title,
          artist,
          album: parsedMeta.album,
          genre: parsedMeta.genre,
          duration: parsedMeta.duration || 180,
          bpm: parsedMeta.bpm || 120,
          key: parsedMeta.key || 'C',
          syncOffset: parsedMeta.syncOffset || 0,
          artistsList: parsedMeta.artistsList,
          isDuet: parsedMeta.isDuet,
          videoBgId: parsedMeta.videoBgId,
          videoBgTitle: parsedMeta.videoBgTitle,
          videoBgMode: parsedMeta.videoBgMode,
          videoBgCustomUrl: parsedMeta.videoBgCustomUrl,
          vocalAutomation: parsedMeta.vocalAutomation,
          rawLrc: item.lrc_content || parsedMeta.rawLrc,
          lyrics: parsedMeta.lyrics || [],
          originalFileName: `${title}.mp3`,
          createdAt: parsedMeta.createdAt || Date.now(),
          updatedAt: parsedMeta.updatedAt || Date.now(),
          audioBlob: instBlob || audioBlob,
          stems: (instBlob || vocBlob) ? {
            instrumentalBlob: instBlob,
            vocalsBlob: vocBlob,
          } : undefined,
        };

        const matchIdx = mergedSongs.findIndex(
          (m) => m.id === songItem.id || (m.title.toLowerCase() === songItem.title.toLowerCase() && (m.artist || '').toLowerCase() === (songItem.artist || '').toLowerCase())
        );
        if (matchIdx >= 0) {
          mergedSongs[matchIdx] = songItem;
        } else {
          mergedSongs.push(songItem);
        }

        await saveSongToDB(songItem);
        importedCount++;
      }

      if (res.manifest_content) {
        try {
          const manifestObj = JSON.parse(res.manifest_content);
          if (manifestObj.profiles && Array.isArray(manifestObj.profiles) && manifestObj.profiles.length > 0) {
            saveProfilesToStorage(manifestObj.profiles);
          }
        } catch (_) {}
      }

      const currentProfiles = getProfilesFromStorage();
      if (onProgress) onProgress(100, `✓ ¡${importedCount} canciones cargadas desde la carpeta!`);

      return {
        importedCount,
        allSongs: mergedSongs,
        allProfiles: currentProfiles,
      };
    }
  }

  // 2. Browser Direct File System Access Reader
  if (!_browserDirHandle && typeof window !== 'undefined' && (window as any).showDirectoryPicker) {
    await chooseSyncFolder();
  }

  if (_browserDirHandle) {
    const { getSongsFromDB, saveSongToDB, getProfilesFromStorage, saveProfilesToStorage } = await import('./db');
    const manifestHandle = await _browserDirHandle.getFileHandle('manifest.json');
    const manifestFile = await manifestHandle.getFile();
    const manifestJson = JSON.parse(await manifestFile.text());

    if (!manifestJson.songs || !Array.isArray(manifestJson.songs)) {
      throw new Error('No se encontró un archivo manifest.json válido en la carpeta seleccionada.');
    }

    const existingSongs = await getSongsFromDB();
    const mergedSongs: SongItem[] = [...existingSongs];
    let importedCount = 0;

    for (let i = 0; i < manifestJson.songs.length; i++) {
      const s = manifestJson.songs[i];
      if (onProgress) {
        const p = 25 + Math.round(((i + 1) / manifestJson.songs.length) * 65);
        onProgress(p, `Cargando: ${s.title} (${i + 1}/${manifestJson.songs.length})`);
      }

      let audioBlob: Blob | undefined;
      let vocalsBlob: Blob | undefined;

      try {
        if (s.folder) {
          const songFolderHandle = await _browserDirHandle.getDirectoryHandle(s.folder);
          try {
            const instHandle = await songFolderHandle.getFileHandle(s.audioFile?.split('/').pop() || 'instrumental.mp3');
            audioBlob = await instHandle.getFile();
          } catch (_) {}
          try {
            const vocHandle = await songFolderHandle.getFileHandle(s.vocalsFile?.split('/').pop() || 'vocals.mp3');
            vocalsBlob = await vocHandle.getFile();
          } catch (_) {}
        } else {
          if (s.audioFile) {
            const fileHandle = await _browserDirHandle.getFileHandle(s.audioFile);
            audioBlob = await fileHandle.getFile();
          }
        }
      } catch (_) {}

      const songItem: SongItem = {
        id: s.id,
        title: s.title,
        artist: s.artist,
        album: s.album,
        genre: s.genre,
        duration: s.duration,
        bpm: s.bpm,
        key: s.key,
        syncOffset: s.syncOffset,
        artistsList: s.artistsList,
        isDuet: s.isDuet,
        videoBgId: s.videoBgId,
        videoBgTitle: s.videoBgTitle,
        videoBgMode: s.videoBgMode,
        videoBgCustomUrl: s.videoBgCustomUrl,
        vocalAutomation: s.vocalAutomation,
        rawLrc: s.rawLrc,
        lyrics: s.lyrics || [],
        originalFileName: s.audioFile || `${s.title}.mp3`,
        createdAt: s.createdAt || Date.now(),
        updatedAt: s.updatedAt || Date.now(),
        audioBlob,
        stems: (audioBlob || vocalsBlob) ? {
          instrumentalBlob: audioBlob,
          vocalsBlob,
        } : undefined,
      };

      const matchIdx = mergedSongs.findIndex(m => m.id === songItem.id || (m.title.toLowerCase() === songItem.title.toLowerCase() && m.artist?.toLowerCase() === songItem.artist?.toLowerCase()));
      if (matchIdx >= 0) {
        mergedSongs[matchIdx] = songItem;
      } else {
        mergedSongs.push(songItem);
      }

      await saveSongToDB(songItem);
      importedCount++;
    }

    if (manifestJson.profiles && Array.isArray(manifestJson.profiles) && manifestJson.profiles.length > 0) {
      saveProfilesToStorage(manifestJson.profiles);
    }
    const currentProfiles = getProfilesFromStorage();

    if (onProgress) onProgress(100, `✓ ¡${importedCount} canciones cargadas con éxito!`);

    return {
      importedCount,
      allSongs: mergedSongs,
      allProfiles: currentProfiles,
    };
  }

  throw new Error('Selecciona una carpeta para sincronizar.');
}
