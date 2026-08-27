/**
 * Multi-Tier Online Lyrics & Duet Roles Discovery Service
 *
 * Tier 1: Genius Lyrics Search (via backend /api/genius-lyrics)
 *         Extracts lyrics with rich artist section tags ([Daddy Yankee:], [Ozuna:], [Chorus:])
 *         and parses them with automatic singer assignment.
 * Tier 2: LRCLIB Search (Synced & Plain with Genius parser fallback)
 */

import { LyricLine, ArtistRole } from '../types';
import { parseGeniusLyrics, mergeGeniusRolesWithSyncedLrc, GeniusParseResult } from './lrcParser';
import { searchLrclib } from './lrcApi';

export interface GeniusHitSuggestion {
  id: number;
  title: string;
  artist: string;
  url: string;
  image?: string;
}

export interface DiscoveredLyricsResult {
  lyrics: LyricLine[];
  rawLrc?: string;
  source: 'genius' | 'lrclib_synced' | 'lrclib_plain' | 'none';
  isDuet: boolean;
  allArtists?: ArtistRole[];
  singer1Artists: string[];
  singer2Artists: string[];
  trackTitle?: string;
  artistName?: string;
}

/**
 * Searches Genius for song suggestions matching a search term.
 */
export async function searchGeniusSuggestions(query: string): Promise<GeniusHitSuggestion[]> {
  if (!query || !query.trim()) return [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);

    const res = await fetch(`/api/genius-lyrics?q=${encodeURIComponent(query.trim())}&searchOnly=true`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.hits)) {
        return data.hits.map((h: any) => ({
          id: h.id,
          title: h.title,
          artist: h.artist,
          url: h.url,
          image: h.image,
        }));
      }
    }
  } catch (err: any) {
    console.warn('[GeniusLyrics] Suggestions query failed:', err?.message);
  }
  return [];
}

/**
 * Fetches lyrics directly from a Genius song page URL and parses them with artist roles,
 * attempting to fuse with exact LRCLIB timestamps if available.
 */
export async function fetchGeniusLyricsByUrl(
  pageUrl: string,
  duration = 180
): Promise<DiscoveredLyricsResult | null> {
  if (!pageUrl) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);

    const res = await fetch(`/api/genius-lyrics?url=${encodeURIComponent(pageUrl)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data.success && data.plainLyrics) {
        const parsed: GeniusParseResult = parseGeniusLyrics(data.plainLyrics, duration);
        if (parsed.lyrics.length > 0) {
          let finalLyrics = parsed.lyrics;
          let source: 'genius' | 'lrclib_synced' = 'genius';

          // Try to fuse with exact LRCLIB synced timestamps
          try {
            const query = `${data.artistName || ''} ${data.trackTitle || ''}`.trim();
            if (query) {
              const lrc = await searchLrclib(query, duration);
              if (lrc && lrc.syncedLyrics && lrc.lyrics.length > 0) {
                finalLyrics = mergeGeniusRolesWithSyncedLrc(parsed.lyrics, lrc.lyrics);
                source = 'lrclib_synced';
              }
            }
          } catch {
            // Ignore LRCLIB lookup failure and use parsed Genius
          }

          return {
            lyrics: finalLyrics,
            source,
            isDuet: parsed.isDuet,
            allArtists: parsed.allArtists,
            singer1Artists: parsed.singer1Artists,
            singer2Artists: parsed.singer2Artists,
            trackTitle: data.trackTitle || '',
            artistName: data.artistName || '',
          };
        }
      }
    }
  } catch (err: any) {
    console.warn('[GeniusLyrics] Fetch by URL failed:', err?.message);
  }
  return null;
}

/**
 * Searches Genius for lyrics with section artist headers, fusing with LRCLIB synced timing when available.
 */
export async function searchGeniusLyricsOnline(
  title: string,
  artist = '',
  duration = 180
): Promise<DiscoveredLyricsResult | null> {
  const query = `${artist ? artist + ' ' : ''}${title}`.trim();
  if (!query) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);

    const res = await fetch(`/api/genius-lyrics?q=${encodeURIComponent(query)}&title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data.success && data.plainLyrics) {
        const parsed: GeniusParseResult = parseGeniusLyrics(data.plainLyrics, duration);
        if (parsed.lyrics.length > 0) {
          let finalLyrics = parsed.lyrics;
          let source: 'genius' | 'lrclib_synced' = 'genius';

          // Try to fuse with LRCLIB millisecond synced timestamps
          try {
            const lrc = await searchLrclib(query, duration);
            if (lrc && lrc.syncedLyrics && lrc.lyrics.length > 0) {
              finalLyrics = mergeGeniusRolesWithSyncedLrc(parsed.lyrics, lrc.lyrics);
              source = 'lrclib_synced';
            }
          } catch {
            // Use parsed Genius
          }

          return {
            lyrics: finalLyrics,
            source,
            isDuet: parsed.isDuet,
            allArtists: parsed.allArtists,
            singer1Artists: parsed.singer1Artists,
            singer2Artists: parsed.singer2Artists,
            trackTitle: data.trackTitle || title,
            artistName: data.artistName || artist,
          };
        }
      }
    }
  } catch (err: any) {
    console.warn('[GeniusLyrics] Backend lookup skipped:', err?.message);
  }

  return null;
}

/**
 * High-level multi-tier lyrics discovery:
 * 1. Checks Genius first (provides structured duet sections and multi-artist roles)
 * 2. Fallback to LRCLIB (synced / plain)
 */
export async function discoverSongLyricsWithRoles(
  title: string,
  artist = '',
  duration = 180
): Promise<DiscoveredLyricsResult> {
  const cleanTitle = (title || '').trim();
  const cleanArtist = (artist === 'Desconocido' ? '' : artist || '').trim();
  const query = `${cleanArtist ? cleanArtist + ' ' : ''}${cleanTitle}`.trim();

  // Run Genius & LRCLIB lookups in parallel for maximum speed
  const [geniusResult, lrcRes] = await Promise.all([
    cleanTitle ? searchGeniusLyricsOnline(cleanTitle, cleanArtist, duration) : null,
    query ? searchLrclib(query, duration) : null,
  ]);

  if (geniusResult && geniusResult.lyrics.length > 0) {
    if (lrcRes && lrcRes.syncedLyrics && lrcRes.lyrics.length > 0) {
      const fusedLyrics = mergeGeniusRolesWithSyncedLrc(geniusResult.lyrics, lrcRes.lyrics);
      return {
        ...geniusResult,
        lyrics: fusedLyrics,
        source: 'lrclib_synced',
      };
    }
    return geniusResult;
  }

  if (lrcRes && lrcRes.lyrics.length > 0) {
    const isDuet = lrcRes.lyrics.some(l => l.singer && l.singer !== 'singer1');
    return {
      lyrics: lrcRes.lyrics,
      rawLrc: lrcRes.syncedLyrics,
      source: lrcRes.syncedLyrics ? 'lrclib_synced' : 'lrclib_plain',
      isDuet,
      singer1Artists: cleanArtist ? [cleanArtist] : [],
      singer2Artists: [],
      trackTitle: lrcRes.title || cleanTitle,
      artistName: lrcRes.artist || cleanArtist,
    };
  }

  return {
    lyrics: [],
    source: 'none',
    isDuet: false,
    singer1Artists: [],
    singer2Artists: [],
  };
}
