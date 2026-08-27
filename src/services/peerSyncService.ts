import Peer, { DataConnection } from 'peerjs';
import { SongItem, SingerProfile, YouTubeFavoriteTrack } from '../types';

export interface PeerMessage {
  type: 'CATALOG_SYNC' | 'PROFILES_SYNC' | 'YT_FAVORITES_SYNC' | 'ADD_TO_QUEUE' | 'CREATE_PROFILE' | 'DELETE_PROFILE' | 'TOGGLE_FAVORITE' | 'TOGGLE_YT_FAVORITE' | 'HEARTBEAT' | 'HEARTBEAT_ACK' | 'GUEST_JOINED' | 'GUEST_INFO' | 'KICK';
  payload?: any;
}

export interface ConnectedGuest {
  peerId: string;
  name: string;
  connectedAt: number;
}

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

// Google public STUN servers for 100% reliable cross-device WebRTC NAT traversal
const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
    ],
  },
};

class PeerSyncService {
  private peer: Peer | null = null;
  private hostConnection: DataConnection | null = null;
  private guestConnections: Map<string, DataConnection> = new Map();
  private connectedGuests: Map<string, ConnectedGuest> = new Map();
  private hostId: string | null = null;
  private isHost: boolean = false;
  private currentQrKey: string = Math.random().toString(36).substring(2, 8);
  private onCommandCallback: ((cmd: string, data?: any) => void) | null = null;
  private onCatalogReceivedCallback: ((songs: SongItem[]) => void) | null = null;
  private onProfilesReceivedCallback: ((profiles: SingerProfile[]) => void) | null = null;
  private onYtFavoritesReceivedCallback: ((favorites: YouTubeFavoriteTrack[]) => void) | null = null;
  private onGuestsChangedCallback: ((guests: ConnectedGuest[]) => void) | null = null;
  private onKickedCallback: ((kickedKey?: string) => void) | null = null;
  private onConnectionStatusCallback: ((status: ConnectionStatus) => void) | null = null;

  private currentMiniCatalog: any[] = [];
  private currentProfiles: SingerProfile[] = [];
  private currentYtFavorites: YouTubeFavoriteTrack[] = [];

  // Heartbeat & connection monitoring
  private hostHeartbeatTimer: any = null;
  private guestHeartbeatMonitorTimer: any = null;
  private lastHeartbeatReceived: number = 0;
  private currentConnectionStatus: ConnectionStatus = 'disconnected';
  private targetHostId: string | null = null;

  // Get or rotate dynamic QR session key
  public getQrKey(): string {
    return this.currentQrKey;
  }

  public rotateQrKey(): string {
    this.currentQrKey = Math.random().toString(36).substring(2, 8);
    return this.currentQrKey;
  }

  public getConnectionStatus(): ConnectionStatus {
    return this.currentConnectionStatus;
  }

  public onConnectionStatusChanged(callback: (status: ConnectionStatus) => void): () => void {
    this.onConnectionStatusCallback = callback;
    return () => { this.onConnectionStatusCallback = null; };
  }

  private _setConnectionStatus(status: ConnectionStatus) {
    if (this.currentConnectionStatus !== status) {
      this.currentConnectionStatus = status;
      if (this.onConnectionStatusCallback) {
        this.onConnectionStatusCallback(status);
      }
    }
  }

