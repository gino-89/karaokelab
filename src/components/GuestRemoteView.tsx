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

  // Initial mount & URL validation
  useEffect(() => {
    const saved = localStorage.getItem('karaokelab_guest_name');
    if (saved) {
      setGuestName(saved);
      setNameConfirmed(true);
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

    // Real-time listener: host kicked this device
    const unsubKick = peerSync.onKicked(() => {
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

    const payload = {
      requestId: `req_${song.id}_${Date.now()}`,
      id: song.id,
      title: song.title,
      artist: song.artist || '',
      guestName: guestName,
    };

    const result = peerSync.sendSongRequestFromGuest(payload);

    // Only fallback to broadcast channel if peer sync was not connected
    if (!result.success) {
      tvBroadcast.sendRemoteCommand('ADD_TO_QUEUE', payload);
    }

    if (result.success || typeof window !== 'undefined') {
      setFeedback({ type: 'success', message: `¡"${song.title}" enviada a la cola! 🎤` });
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

  // ── KICKED / EXPELLED SCREEN ──
  if (kicked) {
    return (
      <div className="min-h-screen bg-[#06070d] text-white flex items-center justify-center p-4 font-sans select-none">
        <div className="w-full max-w-sm flex flex-col items-center gap-5 animate-in fade-in zoom-in-95 duration-300">
          <div className="relative flex items-center justify-center">
            <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-rose-500/20 via-rose-600/30 to-red-900/40 border border-rose-500/50 flex items-center justify-center shadow-[0_0_50px_rgba(244,63,94,0.35)]">
              <ShieldX className="w-12 h-12 text-rose-400" />
            </div>
            <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-xs shadow-md">
              🚫
            </div>
          </div>

          <div className="text-center flex flex-col gap-1">
            <h1 className="text-xl font-black uppercase tracking-wider text-rose-400">
              Dispositivo Expulsado
            </h1>
            <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
              El anfitrión ha desconectado este dispositivo de la sala.
            </p>
          </div>

          <div className="w-full p-5 rounded-2xl bg-slate-900/90 border border-cyan-500/40 shadow-[0_0_30px_rgba(0,240,255,0.15)] flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-cyan-950/60 border border-cyan-500/50 flex items-center justify-center text-[#00f0ff] shadow-[0_0_25px_rgba(0,240,255,0.25)] animate-pulse">
              <ScanLine className="w-8 h-8" />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-black text-cyan-300 tracking-wide">
                Escanea el Código QR
              </span>
              <p className="text-[11px] text-slate-400 leading-snug">
                Abre la <b>cámara de tu celular</b> y escanea el código QR que se muestra en la pantalla del anfitrión para volver a entrar.
              </p>
            </div>

            <div className="w-full pt-3 border-t border-slate-800/80 flex items-center justify-center gap-2 text-xs text-slate-400">
              <Camera className="w-4 h-4 text-cyan-400 animate-bounce" />
              <span className="font-semibold text-slate-300">Usa la cámara nativa de tu teléfono</span>
            </div>
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
      {/* Disconnection Warning Banner */}
      {connStatus === 'disconnected' && (
        <div className="p-3 rounded-2xl bg-rose-950/90 border border-rose-500/60 shadow-[0_0_25px_rgba(244,63,94,0.3)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2 text-rose-200">
            <WifiOff className="w-5 h-5 text-rose-400 shrink-0 animate-pulse" />
            <div className="flex flex-col">
              <span className="text-xs font-black uppercase tracking-wide text-rose-300">
                Conexión Perdida con el Anfitrión
              </span>
              <span className="text-[11px] text-rose-200/80 leading-snug">
                El equipo principal no responde o inició una nueva sesión. Pide escanear el QR nuevo.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            <button
              type="button"
              onClick={() => peerSync.reconnectGuest()}
              className="px-3 py-1.5 rounded-xl bg-rose-800 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 border border-rose-400/40"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reconectar</span>
            </button>
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
                        onClick={() => handleToggleYouTubeFavorite(item, activeProfileId)}
                        className={`p-2 rounded-xl text-xs font-bold transition-all border flex items-center justify-center cursor-pointer ${
                          isFav
                            ? 'bg-amber-500 text-slate-950 border-amber-400 font-black shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                            : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-700'
                        }`}
                        title={isFav ? 'Quitar de favoritos' : 'Guardar en favoritos'}
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
    </div>
  );
};
