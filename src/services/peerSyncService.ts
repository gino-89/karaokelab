import Peer, { DataConnection } from 'peerjs';
import { SongItem, SingerProfile, YouTubeFavoriteTrack, ChatMessage } from '../types';
import { getDeviceFingerprint } from './deviceFingerprint';

export interface PeerMessage {
  type: 'CATALOG_SYNC' | 'PROFILES_SYNC' | 'YT_FAVORITES_SYNC' | 'ADD_TO_QUEUE' | 'REMOVE_FROM_QUEUE' | 'QUEUE_SYNC' | 'CREATE_PROFILE' | 'DELETE_PROFILE' | 'TOGGLE_FAVORITE' | 'TOGGLE_YT_FAVORITE' | 'CHAT_MESSAGE' | 'HEARTBEAT' | 'HEARTBEAT_ACK' | 'GUEST_JOINED' | 'GUEST_INFO' | 'KICK' | 'TV_DISPLAY_JOIN' | 'TV_STATE_SYNC';
  payload?: any;
}

export interface ConnectedGuest {
  peerId: string;
  name: string;
  tableNumber?: string;
  connectedAt: number;
  fingerprint?: string;
}

export interface BlockedGuestDevice {
  fingerprint: string;
  name: string;
  blockedAt: number;
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
  private blockedDevices: Map<string, BlockedGuestDevice> = new Map();
  private hostId: string | null = null;
  private isHost: boolean = false;
  private currentQrKey: string = '';
  private onCommandCallback: ((cmd: string, data?: any) => void) | null = null;
  private onCatalogReceivedCallback: ((songs: SongItem[]) => void) | null = null;
  private onProfilesReceivedCallback: ((profiles: SingerProfile[]) => void) | null = null;
  private onYtFavoritesReceivedCallback: ((favorites: YouTubeFavoriteTrack[]) => void) | null = null;
  private onChatMessageReceivedCallback: ((msg: ChatMessage) => void) | null = null;
  private onGuestsChangedCallback: ((guests: ConnectedGuest[]) => void) | null = null;
  private onKickedCallback: ((reason?: string, message?: string) => void) | null = null;
  private onConnectionStatusCallback: ((status: ConnectionStatus) => void) | null = null;
  private onQueueReceivedCallback: ((queue: any[]) => void) | null = null;

  public onChatMessageReceived(callback: (msg: ChatMessage) => void): () => void {
    this.onChatMessageReceivedCallback = callback;
    return () => { this.onChatMessageReceivedCallback = null; };
  }

