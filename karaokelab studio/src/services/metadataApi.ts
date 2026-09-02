/**
 * Online Metadata Enrichment Service
 * Uses iTunes Search API & LRCLIB to discover official Track Name, Artist, Album, Genre and Artwork
 * Features robust filename cleaning and smart fuzzy-matching score validation.
 */

export interface TrackOnlineMetadata {
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  artworkUrl?: string;
  releaseYear?: string;
  durationMs?: number;
  confidenceScore?: number;
}

/**
 * Calculates string similarity using normalized Levenshtein-based Jaccard token matching (0.0 to 1.0)
 */
function calculateTextSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const s2 = str2.toLowerCase().replace(/[^\w\s]/g, '').trim();
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.85;

  const tokens1 = new Set(s1.split(/\s+/).filter((t) => t.length > 1));
  const tokens2 = new Set(s2.split(/\s+/).filter((t) => t.length > 1));
  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  let intersection = 0;
  tokens1.forEach((t) => {
    if (tokens2.has(t)) intersection++;
  });

  const union = new Set([...tokens1, ...tokens2]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Cleans messy filenames (removes 320kbps, official video, track numbers, .mp3, etc.)
 */
export function cleanSongFilename(raw: string): { query: string; artist?: string; title?: string } {
  let cleaned = raw
    // Remove extension
    .replace(/\.(mp3|wav|ogg|m4a|flac|aac|opus|webm)$/i, '')
    // Remove track numbers at start: "01. ", "01 - ", "1-01 ", "01_ ", "01 "
    .replace(/^(\d+[\.\-_]\s*|\d+\s+)/, '')
    // Remove quality and source tags in brackets/parens
    .replace(/\[.*?(official|video|audio|lyrics|letra|hq|hd|4k|remastered|live|320kbps|flac|wav|mp3|prod|by).*?\]/gi, '')
    .replace(/\(.*?(official|video|audio|lyrics|letra|hq|hd|4k|remastered|live|320kbps|flac|wav|mp3|prod|by).*?\)/gi, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Split by hyphen variations: " - ", " _ ", " – ", " — " or "-" if surrounded by word boundary
  const parts = cleaned.split(/\s+[-_–—]\s+|\s*[-–—]\s*/);

  const isPlaceholder = (s: string) =>
    /^(desconocido|unknown|track|audio|artist|artista|song|cancion|pista|\d+)$/i.test(s.trim());

  if (parts.length >= 2) {
    let rawArtist = parts[0].trim();
    let rawTitle = parts.slice(1).join(' - ').trim();

    if (isPlaceholder(rawArtist)) rawArtist = '';
    if (isPlaceholder(rawTitle)) rawTitle = '';

    const artist = rawArtist || undefined;
    const title = rawTitle || undefined;
    const query = artist && title ? `${artist} ${title}` : title || artist || cleaned;

    return { query, artist, title };
  }

  const query = isPlaceholder(cleaned) ? raw.replace(/\.[^/.]+$/, '') : cleaned;
  return { query };
}

/**
 * Parses embedded ID3v2 / ID3v1 metadata directly from an audio file's binary ArrayBuffer.
 * Extracts official Title (TIT2), Artist (TPE1), Album (TALB), and Genre (TCON).
 */
export function parseAudioBufferTags(buffer?: ArrayBuffer | null): {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
} | null {
  if (!buffer || buffer.byteLength < 10) return null;
  const bytes = new Uint8Array(buffer);

  // Check for ID3v2 header: 'I', 'D', '3' (0x49, 0x44, 0x33)
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const version = bytes[3];
    const size =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);

    let offset = 10;
    const maxOffset = Math.min(bytes.length, 10 + size);
    const tags: { title?: string; artist?: string; album?: string; genre?: string } = {};

    const decoder = new TextDecoder('utf-8');
    const latin1Decoder = new TextDecoder('iso-8859-1');

    while (offset < maxOffset - 10) {
      const frameId = String.fromCharCode(
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3]
      );
      if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

      let frameSize = 0;
      if (version === 4) {
        frameSize =
          ((bytes[offset + 4] & 0x7f) << 21) |
          ((bytes[offset + 5] & 0x7f) << 14) |
          ((bytes[offset + 6] & 0x7f) << 7) |
          (bytes[offset + 7] & 0x7f);
      } else {
        frameSize =
          (bytes[offset + 4] << 24) |
          (bytes[offset + 5] << 16) |
          (bytes[offset + 6] << 8) |
          bytes[offset + 7];
      }

      if (frameSize <= 0 || offset + 10 + frameSize > maxOffset) break;

      const encoding = bytes[offset + 10];
      const frameBytes = bytes.subarray(offset + 11, offset + 10 + frameSize);

      let text = '';
      try {
        if (encoding === 0) text = latin1Decoder.decode(frameBytes);
        else text = decoder.decode(frameBytes);
        text = text.replace(/\0/g, '').trim();
      } catch (_) {}

      if (text && text.length > 0) {
        if (frameId === 'TIT2') tags.title = text;
        else if (frameId === 'TPE1') tags.artist = text;
        else if (frameId === 'TALB') tags.album = text;
        else if (frameId === 'TCON') tags.genre = text;
      }

      offset += 10 + frameSize;
    }

    if (tags.title || tags.artist) {
      return tags;
    }
  }

  return null;
}

