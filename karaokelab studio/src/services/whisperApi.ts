import { LyricLine } from '../types';

/**
 * Calls the local OpenAI Whisper AI engine to transcribe exact real-world lyrics and timestamps
 * from an isolated vocal stem.
 */
export async function transcribeVocalsWithWhisper(vocalsBlob: Blob): Promise<LyricLine[] | null> {
  const endpoints = [
    'http://localhost:3001/api/transcribe-ai',
    '/api/transcribe-ai',
    'http://localhost:3000/api/transcribe-ai',
  ];

  try {
    const arrayBuf = await vocalsBlob.arrayBuffer();

    for (const endpoint of endpoints) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'audio/wav',
          },
          body: arrayBuf,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (response.ok) {
          const data = await response.json();
          if (data.success && Array.isArray(data.lyrics) && data.lyrics.length > 0) {
            return data.lyrics as LyricLine[];
          }
        }
      } catch (err: any) {
        console.warn(`[Whisper API] Endpoint ${endpoint} attempt failed:`, err?.message);
      }
    }
  } catch (err) {
    console.warn('[Whisper API] ArrayBuffer extraction error:', err);
  }
  return null;
}

/**
 * Force-aligns existing text lyrics against separated vocal audio using OpenAI Whisper AI timestamps.
 */
export async function forceAlignLyricsWithAI(
  vocalsBlob: Blob,
  lyricsText: string
): Promise<LyricLine[] | null> {
  const endpoints = [
    'http://localhost:3001/api/align-lyrics-ai',
    '/api/align-lyrics-ai',
    'http://localhost:3000/api/align-lyrics-ai',
  ];

  try {
    const arrayBuf = await vocalsBlob.arrayBuffer();

    for (const endpoint of endpoints) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'audio/wav',
            'x-lyrics-text': encodeURIComponent(lyricsText),
          },
          body: arrayBuf,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (response.ok) {
          const data = await response.json();
          if (data.success && Array.isArray(data.lyrics) && data.lyrics.length > 0) {
            return data.lyrics as LyricLine[];
          }
        }
      } catch (err: any) {
        console.warn(`[Forced Alignment API] Endpoint ${endpoint} attempt failed:`, err?.message);
      }
    }
  } catch (err) {
    console.warn('[Forced Alignment API] ArrayBuffer extraction error:', err);
  }
  return null;
}