  // Initialize Host session on Mac/PC player
  public initHost(
    onCommand: (cmd: string, data?: any) => void,
    onPeerIdReady?: (peerId: string) => void
  ) {
    this.isHost = true;
    this.onCommandCallback = onCommand;

    // If host peer is already open, immediately return current ID
    if (this.peer && !this.peer.destroyed) {
      if (this.hostId && onPeerIdReady) {
        onPeerIdReady(this.hostId);
      }
      return;
    }

    // Create unique room ID
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const sessionPeerId = `klab_host_${randomSuffix}`;

    try {
      this.peer = new Peer(sessionPeerId, PEER_CONFIG);

      this.peer.on('open', (id) => {
        this.hostId = id;
        console.log('✓ Host PeerJS online with ID:', id);
        if (onPeerIdReady) onPeerIdReady(id);

        // Start sending periodic heartbeats to all connected guests every 3s
        if (this.hostHeartbeatTimer) clearInterval(this.hostHeartbeatTimer);
        this.hostHeartbeatTimer = setInterval(() => {
          this.guestConnections.forEach((conn) => {
            if (conn.open) {
              try {
                conn.send({ type: 'HEARTBEAT', payload: { ts: Date.now() } });
              } catch (_) {}
            }
          });
        }, 3000);
      });

      this.peer.on('connection', (conn) => {
        this.guestConnections.set(conn.peer, conn);

        conn.on('open', () => {
          console.log('✓ Guest connected:', conn.peer);
          if (this.currentMiniCatalog.length > 0) {
            try {
              conn.send({ type: 'CATALOG_SYNC', payload: this.currentMiniCatalog });
            } catch (_) {}
          }
          if (this.currentProfiles.length > 0) {
            try {
              conn.send({ type: 'PROFILES_SYNC', payload: this.currentProfiles });
            } catch (_) {}
          }
          try {
            conn.send({ type: 'HEARTBEAT', payload: { ts: Date.now() } });
          } catch (_) {}
        });

        conn.on('data', (data: any) => {
          if (!data) return;

          if (data.type === 'GUEST_INFO') {
            const guestName = (data.payload?.name || 'Invitado').trim();
            const guest: ConnectedGuest = {
              peerId: conn.peer,
              name: guestName,
              connectedAt: Date.now(),
            };
            this.connectedGuests.set(conn.peer, guest);
            this._notifyGuestsChanged();

            if (this.currentMiniCatalog.length > 0) {
              try {
                conn.send({ type: 'CATALOG_SYNC', payload: this.currentMiniCatalog });
              } catch (_) {}
            }
            if (this.currentProfiles.length > 0) {
              try {
                conn.send({ type: 'PROFILES_SYNC', payload: this.currentProfiles });
              } catch (_) {}
            }
          } else if (data.type === 'ADD_TO_QUEUE') {
            console.log('✓ Host received ADD_TO_QUEUE from guest:', data.payload);
            // Ensure guest is recognized in list if not already
            if (!this.connectedGuests.has(conn.peer)) {
              this.connectedGuests.set(conn.peer, {
                peerId: conn.peer,
                name: data.payload?.guestName || 'Invitado',
                connectedAt: Date.now(),
              });
              this._notifyGuestsChanged();
            }
            if (this.onCommandCallback) {
              this.onCommandCallback('ADD_TO_QUEUE', data.payload);
            }
          } else if (data.type === 'CREATE_PROFILE') {
            if (this.onCommandCallback) {
              this.onCommandCallback('CREATE_PROFILE', data.payload);
            }
          } else if (data.type === 'DELETE_PROFILE') {
            if (this.onCommandCallback) {
              this.onCommandCallback('DELETE_PROFILE', data.payload);
            }
          } else if (data.type === 'TOGGLE_FAVORITE') {
            if (this.onCommandCallback) {
              this.onCommandCallback('TOGGLE_FAVORITE', data.payload);
            }
          }
        });

        conn.on('close', () => {
          this.guestConnections.delete(conn.peer);
          this.connectedGuests.delete(conn.peer);
          this._notifyGuestsChanged();
        });

        conn.on('error', (err) => {
          console.warn('Guest connection error:', err);
          this.guestConnections.delete(conn.peer);
          this.connectedGuests.delete(conn.peer);
          this._notifyGuestsChanged();
        });
      });

      this.peer.on('error', (err) => {
        console.warn('Host PeerJS warning:', err);
      });
    } catch (e) {
      console.warn('Host PeerJS init exception:', e);
    }
  }

