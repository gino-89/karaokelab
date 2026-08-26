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

// Google public STUN servers for 100% reliable cross-device WebRTC NAT traversal (WiFi, 4G/5G, cross-network)
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
  private onCommandCallback: ((cmd: string, data?: any) => void) | null = null;
  private onCatalogReceivedCallback: ((songs: SongItem[]) => void) | null = null;
  private onGuestsChangedCallback: ((guests: ConnectedGuest[]) => void) | null = null;

  private currentMiniCatalog: any[] = [];

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

          if (data.type === 'ADD_TO_QUEUE') {
            if (this.onCommandCallback) {
              this.onCommandCallback('ADD_TO_QUEUE', data.payload);
            }
          } else if (data.type === 'GUEST_INFO') {
            // Guest is sending their name
            const guest: ConnectedGuest = {
              peerId: conn.peer,
              name: data.payload?.name || 'Invitado',
              connectedAt: Date.now(),
            };
            this.connectedGuests.set(conn.peer, guest);
            this._notifyGuestsChanged();
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

        // Send immediately if channel open
        if (this.currentMiniCatalog.length > 0) {
          try {
            conn.send({ type: 'CATALOG_SYNC', payload: this.currentMiniCatalog });
          } catch (_) {}
        }
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
    if (conn) {
      try {
        conn.send({ type: 'KICK', payload: { reason: 'Expulsado por el host' } });
      } catch (_) {}
      setTimeout(() => {
        try { conn.close(); } catch (_) {}
      }, 300);
    }
    this.guestConnections.delete(peerId);
    this.connectedGuests.delete(peerId);
    this._notifyGuestsChanged();
  }

  // Register callback for guest connection changes
  public onGuestsChanged(callback: (guests: ConnectedGuest[]) => void): () => void {
    this.onGuestsChangedCallback = callback;
    return () => { this.onGuestsChangedCallback = null; };
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
          console.log('✓ WebRTC P2P connected to Host:', targetHostId);
          // Send guest name to host
          const savedName = localStorage.getItem('karaokelab_guest_name') || 'Invitado';
          conn.send({ type: 'GUEST_INFO', payload: { name: savedName } });
        });

        conn.on('data', (data: any) => {
          if (data && data.type === 'CATALOG_SYNC' && Array.isArray(data.payload)) {
            if (this.onCatalogReceivedCallback) {
              this.onCatalogReceivedCallback(data.payload);
            }
          } else if (data && data.type === 'KICK') {
            // Host kicked this guest — show message and redirect
            alert('Has sido expulsado de la sesión por el anfitrión.');
            try { this.peer?.destroy(); } catch (_) {}
            window.location.href = window.location.origin;
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

  // Send guest name to host (can be called after setting name)
  public sendGuestName(name: string) {
    if (this.hostConnection && this.hostConnection.open) {
      try {
        this.hostConnection.send({ type: 'GUEST_INFO', payload: { name } });
      } catch (_) {}
    }
  }

  // Send song request command from guest mobile phone to host
  public sendSongRequestFromGuest(songData: { id?: string; title: string; artist?: string; singerName?: string }) {
    if (this.hostConnection && this.hostConnection.open) {
      try {
        // Include guest name in the request
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
