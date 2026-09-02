const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const express = require('express');

// Enhance PATH environment for macOS / Linux sub-processes (Python, ffmpeg, Demucs, Whisper)
const extraPaths = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  path.join(process.env.HOME || '', 'Library/Python/3.9/bin'),
  path.join(process.env.HOME || '', '.local/bin'),
];
process.env.PATH = `${extraPaths.join(':')}:${process.env.PATH || ''}`;

let mainWindow = null;
let aiServerApp = null;
let aiServerInstance = null;
const AI_SERVER_PORT = process.env.AI_PORT || 3001;

// Diagnostic AI Engine Status
const aiStatus = {
  pythonAvailable: false,
  torchAvailable: false,
  device: 'cpu',
  demucsReady: false,
  whisperReady: false,
  pythonPath: 'python3',
  errorMessage: null,
};

function checkPythonDependencies() {
  const checkCmd = `python3 -c "import torch, demucs, whisper, librosa; print('MPS:' + str(torch.backends.mps.is_available()))"`;
  exec(checkCmd, (error, stdout) => {
    if (!error) {
      aiStatus.pythonAvailable = true;
      aiStatus.torchAvailable = true;
      aiStatus.demucsReady = true;
      aiStatus.whisperReady = true;
      if (stdout.includes('MPS:True')) {
        aiStatus.device = 'mps (Apple Silicon GPU Acceleration)';
      } else {
        aiStatus.device = 'cpu';
      }
      aiStatus.errorMessage = null;
    } else {
      // Check fallback python3 alone
      exec('python3 --version', (err2, out2) => {
        if (!err2) {
          aiStatus.pythonAvailable = true;
          aiStatus.errorMessage = 'Python está instalado pero faltan módulos PyTorch/Demucs/Whisper. Se usará el motor alternativo en tiempo real.';
        } else {
          aiStatus.pythonAvailable = false;
          aiStatus.errorMessage = 'Python 3 no encontrado en el sistema. Operando con procesador de audio DSP integrado.';
        }
      });
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ai:statusUpdate', aiStatus);
    }
  });
}

