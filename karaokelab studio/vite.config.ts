import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { defineConfig, Plugin } from 'vite';

function aiStemSeparationPlugin(): Plugin {
  return {
    name: 'ai-stem-separation-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // ── 1. AI Stem Separation with Meta AI Demucs ──
        if (req.url === '/api/separate-ai' && req.method === 'POST') {
          try {
            const chunks: Buffer[] = [];
            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', async () => {
              const body = Buffer.concat(chunks);
              const tempDir = path.resolve(__dirname, 'temp_ai');
              if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
              }

              const id = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
              const inPath = path.join(tempDir, `input_${id}.wav`);
              const outDir = path.join(tempDir, `out_${id}`);

              fs.writeFileSync(inPath, body);

              const scriptPath = path.resolve(__dirname, 'server/separate.py');
              const cmd = `python3 "${scriptPath}" "${inPath}" "${outDir}"`;

              exec(cmd, { maxBuffer: 1024 * 1024 * 64 }, (error, stdout, stderr) => {
                if (error) {
                  console.error('Demucs AI Error:', stderr || error);
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'AI separation failed', details: error.message }));
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
                    fs.unlinkSync(inPath);
                    fs.unlinkSync(instFile);
                    fs.unlinkSync(vocFile);
                    fs.unlinkSync(bassFile);
                    fs.rmdirSync(outDir);
                  } catch (_) {}

                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({
                    success: true,
                    instrumental: instB64,
                    vocals: vocB64,
                    bass: bassB64,
                  }));
                } catch (readErr: any) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Failed to read stems', details: readErr?.message }));
                }
              });
            });
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err?.message }));
          }
          return;
        }

        // ── 2. AI Vocal Transcription with OpenAI Whisper ──
        if (req.url === '/api/transcribe-ai' && req.method === 'POST') {
          try {
            const chunks: Buffer[] = [];
            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', async () => {
              const body = Buffer.concat(chunks);
              const tempDir = path.resolve(__dirname, 'temp_ai');
              if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
              }

              const id = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
              const inPath = path.join(tempDir, `voc_${id}.wav`);
              const outJsonPath = path.join(tempDir, `lyrics_${id}.json`);

              fs.writeFileSync(inPath, body);

              const scriptPath = path.resolve(__dirname, 'server/transcribe.py');
              const cmd = `python3 "${scriptPath}" "${inPath}" "${outJsonPath}"`;

              exec(cmd, { maxBuffer: 1024 * 1024 * 32 }, (error, stdout, stderr) => {
                if (error) {
                  console.error('Whisper AI Error:', stderr || error);
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Whisper AI transcription failed', details: error.message }));
                  try { fs.unlinkSync(inPath); } catch (_) {}
                  return;
                }

                try {
                  let lyricsData = { success: false, lyrics: [] };
                  if (fs.existsSync(outJsonPath)) {
                    lyricsData = JSON.parse(fs.readFileSync(outJsonPath, 'utf-8'));
                  }

                  try {
                    fs.unlinkSync(inPath);
                    fs.unlinkSync(outJsonPath);
                  } catch (_) {}

                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify(lyricsData));
                } catch (readErr: any) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Failed to parse lyrics json', details: readErr?.message }));
                }
              });
            });
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err?.message }));
          }
          return;
        }

        // ── 3. Studio BPM & Musical Key Detection with Librosa ──
        if (req.url === '/api/analyze-dsp' && req.method === 'POST') {
          try {
            const chunks: Buffer[] = [];
            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', async () => {
              const body = Buffer.concat(chunks);
              const tempDir = path.resolve(__dirname, 'temp_ai');
              if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
              }

              const id = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
              const inPath = path.join(tempDir, `dsp_${id}.wav`);
              const outJsonPath = path.join(tempDir, `dsp_${id}.json`);

              fs.writeFileSync(inPath, body);

              const scriptPath = path.resolve(__dirname, 'server/analyze_dsp.py');
              const cmd = `python3 "${scriptPath}" "${inPath}" "${outJsonPath}"`;

              exec(cmd, { maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) => {
                if (error) {
                  console.error('DSP Analysis Error:', stderr || error);
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'DSP analysis failed', details: error.message }));
                  try { fs.unlinkSync(inPath); } catch (_) {}
                  return;
                }

                try {
                  let dspData = { success: false, bpm: 120, key: 'C Major' };
                  if (fs.existsSync(outJsonPath)) {
                    dspData = JSON.parse(fs.readFileSync(outJsonPath, 'utf-8'));
                  }

                  try {
                    fs.unlinkSync(inPath);
                    fs.unlinkSync(outJsonPath);
                  } catch (_) {}

                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify(dspData));
                } catch (readErr: any) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Failed to read dsp json', details: readErr?.message }));
                }
              });
            });
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err?.message }));
          }
          return;
        }

        // ── 3.5. AI Vocal Gender & Duet Classification with Librosa ──
        if (req.url === '/api/classify-vocal-ai' && req.method === 'POST') {
          try {
            const chunks: Buffer[] = [];
            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', async () => {
              const body = Buffer.concat(chunks);
              const tempDir = path.resolve(__dirname, 'temp_ai');
              if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
              }

              const id = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
              const inPath = path.join(tempDir, `class_voc_${id}.wav`);
              const outJsonPath = path.join(tempDir, `class_out_${id}.json`);

              fs.writeFileSync(inPath, body);

              const scriptPath = path.resolve(__dirname, 'server/classify_vocal.py');
              const cmd = `python3 "${scriptPath}" "${inPath}" "${outJsonPath}"`;

              exec(cmd, { maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) => {
                if (error) {
                  console.error('Vocal Classify Error:', stderr || error);
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Vocal classification failed', details: error.message }));
                  try { fs.unlinkSync(inPath); } catch (_) {}
                  return;
                }

                try {
                  let classData = { success: false, isDuet: false, primaryGender: 'singer1' };
                  if (fs.existsSync(outJsonPath)) {
                    classData = JSON.parse(fs.readFileSync(outJsonPath, 'utf-8'));
                  }

                  try {
                    fs.unlinkSync(inPath);
                    fs.unlinkSync(outJsonPath);
                  } catch (_) {}

                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify(classData));
                } catch (readErr: any) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Failed to read classification json', details: readErr?.message }));
                }
              });
            });
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err?.message }));
          }
          return;
        }

        // ── 3.8. Genius Lyrics Discovery & Scraping ──
        if (req.url?.startsWith('/api/genius-lyrics')) {
          try {
            const parsedUrl = new URL(req.url, 'http://localhost:3000');
            const q = parsedUrl.searchParams.get('q') || '';
            const title = parsedUrl.searchParams.get('title') || '';
            const artist = parsedUrl.searchParams.get('artist') || '';
            const directUrl = parsedUrl.searchParams.get('url') || '';
            const searchOnly = parsedUrl.searchParams.get('searchOnly');

            let pageUrl = directUrl;
            let topHit: any = null;

            if (!pageUrl) {
              const queryStr = q || `${artist ? artist + ' ' : ''}${title || ''}`.trim();
              if (!queryStr) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: 'Query parameter required' }));
                return;
              }

              const searchUrl = `https://genius.com/api/search/multi?q=${encodeURIComponent(queryStr)}`;
              const searchRes = await fetch(searchUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
              });

              if (!searchRes.ok) {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: `Genius search returned ${searchRes.status}` }));
                return;
              }

              const searchData: any = await searchRes.json();
              const sections = searchData?.response?.sections || [];
              const songSection = sections.find((s: any) => s.type === 'song' || s.type === 'top_hit');
              const hits = songSection?.hits || [];

              if (hits.length === 0) {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, hits: [], error: 'No Genius matches found' }));
                return;
              }

              if (searchOnly === 'true' || searchOnly === '1') {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                  success: true,
                  hits: hits.map((h: any) => ({
                    id: h.result?.id,
                    title: h.result?.title,
                    artist: h.result?.primary_artist?.name,
                    url: h.result?.url,
                    image: h.result?.song_art_image_thumbnail_url,
                  })),
                }));
                return;
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
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: `Failed to load Genius page (${pageRes.status})` }));
              return;
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

            // Strategy 2: Fallback to DOM container extraction if state parsing failed
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

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              success: true,
              plainLyrics: rawLyrics,
              trackTitle: topHit?.title || title || '',
              artistName: topHit?.primary_artist?.name || artist || '',
              url: pageUrl,
            }));
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: err?.message }));
          }
          return;
        }

        // ── 4. AI Acoustic Vocal Coupling & Forced Alignment ──
        if (req.url === '/api/align-lyrics-ai' && req.method === 'POST') {
          try {
            const rawLyricsHeader = req.headers['x-lyrics-text'] as string || '';
            const lyricsText = decodeURIComponent(rawLyricsHeader);

            const chunks: Buffer[] = [];
            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', async () => {
              const body = Buffer.concat(chunks);
              const tempDir = path.resolve(__dirname, 'temp_ai');
              if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
              }

              const id = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
              const inPath = path.join(tempDir, `align_voc_${id}.wav`);
              const lyricsPath = path.join(tempDir, `lyrics_${id}.txt`);
              const outJsonPath = path.join(tempDir, `align_out_${id}.json`);

              fs.writeFileSync(inPath, body);
              fs.writeFileSync(lyricsPath, lyricsText, 'utf-8');

              const scriptPath = path.resolve(__dirname, 'server/align_lyrics.py');
              const cmd = `python3 "${scriptPath}" "${inPath}" "${lyricsPath}" "${outJsonPath}"`;

              exec(cmd, { maxBuffer: 1024 * 1024 * 32 }, (error, stdout, stderr) => {
                if (error) {
                  console.error('AI Vocal Alignment Error:', stderr || error);
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'AI Alignment failed', details: error.message }));
                  try {
                    fs.unlinkSync(inPath);
                    fs.unlinkSync(lyricsPath);
                  } catch (_) {}
                  return;
                }

                try {
                  let alignData = { success: false, lyrics: [] };
                  if (fs.existsSync(outJsonPath)) {
                    alignData = JSON.parse(fs.readFileSync(outJsonPath, 'utf-8'));
                  }

                  try {
                    fs.unlinkSync(inPath);
                    fs.unlinkSync(lyricsPath);
                    fs.unlinkSync(outJsonPath);
                  } catch (_) {}

                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify(alignData));
                } catch (readErr: any) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Failed to read alignment json', details: readErr?.message }));
                }
              });
            });
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err?.message }));
          }
          return;
        }

        // ── 5. YouTube Search Endpoint ──
        if (req.url?.startsWith('/api/youtube/search') && req.method === 'GET') {
          try {
            const urlObj = new URL(req.url, 'http://localhost');
            const q = urlObj.searchParams.get('q') || '';
            const scriptPath = path.resolve(__dirname, 'server/youtube.py');
            const cmd = `python3 "${scriptPath}" search "${q.replace(/"/g, '\\"')}"`;

            exec(cmd, { maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) => {
              if (error) {
                console.error('YouTube Search Error:', stderr || error);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Search failed', results: [] }));
                return;
              }

              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(stdout || JSON.stringify({ success: true, results: [] }));
            });
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err?.message }));
          }
          return;
        }

        // ── 6. YouTube Audio Download Endpoint ──
        if (req.url?.startsWith('/api/youtube/download') && req.method === 'GET') {
          try {
            const urlObj = new URL(req.url, 'http://localhost');
            const videoId = urlObj.searchParams.get('videoId') || '';
            if (!videoId) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing videoId' }));
              return;
            }

            const tempDir = path.resolve(__dirname, 'temp_ai');
            if (!fs.existsSync(tempDir)) {
              fs.mkdirSync(tempDir, { recursive: true });
            }

            const id = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
            const outWavPath = path.join(tempDir, `yt_${id}.wav`);
            const scriptPath = path.resolve(__dirname, 'server/youtube.py');
            const cmd = `python3 "${scriptPath}" download "${videoId.replace(/"/g, '\\"')}" "${outWavPath}"`;

            exec(cmd, { maxBuffer: 1024 * 1024 * 64 }, (error, stdout, stderr) => {
              if (error || !fs.existsSync(outWavPath)) {
                console.error('YouTube Download Error:', stderr || error);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Failed to download YouTube audio' }));
                return;
              }

              try {
                const wavBuffer = fs.readFileSync(outWavPath);
                try { fs.unlinkSync(outWavPath); } catch (_) {}

                res.statusCode = 200;
                res.setHeader('Content-Type', 'audio/wav');
                res.setHeader('Content-Length', wavBuffer.length);
                res.end(wavBuffer);
              } catch (sendErr: any) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Failed to read audio file', details: sendErr?.message }));
              }
            });
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err?.message }));
          }
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), aiStemSeparationPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      strictPort: true,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
