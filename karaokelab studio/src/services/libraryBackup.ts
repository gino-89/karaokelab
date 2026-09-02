import JSZip from 'jszip';
import { SongItem, SingerProfile, LyricLine, ArtistRole, VideoBackgroundMode, VocalAutomationConfig } from '../types';
import { saveSongToDB, getSongsFromDB, saveProfilesToStorage, getProfilesFromStorage } from './db';
import { formatLRC, parseLRC } from './lrcParser';
import { convertWavBlobToMp3_320kbps } from './mp3Encoder';

const LAST_EXPORT_KEY = 'karaokelab_last_export_timestamp';

export interface LibraryBackupData {
  version: string;
  app: string;
  exportedAt: string;
  timestamp: number;
  totalSongs: number;
  profiles: SingerProfile[];
  songs: SongItemBackup[];
}

export interface SongItemBackup {
  id: string;
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  duration: number;
  bpm: number;
  key: string;
  syncOffset?: number;
  artistsList?: ArtistRole[];
  isDuet?: boolean;
  videoBgId?: string;
  videoBgTitle?: string;
  videoBgMode?: VideoBackgroundMode;
  videoBgCustomUrl?: string;
  vocalAutomation?: VocalAutomationConfig;
  rawLrc?: string;
  lyrics: LyricLine[];
  originalFileName: string;
  createdAt: number;
  updatedAt?: number;
}

/**
 * Gets the timestamp of the last successful backup export.
 */