function startAIServer() {
  aiServerApp = express();
  aiServerApp.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', '*');
    if (_req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });
  aiServerApp.use(express.raw({ type: () => true, limit: '150mb' }));
  aiServerApp.use(express.json({ limit: '50mb' }));

  // Status endpoint
  aiServerApp.get('/api/ai/status', (_req, res) => {
    res.json({ success: true, status: aiStatus });
  });

  // AI Stem Separation endpoint
  aiServerApp.post('/api/separate-ai', (req, res) => {
    try {
      const body = req.body;
      const tempDir = path.resolve(app.getPath('temp'), 'karaokelab_temp');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const id = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const inPath = path.join(tempDir, `input_${id}.wav`);
      const outDir = path.join(tempDir, `out_${id}`);

      fs.writeFileSync(inPath, body);
      const scriptPath = path.resolve(__dirname, '../server/separate.py');
      const cmd = `python3 "${scriptPath}" "${inPath}" "${outDir}"`;

      exec(cmd, { maxBuffer: 1024 * 1024 * 64 }, (error, _stdout, stderr) => {
        if (error) {
          console.error('Demucs AI Error:', stderr || error);
          res.status(500).json({ error: 'AI separation failed', details: error.message });
          try { fs.unlinkSync(inPath); } catch (_) {}
          return;
        }

        try {
          const instFile = path.join(outDir, 'instrumental.wav');
          const vocFile = path.join(outDir, 'vocals.wav');
          const bassFile = path.join(outDir, 'bass.wav');

          const instB64 = fs.existsSync(instFile) ? fs.readFileSync(instFile).toString('base64') : '';
          const vocB64 = fs.existsSync(vocFile) ? fs.readFileSync(vocFile).toString('base64') : '';
          const bassB64 = fs.existsSync(bassFile) ? fs.readFileSync(bassFile).toString('base64') : '';

          try {
            if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
            if (fs.existsSync(instFile)) fs.unlinkSync(instFile);
            if (fs.existsSync(vocFile)) fs.unlinkSync(vocFile);
            if (fs.existsSync(bassFile)) fs.unlinkSync(bassFile);
            if (fs.existsSync(outDir)) fs.rmdirSync(outDir);
          } catch (_) {}

          res.json({
            success: true,
            instrumental: instB64,
            vocals: vocB64,
            bass: bassB64,
          });
        } catch (readErr) {
          res.status(500).json({ error: 'Failed to read stems', details: readErr?.message });
        }
      });
    } catch (err) {
      res.status(500).json({ error: err?.message });
    }
  });

  // AI Whisper Transcription endpoint
  aiServerApp.post('/api/transcribe-ai', (req, res) => {
    try {
      const body = req.body;
      const tempDir = path.resolve(app.getPath('temp'), 'karaokelab_temp');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const id = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const inPath = path.join(tempDir, `voc_${id}.wav`);
      const outJsonPath = path.join(tempDir, `lyrics_${id}.json`);

      fs.writeFileSync(inPath, body);
      const scriptPath = path.resolve(__dirname, '../server/transcribe.py');
      const cmd = `python3 "${scriptPath}" "${inPath}" "${outJsonPath}"`;

      exec(cmd, { maxBuffer: 1024 * 1024 * 32 }, (error, _stdout, stderr) => {
        if (error) {
          console.error('Whisper AI Error:', stderr || error);
          res.status(500).json({ error: 'Whisper AI transcription failed', details: error.message });
          try { fs.unlinkSync(inPath); } catch (_) {}
          return;
        }

        try {
          let lyricsData = { success: false, lyrics: [] };
          if (fs.existsSync(outJsonPath)) {
            lyricsData = JSON.parse(fs.readFileSync(outJsonPath, 'utf-8'));
          }

          try {
            if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
            if (fs.existsSync(outJsonPath)) fs.unlinkSync(outJsonPath);
          } catch (_) {}

          res.json(lyricsData);
        } catch (readErr) {
          res.status(500).json({ error: 'Failed to parse lyrics json', details: readErr?.message });
        }
      });
    } catch (err) {
      res.status(500).json({ error: err?.message });
    }
  });

  // AI Acoustic Vocal Coupling & Forced Alignment
  aiServerApp.post('/api/align-lyrics-ai', (req, res) => {
    try {
      const rawLyricsHeader = req.headers['x-lyrics-text'] || '';
      const lyricsText = decodeURIComponent(rawLyricsHeader);
      const body = req.body;

      const tempDir = path.resolve(app.getPath('temp'), 'karaokelab_temp');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const id = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const inPath = path.join(tempDir, `align_voc_${id}.wav`);
      const lyricsPath = path.join(tempDir, `lyrics_${id}.txt`);
      const outJsonPath = path.join(tempDir, `align_out_${id}.json`);

      fs.writeFileSync(inPath, body);
      fs.writeFileSync(lyricsPath, lyricsText, 'utf-8');

      const scriptPath = path.resolve(__dirname, '../server/align_lyrics.py');
      const cmd = `python3 "${scriptPath}" "${inPath}" "${lyricsPath}" "${outJsonPath}"`;

      exec(cmd, { maxBuffer: 1024 * 1024 * 32 }, (error, _stdout, stderr) => {
        if (error) {
          console.error('AI Vocal Alignment Error:', stderr || error);
          res.status(500).json({ error: 'AI Alignment failed', details: error.message });
          try {
            if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
            if (fs.existsSync(lyricsPath)) fs.unlinkSync(lyricsPath);
          } catch (_) {}
          return;
        }

        try {
          let alignData = { success: false, lyrics: [] };
          if (fs.existsSync(outJsonPath)) {
            alignData = JSON.parse(fs.readFileSync(outJsonPath, 'utf-8'));
          }

          try {
            if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
            if (fs.existsSync(lyricsPath)) fs.unlinkSync(lyricsPath);
            if (fs.existsSync(outJsonPath)) fs.unlinkSync(outJsonPath);
          } catch (_) {}

          res.json(alignData);
        } catch (readErr) {
          res.status(500).json({ error: 'Failed to parse alignment json', details: readErr?.message });
        }
      });
    } catch (err) {
      res.status(500).json({ error: err?.message });
    }
  });

  // AI Vocal Gender & Duet Classification endpoint
  aiServerApp.post('/api/classify-vocal-ai', (req, res) => {
    try {
      const body = req.body;
      const tempDir = path.resolve(app.getPath('temp'), 'karaokelab_temp');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const id = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const inPath = path.join(tempDir, `class_${id}.wav`);
      const outJsonPath = path.join(tempDir, `class_${id}.json`);

      fs.writeFileSync(inPath, body);
      const scriptPath = path.resolve(__dirname, '../server/classify_vocal.py');
      const cmd = `python3 "${scriptPath}" "${inPath}" "${outJsonPath}"`;

      exec(cmd, { maxBuffer: 1024 * 1024 * 16 }, (error, _stdout, stderr) => {
        if (error) {
          console.error('Vocal Classification Error:', stderr || error);
          res.status(500).json({ error: 'Classification failed', details: error.message });
          try { fs.unlinkSync(inPath); } catch (_) {}
          return;
        }

        try {
          let classData = { success: false, isDuet: false, primaryGender: 'singer1' };
          if (fs.existsSync(outJsonPath)) {
            classData = JSON.parse(fs.readFileSync(outJsonPath, 'utf-8'));
          }

          try {
            if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
            if (fs.existsSync(outJsonPath)) fs.unlinkSync(outJsonPath);
          } catch (_) {}

          res.json(classData);
        } catch (readErr) {
          res.status(500).json({ error: 'Failed to parse classification json', details: readErr?.message });
        }
      });
    } catch (err) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Genius Lyrics Discovery Endpoint (Free, no API key required)
  aiServerApp.get('/api/genius-lyrics', async (req, res) => {
    try {
      const { q, title, artist, url: directUrl, searchOnly } = req.query;
      
      let pageUrl = directUrl;
      let topHit = null;

      if (!pageUrl) {
        const queryStr = q || `${artist ? artist + ' ' : ''}${title || ''}`.trim();
        if (!queryStr) {
          return res.status(400).json({ success: false, error: 'Query parameter required' });
        }

        const searchUrl = `https://genius.com/api/search/multi?q=${encodeURIComponent(queryStr)}`;
        const searchRes = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });

        if (!searchRes.ok) {
          return res.json({ success: false, error: `Genius search returned status ${searchRes.status}` });
        }

        const searchData = await searchRes.json();
        const sections = searchData?.response?.sections || [];
        const songSection = sections.find((s) => s.type === 'song' || s.type === 'top_hit');
        const hits = songSection?.hits || [];

        if (hits.length === 0) {
          return res.json({ success: false, hits: [], error: 'No Genius matches found' });
        }

        if (searchOnly === 'true' || searchOnly === '1') {
          return res.json({
            success: true,
            hits: hits.map((h) => ({
              id: h.result?.id,
              title: h.result?.title,
              artist: h.result?.primary_artist?.name,
              url: h.result?.url,
              image: h.result?.song_art_image_thumbnail_url,
            })),
          });
        }

        topHit = hits[0].result;
        pageUrl = topHit.url || `https://genius.com${topHit.path}`;
      }

      const pageRes = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!pageRes.ok) {
        return res.json({ success: false, error: `Failed to load Genius page (${pageRes.status})` });
      }

      const html = await pageRes.text();
      let rawLyrics = '';

      // Strategy 1: Canonical Preloaded State (100% strictly chronological order)
      const preloadedMatch = html.match(/window\.__PRELOADED_STATE__\s*=\s*JSON\.parse\((['\"].*?['\"])\);/s);
      if (preloadedMatch) {
        try {
          const rawString = Function('"use strict";return (' + preloadedMatch[1] + ')')();
          const state = JSON.parse(rawString);
          const bodyHtml = state.songPage?.lyricsData?.body?.html;
          if (bodyHtml) {
            rawLyrics = bodyHtml
              .replace(/<br\s*\/?>/gi, '\n')
              .replace(/<\/p>/gi, '\n\n')
              .replace(/<[^>]+>/g, '')
              .replace(/&amp;/g, '&')
              .replace(/&#x27;/g, "'")
              .replace(/&quot;/g, '"')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>');
          }
        } catch (_) {}
      }

      // Strategy 2: Fallback to DOM container extraction
      if (!rawLyrics.trim()) {
        const matches = html.matchAll(/<div[^>]*data-lyrics-container="true"[^>]*>(.*?)<\/div>/gis);
        for (const m of matches) {
          let chunk = m[1];
          chunk = chunk.replace(/<br\s*\/?>/gi, '\n');
          chunk = chunk.replace(/<[^>]+>/g, '');
          chunk = chunk
            .replace(/&amp;/g, '&')
            .replace(/&#x27;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          rawLyrics += chunk + '\n';
        }
      }

      rawLyrics = rawLyrics
        .split('\n')
        .filter((l) => !/^\d+\s+Contributors?$/i.test(l.trim()))
        .filter((l) => !/^\[Letra de.*\]$/i.test(l.trim()))
        .join('\n')
        .trim();

      if (!rawLyrics || rawLyrics.length < 20) {
        return res.json({ success: false, error: 'Could not extract lyrics text from Genius page' });
      }

      res.json({
        success: true,
        plainLyrics: rawLyrics,
        trackTitle: topHit?.title || title || '',
        artistName: topHit?.primary_artist?.name || artist || '',
        url: pageUrl,
      });
    } catch (err) {
      console.warn('[Genius Scraper] Error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  aiServerInstance = aiServerApp.listen(AI_SERVER_PORT, () => {
    console.log(`[KaraokeLab Native AI Server] running on http://localhost:${AI_SERVER_PORT}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[KaraokeLab Native AI Server] Port ${AI_SERVER_PORT} already in use, reusing active server endpoint.`);
    } else {
      console.error('[KaraokeLab Native AI Server] Server error:', err);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'KaraokeLab Studio',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#09090b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allows local file audio rendering seamlessly
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';
  const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL(devServerUrl);
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('dialog:openFile', async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', ...(options.allowMultiple ? ['multiSelections'] : [])],
    filters: options.filters || [
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'] },
      { name: 'Karaoke LRC Files', extensions: ['lrc', 'txt'] },
      { name: 'KaraokeLab Packages', extensions: ['klab', 'json'] }
    ]
  });
  return result;
});

ipcMain.handle('dialog:saveFile', async (_event, options = {}) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: options.title || 'Guardar Archivo KaraokeLab',
    defaultPath: options.defaultPath || 'cancion_karaokelab.klab',
    filters: options.filters || [
      { name: 'KaraokeLab Web Package', extensions: ['klab', 'json'] },
      { name: 'LRC Karaoke Lyrics', extensions: ['lrc'] }
    ]
  });
  return result;
});

ipcMain.handle('dialog:selectFolder', async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options.title || 'Seleccionar Carpeta de la Biblioteca o Memoria USB',
    defaultPath: options.defaultPath,
    properties: ['openDirectory', 'createDirectory']
  });
  return result;
});

