// Real-time Dual Screen Synchronization Service for Chromecast / AirPlay / External TV
import { LyricLine, ArtistRole, VideoBackgroundConfig } from '../types';

export interface TvStatePayload {
  songTitle?: string;
  songArtist?: string;
  artistsList?: ArtistRole[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  lyrics?: LyricLine[];
  currentIndex: number;
  activeSingerName?: string;
  activeSingerAvatar?: string;
  nextSongTitle?: string;
  nextSongArtist?: string;
  nextSongRequestedBy?: string;
  scoreModalState?: {
    isOpen: boolean;
    mode: 'score' | 'transition';
    performance: any;
    nextSong: any;
    nextSinger?: any;
  } | null;
  bpm?: number;
  isDuetMode?: boolean;
  youTubeEmbedId?: string | null;
  videoBgConfig?: VideoBackgroundConfig;
  catalog?: Array<{ id: string; title: string; artist?: string; genre?: string; bpm?: number; duration?: number }>;
  timestamp: number;
  isTick?: boolean;
}

const CHANNEL_NAME = 'karaokelab_tv_sync';

class TvBroadcastService {
  private channel: BroadcastChannel | null = null;
  private listeners: ((state: TvStatePayload) => void)[] = [];
  private remoteCommandListeners: ((command: string, data?: any) => void)[] = [];

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (event) => {
        const { type, payload } = event.data || {};
        if (type === 'TV_STATE_UPDATE') {
          this.listeners.forEach((fn) => fn(payload));
        } else if (type === 'REMOTE_COMMAND') {
          this.remoteCommandListeners.forEach((fn) => fn(payload.command, payload.data));
        }
      };
    }
  }

  // Broadcast state to external TV window
  public broadcastState(payload: Omit<TvStatePayload, 'timestamp'>) {
    const fullPayload: TvStatePayload = {
      ...payload,
      timestamp: Date.now(),
    };
    if (this.channel) {
      this.channel.postMessage({ type: 'TV_STATE_UPDATE', payload: fullPayload });
    }
    // Also save in localStorage for instant sync on window open
    try {
      localStorage.setItem('karaokelab_tv_state', JSON.stringify(fullPayload));
    } catch (e) {
      // ignore
    }
  }

  // Subscribe to TV state (used by TV window)
  public onStateUpdate(fn: (state: TvStatePayload) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  // Send command from TV back to Remote (if needed)
  public sendRemoteCommand(command: string, data?: any) {
    if (this.channel) {
      this.channel.postMessage({ type: 'REMOTE_COMMAND', payload: { command, data } });
    }
  }

  public onRemoteCommand(fn: (command: string, data?: any) => void): () => void {
    this.remoteCommandListeners.push(fn);
    return () => {
      this.remoteCommandListeners = this.remoteCommandListeners.filter((l) => l !== fn);
    };
  }

  public getInitialState(): TvStatePayload | null {
    try {
      const raw = localStorage.getItem('karaokelab_tv_state');
      if (raw) return JSON.parse(raw);
    } catch (e) {
      // ignore
    }
    return null;
  }
}

export const tvBroadcast = new TvBroadcastService();