export function getLastExportTimestamp(): number {
  try {
    const raw = localStorage.getItem(LAST_EXPORT_KEY);
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Sets the timestamp of the last successful backup export.
 */
export function setLastExportTimestamp(ts: number = Date.now()): void {
  try {
    localStorage.setItem(LAST_EXPORT_KEY, String(ts));
  } catch (err) {
    console.warn('Error saving last export timestamp:', err);
  }
}

/**
 * Returns songs that were added or modified since the last backup export.
 */
export function getModifiedOrNewSongs(songs: SongItem[]): SongItem[] {
  const lastTs = getLastExportTimestamp();
  if (lastTs === 0) return songs;
  return songs.filter((s) => {
    const songTime = s.updatedAt || s.createdAt || 0;
    return songTime > lastTs;
  });
}

/**
 * Sanitizes a string for safe filesystem folder/file naming.
 */
function sanitizeFilename(name: string): string {
  return (name || 'song')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * 1. Export metadata-only JSON backup (Fast, lightweight, <1 second).
 */
export function exportLibraryBackup(songs: SongItem[], profiles: SingerProfile[]): void {
  const cleanSongs: SongItemBackup[] = songs.map((s) => ({
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
    originalFileName: s.originalFileName,
    createdAt: s.createdAt || Date.now(),
    updatedAt: s.updatedAt || s.createdAt || Date.now(),
  }));

  const backupData: LibraryBackupData = {
    version: '2.0',
    app: 'KaraokeLab // CyberKaraoke',
    exportedAt: new Date().toISOString(),
    timestamp: Date.now(),
    totalSongs: cleanSongs.length,
    profiles: profiles || [],
    songs: cleanSongs,
  };

  const jsonStr = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `KaraokeLab_Metadatos_Letras_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  setLastExportTimestamp();
}

/**
 * 2. Export FULL or INCREMENTAL Library with AUDIO STEMS in a single portable .ZIP (.karaokelab) archive.
 */
export async function exportFullLibraryWithAudioZip(
  songs: SongItem[],
  profiles: SingerProfile[],
  onProgress?: (percent: number, message: string) => void,
  isIncremental = false
): Promise<void> {
  if (songs.length === 0) {
    throw new Error('No hay canciones para exportar.');
  }

  const zip = new JSZip();
  const rootManifest: LibraryBackupData = {
    version: '2.0',
    app: 'KaraokeLab // CyberKaraoke',
    exportedAt: new Date().toISOString(),
    timestamp: Date.now(),
    totalSongs: songs.length,
    profiles: profiles || [],
    songs: [],
  };

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    const songIndex = String(i + 1).padStart(2, '0');
    const folderName = `${songIndex}_${sanitizeFilename(song.artist)} - ${sanitizeFilename(song.title)}`;
    const songFolder = zip.folder(folderName);

    if (onProgress) {
      const p = Math.round(((i + 0.2) / songs.length) * 80);
      onProgress(p, `Empaquetando: ${song.title} (${i + 1}/${songs.length})`);
    }

    if (songFolder) {
      // 1. Audio Instrumental Stem (MP3 320 kbps Studio Quality)
      if (song.stems?.instrumentalBlob) {
        const mp3Blob = await convertWavBlobToMp3_320kbps(song.stems.instrumentalBlob);
        songFolder.file('instrumental.mp3', mp3Blob);
      } else if (song.audioBlob) {
        if (song.audioBlob.type.includes('wav') || song.originalFileName?.toLowerCase().endsWith('.wav')) {
          const mp3Blob = await convertWavBlobToMp3_320kbps(song.audioBlob);
          songFolder.file('audio.mp3', mp3Blob);
        } else {
          const ext = song.originalFileName?.split('.').pop() || 'mp3';
          songFolder.file(`audio.${ext}`, song.audioBlob);
        }
      }

      // 2. Audio Vocals Stem (MP3 320 kbps Studio Quality)
      if (song.stems?.vocalsBlob) {
        const mp3Blob = await convertWavBlobToMp3_320kbps(song.stems.vocalsBlob);
        songFolder.file('vocals.mp3', mp3Blob);
      }

      // 3. Audio Bass Stem (if available)
      if (song.stems?.bassBlob) {
        const mp3Blob = await convertWavBlobToMp3_320kbps(song.stems.bassBlob);
        songFolder.file('bass.mp3', mp3Blob);
      }

      // 4. Formatted LRC Lyrics
      const lrcContent = formatLRC(song.lyrics || []);
      songFolder.file('lyrics.lrc', lrcContent);

      // 5. Individual song metadata JSON
      const songMeta: SongItemBackup = {
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        genre: song.genre,
        duration: song.duration,
        bpm: song.bpm,
        key: song.key,
        syncOffset: song.syncOffset,
        isDuet: song.isDuet,
        videoBgId: song.videoBgId,
        videoBgTitle: song.videoBgTitle,
        videoBgMode: song.videoBgMode,
        videoBgCustomUrl: song.videoBgCustomUrl,
        vocalAutomation: song.vocalAutomation,
        rawLrc: song.rawLrc,
        lyrics: song.lyrics || [],
        originalFileName: song.originalFileName,
        createdAt: song.createdAt || Date.now(),
        updatedAt: song.updatedAt || song.createdAt || Date.now(),
      };
      songFolder.file('song.json', JSON.stringify(songMeta, null, 2));

      rootManifest.songs.push(songMeta);
    }
  }

  // Root Manifest
  zip.file('library_manifest.json', JSON.stringify(rootManifest, null, 2));

  if (onProgress) onProgress(85, 'Comprimiendo archivo ZIP con audios y stems...');

  const content = await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 4 }, // fast compression
    },
    (metadata) => {
      if (onProgress) {
        const p = 85 + Math.round((metadata.percent / 100) * 14);
        onProgress(p, `Generando paquete ZIP: ${Math.round(metadata.percent)}%`);
      }
    }
  );

  const dateStr = new Date().toISOString().slice(0, 10);
  const prefix = isIncremental ? 'KaraokeLab_INCREMENTAL_NUEVAS' : 'KaraokeLab_BIBLIOTECA_COMPLETA';
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${prefix}_${dateStr}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  setLastExportTimestamp();

  if (onProgress) onProgress(100, '✓ ¡Descarga del paquete de audio iniciada!');
}

/**
 * 3. UPDATE an existing ZIP backup by injecting new/modified songs without recompressing previous ones.
 */
export async function updateExistingZipWithSongs(
  existingZipFile: File,
  newOrUpdatedSongs: SongItem[],
  profiles: SingerProfile[],
  onProgress?: (percent: number, message: string) => void
): Promise<void> {
  if (onProgress) onProgress(15, 'Abriendo archivo ZIP existente...');

  const zip = await JSZip.loadAsync(existingZipFile);

  // Read existing manifest if any
  let manifestData: LibraryBackupData = {
    version: '2.0',
    app: 'KaraokeLab // CyberKaraoke',
    exportedAt: new Date().toISOString(),
    timestamp: Date.now(),
    totalSongs: 0,
    profiles: profiles || [],
    songs: [],
  };

  const manifestFile = zip.file('library_manifest.json');
  if (manifestFile) {
    try {
      const text = await manifestFile.async('text');
      manifestData = JSON.parse(text);
    } catch (e) {
      console.warn('Could not read existing manifest:', e);
    }
  }

  // Inject each new/updated song
  for (let i = 0; i < newOrUpdatedSongs.length; i++) {
    const song = newOrUpdatedSongs[i];
    if (onProgress) {
      const p = 20 + Math.round(((i + 1) / newOrUpdatedSongs.length) * 60);
      onProgress(p, `Inyectando en ZIP: ${song.title} (${i + 1}/${newOrUpdatedSongs.length})`);
    }

    const folderName = `update_${sanitizeFilename(song.artist)} - ${sanitizeFilename(song.title)}`;
    const songFolder = zip.folder(folderName);

    if (songFolder) {
      if (song.stems?.instrumentalBlob) {
        const mp3Blob = await convertWavBlobToMp3_320kbps(song.stems.instrumentalBlob);
        songFolder.file('instrumental.mp3', mp3Blob);
      } else if (song.audioBlob) {
        if (song.audioBlob.type.includes('wav') || song.originalFileName?.toLowerCase().endsWith('.wav')) {
          const mp3Blob = await convertWavBlobToMp3_320kbps(song.audioBlob);
          songFolder.file('audio.mp3', mp3Blob);
        } else {
          const ext = song.originalFileName?.split('.').pop() || 'mp3';
          songFolder.file(`audio.${ext}`, song.audioBlob);
        }
      }

      if (song.stems?.vocalsBlob) {
        const mp3Blob = await convertWavBlobToMp3_320kbps(song.stems.vocalsBlob);
        songFolder.file('vocals.mp3', mp3Blob);
      }
      if (song.stems?.bassBlob) {
        const mp3Blob = await convertWavBlobToMp3_320kbps(song.stems.bassBlob);
        songFolder.file('bass.mp3', mp3Blob);
      }

      const lrcContent = formatLRC(song.lyrics || []);
      songFolder.file('lyrics.lrc', lrcContent);

      const songMeta: SongItemBackup = {
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
        rawLrc: song.rawLrc,
        lyrics: song.lyrics || [],
        originalFileName: song.originalFileName,
        createdAt: song.createdAt || Date.now(),
        updatedAt: song.updatedAt || song.createdAt || Date.now(),
      };
      songFolder.file('song.json', JSON.stringify(songMeta, null, 2));

      // Update in manifest
      const existingIdx = manifestData.songs.findIndex((s) => s.id === song.id);
      if (existingIdx >= 0) {
        manifestData.songs[existingIdx] = songMeta;
      } else {
        manifestData.songs.push(songMeta);
      }
    }
  }

  manifestData.totalSongs = manifestData.songs.length;
  manifestData.profiles = profiles || manifestData.profiles;
  manifestData.exportedAt = new Date().toISOString();
  manifestData.timestamp = Date.now();

  zip.file('library_manifest.json', JSON.stringify(manifestData, null, 2));

  if (onProgress) onProgress(85, 'Guardando archivo ZIP actualizado...');

  const content = await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 4 },
    },
    (metadata) => {
      if (onProgress) {
        const p = 85 + Math.round((metadata.percent / 100) * 14);
        onProgress(p, `Finalizando ZIP: ${Math.round(metadata.percent)}%`);
      }
    }
  );

  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  // Keep the exact same filename (e.g. Biblioteca.klab or Biblioteca.zip) without creating duplicate suffixed files
  a.download = existingZipFile.name || 'Biblioteca_KaraokeLab.klab';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  setLastExportTimestamp();

  if (onProgress) onProgress(100, `✓ ¡${existingZipFile.name} actualizado con éxito!`);
}

/**
 * 4. Export a SINGLE song package with all its audio stems and lyrics.
 */
export async function exportSingleSongPackageZip(song: SongItem): Promise<void> {
  const zip = new JSZip();
  const baseName = `${sanitizeFilename(song.artist)} - ${sanitizeFilename(song.title)}`;

  // 1. Audio Instrumental
  if (song.stems?.instrumentalBlob) {
    zip.file('instrumental.wav', song.stems.instrumentalBlob);
  } else if (song.audioBlob) {
    const ext = song.originalFileName?.split('.').pop() || 'mp3';
    zip.file(`audio.${ext}`, song.audioBlob);
  }

  // 2. Audio Vocals Stem
  if (song.stems?.vocalsBlob) {
    zip.file('vocals.wav', song.stems.vocalsBlob);
  }

  // 3. Lyrics
  const lrcContent = formatLRC(song.lyrics || []);
  zip.file('lyrics.lrc', lrcContent);

  // 4. Metadata
  const songMeta: SongItemBackup = {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    genre: song.genre,
    duration: song.duration,
    bpm: song.bpm,
    key: song.key,
    syncOffset: song.syncOffset,
    isDuet: song.isDuet,
    videoBgId: song.videoBgId,
    videoBgTitle: song.videoBgTitle,
    videoBgMode: song.videoBgMode,
    videoBgCustomUrl: song.videoBgCustomUrl,
    vocalAutomation: song.vocalAutomation,
    rawLrc: song.rawLrc,
    lyrics: song.lyrics || [],
    originalFileName: song.originalFileName,
    createdAt: song.createdAt || Date.now(),
    updatedAt: song.updatedAt || song.createdAt || Date.now(),
  };
  zip.file('song.json', JSON.stringify(songMeta, null, 2));

  const content = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 4 } });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}_KaraokePackage.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 5. Universal Import: Handles BOTH .json metadata backups AND .zip full-audio packages!
 */
export async function importUniversalBackup(
  file: File,
  onProgress?: (percent: number, message: string) => void
): Promise<{
  importedSongsCount: number;
  importedProfilesCount: number;
  allSongs: SongItem[];
  allProfiles: SingerProfile[];
}> {
  const fileNameLower = file.name.toLowerCase();

  // If it's a JSON file → run fast metadata import
  if (fileNameLower.endsWith('.json')) {
    if (onProgress) onProgress(30, 'Importando metadatos y letras desde JSON...');
    const res = await importLibraryMetadataJSON(file);
    if (onProgress) onProgress(100, '✓ Metadatos importados.');
    return res;
  }

  // If it's a ZIP / Karaokelab package → extract audio files, stems & lyrics
  if (fileNameLower.endsWith('.zip') || fileNameLower.endsWith('.karaokelab')) {
    return importLibraryFromZip(file, onProgress);
  }

  throw new Error('Formato no soportado. Selecciona un archivo .zip o .json');
}

/**
 * Import from a ZIP containing full audio, stems, lyrics and metadata.
 */
async function importLibraryFromZip(
  file: File,
  onProgress?: (percent: number, message: string) => void
): Promise<{
  importedSongsCount: number;
  importedProfilesCount: number;
  allSongs: SongItem[];
  allProfiles: SingerProfile[];
}> {
  if (onProgress) onProgress(15, 'Descomprimiendo archivo ZIP de audio...');

  const zip = await JSZip.loadAsync(file);
  const existingSongs = await getSongsFromDB();
  const mergedSongs: SongItem[] = [...existingSongs];
  let importedSongsCount = 0;

  // Check if there is a root manifest
  const manifestFile = zip.file('library_manifest.json');
  let manifestData: LibraryBackupData | null = null;
  if (manifestFile) {
    try {
      const text = await manifestFile.async('text');
      manifestData = JSON.parse(text);
    } catch (e) {
      console.warn('Could not parse root library_manifest.json:', e);
    }
  }

  // Find all folders or root song
  const songJsonFiles = Object.keys(zip.files).filter((p) => p.endsWith('song.json'));

  if (songJsonFiles.length === 0) {
    // If no song.json, maybe it's a single song ZIP with audio + lrc
    const lrcFiles = Object.keys(zip.files).filter((p) => p.endsWith('.lrc'));
    const audioFiles = Object.keys(zip.files).filter((p) => /\.(mp3|wav|ogg|m4a|flac)$/i.test(p));

    if (audioFiles.length > 0) {
      let instBlob: Blob | undefined;
      let vocBlob: Blob | undefined;
      let mainAudioBlob: Blob | undefined;
      let lyrics: LyricLine[] = [];

      for (const aPath of audioFiles) {
        const fileObj = zip.file(aPath);
        if (!fileObj) continue;
        const blob = await fileObj.async('blob');
        if (aPath.includes('instrumental')) instBlob = blob;
        else if (aPath.includes('vocals') || aPath.includes('voz')) vocBlob = blob;
        else if (!mainAudioBlob) mainAudioBlob = blob;
      }

      if (lrcFiles.length > 0) {
        const lrcObj = zip.file(lrcFiles[0]);
        if (lrcObj) {
          const lrcText = await lrcObj.async('text');
          lyrics = parseLRC(lrcText);
        }
      }

      const songTitle = file.name.replace(/\.[^/.]+$/, '').replace(/_KaraokePackage/i, '');
      const newSong: SongItem = {
        id: `song_zip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        title: songTitle,
        artist: 'Desconocido',
        album: '',
        genre: 'General',
        duration: 180,
        bpm: 120,
        key: 'Am',
        lyrics,
        originalFileName: file.name,
        audioBlob: mainAudioBlob || instBlob,
        stems: instBlob || vocBlob ? { instrumentalBlob: instBlob, vocalsBlob: vocBlob } : undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveSongToDB(newSong);
      mergedSongs.push(newSong);
      importedSongsCount++;
    }
  } else {
    // Process each song folder in the ZIP
    for (let i = 0; i < songJsonFiles.length; i++) {
      const jsonPath = songJsonFiles[i];
      const folderPrefix = jsonPath.substring(0, jsonPath.lastIndexOf('song.json'));
      const jsonFile = zip.file(jsonPath);
      if (!jsonFile) continue;

      if (onProgress) {
        const p = 20 + Math.round(((i + 1) / songJsonFiles.length) * 70);
        onProgress(p, `Extrayendo pistas de audio (${i + 1}/${songJsonFiles.length})...`);
      }

      try {
        const jsonText = await jsonFile.async('text');
        const songMeta: SongItemBackup = JSON.parse(jsonText);

        let instrumentalBlob: Blob | undefined;
        let vocalsBlob: Blob | undefined;
        let bassBlob: Blob | undefined;
        let genericAudioBlob: Blob | undefined;

        const folderFiles = Object.keys(zip.files).filter((p) => p.startsWith(folderPrefix) && p !== jsonPath);

        for (const fPath of folderFiles) {
          const fObj = zip.file(fPath);
          if (!fObj) continue;
          const fileName = fPath.substring(folderPrefix.length).toLowerCase();

          if (fileName.includes('instrumental')) {
            instrumentalBlob = await fObj.async('blob');
          } else if (fileName.includes('vocals') || fileName.includes('voz')) {
            vocalsBlob = await fObj.async('blob');
          } else if (fileName.includes('bass') || fileName.includes('bajo')) {
            bassBlob = await fObj.async('blob');
          } else if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(fileName)) {
            genericAudioBlob = await fObj.async('blob');
          }
        }

        let finalLyrics = songMeta.lyrics || [];
        const lrcPath = `${folderPrefix}lyrics.lrc`;
        const lrcFile = zip.file(lrcPath);
        if (lrcFile && finalLyrics.length === 0) {
          const lrcText = await lrcFile.async('text');
          finalLyrics = parseLRC(lrcText);
        }

        const matchIdx = mergedSongs.findIndex(
          (s) =>
            s.id === songMeta.id ||
            (s.title.toLowerCase().trim() === songMeta.title.toLowerCase().trim() &&
              (s.artist || '').toLowerCase().trim() === (songMeta.artist || '').toLowerCase().trim())
        );

        if (matchIdx >= 0) {
          const existing = mergedSongs[matchIdx];
          const updated: SongItem = {
            ...existing,
            title: songMeta.title || existing.title,
            artist: songMeta.artist || existing.artist,
            album: songMeta.album || existing.album,
            genre: songMeta.genre || existing.genre,
            bpm: songMeta.bpm || existing.bpm,
            key: songMeta.key || existing.key,
            duration: songMeta.duration || existing.duration,
            syncOffset: songMeta.syncOffset !== undefined ? songMeta.syncOffset : existing.syncOffset,
            artistsList: songMeta.artistsList || existing.artistsList,
            isDuet: songMeta.isDuet !== undefined ? songMeta.isDuet : existing.isDuet,
            videoBgId: songMeta.videoBgId || existing.videoBgId,
            videoBgTitle: songMeta.videoBgTitle || existing.videoBgTitle,
            videoBgMode: songMeta.videoBgMode || existing.videoBgMode,
            videoBgCustomUrl: songMeta.videoBgCustomUrl || existing.videoBgCustomUrl,
            vocalAutomation: songMeta.vocalAutomation || existing.vocalAutomation,
            lyrics: finalLyrics.length > 0 ? finalLyrics : existing.lyrics,
            rawLrc: songMeta.rawLrc || existing.rawLrc,
            audioBlob: genericAudioBlob || existing.audioBlob,
            stems:
              instrumentalBlob || vocalsBlob || bassBlob
                ? {
                    instrumentalBlob: instrumentalBlob || existing.stems?.instrumentalBlob,
                    vocalsBlob: vocalsBlob || existing.stems?.vocalsBlob,
                    bassBlob: bassBlob || existing.stems?.bassBlob,
                  }
                : existing.stems,
            updatedAt: songMeta.updatedAt || Date.now(),
          };
          await saveSongToDB(updated);
          mergedSongs[matchIdx] = updated;
          importedSongsCount++;
        } else {
          const newSong: SongItem = {
            id: songMeta.id || `song_zip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}_${i}`,
            title: songMeta.title,
            artist: songMeta.artist || 'Desconocido',
            album: songMeta.album || '',
            genre: songMeta.genre || 'General',
            duration: songMeta.duration || 180,
            bpm: songMeta.bpm || 120,
            key: songMeta.key || 'Am',
            lyrics: finalLyrics,
            rawLrc: songMeta.rawLrc || '',
            originalFileName: songMeta.originalFileName || `${songMeta.title}.mp3`,
            syncOffset: songMeta.syncOffset ?? 0.0,
            artistsList: songMeta.artistsList,
            isDuet: songMeta.isDuet,
            videoBgId: songMeta.videoBgId,
            videoBgTitle: songMeta.videoBgTitle,
            videoBgMode: songMeta.videoBgMode,
            videoBgCustomUrl: songMeta.videoBgCustomUrl,
            vocalAutomation: songMeta.vocalAutomation,
            createdAt: songMeta.createdAt || Date.now(),
            updatedAt: songMeta.updatedAt || songMeta.createdAt || Date.now(),
            audioBlob: genericAudioBlob || instrumentalBlob,
            stems:
              instrumentalBlob || vocalsBlob || bassBlob
                ? {
                    instrumentalBlob,
                    vocalsBlob,
                    bassBlob,
                  }
                : undefined,
          };
          await saveSongToDB(newSong);
          mergedSongs.push(newSong);
          importedSongsCount++;
        }
      } catch (err) {
        console.warn('Error reading song entry in ZIP:', err);
      }
    }
  }

  // Restore Singer Profiles if present in manifest
  let importedProfilesCount = 0;
  let allProfiles = getProfilesFromStorage();

  if (manifestData && Array.isArray(manifestData.profiles) && manifestData.profiles.length > 0) {
    const existingProfilesMap = new Map<string, SingerProfile>(allProfiles.map((p) => [p.id, p]));
    for (const bProf of manifestData.profiles) {
      if (!bProf.id || !bProf.name) continue;
      if (existingProfilesMap.has(bProf.id)) {
        const existing = existingProfilesMap.get(bProf.id)!;
        const mergedFavs = Array.from(new Set([...existing.favoriteSongIds, ...(bProf.favoriteSongIds || [])]));
        existingProfilesMap.set(bProf.id, { ...existing, ...bProf, favoriteSongIds: mergedFavs });
      } else {
        existingProfilesMap.set(bProf.id, bProf);
        importedProfilesCount++;
      }
    }
    allProfiles = Array.from(existingProfilesMap.values());
    saveProfilesToStorage(allProfiles);
  }

  if (onProgress) onProgress(100, `✓ ¡${importedSongsCount} canciones y audios restaurados con éxito!`);

  return {
    importedSongsCount,
    importedProfilesCount,
    allSongs: mergedSongs,
    allProfiles,
  };
}

