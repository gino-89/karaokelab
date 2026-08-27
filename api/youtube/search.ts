import type { VercelRequest, VercelResponse } from '@vercel/node';
import YouTube from 'youtube-sr';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Configuración de CORS
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
    const videos = await YouTube.search(q, { limit: 15, type: 'video' });
    
    const results = videos.map((video) => {
      const sec = video.duration / 1000 || 0;
      const mins = Math.floor(sec / 60);
      const remainderSec = Math.floor(sec % 60);
      const durationStr = sec > 0 ? `${mins}:${remainderSec < 10 ? '0' : ''}${remainderSec}` : 'Karaoke';

      return {
        id: video.id,
        title: video.title,
        channel: video.channel?.name || 'YouTube',
        duration: durationStr,
        thumbnail: video.thumbnail?.url || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
        url: video.url,
      };
    });

    return res.status(200).json({ results });
  } catch (error) {
    console.error('YouTube search backend error:', error);
    return res.status(500).json({ error: 'Failed to fetch search results from YouTube' });
  }
}
