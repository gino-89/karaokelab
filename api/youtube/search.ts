import type { VercelRequest, VercelResponse } from '@vercel/node';
import YouTubeSR from 'youtube-sr';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS setup
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { q } = req.query;

  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  try {
    const yt: any = (YouTubeSR as any).default || YouTubeSR;
    const searchFn = typeof yt.search === 'function' ? yt.search.bind(yt) : (YouTubeSR as any).search.bind(YouTubeSR);

    const videos = await searchFn(q, { limit: 25, type: 'video' });

    const rawResults = (videos || []).map((video: any) => {
      const sec = video.duration ? video.duration / 1000 : 0;
      const mins = Math.floor(sec / 60);
      const remainderSec = Math.floor(sec % 60);
      const durationStr = sec > 0 ? `${mins}:${remainderSec < 10 ? '0' : ''}${remainderSec}` : (video.durationFormatted || 'Karaoke');

      return {
        id: video.id,
        title: video.title,
        channel: video.channel?.name || 'YouTube',
        duration: durationStr,
        thumbnail: video.thumbnail?.url || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
        url: video.url || `https://www.youtube.com/watch?v=${video.id}`,
      };
    });

    // Filtro de Reproducción Externa: Descarta videos que tienen la inserción bloqueada (Error 150 / 101)
    const embedChecks = await Promise.allSettled(
      rawResults.map(async (item: any) => {
        if (!item.id) return false;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2000);
          const oembedRes = await fetch(
            `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(item.id)}&format=json`,
            { signal: controller.signal }
          );
          clearTimeout(timer);
          // Si el código es 401 o 403, YouTube prohíbe la reproducción en reproductores externos
          if (oembedRes.status === 401 || oembedRes.status === 403) {
            return false;
          }
          return true;
        } catch {
          // En caso de timeout de red, conservar el elemento
          return true;
        }
      })
    );

    const results = rawResults.filter((_, idx) => {
      const check = embedChecks[idx];
      return check.status === 'fulfilled' ? check.value : true;
    });

    return res.status(200).json({ results });
  } catch (error: any) {
    console.error('YouTube search backend error:', error);
    return res.status(500).json({ error: 'Failed to fetch search results from YouTube', details: error?.message });
  }
}
