import { SongItem, SingerProfile, YouTubeFavoriteTrack, ChatMessage } from '../types';

const DB_NAME = 'CyberKaraokeDB';
const DB_VERSION = 1;
const STORE_SONGS = 'songs';
const PROFILES_STORAGE_KEY = 'karaokelab_singer_profiles';
const ACTIVE_PROFILE_KEY = 'karaokelab_active_profile_id';

export const DEFAULT_PROFILES: SingerProfile[] = [
  {
    id: 'profile_all',
    name: 'Todos',
    avatar: '👥',
    color: '#00f0ff',
    favoriteSongIds: [],
    createdAt: 0,
  },
];

export const DEFAULT_PRESET_SONGS: SongItem[] = [
  {
    id: 'preset_despacito',
    title: 'Despacito',
    artist: 'Luis Fonsi ft. Daddy Yankee',
    genre: 'Pop / Reggaeton',
    duration: 228,
    bpm: 89,
    key: 'D Minor',
    lyrics: [
      { time: 0, text: '♪ Sí, sabes que ya llevo un rato mirándote' },
      { time: 5, text: 'Tengo que bailar contigo hoy ♪' },
      { time: 10, text: '¡Despacito!' },
    ],
    originalFileName: 'Despacito_Luis_Fonsi.mp3',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'preset_amor_prohibido',
    title: 'Amor Prohibido',
    artist: 'Selena',
    genre: 'Cumbia / Tex-Mex',
    duration: 168,
    bpm: 90,
    key: 'C Major',
    lyrics: [
      { time: 0, text: '♪ Con el corazón en la mano ♪' },
      { time: 5, text: 'Amor prohibido murmuran por las calles ♪' },
    ],
    originalFileName: 'Amor_Prohibido_Selena.mp3',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'preset_provenza',
    title: 'PROVENZA',
    artist: 'Karol G',
    genre: 'Urbano / Reggaeton',
    duration: 210,
    bpm: 111,
    key: 'F# Minor',
    lyrics: [{ time: 0, text: '♪ Baby, qué más, hace rato que no sé de ti ♪' }],
    originalFileName: 'Provenza_Karol_G.mp3',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'preset_bohemian_rhapsody',
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    genre: 'Rock / Anthem',
    duration: 354,
    bpm: 72,
    key: 'Bb Major',
    lyrics: [{ time: 0, text: '♪ Is this the real life? Is this just fantasy? ♪' }],
    originalFileName: 'Bohemian_Rhapsody_Queen.mp3',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'preset_ojitos_lindos',
    title: 'Ojitos Lindos',
    artist: 'Bad Bunny ft. Bomba Estéreo',
    genre: 'Urbano / Indie',
    duration: 258,
    bpm: 100,
    key: 'A Minor',
    lyrics: [{ time: 0, text: '♪ Hace mucho tiempo que no miro a los ojos a alguien ♪' }],
    originalFileName: 'Ojitos_Lindos_Bad_Bunny.mp3',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'preset_el_rey',
    title: 'El Rey',
    artist: 'Vicente Fernández',
    genre: 'Mariachi / Ranchera',
    duration: 145,
    bpm: 110,
    key: 'G Major',
    lyrics: [{ time: 0, text: '♪ Yo sé bien que estoy afuera, pero el día que yo me muera ♪' }],
    originalFileName: 'El_Rey_Vicente_Fernandez.mp3',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'preset_fly_me_to_the_moon',
    title: 'Fly Me To The Moon',
    artist: 'Frank Sinatra',
    genre: 'Jazz / Classic',
    duration: 147,
    bpm: 118,
    key: 'C Major',
    lyrics: [{ time: 0, text: '♪ Fly me to the moon and let me play among the stars ♪' }],
    originalFileName: 'Fly_Me_To_The_Moon_Frank_Sinatra.mp3',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_SONGS)) {
        db.createObjectStore(STORE_SONGS, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSongToDB(song: SongItem): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_SONGS, 'readwrite');
    const store = tx.objectStore(STORE_SONGS);
    store.put(song);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Error saving to IndexedDB:', err);
  }
}

export async function getSongsFromDB(): Promise<SongItem[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_SONGS, 'readonly');
    const store = tx.objectStore(STORE_SONGS);
    const req = store.getAll();
    const result = await new Promise<SongItem[]>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    return result || [];
  } catch (err) {
    console.warn('Error reading from IndexedDB:', err);
    return [];
  }
}

export async function deleteSongFromDB(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_SONGS, 'readwrite');
    const store = tx.objectStore(STORE_SONGS);
    store.delete(id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Error deleting from IndexedDB:', err);
  }
}

export async function clearAllSongsFromDB(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_SONGS, 'readwrite');
    const store = tx.objectStore(STORE_SONGS);
    store.clear();
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Error clearing IndexedDB:', err);
  }
}

// ── Singer Profiles Storage Helpers ──
export function getProfilesFromStorage(): SingerProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_PROFILES;
  } catch {
    return DEFAULT_PROFILES;
  }
}

export function saveProfilesToStorage(profiles: SingerProfile[]): void {
  try {
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  } catch (err) {
    console.warn('Error saving profiles to localStorage:', err);
  }
}

export function getActiveProfileIdFromStorage(): string {
  try {
    return localStorage.getItem(ACTIVE_PROFILE_KEY) || 'profile_all';
  } catch {
    return 'profile_all';
  }
}

export function saveActiveProfileIdToStorage(id: string): void {
  try {
    localStorage.setItem(ACTIVE_PROFILE_KEY, id);
  } catch (err) {
    console.warn('Error saving active profile ID:', err);
  }
}
export const setActiveProfileIdToStorage = saveActiveProfileIdToStorage;

export function getYouTubeFavoritesFromStorage(): YouTubeFavoriteTrack[] {
  try {
    const raw = localStorage.getItem('karaokelab_yt_favorites');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveYouTubeFavoritesToStorage(favorites: YouTubeFavoriteTrack[]): void {
  try {
    localStorage.setItem('karaokelab_yt_favorites', JSON.stringify(favorites));
  } catch (err) {
    console.warn('Error saving YouTube favorites:', err);
  }
}

// ── Room Chat Message 12-Hour TTL Storage ──
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export function getChatMessagesFromStorage(key: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const now = Date.now();
    const valid = parsed.filter((m: ChatMessage) => m && m.timestamp && (now - m.timestamp < TWELVE_HOURS_MS));
    if (valid.length !== parsed.length) {
      saveChatMessagesToStorage(key, valid);
    }
    return valid;
  } catch {
    return [];
  }
}

export function saveChatMessagesToStorage(key: string, messages: ChatMessage[]): void {
  try {
    const now = Date.now();
    const valid = messages.filter((m) => m && m.timestamp && (now - m.timestamp < TWELVE_HOURS_MS));
    localStorage.setItem(key, JSON.stringify(valid));
  } catch (err) {
    console.warn('Error saving chat messages:', err);
  }
}
