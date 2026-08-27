import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

function youtubeDevApiPlugin() {
  return {
    name: 'youtube-dev-api',
    configureServer(server: any) {
      server.middlewares.use('/api/youtube/search', async (req: any, res: any) => {
        try {
          const url = new URL(req.url, `http://${req.headers.host}`);
          const q = url.searchParams.get('q');
          if (!q) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Query parameter "q" is required' }));
            return;
          }

          const YouTubeSRModule = await import('youtube-sr');
          const YouTubeSR: any = YouTubeSRModule.default || YouTubeSRModule;
          const yt: any = YouTubeSR?.default || YouTubeSR;
          const searchFn = typeof yt?.search === 'function' ? yt.search.bind(yt) : YouTubeSR?.search?.bind(YouTubeSR);

          const videos = await searchFn(q, { limit: 15, type: 'video' });
          const results = (videos || []).map((video: any) => {
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

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ results }));
        } catch (err: any) {
          console.error('[ViteDevAPI] YouTube search error:', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), youtubeDevApiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3005,
      strictPort: true,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
