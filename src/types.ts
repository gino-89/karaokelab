export interface LyricWord {
  word: string;
  start: number;
  end: number;
}

export interface ArtistRole {
  id: string; // e.g. 'artist-0', 'artist-1', 'singer1', 'singer2'
  name: string; // e.g. 'Wisin', 'Yandel', 'Chris Brown'
  color: string; // e.g. '#00f0ff', '#ff007f', '#10b981', '#a855f7'
}

export interface LyricLine {
  time: number; // in seconds
  text: string;
  duration?: number;
  words?: LyricWord[];
  singer?: 'singer1' | 'singer2' | 'both' | string; // supports any artist ID or 'both' / 'all'
  sectionHeader?: string; // e.g. "[Refrán: Wisin, Chris Brown]", "[Pre-Coro: Wisin, Yandel]"
}

export interface AudioStems {
  instrumentalBlob?: Blob; // Pista Karaoke (Instrumental sin voz)
  vocalsBlob?: Blob;       // Voz aislada
  bassBlob?: Blob;         // Pista de Bajo / Batería
}

export interface YouTubeFavoriteTrack {
  id: string; // YouTube Video ID
  title: string;
  channel: string;
  duration: string;
  thumbnail: string;
  url: string;
  singerProfileId?: string;
  createdAt: number;
}

export type VideoBackgroundMode = 'off' | 'auto' | 'preset' | 'custom';

export interface VideoBackgroundPreset {
  id: string;
  name: string;
  category: string;
  videoId: string;
  thumbnail: string;
  tag: string;
}

export interface VideoBackgroundConfig {
  enabled: boolean;
  mode: VideoBackgroundMode;
  videoId: string;
  videoTitle?: string;
  customUrlOrId?: string;
  overlayOpacity: number; // 0.2 to 0.95
  blurAmount: number; // 0 to 8
}

export interface VocalAutomationPoint {
  id: string;
  time: number; // in seconds
  gain: number; // 0.0 (Mute / 0%) to 1.0 (Full / 100%) or up to 1.5
  label?: string; // e.g. "Inicio Coro", "Verso"
}

export interface VocalAutomationRegion {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  gain: number;
  fadeTime?: number;
  color?: string;
}

export interface VocalAutomationConfig {
  enabled: boolean;
  defaultGain?: number;
  points: VocalAutomationPoint[];
  regions?: VocalAutomationRegion[];
  backgroundVocalEnabled?: boolean;
  backgroundVocalGain?: number; // e.g. 0.20 (20%)
}

export interface SongItem {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number; // seconds
  bpm: number;
  key: string;
  rawLrc?: string;
  lyrics: LyricLine[];
  originalFileName: string;
  audioBlob?: Blob;
  stems?: AudioStems;
  genre?: string;
  artistsList?: ArtistRole[];
  syncOffset?: number;
  isDuet?: boolean;
  videoBgId?: string;
  videoBgTitle?: string;
  videoBgMode?: VideoBackgroundMode;
  videoBgCustomUrl?: string;
  vocalAutomation?: VocalAutomationConfig;
  createdAt: number;
  updatedAt?: number;
}

export interface QueueItem {
  id: string;
  file?: File;
  fileName: string;
  fileSize?: number;
  status: 'queued' | 'decoding' | 'separating_stems' | 'generating_lyrics' | 'preparing_video' | 'ready' | 'error';
  currentStep?: string;
  progress: number; // 0 to 100
  errorMsg?: string;
  songData?: SongItem;
  requestedBy?: string;
  tableNumber?: string;
}

export interface AudioEngineTelemetry {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  bpm: number;
  detectedKey: string;
  vocalGain: number; // 0 to 2.0 (1.0 default)
  musicGain: number; // 0 to 2.0 (1.0 default)
  masterGain: number; // 0 to 1.5 (1.0 default)
  pitchShift: number; // semitones (-12 to +12)
  isLooping: boolean;
  loopStart: number;
  loopEnd: number;
  isMicActive: boolean;
  micGain: number;
  isRecordingVideo: boolean;
  recordingProgress: number;
}

export interface LRCLibSearchResult {
  id: number;
  name: string;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string;
  syncedLyrics: string;
}

export interface SingerProfile {
  id: string;
  name: string;
  avatar: string; // Emoji avatar e.g. 🎤, 🌟, 👑, 🎸, 💃
  color: string;  // Hex color or theme
  favoriteSongIds: string[]; // List of SongItem ids favorited by this singer
  tableNumber?: string;
  pin?: string;   // 4-digit PIN for profile recovery & unique ownership
  deviceId?: string;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  senderName: string;
  senderProfileId?: string;
  targetProfileId?: string;
  tableNumber?: string;
  text: string;
  timestamp: number;
  avatar?: string;
  color?: string;
  isHost?: boolean;
}