  // Get current host peer ID for QR code generation
  public getHostId(): string | null {
    return this.hostId;
  }

  // Get list of connected guests
  public getConnectedGuests(): ConnectedGuest[] {
    return Array.from(this.connectedGuests.values());
  }

  // Kick/expel a guest by peerId
  public kickGuest(peerId: string) {
    const conn = this.guestConnections.get(peerId);
    const keyToBan = this.currentQrKey;

    if (conn) {
      try {
        conn.send({
          type: 'KICK',
          payload: {
            reason: 'Expulsado por el host',
            kickedKey: keyToBan,
            hostId: this.hostId,
          },
        });
      } catch (_) {}

      setTimeout(() => {
        try {
          conn.send({
            type: 'KICK',
            payload: {
              reason: 'Expulsado por el host',
              kickedKey: keyToBan,
              hostId: this.hostId,
            },
          });
        } catch (_) {}
      }, 150);

      setTimeout(() => {
        try { conn.close(); } catch (_) {}
      }, 600);
    }

    // Rotate QR key so any NEW camera scan has a fresh unbanned key
    this.rotateQrKey();

    this.guestConnections.delete(peerId);
    this.connectedGuests.delete(peerId);
    this._notifyGuestsChanged();
  }

  // Register callback for guest connection changes
  public onGuestsChanged(callback: (guests: ConnectedGuest[]) => void): () => void {
    this.onGuestsChangedCallback = callback;
    return () => { this.onGuestsChangedCallback = null; };
  }

  // Register callback for when this guest gets kicked
  public onKicked(callback: (kickedKey?: string) => void): () => void {
    this.onKickedCallback = callback;
    return () => { this.onKickedCallback = null; };
  }

  private _notifyGuestsChanged() {
    if (this.onGuestsChangedCallback) {
      this.onGuestsChangedCallback(this.getConnectedGuests());
    }
  }

  // Broadcast updated catalog to all connected guest phones
  public broadcastCatalogToGuests(songs: SongItem[]) {
    if (!this.isHost) return;
    const miniCatalog = songs.map((s) => ({
      id: s.id,
      title: s.title,
      artist: s.artist || '',
      genre: s.genre || '',
      duration: s.duration || 180,
      bpm: s.bpm || 120,
    }));

    this.currentMiniCatalog = miniCatalog;

    try {
      localStorage.setItem('karaokelab_song_catalog', JSON.stringify(miniCatalog));
    } catch (_) {}

    this.guestConnections.forEach((conn) => {
      if (conn.open) {
        try {
          conn.send({ type: 'CATALOG_SYNC', payload: miniCatalog });
        } catch (_) {}
      }
    });
  }

  // Broadcast updated singer profiles to all connected guest phones
  public broadcastProfilesToGuests(profiles: SingerProfile[]) {
    if (!this.isHost) return;
    this.currentProfiles = profiles;

    this.guestConnections.forEach((conn) => {
      if (conn.open) {
        try {
          conn.send({ type: 'PROFILES_SYNC', payload: profiles });
        } catch (_) {}
      }
    });
  }

  // Broadcast updated YouTube favorites to all connected guest phones
  public broadcastYouTubeFavoritesToGuests(favorites: YouTubeFavoriteTrack[]) {
    if (!this.isHost) return;
    this.currentYtFavorites = favorites;

    this.guestConnections.forEach((conn) => {
      if (conn.open) {
        try {
          conn.send({ type: 'YT_FAVORITES_SYNC', payload: favorites });
        } catch (_) {}
      }
    });
  }

