import JSZip from 'jszip';
import { SongItem, SingerProfile, LyricLine, ArtistRole, VideoBackgroundMode, VocalAutomationConfig, YouTubeFavoriteTrack } from '../types';
import { saveSongToDB, getSongsFromDB, saveProfilesToStorage, getProfilesFromStorage, saveYouTubeFavoritesToStorage, getYouTubeFavoritesFromStorage } from './db';
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
  youtubeFavorites?: YouTubeFavoriteTrack[];
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
    youtubeFavorites: getYouTubeFavoritesFromStorage(),
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
    youtubeFavorites: getYouTubeFavoritesFromStorage(),
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

      if (song.stems?.backingBlob) {
        const mp3Blob = await convertWavBlobToMp3_320kbps(song.stems.backingBlob);
        songFolder.file('coros.mp3', mp3Blob);
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
        hasBackingVocals: !!song.stems?.backingBlob || song.hasBackingVocals || false,
        backingVocalsFile: song.stems?.backingBlob ? 'coros.mp3' : song.backingVocalsFile,
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
  const playerManifest = {
    version: '1.0.0',
    updatedAt: Date.now(),
    profiles: profiles || [],
    youtubeFavorites: getYouTubeFavoritesFromStorage(),
    songs: rootManifest.songs.map((s, idx) => {
      const sIdx = String(idx + 1).padStart(2, '0');
      const fName = `${sIdx}_${sanitizeFilename(s.artist)} - ${sanitizeFilename(s.title)}`;
      return {
        ...s,
        folder: fName,
        audioFile: `${fName}/instrumental.mp3`,
        vocalsFile: s.vocalAutomation || s.lyrics ? `${fName}/vocals.mp3` : undefined,
        lrcFile: `${fName}/lyrics.lrc`,
      };
    }),
  };
  zip.file('manifest.json', JSON.stringify(playerManifest, null, 2));
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

  const manifestFile = zip.file('manifest.json') || zip.file('library_manifest.json');
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

      if (song.stems?.backingBlob) {
        const mp3Blob = await convertWavBlobToMp3_320kbps(song.stems.backingBlob);
        songFolder.file('coros.mp3', mp3Blob);
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

  // If it's a ZIP / Karaokelab package (.zip, .karaokelab, .klab) → extract audio files, stems & lyrics
  if (fileNameLower.endsWith('.zip') || fileNameLower.endsWith('.karaokelab') || fileNameLower.endsWith('.klab')) {
    return importLibraryFromZip(file, onProgress);
  }

  throw new Error('Formato no soportado. Selecciona un archivo .klab, .zip o .json');
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
  const idMapping = new Map<string, string>(); // maps manifest/song.json id -> actual ID in database

  // 1. Locate and parse manifest (manifest.json, library_manifest.json, karaokelab_manifest.json)
  let manifestData: any = null;
  const manifestFileNames = ['manifest.json', 'library_manifest.json', 'karaokelab_manifest.json'];
  let manifestZipObj: JSZip.JSZipObject | null = null;

  for (const name of manifestFileNames) {
    const direct = zip.file(name);
    if (direct) {
      manifestZipObj = direct;
      break;
    }
  }

  if (!manifestZipObj) {
    const manifestPath = Object.keys(zip.files).find(
      (p) => !zip.files[p].dir && /(?:^|\/)(?:manifest|library_manifest|karaokelab_manifest)\.json$/i.test(p)
    );
    if (manifestPath) {
      manifestZipObj = zip.file(manifestPath);
    }
  }

  if (manifestZipObj) {
    try {
      const text = await manifestZipObj.async('text');
      manifestData = JSON.parse(text);
    } catch (e) {
      console.warn('Could not parse manifest JSON from ZIP:', e);
    }
  }

  // 2. Discover song entries
  const songJsonFiles = Object.keys(zip.files).filter((p) => /(?:^|\/)song\.json$/i.test(p) && !zip.files[p].dir);

  if (songJsonFiles.length > 0) {
    // Process each song folder containing a song.json
    for (let i = 0; i < songJsonFiles.length; i++) {
      const jsonPath = songJsonFiles[i];
      const folderPrefix = jsonPath.substring(0, jsonPath.lastIndexOf('song.json'));
      const jsonFile = zip.file(jsonPath);
      if (!jsonFile) continue;

      if (onProgress) {
        const p = 20 + Math.round(((i + 1) / songJsonFiles.length) * 65);
        onProgress(p, `Extrayendo canciones (${i + 1}/${songJsonFiles.length})...`);
      }

      try {
        const jsonText = await jsonFile.async('text');
        const songMeta: SongItemBackup = JSON.parse(jsonText);

        let instrumentalBlob: Blob | undefined;
        let vocalsBlob: Blob | undefined;
        let backingBlob: Blob | undefined;
        let bassBlob: Blob | undefined;
        let genericAudioBlob: Blob | undefined;

        const folderFiles = Object.keys(zip.files).filter((p) => p.startsWith(folderPrefix) && p !== jsonPath && !zip.files[p].dir);

        for (const fPath of folderFiles) {
          const fObj = zip.file(fPath);
          if (!fObj) continue;
          const fileName = fPath.substring(folderPrefix.length).toLowerCase();

          if (fileName.includes('instrumental')) {
            instrumentalBlob = await fObj.async('blob');
          } else if (fileName.includes('coros') || fileName.includes('backing')) {
            backingBlob = await fObj.async('blob');
          } else if (fileName.includes('vocal') || fileName.includes('voz')) {
            vocalsBlob = await fObj.async('blob');
          } else if (fileName.includes('bass') || fileName.includes('bajo')) {
            bassBlob = await fObj.async('blob');
          } else if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(fileName)) {
            genericAudioBlob = await fObj.async('blob');
          }
        }

        // Direct lookup from metadata filenames if blobs not found by name pattern
        if (!vocalsBlob && songMeta.vocalsFile) {
          const vName = songMeta.vocalsFile.split('/').pop() || songMeta.vocalsFile;
          const vFile = zip.file(`${folderPrefix}${vName}`) || zip.file(songMeta.vocalsFile) || zip.file(`${folderPrefix}vocals.mp3`) || zip.file(`${folderPrefix}vocal.mp3`);
          if (vFile) vocalsBlob = await vFile.async('blob');
        }
        if (!backingBlob && ((songMeta as any).backingVocalsFile || (songMeta as any).hasBackingVocals)) {
          const bName = (songMeta as any).backingVocalsFile?.split('/').pop() || 'coros.mp3';
          const bFile = zip.file(`${folderPrefix}${bName}`) || zip.file((songMeta as any).backingVocalsFile || '') || zip.file(`${folderPrefix}coros.mp3`) || zip.file(`${folderPrefix}backing.mp3`);
          if (bFile) backingBlob = await bFile.async('blob');
        }
        if (!instrumentalBlob && songMeta.audioFile) {
          const aName = songMeta.audioFile.split('/').pop() || songMeta.audioFile;
          const aFile = zip.file(`${folderPrefix}${aName}`) || zip.file(songMeta.audioFile) || zip.file(`${folderPrefix}instrumental.mp3`);
          if (aFile) instrumentalBlob = await aFile.async('blob');
        }

        let finalLyrics = songMeta.lyrics || [];
        const lrcCandidate = Object.keys(zip.files).find((p) => p.startsWith(folderPrefix) && /\.lrc$/i.test(p) && !zip.files[p].dir);
        if (lrcCandidate && finalLyrics.length === 0) {
          const lrcObj = zip.file(lrcCandidate);
          if (lrcObj) {
            const lrcText = await lrcObj.async('text');
            finalLyrics = parseLRC(lrcText);
          }
        }

        const rawSongId = songMeta.id || `song_zip_${Date.now()}_${i}`;
        const matchIdx = mergedSongs.findIndex(
          (s) =>
            s.id === songMeta.id ||
            (s.title.toLowerCase().trim() === (songMeta.title || '').toLowerCase().trim() &&
              (s.artist || '').toLowerCase().trim() === (songMeta.artist || '').toLowerCase().trim())
        );

        if (matchIdx >= 0) {
          const existing = mergedSongs[matchIdx];
          const finalId = existing.id;
          idMapping.set(rawSongId, finalId);
          idMapping.set(finalId, finalId);

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
            audioBlob: instrumentalBlob || genericAudioBlob || existing.audioBlob,
            stems:
              instrumentalBlob || vocalsBlob || backingBlob || bassBlob
                ? {
                    instrumentalBlob: instrumentalBlob || existing.stems?.instrumentalBlob,
                    vocalsBlob: vocalsBlob || existing.stems?.vocalsBlob,
                    backingBlob: backingBlob || existing.stems?.backingBlob,
                    bassBlob: bassBlob || existing.stems?.bassBlob,
                  }
                : existing.stems,
            hasBackingVocals: !!backingBlob || !!existing.stems?.backingBlob || (songMeta as any).hasBackingVocals || false,
            backingVocalsFile: (songMeta as any).backingVocalsFile || (backingBlob ? 'coros.mp3' : existing.backingVocalsFile),
            updatedAt: songMeta.updatedAt || Date.now(),
          };
          await saveSongToDB(updated);
          mergedSongs[matchIdx] = updated;
          importedSongsCount++;
        } else {
          const finalId = rawSongId;
          idMapping.set(rawSongId, finalId);

          const newSong: SongItem = {
            id: finalId,
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
            audioBlob: instrumentalBlob || genericAudioBlob,
            stems:
              instrumentalBlob || vocalsBlob || backingBlob || bassBlob
                ? {
                    instrumentalBlob,
                    vocalsBlob,
                    backingBlob,
                    bassBlob,
                  }
                : undefined,
            hasBackingVocals: !!backingBlob || (songMeta as any).hasBackingVocals || false,
            backingVocalsFile: (songMeta as any).backingVocalsFile || (backingBlob ? 'coros.mp3' : undefined),
          };
          await saveSongToDB(newSong);
          mergedSongs.push(newSong);
          importedSongsCount++;
        }
      } catch (err) {
        console.warn('Error reading song entry in ZIP:', err);
      }
    }
  } else if (manifestData && Array.isArray(manifestData.songs) && manifestData.songs.length > 0) {
    // Process songs defined in manifest.json when individual song.json files are not present
    const mSongs = manifestData.songs;
    for (let i = 0; i < mSongs.length; i++) {
      const s = mSongs[i];
      if (onProgress) {
        const p = 20 + Math.round(((i + 1) / mSongs.length) * 65);
        onProgress(p, `Extrayendo canciones del catálogo (${i + 1}/${mSongs.length})...`);
      }

      try {
        const folderPrefix = s.folder ? (s.folder.endsWith('/') ? s.folder : `${s.folder}/`) : '';
        let instrumentalBlob: Blob | undefined;
        let vocalsBlob: Blob | undefined;
        let backingBlob: Blob | undefined;
        let genericAudioBlob: Blob | undefined;

        // Try exact paths from manifest
        if (s.audioFile) {
          const aObj = zip.file(s.audioFile) || zip.file(`${folderPrefix}${s.audioFile.split('/').pop()}`);
          if (aObj) instrumentalBlob = await aObj.async('blob');
        }
        if (s.vocalsFile) {
          const vObj = zip.file(s.vocalsFile) || zip.file(`${folderPrefix}${s.vocalsFile.split('/').pop()}`);
          if (vObj) vocalsBlob = await vObj.async('blob');
        }
        if (s.backingVocalsFile) {
          const bObj = zip.file(s.backingVocalsFile) || zip.file(`${folderPrefix}${s.backingVocalsFile.split('/').pop()}`);
          if (bObj) backingBlob = await bObj.async('blob');
        }

        // Search folder if files not found
        if (folderPrefix) {
          const folderFiles = Object.keys(zip.files).filter((p) => p.startsWith(folderPrefix) && !zip.files[p].dir);
          for (const fPath of folderFiles) {
            const fObj = zip.file(fPath);
            if (!fObj) continue;
            const fileName = fPath.substring(folderPrefix.length).toLowerCase();
            if (!instrumentalBlob && fileName.includes('instrumental')) {
              instrumentalBlob = await fObj.async('blob');
            } else if (!backingBlob && (fileName.includes('coros') || fileName.includes('backing'))) {
              backingBlob = await fObj.async('blob');
            } else if (!vocalsBlob && (fileName.includes('vocal') || fileName.includes('voz'))) {
              vocalsBlob = await fObj.async('blob');
            } else if (!genericAudioBlob && /\.(mp3|wav|ogg|m4a|flac)$/i.test(fileName)) {
              genericAudioBlob = await fObj.async('blob');
            }
          }
        }

        let finalLyrics = s.lyrics || [];
        if (finalLyrics.length === 0) {
          const lrcPath = s.lrcFile || `${folderPrefix}lyrics.lrc`;
          const lrcObj = zip.file(lrcPath) || (folderPrefix ? zip.file(Object.keys(zip.files).find((p) => p.startsWith(folderPrefix) && /\.lrc$/i.test(p)) || '') : null);
          if (lrcObj) {
            const lrcText = await lrcObj.async('text');
            finalLyrics = parseLRC(lrcText);
          }
        }

        const rawSongId = s.id || `song_manifest_${Date.now()}_${i}`;
        const matchIdx = mergedSongs.findIndex(
          (ex) =>
            ex.id === s.id ||
            (ex.title.toLowerCase().trim() === (s.title || '').toLowerCase().trim() &&
              (ex.artist || '').toLowerCase().trim() === (s.artist || '').toLowerCase().trim())
        );

        if (matchIdx >= 0) {
          const existing = mergedSongs[matchIdx];
          const finalId = existing.id;
          idMapping.set(rawSongId, finalId);
          idMapping.set(finalId, finalId);

          const updated: SongItem = {
            ...existing,
            title: s.title || existing.title,
            artist: s.artist || existing.artist,
            album: s.album || existing.album,
            genre: s.genre || existing.genre,
            bpm: s.bpm || existing.bpm,
            key: s.key || existing.key,
            duration: s.duration || existing.duration,
            syncOffset: s.syncOffset !== undefined ? s.syncOffset : existing.syncOffset,
            artistsList: s.artistsList || existing.artistsList,
            isDuet: s.isDuet !== undefined ? s.isDuet : existing.isDuet,
            videoBgId: s.videoBgId || existing.videoBgId,
            videoBgTitle: s.videoBgTitle || existing.videoBgTitle,
            videoBgMode: s.videoBgMode || existing.videoBgMode,
            videoBgCustomUrl: s.videoBgCustomUrl || existing.videoBgCustomUrl,
            vocalAutomation: s.vocalAutomation || existing.vocalAutomation,
            lyrics: finalLyrics.length > 0 ? finalLyrics : existing.lyrics,
            rawLrc: s.rawLrc || existing.rawLrc,
            audioBlob: instrumentalBlob || genericAudioBlob || existing.audioBlob,
            stems:
              instrumentalBlob || vocalsBlob || backingBlob
                ? {
                    instrumentalBlob: instrumentalBlob || existing.stems?.instrumentalBlob,
                    vocalsBlob: vocalsBlob || existing.stems?.vocalsBlob,
                    backingBlob: backingBlob || existing.stems?.backingBlob,
                  }
                : existing.stems,
            hasBackingVocals: !!backingBlob || !!existing.stems?.backingBlob || s.hasBackingVocals || false,
            backingVocalsFile: s.backingVocalsFile || (backingBlob ? 'coros.mp3' : existing.backingVocalsFile),
            updatedAt: s.updatedAt || Date.now(),
          };
          await saveSongToDB(updated);
          mergedSongs[matchIdx] = updated;
          importedSongsCount++;
        } else {
          const finalId = rawSongId;
          idMapping.set(rawSongId, finalId);

          const newSong: SongItem = {
            id: finalId,
            title: s.title,
            artist: s.artist || 'Desconocido',
            album: s.album || '',
            genre: s.genre || 'General',
            duration: s.duration || 180,
            bpm: s.bpm || 120,
            key: s.key || 'Am',
            lyrics: finalLyrics,
            rawLrc: s.rawLrc || '',
            originalFileName: s.originalFileName || s.audioFile || `${s.title}.mp3`,
            syncOffset: s.syncOffset ?? 0.0,
            artistsList: s.artistsList,
            isDuet: s.isDuet,
            videoBgId: s.videoBgId,
            videoBgTitle: s.videoBgTitle,
            videoBgMode: s.videoBgMode,
            videoBgCustomUrl: s.videoBgCustomUrl,
            vocalAutomation: s.vocalAutomation,
            createdAt: s.createdAt || Date.now(),
            updatedAt: s.updatedAt || s.createdAt || Date.now(),
            audioBlob: instrumentalBlob || genericAudioBlob,
            stems:
              instrumentalBlob || vocalsBlob || backingBlob
                ? {
                    instrumentalBlob,
                    vocalsBlob,
                    backingBlob,
                  }
                : undefined,
            hasBackingVocals: !!backingBlob || s.hasBackingVocals || false,
            backingVocalsFile: s.backingVocalsFile || (backingBlob ? 'coros.mp3' : undefined),
          };
          await saveSongToDB(newSong);
          mergedSongs.push(newSong);
          importedSongsCount++;
        }
      } catch (err) {
        console.warn('Error reading manifest song in ZIP:', err);
      }
    }
  } else {
    // Single song ZIP fallback
    const lrcFiles = Object.keys(zip.files).filter((p) => p.endsWith('.lrc') && !zip.files[p].dir);
    const audioFiles = Object.keys(zip.files).filter((p) => /\.(mp3|wav|ogg|m4a|flac)$/i.test(p) && !zip.files[p].dir);

    if (audioFiles.length > 0) {
      let instBlob: Blob | undefined;
      let vocBlob: Blob | undefined;
      let backingBlob: Blob | undefined;
      let mainAudioBlob: Blob | undefined;
      let lyrics: LyricLine[] = [];

      for (const aPath of audioFiles) {
        const fileObj = zip.file(aPath);
        if (!fileObj) continue;
        const blob = await fileObj.async('blob');
        const low = aPath.toLowerCase();
        if (low.includes('instrumental')) instBlob = blob;
        else if (low.includes('coros') || low.includes('backing')) backingBlob = blob;
        else if (low.includes('vocal') || low.includes('voz')) vocBlob = blob;
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
      const rawSongId = `song_zip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const newSong: SongItem = {
        id: rawSongId,
        title: songTitle,
        artist: 'Desconocido',
        album: '',
        genre: 'General',
        duration: 180,
        bpm: 120,
        key: 'Am',
        lyrics,
        originalFileName: file.name,
        audioBlob: instBlob || mainAudioBlob,
        stems: instBlob || vocBlob || backingBlob ? { instrumentalBlob: instBlob, vocalsBlob: vocBlob, backingBlob } : undefined,
        hasBackingVocals: !!backingBlob,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveSongToDB(newSong);
      mergedSongs.push(newSong);
      idMapping.set(rawSongId, rawSongId);
      importedSongsCount++;
    }
  }

  // 3. Restore Singer Profiles and Favorites from Manifest
  let importedProfilesCount = 0;
  let allProfiles = getProfilesFromStorage();

  const manifestProfiles: SingerProfile[] =
    manifestData && Array.isArray(manifestData.profiles) && manifestData.profiles.length > 0
      ? manifestData.profiles
      : [];

  if (manifestProfiles.length > 0) {
    const existingProfilesMap = new Map<string, SingerProfile>(allProfiles.map((p) => [p.id, p]));

    for (const bProf of manifestProfiles) {
      if (!bProf.id || !bProf.name) continue;

      // Remap favorite song IDs using idMapping
      const rawFavs = Array.isArray(bProf.favoriteSongIds) ? bProf.favoriteSongIds : [];
      const mappedFavs = rawFavs.map((fId) => (idMapping.has(fId) ? idMapping.get(fId)! : fId));

      if (existingProfilesMap.has(bProf.id)) {
        const existing = existingProfilesMap.get(bProf.id)!;
        const mergedFavs = Array.from(new Set([...existing.favoriteSongIds, ...mappedFavs]));
        existingProfilesMap.set(bProf.id, {
          ...existing,
          ...bProf,
          favoriteSongIds: mergedFavs,
        });
      } else {
        existingProfilesMap.set(bProf.id, {
          ...bProf,
          favoriteSongIds: Array.from(new Set(mappedFavs)),
        });
        importedProfilesCount++;
      }
    }

    allProfiles = Array.from(existingProfilesMap.values());
    saveProfilesToStorage(allProfiles);
  }

  // 4. Restore YouTube Favorites from Manifest
  const rawYtFavs = manifestData?.youtubeFavorites || (manifestData as any)?.favorites;
  if (Array.isArray(rawYtFavs) && rawYtFavs.length > 0) {
    const existingYtFavs = getYouTubeFavoritesFromStorage();
    const existingYtIds = new Set(existingYtFavs.map((y) => y.id));
    const mergedYtFavs = [...existingYtFavs];

    for (const yf of rawYtFavs) {
      if (yf && yf.id && !existingYtIds.has(yf.id)) {
        mergedYtFavs.push(yf);
        existingYtIds.add(yf.id);
      }
    }
    saveYouTubeFavoritesToStorage(mergedYtFavs);
  }

  if (onProgress) onProgress(100, `✓ ¡${importedSongsCount} canciones y perfiles restaurados con éxito!`);

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
  const idMapping = new Map<string, string>();

  for (let i = 0; i < backupSongs.length; i++) {
    const bSong = backupSongs[i];
    if (!bSong.title) continue;

    const rawSongId = bSong.id || `song_backup_${Date.now()}_${i}`;
    const matchById = existingSongs.find((s) => s.id === bSong.id);
    const matchByTitleArtist = existingSongs.find(
      (s) =>
        s.title.toLowerCase().trim() === bSong.title.toLowerCase().trim() &&
        (s.artist || '').toLowerCase().trim() === (bSong.artist || '').toLowerCase().trim()
    );

    const existingMatch = matchById || matchByTitleArtist;

    if (existingMatch) {
      const finalId = existingMatch.id;
      idMapping.set(rawSongId, finalId);
      idMapping.set(finalId, finalId);

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
      const finalId = rawSongId;
      idMapping.set(rawSongId, finalId);

      const newSong: SongItem = {
        id: finalId,
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

      const rawFavs = Array.isArray(bProf.favoriteSongIds) ? bProf.favoriteSongIds : [];
      const mappedFavs = rawFavs.map((fId) => (idMapping.has(fId) ? idMapping.get(fId)! : fId));

      if (existingProfilesMap.has(bProf.id)) {
        const existing = existingProfilesMap.get(bProf.id)!;
        const mergedFavs = Array.from(new Set([...existing.favoriteSongIds, ...mappedFavs]));
        existingProfilesMap.set(bProf.id, { ...existing, ...bProf, favoriteSongIds: mergedFavs });
      } else {
        existingProfilesMap.set(bProf.id, { ...bProf, favoriteSongIds: Array.from(new Set(mappedFavs)) });
        importedProfilesCount++;
      }
    }
    allProfiles = Array.from(existingProfilesMap.values());
    saveProfilesToStorage(allProfiles);
  }

  // Restore YouTube Favorites if present
  const rawYtFavs = parsed.youtubeFavorites || parsed.favorites;
  if (Array.isArray(rawYtFavs) && rawYtFavs.length > 0) {
    const existingYtFavs = getYouTubeFavoritesFromStorage();
    const existingYtIds = new Set(existingYtFavs.map((y) => y.id));
    const mergedYtFavs = [...existingYtFavs];

    for (const yf of rawYtFavs) {
      if (yf && yf.id && !existingYtIds.has(yf.id)) {
        mergedYtFavs.push(yf);
        existingYtIds.add(yf.id);
      }
    }
    saveYouTubeFavoritesToStorage(mergedYtFavs);
  }

  return {
    importedSongsCount,
    importedProfilesCount,
    allSongs: mergedSongs,
    allProfiles,
  };
}
