import React, { useState, useEffect, useCallback } from 'react';
import { SongItem, SingerProfile, YouTubeFavoriteTrack } from '../types';
import { getSongsFromDB, getYouTubeFavoritesFromStorage, saveYouTubeFavoritesToStorage } from '../services/db';
import { tvBroadcast } from '../services/tvBroadcastService';
import { peerSync, ConnectionStatus } from '../services/peerSyncService';
import { searchYouTubeVideos, YouTubeSearchResult } from '../services/youtubeApi';
import { SongLibrary } from './SongLibrary';
import {
  Check,
  ListPlus,
  UserRound,
  ScanLine,
  ShieldX,
  QrCode,
  Camera,
  Wifi,
  WifiOff,
  AlertTriangle,
  RefreshCw,
  Youtube,
  Search,
  Play,
  Loader2,
  BookOpen,
  X,
  Star,
  UserPlus,
} from 'lucide-react';

const GUEST_PROFILE_KEY = 'karaokelab_guest_profiles';
const GUEST_ACTIVE_PROFILE_KEY = 'karaokelab_guest_active_profile';

export const GuestRemoteView: React.FC = () => {
  const [guestName, setGuestName] = useState('');
  const [nameConfirmed, setNameConfirmed] = useState(false);
  const [kicked, setKicked] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('reconnecting');

  const [remoteTab, setRemoteTab] = useState<'library' | 'youtube'>('library');
  const [ytQuery, setYtQuery] = useState('');
  const [ytSearching, setYtSearching] = useState(false);
  const [ytResults, setYtResults] = useState<YouTubeSearchResult[]>([]);
  const [ytActiveEmbedId, setYtActiveEmbedId] = useState<string | null>(null);
  const [youtubeFavorites, setYoutubeFavorites] = useState<YouTubeFavoriteTrack[]>(() => getYouTubeFavoritesFromStorage());

  const [savedSongs, setSavedSongs] = useState<SongItem[]>([]);
  const [profiles, setProfiles] = useState<SingerProfile[]>([
    { id: 'profile_all', name: 'Todos', avatar: '👥', color: '#00f0ff', favoriteSongIds: [], createdAt: 0 },
  ]);
  const [activeProfileId, setActiveProfileId] = useState('profile_all');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [customRequestTitle, setCustomRequestTitle] = useState('');
  const [kickReason, setKickReason] = useState<'kicked' | 'expired_qr' | string>('kicked');
  const [ytTrackForProfileAssign, setYtTrackForProfileAssign] = useState<{ id: string; title: string; channel: string; duration: string; thumbnail: string; url: string } | null>(null);
  const [isCreateProfileOpen, setIsCreateProfileOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileAvatar, setNewProfileAvatar] = useState('🎤');
  const [newProfileColor, setNewProfileColor] = useState('#00f0ff');

  // Initial mount & URL validation
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hostParam = params.get('host') || '';
    const urlKey = params.get('k') || '';
    const expiredHost = localStorage.getItem('karaokelab_expired_qr_host');
    const expiredKey = localStorage.getItem('karaokelab_expired_qr_key');

    let isExpiredLock = false;

    // Check if device was locked due to an expired QR code
    if (expiredHost && hostParam && expiredHost === hostParam) {
      if (urlKey && expiredKey && urlKey !== expiredKey) {
        // Genuine new QR scanned with a different key! Unlock and clear lock
        localStorage.removeItem('karaokelab_expired_qr_host');
        localStorage.removeItem('karaokelab_expired_qr_key');
        setKicked(false);
      } else {
        // Same expired link/key reloaded -> STRICT LOCK on Expired screen!
        setKickReason('expired_qr');
        setKicked(true);
        setNameConfirmed(false);
        isExpiredLock = true;
      }
    } else if (expiredHost && hostParam && expiredHost !== hostParam) {
      // Switched to a new host ID
      localStorage.removeItem('karaokelab_expired_qr_host');
      localStorage.removeItem('karaokelab_expired_qr_key');
      setKicked(false);
    }

    if (!isExpiredLock) {
      const saved = localStorage.getItem('karaokelab_guest_name');
      if (saved) {
        setGuestName(saved);
        setNameConfirmed(true);
      }
    }

    // Load guest-local profiles
    try {
      const raw = localStorage.getItem(GUEST_PROFILE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setProfiles(parsed);
        }
      }
    } catch (_) {}

    const activeId = localStorage.getItem(GUEST_ACTIVE_PROFILE_KEY) || 'profile_all';
    setActiveProfileId(activeId);

    // Real-time listener: host kicked this device or refreshed QR
    const unsubKick = peerSync.onKicked((reason) => {
      const currentParams = new URLSearchParams(window.location.search);
      const currentHost = currentParams.get('host') || '';
      const currentKey = currentParams.get('k') || '';

      if (reason === 'expired_qr') {
        try {
          if (currentHost) localStorage.setItem('karaokelab_expired_qr_host', currentHost);
          if (currentKey) localStorage.setItem('karaokelab_expired_qr_key', currentKey);
        } catch (_) {}
      }

      setKickReason(reason || 'kicked');
      setKicked(true);
      setNameConfirmed(false);
    });

    // Connection status listener (Heartbeat monitor)
    const unsubConn = peerSync.onConnectionStatusChanged((status) => {
      setConnStatus(status);
    });

    return () => {
      unsubKick();
      unsubConn();
    };
  }, []);

  // Save profiles to localStorage whenever they change
  const saveGuestProfiles = useCallback((updatedProfiles: SingerProfile[]) => {
    setProfiles(updatedProfiles);
    try {
      localStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify(updatedProfiles));
    } catch (_) {}
  }, []);

  // Connect to host and load songs once name is confirmed (and NOT kicked)
  useEffect(() => {
    if (!nameConfirmed || kicked) return;

    const loadSongs = async () => {
      let songs = await getSongsFromDB();
      if (!songs || songs.length === 0) {
        try {
          const rawCatalog = localStorage.getItem('karaokelab_song_catalog');
          if (rawCatalog) {
            songs = JSON.parse(rawCatalog);
          }
        } catch (_) {}
      }

      setSavedSongs(songs || []);

      // Connect WebRTC P2P to Host
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const hostParam = params.get('host');
        if (hostParam) {
          peerSync.initGuest(
            hostParam,
            (catalog) => {
              if (catalog && Array.isArray(catalog) && catalog.length > 0) {
                const mapped: SongItem[] = catalog.map((item: any) => ({
                  id: item.id || `remote_${Math.random()}`,
                  title: item.title,
                  artist: item.artist || '',
                  genre: item.genre || '',
                  duration: item.duration || 180,
                  bpm: item.bpm || 120,
                  key: 'C',
                  lyrics: [],
                  originalFileName: `${item.title}.mp3`,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                }));
                setSavedSongs(mapped);
                try {
                  localStorage.setItem('karaokelab_song_catalog', JSON.stringify(mapped));
                } catch (_) {}
              }
            },
            (syncedProfiles) => {
              if (syncedProfiles && Array.isArray(syncedProfiles) && syncedProfiles.length > 0) {
                saveGuestProfiles(syncedProfiles);
              }
            },
            (syncedYtFavorites) => {
              if (syncedYtFavorites && Array.isArray(syncedYtFavorites)) {
                setYoutubeFavorites(syncedYtFavorites);
                saveYouTubeFavoritesToStorage(syncedYtFavorites);
              }
            }
          );
        }
      }
    };

    loadSongs();

    // Listen to live catalog updates from broadcast
    const unsub = tvBroadcast.onStateUpdate((state: any) => {
      if (state?.catalog && Array.isArray(state.catalog) && state.catalog.length > 0) {
        setSavedSongs(state.catalog);
      }
    });
    return () => unsub();
  }, [nameConfirmed, kicked, saveGuestProfiles]);

  const handleConfirmName = () => {
    const trimmed = guestName.trim() || 'Invitado';
    setGuestName(trimmed);
    localStorage.setItem('karaokelab_guest_name', trimmed);
    setNameConfirmed(true);
    peerSync.sendGuestName(trimmed);
  };

  const handleRequestSong = (song: SongItem) => {
    if (kicked) return;

    const isYt = song.id?.startsWith('yt_') || !!song.videoBgId || song.videoBgMode === 'custom';
    const ytVideoId = song.videoBgId || (song.id?.startsWith('yt_') ? song.id.replace('yt_', '') : undefined);

    const payload = {
      requestId: `req_${song.id}_${Date.now()}`,
      id: song.id,
      title: song.title,
      artist: song.artist || '',
      isYouTube: isYt,
      videoId: ytVideoId,
      guestName: guestName,
    };

    const result = peerSync.sendSongRequestFromGuest(payload);

    // Only fallback to broadcast channel if peer sync was not connected
    if (!result.success) {
      tvBroadcast.sendRemoteCommand('ADD_TO_QUEUE', payload);
    }

    if (result.success || typeof window !== 'undefined') {
      setFeedback({
        type: 'success',
        message: isYt ? `¡"${song.title}" de YouTube enviada a la cola! 🎬` : `¡"${song.title}" enviada a la cola! 🎤`,
      });
    } else {
      setFeedback({
        type: 'error',
        message: result.error || '⚠️ Sin conexión con el anfitrión. Escanea el código QR de nuevo.',
      });
    }

    setTimeout(() => setFeedback(null), 4000);
  };

  const handleRequestCustomSong = (title: string) => {
    if (kicked || !title.trim()) return;

    const payload = {
      requestId: `req_custom_${Date.now()}`,
      title: title.trim(),
      guestName: guestName,
    };

    const result = peerSync.sendSongRequestFromGuest(payload);
    if (!result.success) {
      tvBroadcast.sendRemoteCommand('ADD_TO_QUEUE', payload);
    }

    if (result.success || typeof window !== 'undefined') {
      setFeedback({ type: 'success', message: `¡"${title.trim()}" enviada a la cola! 🎤` });
      setCustomRequestTitle('');
    } else {
      setFeedback({
        type: 'error',
        message: result.error || '⚠️ Sin conexión con el anfitrión. Escanea el código QR de nuevo.',
      });
    }

    setTimeout(() => setFeedback(null), 4000);
  };

  // ── YouTube Karaoke Search & Request from Mobile ──
  const handleYouTubeSearch = async (searchTerm?: string) => {
    const q = searchTerm !== undefined ? searchTerm : ytQuery;
    if (!q || !q.trim()) return;
    setYtSearching(true);
    setYtActiveEmbedId(null);
    try {
      const res = await searchYouTubeVideos(q);
      setYtResults(res);
    } catch (err) {
      console.error('YouTube search error in remote:', err);
    } finally {
      setYtSearching(false);
    }
  };

  const handleRequestYouTubeSong = (item: YouTubeSearchResult) => {
    if (kicked) return;

    const payload = {
      requestId: `req_yt_${item.id}_${Date.now()}`,
      isYouTube: true,
      videoId: item.id,
      title: item.title,
      artist: item.channel,
      thumbnail: item.thumbnail,
      guestName: guestName,
    };

    const result = peerSync.sendSongRequestFromGuest(payload);
    if (!result.success) {
      tvBroadcast.sendRemoteCommand('ADD_TO_QUEUE', payload);
    }

    if (result.success || typeof window !== 'undefined') {
      setFeedback({ type: 'success', message: `¡"${item.title}" enviada a la cola de YouTube! 🎬` });
    } else {
      setFeedback({
        type: 'error',
        message: result.error || '⚠️ Sin conexión con el anfitrión. Escanea el código QR de nuevo.',
      });
    }

    setTimeout(() => setFeedback(null), 4000);
  };

  const handleToggleYouTubeFavorite = (
    track: { id: string; title: string; channel: string; duration: string; thumbnail: string; url: string },
    singerProfileId?: string
  ) => {
    const profId = singerProfileId || activeProfileId;
    setYoutubeFavorites((prev) => {
      const exists = prev.some((fav) => fav.id === track.id && (fav.singerProfileId === profId || profId === 'profile_all'));
      let updated: YouTubeFavoriteTrack[];
      if (exists) {
        updated = prev.filter((fav) => !(fav.id === track.id && (fav.singerProfileId === profId || profId === 'profile_all')));
        setFeedback({ type: 'success', message: `¡"${track.title}" quitada de favoritos! ⭐` });
      } else {
        const newItem: YouTubeFavoriteTrack = {
          id: track.id,
          title: track.title,
          channel: track.channel,
          duration: track.duration,
          thumbnail: track.thumbnail,
          url: track.url,
          singerProfileId: profId,
          createdAt: Date.now(),
        };
        updated = [newItem, ...prev];
        const profName = profiles.find((p) => p.id === profId)?.name || 'cantante';
        setFeedback({ type: 'success', message: `¡"${track.title}" guardada en favoritos de ${profName}! ⭐` });
      }
      saveYouTubeFavoritesToStorage(updated);
      peerSync.sendToggleYouTubeFavoriteFromGuest(track, profId);
      return updated;
    });
    setTimeout(() => setFeedback(null), 3000);
  };

  // ── Guest-side profile management synced with main host library ──
  const handleCreateProfile = (name: string, avatar: string, color: string) => {
    const newProfile: SingerProfile = {
      id: `profile_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: name.trim() || 'Cantante',
      avatar: avatar || '🎤',
      color: color || '#00f0ff',
      favoriteSongIds: [],
      createdAt: Date.now(),
    };
    const updated = [...profiles, newProfile];
    saveGuestProfiles(updated);
    setActiveProfileId(newProfile.id);
    localStorage.setItem(GUEST_ACTIVE_PROFILE_KEY, newProfile.id);

    // Send profile to Host so it appears and saves in main library
    peerSync.sendCreateProfileFromGuest(newProfile);
    setFeedback({ type: 'success', message: `¡Perfil "${newProfile.name}" guardado en la biblioteca principal! 👤` });
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleDeleteProfile = (profileId: string) => {
    if (profileId === 'profile_all') return;
    const updated = profiles.filter((p) => p.id !== profileId);
    saveGuestProfiles(updated.length > 0 ? updated : [{ id: 'profile_all', name: 'Todos', avatar: '👥', color: '#00f0ff', favoriteSongIds: [], createdAt: 0 }]);
    setActiveProfileId('profile_all');
    localStorage.setItem(GUEST_ACTIVE_PROFILE_KEY, 'profile_all');

    // Notify Host to delete profile
    peerSync.sendDeleteProfileFromGuest(profileId);
  };

  const handleSelectProfile = (profileId: string) => {
    setActiveProfileId(profileId);
    localStorage.setItem(GUEST_ACTIVE_PROFILE_KEY, profileId);
  };

  const handleToggleFavoriteSong = (profileId: string, songId: string) => {
    const updated = profiles.map((p) => {
      if (p.id !== profileId) return p;
      const favs = p.favoriteSongIds.includes(songId)
        ? p.favoriteSongIds.filter((id) => id !== songId)
        : [...p.favoriteSongIds, songId];
      return { ...p, favoriteSongIds: favs };
    });
    saveGuestProfiles(updated);

    // Sync favorite toggle to host
    peerSync.sendToggleFavoriteFromGuest(profileId, songId);
  };

  // ── KICKED / EXPELLED / EXPIRED QR / BANNED SCREEN ──
  if (kicked) {
    const isBanned = kickReason === 'device_banned';
    const isQrExpired = kickReason === 'expired_qr';

    return (
      <div className="min-h-screen bg-[#06070d] text-white flex items-center justify-center p-4 font-sans select-none">
        <div className="w-full max-w-sm flex flex-col items-center gap-5 animate-in fade-in zoom-in-95 duration-300">
          <div className="relative flex items-center justify-center">
            <div
              className={`w-24 h-24 rounded-3xl bg-gradient-to-br flex items-center justify-center shadow-2xl transition-all ${
                isBanned
                  ? 'from-red-600/30 via-rose-700/40 to-black border border-red-500/70 shadow-[0_0_50px_rgba(239,68,68,0.5)]'
                  : isQrExpired
                  ? 'from-amber-500/20 via-orange-600/30 to-amber-900/40 border border-amber-500/50 shadow-[0_0_50px_rgba(245,158,11,0.35)]'
                  : 'from-rose-500/20 via-rose-600/30 to-red-900/40 border border-rose-500/50 shadow-[0_0_50px_rgba(244,63,94,0.35)]'
              }`}
            >
              {isBanned ? (
                <ShieldX className="w-12 h-12 text-red-400 animate-pulse" />
              ) : isQrExpired ? (
                <QrCode className="w-12 h-12 text-amber-400" />
              ) : (
                <ShieldX className="w-12 h-12 text-rose-400" />
              )}
            </div>
            <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-xs shadow-md">
              {isBanned ? '⛔' : isQrExpired ? '🔄' : '🚫'}
            </div>
          </div>

          <div className="text-center flex flex-col gap-1">
            <h1
              className={`text-xl font-black uppercase tracking-wider ${
                isBanned ? 'text-red-400' : isQrExpired ? 'text-amber-400' : 'text-rose-400'
              }`}
            >
              {isBanned ? 'Dispositivo Bloqueado' : isQrExpired ? 'Código QR Expirado' : 'Dispositivo Desconectado'}
            </h1>
            <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
              {isBanned
                ? 'El anfitrión ha bloqueado el acceso de este dispositivo a la sala.'
                : isQrExpired
                ? 'El anfitrión ha renovado el código QR de la sala.'
                : 'El anfitrión ha desconectado este dispositivo de la sala.'}
            </p>
          </div>

          <div
            className={`w-full p-5 rounded-2xl bg-slate-900/90 border shadow-xl flex flex-col items-center gap-4 text-center ${
              isBanned
                ? 'border-red-500/40 shadow-[0_0_30px_rgba(239,68,68,0.2)]'
                : isQrExpired
                ? 'border-amber-500/40 shadow-[0_0_30px_rgba(245,158,11,0.15)]'
                : 'border-cyan-500/40 shadow-[0_0_30px_rgba(0,240,255,0.15)]'
            }`}
          >
            <div
              className={`w-16 h-16 rounded-2xl border flex items-center justify-center shadow-lg ${
                isBanned
                  ? 'bg-red-950/60 border-red-500/50 text-red-400 shadow-[0_0_25px_rgba(239,68,68,0.3)]'
                  : isQrExpired
                  ? 'bg-amber-950/60 border-amber-500/50 text-amber-400 shadow-[0_0_25px_rgba(245,158,11,0.25)] animate-pulse'
                  : 'bg-cyan-950/60 border-cyan-500/50 text-[#00f0ff] shadow-[0_0_25px_rgba(0,240,255,0.25)] animate-pulse'
              }`}
            >
              {isBanned ? <ShieldX className="w-8 h-8" /> : <ScanLine className="w-8 h-8" />}
            </div>

            <div className="flex flex-col gap-1.5">
              <span
                className={`text-sm font-black tracking-wide uppercase ${
                  isBanned ? 'text-red-300' : isQrExpired ? 'text-amber-300' : 'text-cyan-300'
                }`}
              >
                {isBanned
                  ? 'Acceso Denegado'
                  : isQrExpired
                  ? 'Solicitar Nuevo Código QR'
                  : 'Escanea el Código QR'}
              </span>
              <p className="text-[11px] text-slate-400 leading-snug">
                {isBanned
                  ? 'Este teléfono no tiene permiso para enviar canciones a la cola de reproducción en este evento.'
                  : isQrExpired
                  ? 'Estás intentando ingresar con un código anterior. Pídele al anfitrión el nuevo código QR y escanéalo con la cámara de tu celular para entrar.'
                  : 'Abre la cámara de tu celular y escanea el código QR que se muestra en la pantalla del anfitrión para volver a entrar.'}
              </p>
            </div>

            {!isBanned && (
              <div className="w-full pt-3 border-t border-slate-800/80 flex items-center justify-center gap-2 text-xs text-slate-400">
                <Camera className={`w-4 h-4 animate-bounce ${isQrExpired ? 'text-amber-400' : 'text-cyan-400'}`} />
                <span className="font-semibold text-slate-300">
                  {isQrExpired ? 'Escanea el nuevo QR en pantalla' : 'Usa la cámara nativa de tu teléfono'}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
            <QrCode className="w-3 h-3 text-cyan-500" />
            <span>KaraokeLab Studio Party Connect</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Name Entry Screen ──
  if (!nameConfirmed) {
    return (
      <div className="min-h-screen bg-[#080811] text-white flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-sm flex flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#00f0ff] to-[#ff007f] flex items-center justify-center text-3xl shadow-[0_0_40px_rgba(0,240,255,0.4)]">
              🎤
            </div>
            <h1 className="text-2xl font-black italic uppercase tracking-wider bg-gradient-to-r from-[#00f0ff] to-[#ff007f] bg-clip-text text-transparent">
              KaraokeLab
            </h1>
            <p className="text-xs text-slate-400 font-mono">Control Remoto en Vivo</p>
          </div>

          <div className="w-full p-5 rounded-2xl bg-slate-900/90 border border-cyan-500/30 shadow-[0_0_30px_rgba(0,240,255,0.15)] flex flex-col gap-4">
            <div className="flex items-center gap-2 text-cyan-300">
              <UserRound className="w-5 h-5" />
              <span className="text-sm font-bold">¿Cómo te llamas?</span>
            </div>

            <input
              type="text"
              placeholder="Escribe tu nombre..."
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmName();
              }}
              autoFocus
              className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#00f0ff] focus:shadow-[0_0_15px_rgba(0,240,255,0.2)] transition-all"
            />

            <button
              type="button"
              onClick={handleConfirmName}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00f0ff] to-[#bd00ff] text-slate-950 font-black text-sm cursor-pointer shadow-[0_0_20px_rgba(0,240,255,0.3)] hover:shadow-[0_0_30px_rgba(0,240,255,0.5)] hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              Entrar al Karaoke 🎶
            </button>
          </div>

          <p className="text-[10px] text-slate-600 font-mono text-center">
            Tu nombre aparecerá en la pantalla principal cuando pidas canciones
          </p>
        </div>
      </div>
    );
  }

  // ── Main Remote View ──
  return (
    <div className="min-h-screen bg-[#080811] text-white p-3 pb-40 flex flex-col gap-3 font-sans max-w-4xl mx-auto">
      {/* Centered Modal / Overlay for Lost Connection (Media Pantalla) */}
      {connStatus === 'disconnected' && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200 select-none">
          <div className="w-full max-w-sm bg-[#0d0914] border-2 border-rose-500/60 rounded-3xl shadow-[0_0_60px_rgba(244,63,94,0.4)] p-6 flex flex-col items-center gap-5 text-center relative animate-in zoom-in-95 duration-200">
            {/* Glowing Icon */}
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-rose-500/20 via-rose-600/30 to-red-950/60 border border-rose-500/60 flex items-center justify-center shadow-[0_0_35px_rgba(244,63,94,0.35)] animate-pulse">
                <WifiOff className="w-10 h-10 text-rose-400" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center text-xs shadow">
                ⚠️
              </div>
            </div>

            {/* Title & Description */}
            <div className="flex flex-col gap-1.5">
              <h2 className="text-lg font-black uppercase tracking-wider text-rose-300">
                Conexión Perdida
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed max-w-xs">
                Se perdió la sincronización en vivo con la pantalla del karaoke.
              </p>
              <p className="text-[11px] text-slate-400 leading-snug mt-1">
                El sistema está intentando reconectar. Si el anfitrión reinició la sala, por favor escanea el nuevo código QR.
              </p>
            </div>

            {/* Actions */}
            <div className="w-full flex flex-col gap-2.5 pt-2 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => peerSync.reconnectGuest()}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-black text-xs uppercase tracking-wider cursor-pointer transition-all shadow-[0_0_20px_rgba(244,63,94,0.35)] flex items-center justify-center gap-2 active:scale-95"
              >
                <RefreshCw className="w-4 h-4 text-white" />
                <span>Reconectar Ahora</span>
              </button>

              <button
                type="button"
                onClick={() => window.location.reload()}
                className="w-full py-2 px-3 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-[11px] font-bold cursor-pointer transition-all border border-slate-700/60 flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Recargar Página</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
              <Wifi className="w-3 h-3 text-rose-500 animate-pulse" />
              <span>Intentando reconectar automáticamente...</span>
            </div>
          </div>
        </div>
      )}

      {/* Sticky Header & Navigation for Mobile Phones */}
      <div className="sticky top-0 z-30 bg-[#080811]/95 backdrop-blur-md pb-2 pt-1 space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[#00f0ff] to-[#ff007f] flex items-center justify-center font-black text-slate-950 text-xs shadow-md">
              🎤
            </div>
            <div>
              <h1 className="text-sm font-black italic uppercase tracking-wider text-white">
                KaraokeLab Remote
              </h1>
              <p className="text-[9px] text-cyan-400 font-mono">
                Conectado: <span className="text-white font-bold">{guestName}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setNameConfirmed(false);
                localStorage.removeItem('karaokelab_guest_name');
              }}
              className="px-2 py-1 rounded-lg bg-slate-850 border border-slate-700 text-slate-400 hover:text-white text-[10px] font-bold cursor-pointer transition-all"
            >
              Nombre
            </button>

            {/* Real-time Heartbeat Connection Pill */}
            {connStatus === 'connected' ? (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[9px] font-bold font-mono flex items-center gap-1">
                <Wifi className="w-2.5 h-2.5 text-emerald-400 animate-pulse" />
                <span>En Vivo</span>
              </span>
            ) : connStatus === 'reconnecting' ? (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-bold font-mono flex items-center gap-1 animate-pulse">
                <RefreshCw className="w-2.5 h-2.5 text-amber-400 animate-spin" />
                <span>Reconectando</span>
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[9px] font-bold font-mono flex items-center gap-1">
                <WifiOff className="w-2.5 h-2.5 text-rose-400" />
                <span>Desconectado</span>
              </span>
            )}
          </div>
        </div>

        {/* Remote Navigation Tabs: Local Library vs YouTube Online Search */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950/90 rounded-xl border border-slate-800 shadow-xl">
          <button
            type="button"
            onClick={() => setRemoteTab('library')}
            className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
              remoteTab === 'library'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-[0_0_20px_rgba(0,240,255,0.3)] font-black'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Biblioteca ({savedSongs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setRemoteTab('youtube')}
            className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
              remoteTab === 'youtube'
                ? 'bg-gradient-to-r from-red-600 to-pink-600 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)] font-black'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Youtube className="w-3.5 h-3.5 text-red-400 fill-current" />
            <span>YouTube Karaoke 🎬</span>
          </button>
        </div>
      </div>

      {/* TAB 1: YOUTUBE KARAOKE SEARCH */}
      {remoteTab === 'youtube' && (
        <div className="flex flex-col gap-3 animate-in fade-in duration-200">
          {/* YouTube Search Bar */}
          <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-red-500/40 flex flex-col gap-2.5 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-red-300 flex items-center gap-1.5 font-mono uppercase tracking-wider">
                <Youtube className="w-3.5 h-3.5 text-red-500 fill-current" />
                <span>Buscador YouTube en Vivo</span>
              </span>
              <span className="text-[10px] text-slate-400">Pide a la cola del host</span>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="search"
                  enterKeyHint="search"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Busca por canción o artista (ej. Luis Miguel, Bad Bunny)..."
                  value={ytQuery}
                  onChange={(e) => setYtQuery(e.target.value)}
                  onFocus={(e) => {
                    setTimeout(() => {
                      e.target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 300);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      (e.target as HTMLInputElement).blur();
                      handleYouTubeSearch();
                    }
                  }}
                  className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-red-500 focus:shadow-[0_0_15px_rgba(239,68,68,0.2)] transition-all"
                />
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                {ytQuery && (
                  <button
                    type="button"
                    onClick={() => { setYtQuery(''); setYtResults([]); }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => handleYouTubeSearch()}
                disabled={ytSearching || !ytQuery.trim()}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-50 text-white font-black text-xs shrink-0 cursor-pointer shadow-md hover:scale-105 active:scale-95 transition-all flex items-center gap-1.5"
              >
                {ytSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                <span>Buscar</span>
              </button>
            </div>

            {/* Popular Suggestions */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
              <span className="text-slate-500 font-mono font-bold shrink-0">Popular:</span>
              {['Luis Miguel', 'Bad Bunny', 'Karol G', 'Queen', 'Rocío Dúrcal', 'RBD', 'Salsa', 'Cumbia'].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    setYtQuery(tag);
                    handleYouTubeSearch(tag);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition-colors cursor-pointer shrink-0"
                >
                  {tag}
                </button>
              ))}
            </div>
            {/* Singer Profile Active Indicator in YouTube Tab */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 text-xs border-t border-slate-800/80">
              <span className="text-[10px] text-slate-400 font-mono shrink-0">Cantante activo:</span>
              {profiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectProfile(p.id)}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all flex items-center gap-1 shrink-0 cursor-pointer ${
                    activeProfileId === p.id
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-black shadow-md'
                      : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60'
                  }`}
                >
                  <span>{p.avatar}</span>
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Active Preview Embed Player */}
          {ytActiveEmbedId && (
            <div className="rounded-2xl overflow-hidden border border-red-500/40 bg-black shadow-[0_0_30px_rgba(239,68,68,0.2)]">
              <div className="p-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs font-bold text-red-400 font-mono flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5 fill-current" />
                  PREVIEW EN CELULAR
                </span>
                <button
                  type="button"
                  onClick={() => setYtActiveEmbedId(null)}
                  className="text-xs text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800 cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
              <div className="relative aspect-video w-full">
                <iframe
                  src={`https://www.youtube.com/embed/${ytActiveEmbedId}?autoplay=1`}
                  title="YouTube Player Preview"
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          )}

          {/* YouTube Results List */}
          {ytSearching ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400 bg-slate-900/40 rounded-2xl border border-slate-800">
              <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
              <p className="text-xs font-medium">Buscando pistas de Karaoke en YouTube...</p>
            </div>
          ) : ytResults.length > 0 ? (
            <div className="flex flex-col gap-3">
              {ytResults.map((item) => {
                const isFav = youtubeFavorites.some(
                  (fav) => fav.id === item.id && (fav.singerProfileId === activeProfileId || activeProfileId === 'profile_all')
                );
                return (
                  <div
                    key={item.id}
                    className="flex flex-col justify-between p-3 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-red-500/40 transition-all shadow-lg gap-3"
                  >
                    <div className="flex gap-3">
                      <div className="relative w-24 h-16 rounded-xl overflow-hidden shrink-0 bg-slate-950 border border-slate-800">
                        <img
                          src={item.thumbnail}
                          alt={item.title}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as any).src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80';
                          }}
                        />
                        <span className="absolute bottom-1 right-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/80 text-white font-bold">
                          {item.duration}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <h3 className="text-xs font-bold text-white line-clamp-2 leading-snug">
                          {item.title}
                        </h3>
                        <p className="text-[10px] text-slate-400 mt-1 truncate">{item.channel}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() => handleRequestYouTubeSong(item)}
                        className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-500 hover:to-pink-500 text-white text-xs font-black transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                      >
                        <ListPlus className="w-3.5 h-3.5" />
                        <span>Pedir a la Cola 🎤</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setYtTrackForProfileAssign(item)}
                        className={`p-2 rounded-xl text-xs font-bold transition-all border flex items-center justify-center cursor-pointer ${
                          isFav
                            ? 'bg-amber-500 text-slate-950 border-amber-400 font-black shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                            : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-700'
                        }`}
                        title="Asignar favorito a cantante"
                      >
                        <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-slate-950 text-slate-950' : 'fill-amber-300 text-amber-300'}`} />
                      </button>

                      <button
                        type="button"
                        onClick={() => setYtActiveEmbedId(item.id === ytActiveEmbedId ? null : item.id)}
                        className="py-2 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-all border border-slate-700 flex items-center gap-1 cursor-pointer"
                        title="Ver preview del video"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Preview</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500 text-center bg-slate-900/30 rounded-2xl border border-slate-800/80 p-6">
              <div className="w-12 h-12 rounded-full bg-red-600/10 border border-red-500/20 flex items-center justify-center text-red-500 mb-1">
                <Youtube className="w-6 h-6" />
              </div>
              <p className="text-xs font-bold text-slate-300">Explora millones de canciones de YouTube</p>
              <p className="text-[11px] text-slate-500 max-w-xs">
                Busca cualquier tema en vivo, guárdalo en favoritos o toca <b>"Pedir a la Cola"</b> para que se agregue a la pantalla principal.
              </p>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: LOCAL LIBRARY VIEW */}
      {remoteTab === 'library' && (
        <div className="flex flex-col gap-3 animate-in fade-in duration-200">
          {/* Quick Custom Song Request Bar */}
          <div className="p-3 rounded-2xl bg-slate-900/90 border border-cyan-500/40 flex flex-col gap-2 shadow-lg">
            <span className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5">
              <span>🎤</span>
              <span>¿No ves tu canción? Pídela directamente:</span>
            </span>
            <div className="flex items-center gap-2">
              <input
                type="search"
                enterKeyHint="send"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Escribe el nombre de la canción o artista..."
                value={customRequestTitle}
                onChange={(e) => setCustomRequestTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customRequestTitle.trim()) {
                    (e.target as HTMLInputElement).blur();
                    handleRequestCustomSong(customRequestTitle.trim());
                  }
                }}
                className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#00f0ff]"
              />
              <button
                type="button"
                onClick={() => customRequestTitle.trim() && handleRequestCustomSong(customRequestTitle.trim())}
                className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#00f0ff] to-[#bd00ff] text-slate-950 font-black text-xs shrink-0 cursor-pointer shadow-md hover:scale-105 active:scale-95 transition-all flex items-center gap-1"
              >
                <ListPlus className="w-3.5 h-3.5" />
                <span>Pedir</span>
              </button>
            </div>
          </div>

          {/* Main Song Library Component (Guest Mode: no delete buttons, with profile management and YouTube favorites) */}
          <SongLibrary
            savedSongs={savedSongs}
            queue={[]}
            onFilesSelected={() => {}}
            onSelectSong={handleRequestSong}
            onDeleteSong={() => {}}
            onAddToQueue={handleRequestSong}
            profiles={profiles}
            activeProfileId={activeProfileId}
            onSelectProfile={handleSelectProfile}
            onCreateProfile={handleCreateProfile}
            onDeleteProfile={handleDeleteProfile}
            onToggleFavoriteSong={handleToggleFavoriteSong}
            youtubeFavorites={youtubeFavorites}
            onToggleYouTubeFavorite={handleToggleYouTubeFavorite}
            isGuestMode={true}
          />
        </div>
      )}

      {/* Modal: Asignar Favorito de YouTube a Cantante */}
      {ytTrackForProfileAssign && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200 select-none">
          <div className="w-full max-w-sm bg-[#0c0d18] border border-amber-500/40 rounded-3xl p-5 flex flex-col gap-4 shadow-[0_0_40px_rgba(245,158,11,0.25)]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                <Star className="w-4 h-4 fill-amber-400" />
                <span>Asignar Favorito a Cantante</span>
              </div>
              <button
                type="button"
                onClick={() => setYtTrackForProfileAssign(null)}
                className="p-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Video preview summary */}
            <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-slate-950 border border-slate-800">
              <img
                src={ytTrackForProfileAssign.thumbnail}
                alt={ytTrackForProfileAssign.title}
                className="w-16 h-11 rounded-lg object-cover shrink-0 bg-slate-900"
              />
              <div className="flex flex-col min-w-0">
                <p className="text-xs text-white font-bold line-clamp-2 leading-snug">
                  {ytTrackForProfileAssign.title}
                </p>
                <p className="text-[10px] text-slate-400 truncate mt-0.5">
                  {ytTrackForProfileAssign.channel} • {ytTrackForProfileAssign.duration}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-400">
              Selecciona qué cantantes tienen este video en su repertorio favorito:
            </p>

            {/* Quick Inline Singer Creation */}
            <div className="p-2.5 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col gap-1.5 shadow-inner">
              <span className="text-[10px] font-bold text-amber-300 flex items-center gap-1">
                <UserPlus className="w-3 h-3 text-amber-400" />
                <span>¿No ves al cantante? Créalo y asígnalo aquí:</span>
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Nombre del cantante (ej: Gino)..."
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newProfileName.trim()) {
                      handleCreateProfile(newProfileName.trim(), newProfileAvatar, newProfileColor);
                      setNewProfileName('');
                    }
                  }}
                  className="flex-1 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newProfileName.trim()) {
                      handleCreateProfile(newProfileName.trim(), newProfileAvatar, newProfileColor);
                      setNewProfileName('');
                    }
                  }}
                  disabled={!newProfileName.trim()}
                  className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 disabled:opacity-40 text-slate-950 text-xs font-black cursor-pointer shadow-md hover:scale-105 active:scale-95 transition-all shrink-0 flex items-center gap-1"
                >
                  + Crear
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
              {profiles.filter((p) => p.id !== 'profile_all').length === 0 ? (
                <div className="py-6 text-center text-slate-500 text-xs bg-slate-900/40 rounded-2xl border border-slate-800/80 p-4">
                  <p className="mb-3 text-slate-400">Aún no has creado ningún perfil de persona.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setYtTrackForProfileAssign(null);
                      setIsCreateProfileOpen(true);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#00f0ff] to-[#bd00ff] text-slate-950 font-black text-xs cursor-pointer shadow-md hover:scale-105 transition-all"
                  >
                    + Crear Perfil (Ej: John)
                  </button>
                </div>
              ) : (
                profiles
                  .filter((p) => p.id !== 'profile_all')
                  .map((p) => {
                    const isFav = youtubeFavorites.some(
                      (fav) => fav.id === ytTrackForProfileAssign.id && fav.singerProfileId === p.id
                    );
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleToggleYouTubeFavorite(ytTrackForProfileAssign, p.id)}
                        className={`flex items-center justify-between px-3.5 py-2.5 rounded-2xl border text-xs font-bold transition-all cursor-pointer ${
                          isFav
                            ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.25)]'
                            : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-lg">{p.avatar}</span>
                          <span className="font-bold">{p.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Star className={`w-4 h-4 ${isFav ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`} />
                          <span className="text-[10px] font-mono">{isFav ? 'Favorita' : 'No asignada'}</span>
                        </div>
                      </button>
                    );
                  })
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setYtTrackForProfileAssign(null);
                  setIsCreateProfileOpen(true);
                }}
                className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 cursor-pointer flex items-center gap-1"
              >
                <span>+ Nuevo Cantante</span>
              </button>
              <button
                type="button"
                onClick={() => setYtTrackForProfileAssign(null)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-black cursor-pointer shadow-md transition-all active:scale-95"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Crear Perfil de Cantante */}
      {isCreateProfileOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200 select-none">
          <div className="w-full max-w-sm bg-[#0c0d18] border border-cyan-500/40 rounded-3xl p-5 flex flex-col gap-4 shadow-[0_0_40px_rgba(0,240,255,0.25)]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-cyan-300 font-bold text-sm">
                <span>🎤</span>
                <span>Crear Cantante</span>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateProfileOpen(false)}
                className="p-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">Nombre del Cantante</label>
                <input
                  type="text"
                  placeholder="Ej: Gino, Andrea..."
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  autoFocus
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">Elige un Emoji</label>
                <div className="flex flex-wrap gap-2">
                  {['🎤', '🌟', '🎸', '🔥', '👑', '😎', '💃', '🚀', '🎶', '💎'].map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setNewProfileAvatar(emoji)}
                      className={`w-9 h-9 rounded-xl text-lg flex items-center justify-center border transition-all cursor-pointer ${
                        newProfileAvatar === emoji
                          ? 'bg-cyan-500/20 border-cyan-400 shadow-[0_0_10px_rgba(0,240,255,0.3)]'
                          : 'bg-slate-950 border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsCreateProfileOpen(false)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (newProfileName.trim()) {
                    handleCreateProfile(newProfileName.trim(), newProfileAvatar, newProfileColor);
                    setNewProfileName('');
                    setIsCreateProfileOpen(false);
                  }
                }}
                disabled={!newProfileName.trim()}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#00f0ff] to-[#bd00ff] disabled:opacity-50 text-slate-950 text-xs font-black cursor-pointer shadow-md"
              >
                Crear Perfil
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
