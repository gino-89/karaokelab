import Peer, { DataConnection } from 'peerjs';
import { SongItem } from '../types';

export interface PeerMessage {
  type: 'CATALOG_SYNC' | 'ADD_TO_QUEUE' | 'HEARTBEAT' | 'GUEST_JOINED' | 'GUEST_INFO' | 'KICK';
  payload?: any;
}

export interface ConnectedGuest {
  peerId: string;
  deviceId: string;
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

export function getOrCreateGuestDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  let devId = '';
  try {
    devId = localStorage.getItem('karaokelab_device_id') || '';
    if (!devId) {
      devId = 'dev_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
      localStorage.setItem('karaokelab_device_id', devId);
    }
  } catch (_) {
    devId = 'dev_temp_' + Math.random().toString(36).substring(2, 10);
  }
  return devId;
}

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
  private onKickedCallback: (() => void) | null = null;

  private currentMiniCatalog: any[] = [];

  // HOST-SIDE BANLISTS: Tracks expelled devices, names, and peer IDs
  private bannedDeviceIds: Set<string> = new Set();
  private bannedGuestNames: Set<string> = new Set();
  private bannedPeerIds: Set<string> = new Set();

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
        // Immediate check if peerId is banned
        if (this.bannedPeerIds.has(conn.peer)) {
          try {
            conn.send({ type: 'KICK', payload: { reason: 'Expulsado por el host' } });
          } catch (_) {}
          setTimeout(() => { try { conn.close(); } catch (_) {} }, 200);
          return;
        }

        this.guestConnections.set(conn.peer, conn);

        conn.on('open', () => {
          // If already banned, reject
          if (this.bannedPeerIds.has(conn.peer)) {
            try {
              conn.send({ type: 'KICK', payload: { reason: 'Expulsado por el host' } });
            } catch (_) {}
            setTimeout(() => { try { conn.close(); } catch (_) {} }, 200);
            return;
          }

          if (this.currentMiniCatalog.length > 0) {
            try {
              conn.send({ type: 'CATALOG_SYNC', payload: this.currentMiniCatalog });
            } catch (_) {}
          }
        });

        conn.on('data', (data: any) => {
          if (!data) return;

          // GUARD: If this connection is banned, NEVER process and send KICK
          if (this.bannedPeerIds.has(conn.peer)) {
            try {
              conn.send({ type: 'KICK', payload: { reason: 'Expulsado por el host' } });
            } catch (_) {}
            return;
          }

          if (data.type === 'GUEST_INFO') {
            const guestName = (data.payload?.name || 'Invitado').trim();
            const deviceId = (data.payload?.deviceId || '').trim();

            // CHECK BANLISTS: deviceId, name, or peerId
            const isBanned = (deviceId && this.bannedDeviceIds.has(deviceId)) ||
                             (guestName && this.bannedGuestNames.has(guestName.toLowerCase())) ||
                             this.bannedPeerIds.has(conn.peer);

            if (isBanned) {
              this.bannedPeerIds.add(conn.peer);
              if (deviceId) this.bannedDeviceIds.add(deviceId);
              if (guestName) this.bannedGuestNames.add(guestName.toLowerCase());

              // Send KICK message immediately to force the guest screen to block
              try {
                conn.send({ type: 'KICK', payload: { reason: 'Expulsado por el host' } });
              } catch (_) {}
              setTimeout(() => {
                try {
                  conn.send({ type: 'KICK', payload: { reason: 'Expulsado por el host' } });
                } catch (_) {}
              }, 200);

              setTimeout(() => {
                try { conn.close(); } catch (_) {}
                this.guestConnections.delete(conn.peer);
                this.connectedGuests.delete(conn.peer);
                this._notifyGuestsChanged();
              }, 500);
              return;
            }

            // Valid Guest Registration
            const guest: ConnectedGuest = {
              peerId: conn.peer,
              deviceId: deviceId || conn.peer,
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
            const deviceId = (data.payload?.deviceId || '').trim();
            const senderName = (data.payload?.guestName || '').trim();

            // Strict check: if connection is banned or sender is banned, block command!
            const isBanned = this.bannedPeerIds.has(conn.peer) ||
                             (deviceId && this.bannedDeviceIds.has(deviceId)) ||
                             (senderName && this.bannedGuestNames.has(senderName.toLowerCase()));

            if (isBanned) {
              try {
                conn.send({ type: 'KICK', payload: { reason: 'Expulsado por el host' } });
              } catch (_) {}
              return;
            }

            // Only allow if registered
            if (this.onCommandCallback) {
              this.onCommandCallback('ADD_TO_QUEUE', data.payload);
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
    const guest = this.connectedGuests.get(peerId);
    const conn = this.guestConnections.get(peerId);

    // 1. Add to Host banlists
    this.bannedPeerIds.add(peerId);
    if (guest?.deviceId) {
      this.bannedDeviceIds.add(guest.deviceId);
    }
    if (guest?.name && guest.name.toLowerCase() !== 'invitado') {
      this.bannedGuestNames.add(guest.name.toLowerCase());
    }

    // 2. Send KICK packet over WebRTC immediately
    if (conn) {
      try {
        conn.send({ type: 'KICK', payload: { reason: 'Expulsado por el host' } });
      } catch (_) {}
      setTimeout(() => {
        try {
          conn.send({ type: 'KICK', payload: { reason: 'Expulsado por el host' } });
        } catch (_) {}
      }, 150);

      setTimeout(() => {
        try { conn.close(); } catch (_) {}
      }, 600);
    }

    // 3. Remove from active lists
    this.guestConnections.delete(peerId);
    this.connectedGuests.delete(peerId);
    this._notifyGuestsChanged();
  }

  // Clear banlists (e.g. when host creates new session or unblocks all)
  public clearBannedList() {
    this.bannedDeviceIds.clear();
    this.bannedGuestNames.clear();
    this.bannedPeerIds.clear();
  }

  // Register callback for guest connection changes
  public onGuestsChanged(callback: (guests: ConnectedGuest[]) => void): () => void {
    this.onGuestsChangedCallback = callback;
    return () => { this.onGuestsChangedCallback = null; };
  }

  // Register callback for when this guest gets kicked
  public onKicked(callback: () => void): () => void {
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

    // Send over WebRTC data channels to non-banned guests
    this.guestConnections.forEach((conn, pid) => {
      if (conn.open && !this.bannedPeerIds.has(pid)) {
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
    const deviceId = getOrCreateGuestDeviceId();

    // Check if this host previously expelled this device
    try {
      const kickedFrom = localStorage.getItem('karaokelab_kicked_host');
      if (kickedFrom && kickedFrom === targetHostId) {
        if (this.onKickedCallback) {
          this.onKickedCallback();
        }
        return;
      }
    } catch (_) {}

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
          // Send guest name + unique device ID to host
          const savedName = localStorage.getItem('karaokelab_guest_name') || 'Invitado';
          conn.send({
            type: 'GUEST_INFO',
            payload: { name: savedName, deviceId },
          });
        });

        conn.on('data', (data: any) => {
          if (data && data.type === 'CATALOG_SYNC' && Array.isArray(data.payload)) {
            if (this.onCatalogReceivedCallback) {
              this.onCatalogReceivedCallback(data.payload);
            }
          } else if (data && data.type === 'KICK') {
            // Host kicked this guest — save to persistent storage and trigger UI block
            try {
              localStorage.setItem('karaokelab_kicked_host', targetHostId);
              localStorage.removeItem('karaokelab_guest_name');
            } catch (_) {}

            // Destroy peer connection
            try { conn.close(); } catch (_) {}
            try { this.peer?.destroy(); } catch (_) {}
            this.hostConnection = null;

            // Notify GuestRemoteView to immediately display the blocked QR screen
            if (this.onKickedCallback) {
              this.onKickedCallback();
            }
          }
        });

        conn.on('close', () => {
          // If closed, check if kicked flag was set
          try {
            const kickedFrom = localStorage.getItem('karaokelab_kicked_host');
            if (kickedFrom && kickedFrom === targetHostId) {
              if (this.onKickedCallback) {
                this.onKickedCallback();
              }
            }
          } catch (_) {}
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
        const deviceId = getOrCreateGuestDeviceId();
        this.hostConnection.send({
          type: 'GUEST_INFO',
          payload: { name, deviceId },
        });
      } catch (_) {}
    }
  }

  // Send song request command from guest mobile phone to host
  public sendSongRequestFromGuest(songData: { id?: string; title: string; artist?: string; singerName?: string }) {
    if (this.hostConnection && this.hostConnection.open) {
      try {
        const guestName = localStorage.getItem('karaokelab_guest_name') || 'Invitado';
        const deviceId = getOrCreateGuestDeviceId();
        this.hostConnection.send({
          type: 'ADD_TO_QUEUE',
          payload: { ...songData, guestName, deviceId },
        });
      } catch (e) {
        console.warn('Error sending song request to host:', e);
      }
    }
  }
}

export const peerSync = new PeerSyncService();
