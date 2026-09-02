/**
 * Dynamic Video Background Service
 * Manages YouTube background loops, official music video auto-discovery,
 * and user preferences for video overlays.
 */

import { VideoBackgroundConfig, VideoBackgroundPreset } from '../types';

export const VIDEO_BACKGROUND_PRESETS: VideoBackgroundPreset[] = [
  {
    id: 'cyberpunk_city',
    name: 'Cyberpunk 2099',
    category: 'Cyberpunk',
    videoId: 'q=-_Aky1wY8M',
    thumbnail: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=300&q=80',
    tag: '🌆 Neón Futurista 4K',
  },
  {
    id: 'synthwave_grid',
    name: 'Synthwave 80s',
    category: 'Retro',
    videoId: '8ZhnA1gP_eE',
    thumbnail: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=300&q=80',
    tag: '⚡ Retrowave Grid Sunset',
  },
  {
    id: 'party_disco_lasers',
    name: 'Discoteca & Láseres',
    category: 'Fiesta',
    videoId: 'X9Vp1716j1k',
    thumbnail: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=300&q=80',
    tag: '🪩 Luces de Club & Estrobos',
  },
  {
    id: 'cosmic_galaxy',
    name: 'Galaxia Cósmica',
    category: 'Espacio',
    videoId: '14fG4bK8EaY',
    thumbnail: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=300&q=80',
    tag: '🌌 Nebulosa y Estrellas',
  },
  {
    id: 'live_concert_stage',
    name: 'Escenario de Concierto',
    category: 'En Vivo',
    videoId: 'p7fZvG7N_4I',
    thumbnail: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&q=80',
    tag: '🎤 Festival & Multitud',
  },
  {
    id: 'lofi_cyber_room',
    name: 'Lofi Cyber Rain',
    category: 'Chill',
    videoId: '5wRWniH6PoA',
    thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300&q=80',
    tag: '🌧️ Cuarto Anime Lluvioso',
  },
];

const STORAGE_KEY = 'karaokelab_video_background_config';

export const DEFAULT_VIDEO_BG_CONFIG: VideoBackgroundConfig = {
  enabled: true,
  mode: 'auto',
  videoId: 'q=-_Aky1wY8M',
  overlayOpacity: 0.70, // 70% dark overlay for ideal contrast
  blurAmount: 1, // 1px subtle blur
};

/**
 * Extracts a valid YouTube Video ID from any URL, embed link, or raw ID
 */
export function extractYouTubeVideoId(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  // 1. If it's already an 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  // 2. youtube.com/watch?v=VIDEO_ID
  const watchMatch = trimmed.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
  if (watchMatch && watchMatch[1]) {
    return watchMatch[1];
  }

  // 3. youtube.com/shorts/VIDEO_ID
  const shortsMatch = trimmed.match(/youtube\.com\/shorts\/([^"&?\/\s]{11})/i);
  if (shortsMatch && shortsMatch[1]) {
    return shortsMatch[1];
  }

  return null;
}

/**
 * Loads video background configuration from local storage
 */
export function loadVideoBackgroundConfig(): VideoBackgroundConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_VIDEO_BG_CONFIG, ...parsed };
    }
  } catch (_) {}
  return DEFAULT_VIDEO_BG_CONFIG;
}

/**
 * Persists video background configuration to local storage
 */
export function saveVideoBackgroundConfig(config: VideoBackgroundConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (_) {}
}

/**
 * Searches for the official music video on YouTube for a song
 */
export async function searchOfficialVideo(
  title: string,
  artist = ''
): Promise<{ videoId: string; title: string; thumbnail: string } | null> {
  if (!title) return null;
  const cleanTitle = title.replace(/\(.*?\)|\[.*?\]/g, '').trim();
  const cleanArtist = artist && artist !== 'Desconocido' ? artist.trim() : '';
  const query = `${cleanArtist} ${cleanTitle} official video music`.trim();

  try {
    const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.results) && data.results.length > 0) {
        const topHit = data.results[0];
        if (topHit.id && topHit.id !== 'search_fallback') {
          return {
            videoId: topHit.id,
            title: topHit.title,
            thumbnail: topHit.thumbnail || `https://i.ytimg.com/vi/${topHit.id}/hqdefault.jpg`,
          };
        }
      }
    }
  } catch (err) {
    console.warn('[VideoBackground] Official video search failed:', err);
  }

  return null;
}

/**
 * Fetches the official video title from YouTube for any video ID
 */
export async function fetchYouTubeVideoTitle(videoId: string): Promise<string | null> {
  if (!videoId) return null;
  try {
    const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.title) {
        return data.title;
      }
    }
  } catch (_) {}

  try {
    const res2 = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`);
    if (res2.ok) {
      const data2 = await res2.json();
      if (data2.title) {
        return data2.title;
      }
    }
  } catch (_) {}

  return null;
}