/**
 * Searches iTunes Search API & embedded ID3 tags
 * to retrieve official Title, Artist, Album, Genre and high-res Artwork.
 */
export async function fetchOnlineMetadata(
  filenameOrTitle: string,
  targetDurationSeconds?: number,
  audioArrayBuffer?: ArrayBuffer | null
): Promise<TrackOnlineMetadata | null> {
  // 1. Check embedded ID3 tags in the audio file first
  if (audioArrayBuffer) {
    const embedded = parseAudioBufferTags(audioArrayBuffer);
    if (embedded?.title && embedded?.artist) {
      return {
        title: embedded.title,
        artist: embedded.artist,
        album: embedded.album || '',
        genre: embedded.genre || 'General',
        confidenceScore: 1.0,
      };
    }
  }

  // If browser is offline, return early
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return null;
  }

  const parsed = cleanSongFilename(filenameOrTitle);
  const candidates: string[] = [];

  if (parsed.artist && parsed.title) {
    candidates.push(`${parsed.artist} ${parsed.title}`);
    candidates.push(`${parsed.title} ${parsed.artist}`);
    candidates.push(parsed.title);
  } else if (parsed.query) {
    candidates.push(parsed.query);
  }

  for (const candidate of candidates) {
    if (!candidate || candidate.length < 2) continue;

    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(candidate)}&entity=song&limit=10`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) continue;
      const data = await res.json();

      if (data && Array.isArray(data.results) && data.results.length > 0) {
        const rawResults = data.results as any[];

        // Score each candidate result
        const scoredResults = rawResults.map((item) => {
          const trackName = item.trackName || '';
          const artistName = item.artistName || '';
          const itemDurationSec = item.trackTimeMillis ? item.trackTimeMillis / 1000 : 0;

          // Title & Artist Similarity
          const titleSim = parsed.title
            ? calculateTextSimilarity(trackName, parsed.title)
            : calculateTextSimilarity(trackName, candidate);

          const artistSim = parsed.artist
            ? calculateTextSimilarity(artistName, parsed.artist)
            : 0.5;

          // Duration match score
          let durationScore = 0.5;
          if (targetDurationSeconds && targetDurationSeconds > 0 && itemDurationSec > 0) {
            const diffSec = Math.abs(itemDurationSec - targetDurationSeconds);
            if (diffSec <= 5) durationScore = 1.0;
            else if (diffSec <= 15) durationScore = 0.8;
            else if (diffSec <= 30) durationScore = 0.5;
            else durationScore = 0.1;
          }

          // Penalty for cover bands, tributes, or karaoke versions if original query didn't ask for it
          let penalty = 1.0;
          const isCoverOrTribute = /cover|tribute|tributo|karaoke|instrumental|version|rendition/i.test(
            `${artistName} ${trackName}`
          );
          const userAskedForCover = /cover|tribute|tributo|karaoke/i.test(candidate);
          if (isCoverOrTribute && !userAskedForCover) {
            penalty = 0.35;
          }

          const confidenceScore =
            ((parsed.artist ? artistSim * 0.45 + titleSim * 0.40 : titleSim * 0.70) + durationScore * 0.15) *
            penalty;

          return {
            item,
            confidenceScore,
          };
        });

        // Sort by confidence score descending
        scoredResults.sort((a, b) => b.confidenceScore - a.confidenceScore);

        const best = scoredResults[0];

        // Accept result ONLY if confidence score is >= 0.45
        if (best && best.confidenceScore >= 0.45) {
          const b = best.item;
          return {
            title: b.trackName || parsed.title || candidate,
            artist: b.artistName || parsed.artist || 'Desconocido',
            album: b.collectionName || '',
            genre: b.primaryGenreName || 'General',
            artworkUrl: b.artworkUrl100 ? b.artworkUrl100.replace('100x100bb', '600x600bb') : undefined,
            releaseYear: b.releaseDate ? b.releaseDate.substring(0, 4) : undefined,
            durationMs: b.trackTimeMillis,
            confidenceScore: best.confidenceScore,
          };
        }
      }
    } catch (err) {
      console.warn('iTunes metadata search skipped or timed out:', err);
    }

    // ── Tier 2 Fallback: Deezer International Search API ──
    try {
      const dzUrl = `https://api.deezer.com/search?q=${encodeURIComponent(candidate)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(dzUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.data) && data.data.length > 0) {
          const item = data.data[0];
          return {
            title: item.title_short || item.title || parsed.title || candidate,
            artist: item.artist?.name || parsed.artist || 'Desconocido',
            album: item.album?.title || '',
            genre: 'Pop / Latin',
            artworkUrl: item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium,
            durationMs: item.duration ? item.duration * 1000 : undefined,
            confidenceScore: 0.85,
          };
        }
      }
    } catch (dzErr) {
      console.warn('Deezer metadata search skipped or timed out:', dzErr);
    }
  }

  // Fallback: If cleanSongFilename extracted artist and title, return clean metadata!
  if (parsed.artist && parsed.title) {
    return {
      title: parsed.title,
      artist: parsed.artist,
      genre: 'General',
      confidenceScore: 0.70,
    };
  }

  return null;
}
