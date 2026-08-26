import { SongItem, LyricLine } from '../types';

export interface WebPlayerPublishOptions {
  includeInstrumental: boolean;
  includeVocals: boolean;
  includeWordSync: boolean;
  audioQuality: 'wav' | 'mp3_high' | 'compressed';
  webSyncTarget?: string;
}

export interface WebPlayerSongPackage {
  formatVersion: '1.0';
  publishedAt: number;
  generator: 'KaraokeLab Studio Native';
  meta: {
    id: string;
    title: string;
    artist: string;
    bpm: number;
    key: string;
    duration: number;
    syncDelay: number;
    hasVocalsStem: boolean;
    hasInstrumentalStem: boolean;
  };
  lyrics: LyricLine[];
  audio: {
    instrumentalBase64?: string;
    vocalsBase64?: string;
    mimeType: string;
  };
}

export async function buildWebPlayerPackage(
  song: SongItem,
  lyrics: LyricLine[],
  options: WebPlayerPublishOptions
): Promise<WebPlayerSongPackage> {
  const meta = {
    id: song.id,
    title: song.title || 'Canción Sin Título',
    artist: song.artist || 'Artista Desconocido',
    bpm: song.bpm || 120,
    key: song.key || 'C Major',
    duration: song.duration || 0,
    syncDelay: song.syncOffset || 0,
    hasVocalsStem: !!(options.includeVocals && song.stems?.vocalsBlob),
    hasInstrumentalStem: !!(options.includeInstrumental && (song.stems?.instrumentalBlob || song.audioBlob)),
  };

  const processedLyrics = options.includeWordSync
    ? lyrics
    : lyrics.map((l) => ({ ...l, words: undefined }));

  let instB64: string | undefined = undefined;
  let vocB64: string | undefined = undefined;

  // Convert blobs to base64 if selected
  if (options.includeInstrumental) {
    const blobToUse = song.stems?.instrumentalBlob || song.audioBlob;
    if (blobToUse) {
      instB64 = await blobToBase64(blobToUse);
    }
  }

  if (options.includeVocals && song.stems?.vocalsBlob) {
    vocB64 = await blobToBase64(song.stems.vocalsBlob);
  }

  return {
    formatVersion: '1.0',
    publishedAt: Date.now(),
    generator: 'KaraokeLab Studio Native',
    meta,
    lyrics: processedLyrics,
    audio: {
      instrumentalBase64: instB64,
      vocalsBase64: vocB64,
      mimeType: 'audio/wav',
    },
  };
}

export async function downloadOrSaveKlabFile(
  pkg: WebPlayerSongPackage,
  suggestedName?: string
) {
  const jsonStr = JSON.stringify(pkg, null, 2);
  const fileName = suggestedName || `${cleanFilename(pkg.meta.title)}_${cleanFilename(pkg.meta.artist)}.klab`;

  if (typeof window !== 'undefined' && window.electronAPI?.saveFileDialog) {
    const res = await window.electronAPI.saveFileDialog({
      title: 'Publicar Paquete KaraokeLab Web Player',
      defaultPath: fileName,
      filters: [{ name: 'KaraokeLab Web Package', extensions: ['klab', 'json'] }],
    });
    if (!res.canceled && res.filePath) {
      // In Electron environment, save file
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const arrayBuffer = await blob.arrayBuffer();
      const fs = require('fs');
      fs.writeFileSync(res.filePath, Buffer.from(arrayBuffer));
      return { success: true, filePath: res.filePath };
    }
  }

  // Web Browser fallback download
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { success: true, fileName };
}

export function generateStandaloneHTMLPlayer(pkg: WebPlayerSongPackage): string {
  const titleEsc = escapeHtml(pkg.meta.title);
  const artistEsc = escapeHtml(pkg.meta.artist);
  const lyricsJsonStr = JSON.stringify(pkg.lyrics);
  const audioDataUrl = pkg.audio.instrumentalBase64
    ? `data:${pkg.audio.mimeType};base64,${pkg.audio.instrumentalBase64}`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${titleEsc} - ${artistEsc} | KaraokeLab Web Player</title>
  <style>
    :root {
      --bg: #09090b;
      --card: #18181b;
      --accent: #00f0ff;
      --text: #f4f4f5;
      --muted: #a1a1aa;
    }
    body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .player-card {
      width: 90%;
      max-width: 680px;
      background: var(--card);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px;
      padding: 32px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.6);
      text-align: center;
    }
    h1 { margin: 0 0 4px; font-size: 28px; color: var(--accent); }
    h2 { margin: 0 0 24px; font-size: 18px; color: var(--muted); font-weight: 400; }
    .lyrics-container {
      min-height: 220px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      margin: 20px 0;
      padding: 16px;
      background: rgba(0,0,0,0.3);
      border-radius: 12px;
    }
    .current-line {
      font-size: 26px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 10px;
      text-shadow: 0 0 12px rgba(0,240,255,0.5);
    }
    .next-line { font-size: 18px; color: var(--muted); }
    audio { width: 100%; margin-top: 16px; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="player-card">
    <h1>🎤 ${titleEsc}</h1>
    <h2>${artistEsc} • ${pkg.meta.bpm} BPM • ${pkg.meta.key}</h2>
    
    <div class="lyrics-container">
      <div id="current-line" class="current-line">▶ Presiona Reproducir para Comenzar</div>
      <div id="next-line" class="next-line">KaraokeLab Studio Web Sync</div>
    </div>

    <audio id="audio-player" controls src="${audioDataUrl}"></audio>
  </div>

  <script>
    const lyrics = ${lyricsJsonStr};
    const audio = document.getElementById('audio-player');
    const currentEl = document.getElementById('current-line');
    const nextEl = document.getElementById('next-line');

    audio.addEventListener('timeupdate', () => {
      const t = audio.currentTime;
      let activeIdx = -1;
      for (let i = 0; i < lyrics.length; i++) {
        if (t >= lyrics[i].time && (i === lyrics.length - 1 || t < lyrics[i + 1].time)) {
          activeIdx = i;
          break;
        }
      }
      if (activeIdx !== -1) {
        currentEl.textContent = lyrics[activeIdx].text;
        nextEl.textContent = lyrics[activeIdx + 1] ? lyrics[activeIdx + 1].text : '';
      }
    });
  </script>
</body>
</html>`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function cleanFilename(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').trim();
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
