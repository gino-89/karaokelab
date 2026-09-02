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
 * Searches YouTube for Karaoke videos using public API endpoints (Invidious / Piped + server fallback)
 */
export async function searchYouTubeVideos(query: string): Promise<YouTubeSearchResult[]> {
  if (!query || query.trim().length === 0) return [];
  const cleanQuery = query.toLowerCase().includes('karaoke') ? query.trim() : `${query.trim()} karaoke`;

  // 1. Try local server API endpoint first
  try {
    const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(cleanQuery)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.results) && data.results.length > 0) {
        return data.results;
      }
    }
  } catch (_) {}

  // 2. Public Invidious API instances fallback
  const invidiousInstances = [
    'https://inv.tux.pizza',
    'https://invidious.nerdvpn.de',
    'https://invidious.drgns.space',
    'https://vid.puffyan.us',
  ];

  for (const instance of invidiousInstances) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(`${instance}/api/v1/search?q=${encodeURIComponent(cleanQuery)}&type=video`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) continue;
      const data = await res.json();

      if (Array.isArray(data) && data.length > 0) {
        return data
          .filter((item: any) => item.videoId && item.title)
          .slice(0, 10)
          .map((item: any) => {
            const sec = item.lengthSeconds || 0;
            const mins = Math.floor(sec / 60);
            const remainderSec = Math.floor(sec % 60);
            const durationStr = sec > 0 ? `${mins}:${remainderSec < 10 ? '0' : ''}${remainderSec}` : 'Karaoke';

            return {
              id: item.videoId,
              title: item.title,
              channel: item.author || 'YouTube',
              duration: durationStr,
              thumbnail: item.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
              url: `https://www.youtube.com/watch?v=${item.videoId}`,
            };
          });
      }
    } catch (_) {}
  }

  // 3. Fallback mock / fallback link if all API calls are blocked by CORS
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
