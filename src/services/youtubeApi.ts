/**
 * YouTube Hybrid Search & Audio Import Service
 * Allows users to:
 * 1. Search YouTube for Karaoke / Instrumental videos in real-time
 * 2. Play embedded YouTube videos directly inside KaraokeLab
 * 3. Import YouTube audio directly into KaraokeLab's AI Stem Separator & Teleprompter
 */

export interface YouTubeSearchResult {
  id: string;
  title: string;
  channel: string;
  duration: string;
  thumbnail: string;
  url: string;
}

/**
 * Extracts YouTube video ID from various URL formats
 */
export function extractYouTubeId(urlOrId: string): string | null {
  if (!urlOrId) return null;
  const trimmed = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match ? match[1] : null;
}

/**
 * Searches YouTube for Karaoke videos using serverless backend + public API fallbacks
 */
export async function searchYouTubeVideos(query: string): Promise<YouTubeSearchResult[]> {
  if (!query || query.trim().length === 0) return [];
  const rawQuery = query.trim();

  // If user pasted a direct YouTube URL or 11-char video ID, return that video directly!
  const directId = extractYouTubeId(rawQuery);
  if (directId) {
    let videoTitle = 'Video de YouTube';
    try {
      const oembedRes = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${directId}`);
      if (oembedRes.ok) {
        const oembedData = await oembedRes.json();
        if (oembedData.title) videoTitle = oembedData.title;
      }
    } catch (_) {}

    return [
      {
        id: directId,
        title: videoTitle,
        channel: 'YouTube',
        duration: 'Video',
        thumbnail: `https://i.ytimg.com/vi/${directId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${directId}`,
      },
    ];
  }

  const cleanQuery = rawQuery.toLowerCase().includes('karaoke') ? rawQuery : `${rawQuery} karaoke`;

  // 1. Primary: Try our dedicated backend endpoint (/api/youtube/search)
  try {
    const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(cleanQuery)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.results) && data.results.length > 0) {
        return data.results;
      }
    }
  } catch (err) {
    console.warn('[YouTubeAPI] Backend search failed, trying public fallbacks:', err);
  }

  // 2. Public Piped & Invidious API instances fallback
  const publicInstances = [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.privacydev.net',
    'https://inv.tux.pizza',
    'https://invidious.nerdvpn.de',
    'https://invidious.drgns.space',
  ];

  for (const instance of publicInstances) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const endpoint = instance.includes('piped')
        ? `${instance}/search?q=${encodeURIComponent(cleanQuery)}&filter=videos`
        : `${instance}/api/v1/search?q=${encodeURIComponent(cleanQuery)}&type=video`;

      const res = await fetch(endpoint, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) continue;
      const data = await res.json();

      const items = Array.isArray(data) ? data : data.items;
      if (Array.isArray(items) && items.length > 0) {
        return items
          .filter((item: any) => (item.videoId || item.url?.replace('/watch?v=', '')) && item.title)
          .slice(0, 12)
          .map((item: any) => {
            const vidId = item.videoId || item.url?.replace('/watch?v=', '') || '';
            const sec = item.duration || item.lengthSeconds || 0;
            const mins = Math.floor(sec / 60);
            const remainderSec = Math.floor(sec % 60);
            const durationStr = sec > 0 ? `${mins}:${remainderSec < 10 ? '0' : ''}${remainderSec}` : 'Karaoke';

            return {
              id: vidId,
              title: item.title,
              channel: item.uploaderName || item.author || 'YouTube',
              duration: durationStr,
              thumbnail: item.thumbnail || item.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`,
              url: `https://www.youtube.com/watch?v=${vidId}`,
            };
          });
      }
    } catch (_) {}
  }

  // 3. Fallback quick direct search link
  return [
    {
      id: 'search_fallback',
      title: `Buscar "${cleanQuery}" en YouTube Directo`,
      channel: 'YouTube',
      duration: 'N/A',
      thumbnail: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80',
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`,
    },
  ];
}

/**
 * Downloads audio from YouTube video via backend yt-dlp endpoint
 */
export async function downloadYouTubeAudioBlob(videoId: string): Promise<Blob | null> {
  try {
    const res = await fetch(`/api/youtube/download?videoId=${encodeURIComponent(videoId)}`);
    if (!res.ok) {
      throw new Error(`Error en servidor: ${res.statusText}`);
    }
    const blob = await res.blob();
    if (blob.size < 1000) {
      throw new Error('El archivo descargado es inválido o muy pequeño');
    }
    return blob;
  } catch (err) {
    console.error('Error descargando audio de YouTube:', err);
    return null;
  }
}
