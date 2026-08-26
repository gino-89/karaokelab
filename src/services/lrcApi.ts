import { LRCLibSearchResult, LyricLine } from '../types';
import { parseLRC, isGeniusFormat, parseGeniusLyrics } from './lrcParser';

/**
 * Cleans messy filenames, removing track numbers, resolutions, extensions, video tags, etc.
 */
function cleanQueryString(raw: string): { query: string; artist?: string; title?: string } {
  let cleaned = raw
    .replace(/\.(mp3|wav|ogg|m4a|flac|aac|opus|webm)$/i, '')
    // Remove track numbers: "01. ", "01 - ", "1-01 ", "01 "
    .replace(/^(\d+[\.\-_]\s*|\d+\s+)/, '')
    // Remove video tags
    .replace(/\[.*?(official|video|audio|lyrics|letra|hq|hd|4k|remastered|live).*?\]/gi, '')
    .replace(/\(.*?(official|video|audio|lyrics|letra|hq|hd|4k|remastered|live).*?\)/gi, '')
    .replace(/[\(\[\{].*?[\)\]\}]/g, '')
    .replace(/_/g, ' ')
    .trim();

  // Try splitting by " - " or " _ "
  const parts = cleaned.split(/\s+-\s+|\s+–\s+|\s+—\s+/);
  if (parts.length >= 2) {
    const artist = parts[0].trim();
    const title = parts.slice(1).join(' - ').trim();
    return { query: `${artist} ${title}`, artist, title };
  }

  return { query: cleaned };
}

/**
 * Searches for synced lyrics using LRCLIB API (https://lrclib.net) with multi-strategy fallback
 */
export async function searchLrclib(
  query: string,
  duration?: number
): Promise<{ syncedLyrics?: string; lyrics: LyricLine[]; title?: string; artist?: string } | null> {
  if (!query || !query.trim()) return null;

  const { query: cleanQ, artist, title } = cleanQueryString(query);

  const searchCandidates: string[] = [cleanQ];
  if (artist && title) {
    searchCandidates.push(`${artist} ${title}`);
    searchCandidates.push(title);
  }
  if (query.trim() !== cleanQ) {
    searchCandidates.push(query.trim().replace(/\.[^/.]+$/, ''));
  }

  for (const candidate of searchCandidates) {
    try {
      const url = `https://lrclib.net/api/search?q=${encodeURIComponent(candidate)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) continue;

      const data: LRCLibSearchResult[] = await response.json();
      if (!Array.isArray(data) || data.length === 0) continue;

      // 1. Look for item with syncedLyrics
      let matches = data.filter((item) => item.syncedLyrics && item.syncedLyrics.length > 20);

      if (matches.length > 0) {
        if (duration && duration > 0) {
          matches.sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration));
        }
        const best = matches[0];
        const parsed = parseLRC(best.syncedLyrics!);
        if (parsed.length > 0) {
          return {
            syncedLyrics: best.syncedLyrics,
            lyrics: parsed,
            title: best.trackName || best.name || title || candidate,
            artist: best.artistName || artist || 'Artista',
          };
        }
      }

      // 2. Fallback: plainLyrics auto-alignment across track duration
      const plainMatch = data.find((item) => item.plainLyrics && item.plainLyrics.length > 10);
      if (plainMatch && plainMatch.plainLyrics) {
        const estDuration = duration || plainMatch.duration || 180;
        
        // If plainLyrics has Genius [ArtistName:] section markers, parse with singer assignments
        if (isGeniusFormat(plainMatch.plainLyrics)) {
          const geniusRes = parseGeniusLyrics(plainMatch.plainLyrics, estDuration);
          if (geniusRes.lyrics.length > 0) {
            return {
              lyrics: geniusRes.lyrics,
              title: plainMatch.trackName || plainMatch.name || title || candidate,
              artist: plainMatch.artistName || artist || 'Artista',
            };
          }
        }

        const lines = plainMatch.plainLyrics
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith('[') && !l.endsWith(']'));

        if (lines.length > 0) {
          const introPad = Math.min(8.0, estDuration * 0.08);
          const usableDuration = Math.max(10, estDuration - introPad - 4);
          const step = usableDuration / lines.length;

          const generated: LyricLine[] = lines.map((text, idx) => ({
            time: introPad + idx * step,
            text,
            duration: Math.min(step * 0.95, 4.5),
          }));

          return {
            lyrics: generated,
            title: plainMatch.trackName || plainMatch.name || title || candidate,
            artist: plainMatch.artistName || artist || 'Artista',
          };
        }
      }
    } catch (err) {
      console.warn('LRCLib candidate query failed:', candidate, err);
    }
  }

  return null;
}

export interface LrcSuggestion {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration: number;
  hasSyncedLyrics: boolean;
  syncedLyrics?: string;
  plainLyrics?: string;
}

/**
 * Searches LRCLIB and returns an array of matching track suggestions for the user to choose from.
 */
export async function searchLrclibSuggestions(query: string): Promise<LrcSuggestion[]> {
  if (!query || !query.trim()) return [];

  const { query: cleanQ, artist, title } = cleanQueryString(query);
  const searchCandidates: string[] = [cleanQ];
  if (artist && title) {
    searchCandidates.push(`${artist} ${title}`);
    searchCandidates.push(title);
  }
  if (query.trim() !== cleanQ) {
    searchCandidates.push(query.trim().replace(/\.[^/.]+$/, ''));
  }

  for (const candidate of searchCandidates) {
    try {
      const url = `https://lrclib.net/api/search?q=${encodeURIComponent(candidate)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) continue;

      const data: any[] = await response.json();
      if (!Array.isArray(data) || data.length === 0) continue;

      return data.slice(0, 10).map((item) => ({
        id: item.id,
        trackName: item.trackName || item.name || 'Sin título',
        artistName: item.artistName || 'Artista desconocido',
        albumName: item.albumName || '',
        duration: item.duration || 0,
        hasSyncedLyrics: !!(item.syncedLyrics && item.syncedLyrics.length > 20),
        syncedLyrics: item.syncedLyrics,
        plainLyrics: item.plainLyrics,
      }));
    } catch (err) {
      console.warn('LRCLIB suggestion fetch error:', err);
    }
  }

  return [];
}
