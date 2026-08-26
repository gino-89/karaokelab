import Peer, { DataConnection } from 'peerjs';
import { SongItem } from '../types';

export interface PeerMessage {
  type: 'CATALOG_SYNC' | 'ADD_TO_QUEUE' | 'HEARTBEAT' | 'GUEST_JOINED' | 'GUEST_INFO' | 'KICK';
  payload?: any;
}

export interface ConnectedGuest {
  peerId: string;
  name: string;
  connectedAt: number;
}

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
  private onGuestsChangedCallback: ((guests: ConnectedGuest[]) => void) | null = null;
  private onKickedCallback: ((kickedKey?: string) => void) | null = null;

  private currentMiniCatalog: any[] = [];

  // Get or rotate dynamic QR session key
  public getQrKey(): string {
    return this.currentQrKey;
  }

  public rotateQrKey(): string {
    this.currentQrKey = Math.random().toString(36).substring(2, 8);
    return this.currentQrKey;
  }

  // Initialize Host session on Mac/PC player
  public initHost(
    onCommand: (cmd: string, data?: any) => void,
    onPeerIdReady?: (peerId: string) => void
  ) {
    if (this.peer && !this.peer.destroyed) return;
    this.isHost = true;
    this.onCommandCallback = onCommand;

    // Create unique room ID
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const sessionPeerId = `klab_host_${randomSuffix}`;

    try {
      this.peer = new Peer(sessionPeerId, PEER_CONFIG);

      this.peer.on('open', (id) => {
        this.hostId = id;
        if (onPeerIdReady) onPeerIdReady(id);
      });

      this.peer.on('connection', (conn) => {
        this.guestConnections.set(conn.peer, conn);

        conn.on('open', () => {
          if (this.currentMiniCatalog.length > 0) {
            try {
              conn.send({ type: 'CATALOG_SYNC', payload: this.currentMiniCatalog });
            } catch (_) {}
          }
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

            // Send fresh catalog
            if (this.currentMiniCatalog.length > 0) {
              try {
                conn.send({ type: 'CATALOG_SYNC', payload: this.currentMiniCatalog });
              } catch (_) {}
            }
          } else if (data.type === 'ADD_TO_QUEUE') {
            // Only process if this connection is currently active and registered
            if (this.connectedGuests.has(conn.peer)) {
              if (this.onCommandCallback) {
                this.onCommandCallback('ADD_TO_QUEUE', data.payload);
              }
            }
          }
        });

        conn.on('close', () => {
          this.guestConnections.delete(conn.peer);
          this.connectedGuests.delete(conn.peer);
          this._notifyGuestsChanged();
        });

        conn.on('error', () => {
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

    // Send KICK message containing the key that is now banned
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

    // Rotate QR key so any NEW scan from the host screen generates a brand new unbanned key!
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

    // Save in localStorage for fallback
    try {
      localStorage.setItem('karaokelab_song_catalog', JSON.stringify(miniCatalog));
    } catch (_) {}

    // Send over WebRTC data channels
    this.guestConnections.forEach((conn) => {
      if (conn.open) {
        try {
          conn.send({ type: 'CATALOG_SYNC', payload: miniCatalog });
        } catch (_) {}
      }
    });
  }

  // Initialize Guest session on mobile phone scanning QR
  public initGuest(
    targetHostId: string,
    onCatalogReceived: (songs: SongItem[]) => void
  ) {
    if (this.peer && !this.peer.destroyed) {
      try {
        this.peer.destroy();
      } catch (_) {}
    }

    this.isHost = false;
    this.onCatalogReceivedCallback = onCatalogReceived;

    try {
      this.peer = new Peer(PEER_CONFIG);

      this.peer.on('open', () => {
        if (!this.peer || !targetHostId) return;

        const conn = this.peer.connect(targetHostId, { reliable: true });
        this.hostConnection = conn;

        conn.on('open', () => {
          // Send guest name to host
          const savedName = localStorage.getItem('karaokelab_guest_name') || 'Invitado';
          conn.send({
            type: 'GUEST_INFO',
            payload: { name: savedName },
          });
        });

        conn.on('data', (data: any) => {
          if (data && data.type === 'CATALOG_SYNC' && Array.isArray(data.payload)) {
            if (this.onCatalogReceivedCallback) {
              this.onCatalogReceivedCallback(data.payload);
            }
          } else if (data && data.type === 'KICK') {
            const kickedKey = data.payload?.kickedKey || '';
            const hostId = data.payload?.hostId || targetHostId;

            try {
              if (kickedKey) {
                localStorage.setItem('karaokelab_kicked_key', kickedKey);
              }
              localStorage.setItem('karaokelab_kicked_host', hostId);
              localStorage.removeItem('karaokelab_guest_name');
            } catch (_) {}

            // Destroy peer connection
            try { conn.close(); } catch (_) {}
            try { this.peer?.destroy(); } catch (_) {}
            this.hostConnection = null;

            // Notify GuestRemoteView to immediately display blocked QR screen
            if (this.onKickedCallback) {
              this.onKickedCallback(kickedKey);
            }
          }
        });

        conn.on('error', (err) => {
          console.warn('Guest WebRTC connection error:', err);
        });
      });
    } catch (e) {
      console.warn('Guest PeerJS init exception:', e);
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

  // Send song request command from guest mobile phone to host
  public sendSongRequestFromGuest(songData: { id?: string; title: string; artist?: string; singerName?: string }) {
    if (this.hostConnection && this.hostConnection.open) {
      try {
        const guestName = localStorage.getItem('karaokelab_guest_name') || 'Invitado';
        this.hostConnection.send({
          type: 'ADD_TO_QUEUE',
          payload: { ...songData, guestName },
        });
      } catch (e) {
        console.warn('Error sending song request to host:', e);
      }
    }
  }
}

export const peerSync = new PeerSyncService();