/**
 * Import from a JSON metadata file.
 */
async function importLibraryMetadataJSON(file: File): Promise<{
  importedSongsCount: number;
  importedProfilesCount: number;
  allSongs: SongItem[];
  allProfiles: SingerProfile[];
}> {
  const text = await file.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('El archivo no es un JSON válido de respaldo.');
  }

  const backupSongs: SongItemBackup[] = Array.isArray(parsed.songs)
    ? parsed.songs
    : Array.isArray(parsed)
    ? parsed
    : [];

  if (backupSongs.length === 0 && (!parsed.profiles || parsed.profiles.length === 0)) {
    throw new Error('No se encontraron canciones ni perfiles válidos en el archivo.');
  }

  const existingSongs = await getSongsFromDB();
  let importedSongsCount = 0;
  const mergedSongs: SongItem[] = [...existingSongs];

  for (const bSong of backupSongs) {
    if (!bSong.title) continue;

    const matchById = existingSongs.find((s) => s.id === bSong.id);
    const matchByTitleArtist = existingSongs.find(
      (s) =>
        s.title.toLowerCase().trim() === bSong.title.toLowerCase().trim() &&
        (s.artist || '').toLowerCase().trim() === (bSong.artist || '').toLowerCase().trim()
    );

    const existingMatch = matchById || matchByTitleArtist;

    if (existingMatch) {
      const updated: SongItem = {
        ...existingMatch,
        title: bSong.title || existingMatch.title,
        artist: bSong.artist || existingMatch.artist,
        album: bSong.album || existingMatch.album,
        genre: bSong.genre || existingMatch.genre,
        bpm: bSong.bpm || existingMatch.bpm,
        key: bSong.key || existingMatch.key,
        duration: bSong.duration || existingMatch.duration,
        syncOffset: bSong.syncOffset !== undefined ? bSong.syncOffset : existingMatch.syncOffset,
        artistsList: bSong.artistsList || existingMatch.artistsList,
        isDuet: bSong.isDuet !== undefined ? bSong.isDuet : existingMatch.isDuet,
        videoBgId: bSong.videoBgId || existingMatch.videoBgId,
        videoBgTitle: bSong.videoBgTitle || existingMatch.videoBgTitle,
        videoBgMode: bSong.videoBgMode || existingMatch.videoBgMode,
        videoBgCustomUrl: bSong.videoBgCustomUrl || existingMatch.videoBgCustomUrl,
        lyrics: bSong.lyrics && bSong.lyrics.length > 0 ? bSong.lyrics : existingMatch.lyrics,
        rawLrc: bSong.rawLrc || existingMatch.rawLrc,
        updatedAt: bSong.updatedAt || Date.now(),
      };

      await saveSongToDB(updated);
      const idx = mergedSongs.findIndex((s) => s.id === existingMatch.id);
      if (idx >= 0) mergedSongs[idx] = updated;
      importedSongsCount++;
    } else {
      const newSong: SongItem = {
        id: bSong.id || `song_backup_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        title: bSong.title,
        artist: bSong.artist || 'Desconocido',
        album: bSong.album || '',
        genre: bSong.genre || 'General',
        duration: bSong.duration || 180,
        bpm: bSong.bpm || 120,
        key: bSong.key || 'Am',
        lyrics: bSong.lyrics || [],
        rawLrc: bSong.rawLrc || '',
        originalFileName: bSong.originalFileName || `${bSong.title}.mp3`,
        syncOffset: bSong.syncOffset ?? 0.0,
        artistsList: bSong.artistsList,
        isDuet: bSong.isDuet,
        videoBgId: bSong.videoBgId,
        videoBgTitle: bSong.videoBgTitle,
        videoBgMode: bSong.videoBgMode,
        videoBgCustomUrl: bSong.videoBgCustomUrl,
        createdAt: bSong.createdAt || Date.now(),
        updatedAt: bSong.updatedAt || bSong.createdAt || Date.now(),
      };

      await saveSongToDB(newSong);
      mergedSongs.push(newSong);
      importedSongsCount++;
    }
  }

  let importedProfilesCount = 0;
  let allProfiles = getProfilesFromStorage();

  if (Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
    const existingProfilesMap = new Map<string, SingerProfile>(allProfiles.map((p) => [p.id, p]));
    for (const bProf of parsed.profiles) {
      if (!bProf.id || !bProf.name) continue;
      if (existingProfilesMap.has(bProf.id)) {
        const existing = existingProfilesMap.get(bProf.id)!;
        const mergedFavs = Array.from(new Set([...existing.favoriteSongIds, ...(bProf.favoriteSongIds || [])]));
        existingProfilesMap.set(bProf.id, { ...existing, ...bProf, favoriteSongIds: mergedFavs });
      } else {
        existingProfilesMap.set(bProf.id, bProf);
        importedProfilesCount++;
      }
    }
    allProfiles = Array.from(existingProfilesMap.values());
    saveProfilesToStorage(allProfiles);
  }

  return {
    importedSongsCount,
    importedProfilesCount,
    allSongs: mergedSongs,
    allProfiles,
  };
}