ipcMain.handle('sync:readFolderInfo', async (_event, folderPath) => {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) {
      return { success: false, exists: false, totalSongs: 0 };
    }
    const manifestPath = path.join(folderPath, 'library_manifest.json');
    if (fs.existsSync(manifestPath)) {
      const data = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      return {
        success: true,
        exists: true,
        totalSongs: data.songs ? data.songs.length : 0,
        lastSync: data.timestamp || 0,
        manifest: data
      };
    }
    return { success: true, exists: true, totalSongs: 0, lastSync: 0 };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sync:writeSongs', async (_event, payload = {}) => {
  try {
    const { folderPath, songs = [], profiles = [] } = payload;
    if (!folderPath || !fs.existsSync(folderPath)) {
      throw new Error('La carpeta de destino no existe o no es accesible.');
    }

    const manifestPath = path.join(folderPath, 'library_manifest.json');
    let manifestData = {
      version: '2.0',
      app: 'KaraokeLab // CyberKaraoke',
      exportedAt: new Date().toISOString(),
      timestamp: Date.now(),
      totalSongs: 0,
      profiles: profiles,
      songs: []
    };

    if (fs.existsSync(manifestPath)) {
      try {
        manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch (_) {}
    }

    let writtenCount = 0;
    for (const song of songs) {
      const safeArtist = (song.artist || 'Artista').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim().slice(0, 50);
      const safeTitle = (song.title || 'Cancion').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim().slice(0, 50);
      const songDir = path.join(folderPath, `${safeArtist} - ${safeTitle}`);
      if (!fs.existsSync(songDir)) fs.mkdirSync(songDir, { recursive: true });

      // 1. Audio Stems
      const stemExt = song.stemExt || 'mp3';
      if (song.instrumentalBase64) {
        fs.writeFileSync(path.join(songDir, `instrumental.${stemExt}`), Buffer.from(song.instrumentalBase64, 'base64'));
      } else if (song.audioBase64) {
        const ext = song.audioExt || 'mp3';
        fs.writeFileSync(path.join(songDir, `audio.${ext}`), Buffer.from(song.audioBase64, 'base64'));
      }

      if (song.vocalsBase64) {
        fs.writeFileSync(path.join(songDir, `vocals.${stemExt}`), Buffer.from(song.vocalsBase64, 'base64'));
      }

      // 2. Lyrics LRC
      if (song.lrcContent) {
        fs.writeFileSync(path.join(songDir, 'lyrics.lrc'), song.lrcContent, 'utf-8');
      }

      // 3. Metadata JSON
      const songMeta = {
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
        rawLrc: song.rawLrc,
        lyrics: song.lyrics || [],
        originalFileName: song.originalFileName,
        createdAt: song.createdAt || Date.now(),
        updatedAt: song.updatedAt || Date.now(),
      };
      fs.writeFileSync(path.join(songDir, 'song.json'), JSON.stringify(songMeta, null, 2), 'utf-8');

      // Update in manifest
      const existingIdx = manifestData.songs.findIndex((s) => s.id === song.id);
      if (existingIdx >= 0) {
        manifestData.songs[existingIdx] = songMeta;
      } else {
        manifestData.songs.push(songMeta);
      }
      writtenCount++;
    }

    manifestData.totalSongs = manifestData.songs.length;
    manifestData.profiles = profiles.length > 0 ? profiles : manifestData.profiles;
    manifestData.timestamp = Date.now();
    manifestData.exportedAt = new Date().toISOString();

    fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), 'utf-8');

    return { success: true, count: writtenCount, totalSongs: manifestData.totalSongs };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sync:readFolderSongs', async (_event, folderPath) => {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) {
      throw new Error('La carpeta no existe o no es accesible.');
    }

    const manifestPath = path.join(folderPath, 'library_manifest.json');
    let manifestData = { songs: [], profiles: [] };
    if (fs.existsSync(manifestPath)) {
      try {
        manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch (_) {}
    }

    const songs = [];
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const songDir = path.join(folderPath, entry.name);
        const songJsonPath = path.join(songDir, 'song.json');
        
        let songMeta = null;
        if (fs.existsSync(songJsonPath)) {
          try {
            songMeta = JSON.parse(fs.readFileSync(songJsonPath, 'utf-8'));
          } catch (_) {}
        }

        if (!songMeta) {
          const parts = entry.name.split(' - ');
          songMeta = {
            id: 'folder_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            artist: parts.length > 1 ? parts[0].trim() : 'Artista',
            title: parts.length > 1 ? parts.slice(1).join(' - ').trim() : entry.name,
            duration: 0,
            bpm: 120,
            key: 'C Major',
            lyrics: [],
          };
        }

        let instB64 = '';
        let vocB64 = '';
        let audioB64 = '';
        let audioExt = 'mp3';

        const allFilesInDir = fs.readdirSync(songDir);

        const instFile = allFilesInDir.find(f => /^instrumental\.(mp3|wav|ogg|m4a|flac)$/i.test(f));
        if (instFile) {
          instB64 = fs.readFileSync(path.join(songDir, instFile)).toString('base64');
        }

        const vocFile = allFilesInDir.find(f => /^vocals\.(mp3|wav|ogg|m4a|flac)$/i.test(f));
        if (vocFile) {
          vocB64 = fs.readFileSync(path.join(songDir, vocFile)).toString('base64');
        }

        const audioFile = allFilesInDir.find(f => /^audio\.(mp3|wav|ogg|m4a|flac)$/i.test(f));
        if (audioFile) {
          audioExt = audioFile.split('.').pop() || 'mp3';
          audioB64 = fs.readFileSync(path.join(songDir, audioFile)).toString('base64');
        }

        // Lyrics LRC
        const lrcPath = path.join(songDir, 'lyrics.lrc');
        let rawLrc = songMeta.rawLrc || '';
        if (fs.existsSync(lrcPath)) {
          rawLrc = fs.readFileSync(lrcPath, 'utf-8');
        }

        songs.push({
          ...songMeta,
          rawLrc,
          instrumentalBase64: instB64,
          vocalsBase64: vocB64,
          audioBase64: audioB64,
          audioExt,
        });
      }
    }

    return {
      success: true,
      totalSongs: songs.length,
      songs,
      profiles: manifestData.profiles || [],
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ai:getStatus', () => {
  return aiStatus;
});

app.whenReady().then(() => {
  checkPythonDependencies();
  startAIServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (aiServerInstance) {
    aiServerInstance.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
