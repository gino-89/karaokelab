import { SongItem, SingerProfile, YouTubeFavoriteTrack } from '../types';

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
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
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

// ── Singer Profiles Storage Helpers ─────────────────────────────────────
export function getProfilesFromStorage(): SingerProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return DEFAULT_PROFILES;
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

export function setActiveProfileIdToStorage(id: string): void {
  try {
    localStorage.setItem(ACTIVE_PROFILE_KEY, id);
  } catch (err) {
    console.warn('Error saving active profile ID:', err);
  }
}

const YOUTUBE_FAVORITES_KEY = 'karaokelab_youtube_favorites';

export function getYouTubeFavoritesFromStorage(): YouTubeFavoriteTrack[] {
  try {
    const raw = localStorage.getItem(YOUTUBE_FAVORITES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as YouTubeFavoriteTrack[];
  } catch {
    return [];
  }
}

export function saveYouTubeFavoritesToStorage(favorites: YouTubeFavoriteTrack[]): void {
  try {
    localStorage.setItem(YOUTUBE_FAVORITES_KEY, JSON.stringify(favorites));
  } catch (err) {
    console.warn('Error saving YouTube favorites to localStorage:', err);
  }
}