  // Initialize Guest session on mobile phone scanning QR
  public initGuest(
    targetHostId: string,
    onCatalogReceived: (songs: SongItem[]) => void,
    onProfilesReceived?: (profiles: SingerProfile[]) => void,
    onYtFavoritesReceived?: (favorites: YouTubeFavoriteTrack[]) => void
  ) {
    this.targetHostId = targetHostId;

    if (this.peer && !this.peer.destroyed) {
      try {
        this.peer.destroy();
      } catch (_) {}
    }

    this.isHost = false;
    this.onCatalogReceivedCallback = onCatalogReceived;
    this.onProfilesReceivedCallback = onProfilesReceived || null;
    this.onYtFavoritesReceivedCallback = onYtFavoritesReceived || null;
    this._setConnectionStatus('reconnecting');

    try {
      this.peer = new Peer(PEER_CONFIG);

      this.peer.on('open', () => {
        if (!this.peer || !targetHostId) return;

        console.log(`Connecting to Host: ${targetHostId}`);
        const conn = this.peer.connect(targetHostId);
        this.hostConnection = conn;

        conn.on('open', () => {
          console.log('✓ WebRTC P2P connected to Host:', targetHostId);
          this.lastHeartbeatReceived = Date.now();
          this._setConnectionStatus('connected');

          const savedName = localStorage.getItem('karaokelab_guest_name') || 'Invitado';
          conn.send({
            type: 'GUEST_INFO',
            payload: { name: savedName },
          });

          // Start Heartbeat monitor on Guest: check every 3s
          if (this.guestHeartbeatMonitorTimer) clearInterval(this.guestHeartbeatMonitorTimer);
          this.guestHeartbeatMonitorTimer = setInterval(() => {
            const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeatReceived;
            if (!this.hostConnection || !this.hostConnection.open || timeSinceLastHeartbeat > 8000) {
              this._setConnectionStatus('disconnected');
            } else {
              this._setConnectionStatus('connected');
            }
          }, 2500);
        });

        conn.on('data', (data: any) => {
          if (!data) return;

          this.lastHeartbeatReceived = Date.now();
          this._setConnectionStatus('connected');

          if (data.type === 'HEARTBEAT') {
            try {
              conn.send({ type: 'HEARTBEAT_ACK', payload: { ts: Date.now() } });
            } catch (_) {}
          } else if (data.type === 'CATALOG_SYNC' && Array.isArray(data.payload)) {
            console.log('✓ Received catalog sync from Host:', data.payload.length, 'songs');
            if (this.onCatalogReceivedCallback) {
              this.onCatalogReceivedCallback(data.payload);
            }
          } else if (data.type === 'PROFILES_SYNC' && Array.isArray(data.payload)) {
            console.log('✓ Received profiles sync from Host:', data.payload.length, 'profiles');
            if (this.onProfilesReceivedCallback) {
              this.onProfilesReceivedCallback(data.payload);
            }
          } else if (data.type === 'YT_FAVORITES_SYNC' && Array.isArray(data.payload)) {
            console.log('✓ Received YouTube favorites sync from Host:', data.payload.length, 'favorites');
            if (this.onYtFavoritesReceivedCallback) {
              this.onYtFavoritesReceivedCallback(data.payload);
            }
          } else if (data.type === 'KICK') {
            const kickedKey = data.payload?.kickedKey || '';
            const hostId = data.payload?.hostId || targetHostId;

            try {
              if (kickedKey) {
                localStorage.setItem('karaokelab_kicked_key', kickedKey);
              }
              localStorage.setItem('karaokelab_kicked_host', hostId);
              localStorage.removeItem('karaokelab_guest_name');
            } catch (_) {}

            try { conn.close(); } catch (_) {}
            try { this.peer?.destroy(); } catch (_) {}
            this.hostConnection = null;
            this._setConnectionStatus('disconnected');

            if (this.onKickedCallback) {
              this.onKickedCallback(kickedKey);
            }
          }
        });

        conn.on('close', () => {
          this._setConnectionStatus('disconnected');
        });

        conn.on('error', (err) => {
          console.warn('Guest WebRTC connection error:', err);
          this._setConnectionStatus('disconnected');
        });
      });

      this.peer.on('error', (err) => {
        console.warn('Guest PeerJS error:', err);
        // If there's an immediate error (like signaling failure) before timeout
        if (!isFallback) {
          console.warn('⚠️ PeerJS error on initial connection. Trying TURN fallback...');
          this.initGuest(targetHostId, onCatalogReceived, onProfilesReceived, true);
        } else {
          this._setConnectionStatus('disconnected');
        }
      });
    } catch (e) {
      console.warn('Guest PeerJS init exception:', e);
      this._setConnectionStatus('disconnected');
    }
  }