  public onQueueReceived(callback: (queue: any[]) => void): () => void {
    this.onQueueReceivedCallback = callback;
    if (this.currentQueue && this.currentQueue.length > 0) {
      callback(this.currentQueue);
    }
    return () => { this.onQueueReceivedCallback = null; };
  }

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const savedQrKey = localStorage.getItem('karaokelab_qr_session_key');
        if (savedQrKey) {
          this.currentQrKey = savedQrKey;
        } else {
          this.currentQrKey = this.getOrCreateQrKey();
        }
      } catch (_) {
        this.currentQrKey = Math.random().toString(36).substring(2, 8);
      }

      try {
        const raw = localStorage.getItem('karaokelab_blocked_devices');
        if (raw) {
          const list: BlockedGuestDevice[] = JSON.parse(raw);
          if (Array.isArray(list)) {
            list.forEach((b) => {
              if (b.fingerprint) this.blockedDevices.set(b.fingerprint, b);
            });
          }
        }
      } catch (_) {}
    } else {
      this.currentQrKey = Math.random().toString(36).substring(2, 8);
    }
  }

  private currentMiniCatalog: any[] = [];
  private currentProfiles: SingerProfile[] = [];
  private currentYtFavorites: YouTubeFavoriteTrack[] = [];
  private currentTvState: any = null;
  private currentQueue: any[] = [];

  // Heartbeat & connection monitoring
  private hostHeartbeatTimer: any = null;
  private guestHeartbeatMonitorTimer: any = null;
  private lastHeartbeatReceived: number = 0;
  private currentConnectionStatus: ConnectionStatus = 'disconnected';
  private targetHostId: string | null = null;

  public getOrCreateQrKey(forceNew = false): string {
    const KEY_STORAGE = 'karaokelab_qr_session_key';
    if (!forceNew && typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(KEY_STORAGE);
        if (saved) {
          this.currentQrKey = saved;
          return saved;
        }
      } catch (_) {}
    }
    const newKey = Math.random().toString(36).substring(2, 8);
    this.currentQrKey = newKey;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(KEY_STORAGE, newKey);
      } catch (_) {}
    }
    return newKey;
  }

  public getQrKey(): string {
    if (!this.currentQrKey) {
      this.currentQrKey = this.getOrCreateQrKey();
    }
    return this.currentQrKey;
  }

  public rotateQrKey(): string {
    this.currentQrKey = this.getOrCreateQrKey(true);
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

  public getOrCreateHostId(forceNew = false): string {
    const STORAGE_KEY = 'karaokelab_p2p_host_id';
    if (!forceNew && typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && saved.startsWith('klab_host_')) {
          return saved;
        }
      } catch (_) {}
    }
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const newId = `klab_host_${randomSuffix}`;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, newId);
      } catch (_) {}
    }
    return newId;
  }

  // Regenerate fresh room code and reconnect host peer, disconnecting previous guests
  public regenerateHost(
    onPeerIdReady?: (peerId: string) => void,
    onCommand?: (cmd: string, data?: any) => void
  ) {
    if (this.hostHeartbeatTimer) {
      clearInterval(this.hostHeartbeatTimer);
      this.hostHeartbeatTimer = null;
    }

    // 1. Notify all currently connected guests that QR code was refreshed
    this.guestConnections.forEach((conn) => {
      try {
        conn.send({
          type: 'KICK',
          payload: {
            reason: 'expired_qr',
            message: 'El anfitrión ha renovado el código QR de la sala. Solicita o escanea el nuevo código QR.',
          },
        });
      } catch (_) {}
      setTimeout(() => {
        try { conn.close(); } catch (_) {}
      }, 300);
    });

    this.guestConnections.clear();
    this.connectedGuests.clear();
    this._notifyGuestsChanged();

    // 2. Rotate the QR key
    this.rotateQrKey();

    // 3. Destroy old peer and recreate fresh host
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (_) {}
      this.peer = null;
    }
    this.hostId = null;

    // Force a fresh new host ID
    const newHostId = this.getOrCreateHostId(true);
    this.hostId = newHostId;

    this.initHost(onCommand || this.onCommandCallback || (() => {}), onPeerIdReady);
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
      const currentId = this.hostId || this.getOrCreateHostId();
      if (onPeerIdReady) {
        onPeerIdReady(currentId);
      }
      return;
    }

    // Use persistent host room ID so host peer ID matches the QR code 100%
    const sessionPeerId = this.getOrCreateHostId();
    this.hostId = sessionPeerId;

    try {
      this.peer = new Peer(sessionPeerId, PEER_CONFIG);

      this.peer.on('open', (id) => {
        this.hostId = id;
        console.log('✓ Host PeerJS online with ID:', id);
        if (onPeerIdReady) onPeerIdReady(id);

        // Start sending periodic heartbeats to all connected guests every 1.5s
        if (this.hostHeartbeatTimer) clearInterval(this.hostHeartbeatTimer);
        this.hostHeartbeatTimer = setInterval(() => {
          this.guestConnections.forEach((conn) => {
            if (conn.open) {
              try {
                conn.send({ type: 'HEARTBEAT', payload: { ts: Date.now() } });
              } catch (_) {}
            }
          });
        }, 1500);
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
            const guestFp = data.payload?.fingerprint || '';
            const guestName = (data.payload?.name || 'Invitado').trim();

            // 1. Check if device is in permanent blacklist (Hardware Fingerprint)
            if (guestFp && this.isFingerprintBlocked(guestFp)) {
              console.warn(`Rejecting permanently banned device: ${guestFp} (${guestName})`);
              try {
                conn.send({
                  type: 'KICK',
                  payload: {
                    reason: 'device_banned',
                    message: 'Este dispositivo ha sido bloqueado por el anfitrión.',
                  },
                });
              } catch (_) {}
              setTimeout(() => {
                try { conn.close(); } catch (_) {}
                this.guestConnections.delete(conn.peer);
                this.connectedGuests.delete(conn.peer);
                this._notifyGuestsChanged();
              }, 300);
              return;
            }

            const guestQrKey = data.payload?.qrKey || '';
            // 2. If the host has a QR key active and guest connects with an old/expired QR key:
            if (this.currentQrKey && guestQrKey && guestQrKey !== this.currentQrKey) {
              console.warn(`Rejecting guest with expired QR key: ${guestQrKey} (expected: ${this.currentQrKey})`);
              try {
                conn.send({
                  type: 'KICK',
                  payload: {
                    reason: 'expired_qr',
                    message: 'El código QR ha expirado. Solicita el nuevo código QR.',
                  },
                });
              } catch (_) {}
              setTimeout(() => {
                try { conn.close(); } catch (_) {}
                this.guestConnections.delete(conn.peer);
                this.connectedGuests.delete(conn.peer);
                this._notifyGuestsChanged();
              }, 300);
              return;
            }

            const guest: ConnectedGuest = {
              peerId: conn.peer,
              name: guestName,
              connectedAt: Date.now(),
              fingerprint: guestFp,
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
            if (this.currentYtFavorites.length > 0) {
              try {
                conn.send({ type: 'YT_FAVORITES_SYNC', payload: this.currentYtFavorites });
              } catch (_) {}
            }
          } else if (data.type === 'ADD_TO_QUEUE') {
            console.log('✓ Host received ADD_TO_QUEUE from guest:', data.payload);
            const guest = this.connectedGuests.get(conn.peer);
            if (guest?.fingerprint && this.isFingerprintBlocked(guest.fingerprint)) {
              console.warn('Blocked song submission from banned device:', guest.fingerprint);
              return;
            }

            // Ensure guest is recognized in list if not already
            if (!this.connectedGuests.has(conn.peer)) {
              this.connectedGuests.set(conn.peer, {
                peerId: conn.peer,
                name: data.payload?.guestName || 'Invitado',
                connectedAt: Date.now(),
                fingerprint: data.payload?.fingerprint,
              });
              this._notifyGuestsChanged();
            }
            if (this.onCommandCallback) {
              this.onCommandCallback('ADD_TO_QUEUE', data.payload);
            }
          } else if (data.type === 'REMOVE_FROM_QUEUE') {
            console.log('✓ Host received REMOVE_FROM_QUEUE from guest:', data.payload);
            if (this.onCommandCallback) {
              this.onCommandCallback('REMOVE_FROM_QUEUE', data.payload);
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
          } else if (data.type === 'TOGGLE_YT_FAVORITE') {
            if (this.onCommandCallback) {
              this.onCommandCallback('TOGGLE_YT_FAVORITE', data.payload);
            }
          } else if (data.type === 'CHAT_MESSAGE') {
            if (this.onCommandCallback) {
              this.onCommandCallback('CHAT_MESSAGE', data.payload);
            }
          } else if (data.type === 'TV_DISPLAY_JOIN') {
            console.log('✓ Smart TV display connected via WebRTC:', conn.peer);
            if (this.currentTvState) {
              try {
                conn.send({ type: 'TV_STATE_SYNC', payload: this.currentTvState });
              } catch (_) {}
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

      this.peer.on('error', (err: any) => {
        console.warn('Host PeerJS warning:', err);
        if (err?.type === 'unavailable-id') {
          console.log('Host ID unavailable, regenerating fresh session...');
          this.regenerateHost(onPeerIdReady, onCommand);
        }
      });
    } catch (e) {
      console.warn('Host PeerJS init exception:', e);
    }
  }

  // Get current host peer ID for QR code generation
  public getHostId(): string {
    return this.hostId || this.getOrCreateHostId();
  }

  // Get list of connected guests
  public getConnectedGuests(): ConnectedGuest[] {
    return Array.from(this.connectedGuests.values());
  }

  // Get list of permanently blocked devices
  public getBlockedDevices(): BlockedGuestDevice[] {
    return Array.from(this.blockedDevices.values()).sort((a, b) => b.blockedAt - a.blockedAt);
  }

  // Check if a hardware fingerprint is blocked
  public isFingerprintBlocked(fingerprint?: string): boolean {
    if (!fingerprint) return false;
    return this.blockedDevices.has(fingerprint);
  }

  // Kick/expel a guest by peerId (Temporary disconnect)
  public kickGuest(peerId: string) {
    const conn = this.guestConnections.get(peerId);
    const keyToBan = this.currentQrKey;

    if (conn) {
      try {
        conn.send({
          type: 'KICK',
          payload: {
            reason: 'kicked',
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
              reason: 'kicked',
              kickedKey: keyToBan,
              hostId: this.hostId,
            },
          });
        } catch (_) {}
      }, 150);

      setTimeout(() => {
        try { conn.close(); } catch (_) {}
      }, 500);
    }

    this.guestConnections.delete(peerId);
    this.connectedGuests.delete(peerId);
    this._notifyGuestsChanged();
  }

  // Permanently block and ban a guest device (Hardware Blacklist)
  public blockGuest(peerId: string) {
    const conn = this.guestConnections.get(peerId);
    const guest = this.connectedGuests.get(peerId);
    const fp = guest?.fingerprint || `fp_${peerId}`;
    const name = guest?.name || 'Invitado';

    const blockedEntry: BlockedGuestDevice = {
      fingerprint: fp,
      name,
      blockedAt: Date.now(),
    };

    this.blockedDevices.set(fp, blockedEntry);
    this._saveBlockedDevices();

    if (conn) {
      try {
        conn.send({
          type: 'KICK',
          payload: {
            reason: 'device_banned',
            message: 'Este dispositivo ha sido bloqueado por el anfitrión.',
            hostId: this.hostId,
          },
        });
      } catch (_) {}

      setTimeout(() => {
        try { conn.close(); } catch (_) {}
      }, 300);
    }

    this.guestConnections.delete(peerId);
    this.connectedGuests.delete(peerId);
    this._notifyGuestsChanged();
  }

  // Unblock a device from the blacklist
  public unblockDevice(fingerprint: string) {
    this.blockedDevices.delete(fingerprint);
    this._saveBlockedDevices();
    this._notifyGuestsChanged();
  }

  private _saveBlockedDevices() {
    if (typeof window !== 'undefined') {
      try {
        const list = Array.from(this.blockedDevices.values());
        localStorage.setItem('karaokelab_blocked_devices', JSON.stringify(list));
      } catch (_) {}
    }
  }

  // Register callback for guest connection changes
  public onGuestsChanged(callback: (guests: ConnectedGuest[]) => void): () => void {
    this.onGuestsChangedCallback = callback;
    return () => { this.onGuestsChangedCallback = null; };
  }

  // Register callback for when this guest gets kicked
  public onKicked(callback: (reason?: string, message?: string) => void): () => void {
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

  // Broadcast updated room queue to all connected guest phones
  public broadcastQueueToGuests(queue: any[]) {
    if (!this.isHost) return;
    this.currentQueue = queue;

    this.guestConnections.forEach((conn) => {
      if (conn.open) {
        try {
          conn.send({ type: 'QUEUE_SYNC', payload: queue });
        } catch (_) {}
      }
    });
  }

  // Send request from guest to remove a song from queue
  public sendRemoveFromQueueFromGuest(payload: { songId?: string; queueItemId?: string; songTitle?: string; guestName?: string }) {
    if (this.hostConnection && this.hostConnection.open) {
      try {
        this.hostConnection.send({
          type: 'REMOVE_FROM_QUEUE',
          payload,
        });
      } catch (_) {}
    }
  }

  // Broadcast live TV state (lyrics, song, playback, visualizer, video bg) to Smart TV displays
  public broadcastTvState(state: any) {
    if (!this.isHost) return;
    this.currentTvState = state;

    this.guestConnections.forEach((conn) => {
      if (conn.open) {
        try {
          conn.send({ type: 'TV_STATE_SYNC', payload: state });
        } catch (_) {}
      }
    });
  }

  // Initialize Smart TV session on external Smart TV / Android TV / FireStick / Web TV
  public initTvDisplay(
    targetHostId: string,
    onStateReceived: (state: any) => void,
    onStatusChanged?: (status: ConnectionStatus) => void
  ) {
    this.targetHostId = targetHostId;

    if (this.peer && !this.peer.destroyed) {
      try {
        this.peer.destroy();
      } catch (_) {}
    }

    this.isHost = false;
    this.onConnectionStatusCallback = onStatusChanged || null;
    this._setConnectionStatus('reconnecting');

    try {
      this.peer = new Peer(PEER_CONFIG);

      this.peer.on('open', () => {
        if (!this.peer || !targetHostId) return;

        console.log(`Smart TV connecting to Host: ${targetHostId}`);
        const conn = this.peer.connect(targetHostId, { reliable: true });
        this.hostConnection = conn;

        conn.on('open', () => {
          console.log('✓ Smart TV WebRTC P2P connected to Host:', targetHostId);
          this.lastHeartbeatReceived = Date.now();
          this._setConnectionStatus('connected');

          conn.send({
            type: 'TV_DISPLAY_JOIN',
            payload: { ts: Date.now() },
          });

          // Start Heartbeat monitor on TV: check every 3s
          if (this.guestHeartbeatMonitorTimer) clearInterval(this.guestHeartbeatMonitorTimer);
          this.guestHeartbeatMonitorTimer = setInterval(() => {
            if (!this.hostConnection || !this.hostConnection.open) {
              this._setConnectionStatus('disconnected');
              return;
            }
            const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeatReceived;
            if (timeSinceLastHeartbeat > 20000) {
              this._setConnectionStatus('disconnected');
            } else {
              this._setConnectionStatus('connected');
            }
          }, 3000);
        });

        conn.on('data', (data: any) => {
          if (!data) return;

          this.lastHeartbeatReceived = Date.now();
          this._setConnectionStatus('connected');

          if (data.type === 'HEARTBEAT') {
            try {
              conn.send({ type: 'HEARTBEAT_ACK', payload: { ts: Date.now() } });
            } catch (_) {}
          } else if (data.type === 'TV_STATE_SYNC' && data.payload) {
            onStateReceived(data.payload);
          }
        });

        conn.on('close', () => {
          this._setConnectionStatus('disconnected');
        });

        conn.on('error', (err) => {
          console.warn('Smart TV connection error:', err);
          this._setConnectionStatus('disconnected');
        });
      });

      this.peer.on('error', (err) => {
        console.warn('Smart TV PeerJS error:', err);
        this._setConnectionStatus('disconnected');
      });
    } catch (e) {
      console.warn('Smart TV PeerJS init exception:', e);
      this._setConnectionStatus('disconnected');
    }
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
        const conn = this.peer.connect(targetHostId, { reliable: true });
        this.hostConnection = conn;

        conn.on('open', async () => {
          console.log('✓ WebRTC P2P connected to Host:', targetHostId);
          this.lastHeartbeatReceived = Date.now();
          this._setConnectionStatus('connected');

          const savedName = localStorage.getItem('karaokelab_guest_name') || 'Invitado';
          const savedPin = localStorage.getItem('karaokelab_guest_pin') || '';
          const savedTable = localStorage.getItem('karaokelab_guest_table_number') || '';
          const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
          const urlQrKey = params ? params.get('k') || '' : '';
          const deviceFp = await getDeviceFingerprint();

          conn.send({
            type: 'GUEST_INFO',
            payload: { name: savedName, pin: savedPin, tableNumber: savedTable, qrKey: urlQrKey, fingerprint: deviceFp },
          });

          // Start Heartbeat monitor on Guest: check every 3s
          if (this.guestHeartbeatMonitorTimer) clearInterval(this.guestHeartbeatMonitorTimer);
          this.guestHeartbeatMonitorTimer = setInterval(() => {
            if (!this.hostConnection || !this.hostConnection.open) {
              this._setConnectionStatus('disconnected');
              return;
            }
            const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeatReceived;
            if (timeSinceLastHeartbeat > 20000) {
              this._setConnectionStatus('disconnected');
            } else {
              this._setConnectionStatus('connected');
            }
          }, 3000);
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
          } else if (data.type === 'QUEUE_SYNC' && Array.isArray(data.payload)) {
            console.log('✓ Received queue sync from Host:', data.payload.length, 'items');
            this.currentQueue = data.payload;
            if (this.onQueueReceivedCallback) {
              this.onQueueReceivedCallback(data.payload);
            }
          } else if (data.type === 'CHAT_MESSAGE' && data.payload) {
            if (this.onChatMessageReceivedCallback) {
              this.onChatMessageReceivedCallback(data.payload);
            }
          } else if (data.type === 'KICK') {
            const reason = data.payload?.reason || 'kicked';
            const message = data.payload?.message || '';

            try {
              localStorage.removeItem('karaokelab_guest_name');
              if (reason === 'expired_qr' && targetHostId) {
                localStorage.setItem('karaokelab_expired_qr_host', targetHostId);
                const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
                const currentKey = params?.get('k') || '';
                if (currentKey) {
                  localStorage.setItem('karaokelab_expired_qr_key', currentKey);
                }
              }
            } catch (_) {}

            try { conn.close(); } catch (_) {}
            try { this.peer?.destroy(); } catch (_) {}
            this.hostConnection = null;
            this._setConnectionStatus('disconnected');

            if (this.onKickedCallback) {
              this.onKickedCallback(reason, message);
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
        this._setConnectionStatus('disconnected');
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

  // Send guest name & table to host
  public sendGuestName(name: string, tableNumber?: string) {
    if (this.hostConnection && this.hostConnection.open) {
      try {
        const savedTable = tableNumber || localStorage.getItem('karaokelab_guest_table_number') || '';
        this.hostConnection.send({
          type: 'GUEST_INFO',
          payload: { name, tableNumber: savedTable },
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
    tableNumber?: string;
    isYouTube?: boolean;
    videoId?: string;
    thumbnail?: string;
  }): { success: boolean; error?: string } {
    if (this.hostConnection && this.hostConnection.open) {
      try {
        const guestName = localStorage.getItem('karaokelab_guest_name') || 'Invitado';
        const savedTable = songData.tableNumber || localStorage.getItem('karaokelab_guest_table_number') || '';
        this.hostConnection.send({
          type: 'ADD_TO_QUEUE',
          payload: { ...songData, guestName, tableNumber: savedTable },
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
  public sendChatMessageFromGuest(msg: ChatMessage): { success: boolean; error?: string } {
    if (this.hostConnection && this.hostConnection.open) {
      try {
        this.hostConnection.send({
          type: 'CHAT_MESSAGE',
          payload: msg,
        });
        return { success: true };
      } catch (e: any) {
        return { success: false, error: 'Error al enviar mensaje' };
      }
    }
    return { success: false, error: 'Sin conexión con el anfitrión.' };
  }

  // Broadcast Chat message from host to all connected guest mobile devices
  public broadcastChatMessageToGuests(msg: ChatMessage) {
    if (!this.isHost) return;
    this.guestConnections.forEach((conn) => {
      if (conn.open) {
        try {
          conn.send({ type: 'CHAT_MESSAGE', payload: msg });
        } catch (_) {}
      }
    });
  }
}

export const peerSync = new PeerSyncService();
