import Peer, { DataConnection } from 'peerjs';
import { SongItem } from '../types';

export interface PeerMessage {
  type: 'CATALOG_SYNC' | 'ADD_TO_QUEUE' | 'HEARTBEAT';
  payload?: any;
}

class PeerSyncService {
  private peer: Peer | null = null;
  private hostConnection: DataConnection | null = null;
  private guestConnections: Map<string, DataConnection> = new Map();
  private hostId: string | null = null;
  private isHost: boolean = false;
  private onCommandCallback: ((cmd: string, data?: any) => void) | null = null;
  private onCatalogReceivedCallback: ((songs: SongItem[]) => void) | null = null;

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
      this.peer = new Peer(sessionPeerId);

      this.peer.on('open', (id) => {
        this.hostId = id;
        if (onPeerIdReady) onPeerIdReady(id);
      });

      this.peer.on('connection', (conn) => {
        this.guestConnections.set(conn.peer, conn);

        conn.on('data', (data: any) => {
          if (data && data.type === 'ADD_TO_QUEUE') {
            if (this.onCommandCallback) {
              this.onCommandCallback('ADD_TO_QUEUE', data.payload);
            }
          }
        });

        conn.on('close', () => {
          this.guestConnections.delete(conn.peer);
        });

        conn.on('error', () => {
          this.guestConnections.delete(conn.peer);
        });

        // Automatically send current catalog to newly connected guest
        try {
          const raw = localStorage.getItem('karaokelab_song_catalog');
          if (raw) {
            const catalog = JSON.parse(raw);
            conn.send({ type: 'CATALOG_SYNC', payload: catalog });
          }
        } catch (_) {}
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
      this.peer = new Peer();

      this.peer.on('open', () => {
        if (!this.peer || !targetHostId) return;

        const conn = this.peer.connect(targetHostId, { reliable: true });
        this.hostConnection = conn;

        conn.on('open', () => {
          console.log('✓ WebRTC connected to Host:', targetHostId);
          // Request initial catalog sync
          conn.send({ type: 'HEARTBEAT' });
        });

        conn.on('data', (data: any) => {
          if (data && data.type === 'CATALOG_SYNC' && Array.isArray(data.payload)) {
            if (this.onCatalogReceivedCallback) {
              this.onCatalogReceivedCallback(data.payload);
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

  // Send song request command from guest mobile phone to host
  public sendSongRequestFromGuest(songData: { id?: string; title: string; artist?: string; singerName?: string }) {
    if (this.hostConnection && this.hostConnection.open) {
      try {
        this.hostConnection.send({
          type: 'ADD_TO_QUEUE',
          payload: songData,
        });
      } catch (e) {
        console.warn('Error sending song request to host:', e);
      }
    }
  }
}

export const peerSync = new PeerSyncService();