  // Reconnect guest on demand
  public reconnectGuest() {
    if (this.targetHostId && !this.isHost && this.onCatalogReceivedCallback) {
      this.initGuest(
        this.targetHostId,
        this.onCatalogReceivedCallback,
        this.onProfilesReceivedCallback || undefined
      );
    }
  }

  // Send guest name to host
  public sendGuestName(name: string) {
    if (this.hostConnection && this.hostConnection.open) {
      try {
        this.hostConnection.send({
          type: 'GUEST_INFO',
          payload: { name },
        });
      } catch (_) {}
    }
  }

  // Send song request from guest to host (Local Song or YouTube Video)
  public sendSongRequestFromGuest(songData: {
    id?: string;
    title: string;
    artist?: string;
    singerName?: string;
    isYouTube?: boolean;
    videoId?: string;
    thumbnail?: string;
  }): { success: boolean; error?: string } {
    if (this.hostConnection && this.hostConnection.open) {
      try {
        const guestName = localStorage.getItem('karaokelab_guest_name') || 'Invitado';
        this.hostConnection.send({
          type: 'ADD_TO_QUEUE',
          payload: { ...songData, guestName },
        });
        console.log('✓ Song request sent to host:', songData.title);
        return { success: true };
      } catch (e: any) {
        console.warn('Error sending song request to host:', e);
        return { success: false, error: 'Error al enviar petición' };
      }
    } else {
      console.warn('Host connection is not open:', this.hostConnection);
      return { success: false, error: 'Sin conexión con el anfitrión. Escanea el código QR de nuevo.' };
    }
  }

  // Send profile creation from guest to host
  public sendCreateProfileFromGuest(profile: SingerProfile) {
    if (this.hostConnection && this.hostConnection.open) {
      try {
        this.hostConnection.send({
          type: 'CREATE_PROFILE',
          payload: profile,
        });
      } catch (e) {
        console.warn('Error sending create profile to host:', e);
      }
    }
  }

  // Send profile deletion from guest to host
  public sendDeleteProfileFromGuest(profileId: string) {
    if (this.hostConnection && this.hostConnection.open) {
      try {
        this.hostConnection.send({
          type: 'DELETE_PROFILE',
          payload: { profileId },
        });
      } catch (e) {
        console.warn('Error sending delete profile to host:', e);
      }
    }
  }

  // Send toggle favorite from guest to host
  public sendToggleFavoriteFromGuest(profileId: string, songId: string) {
    if (this.hostConnection && this.hostConnection.open) {
      try {
        this.hostConnection.send({
          type: 'TOGGLE_FAVORITE',
          payload: { profileId, songId },
        });
      } catch (e) {
        console.warn('Error sending toggle favorite to host:', e);
      }
    }
  }

  // Send toggle YouTube favorite from guest to host
  public sendToggleYouTubeFavoriteFromGuest(track: any, profileId?: string) {
    if (this.hostConnection && this.hostConnection.open) {
      try {
        this.hostConnection.send({
          type: 'TOGGLE_YT_FAVORITE',
          payload: { track, profileId },
        });
      } catch (e) {
        console.warn('Error sending toggle YouTube favorite to host:', e);
      }
    }
  }
}

export const peerSync = new PeerSyncService();
