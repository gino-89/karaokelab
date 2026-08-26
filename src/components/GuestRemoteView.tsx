import React, { useState, useEffect, useCallback } from 'react';
import { SongItem, SingerProfile } from '../types';
import { getSongsFromDB } from '../services/db';
import { tvBroadcast } from '../services/tvBroadcastService';
import { peerSync } from '../services/peerSyncService';
import { SongLibrary } from './SongLibrary';
import { Check, ListPlus, UserRound, ScanLine, ShieldX, QrCode, Camera } from 'lucide-react';

const GUEST_PROFILE_KEY = 'karaokelab_guest_profiles';
const GUEST_ACTIVE_PROFILE_KEY = 'karaokelab_guest_active_profile';

export const GuestRemoteView: React.FC = () => {
  const [guestName, setGuestName] = useState('');
  const [nameConfirmed, setNameConfirmed] = useState(false);

  // Synchronously compute kicked state on first render
  const [kicked, setKicked] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const params = new URLSearchParams(window.location.search);
      const urlKey = params.get('k') || '';
      const kickedKey = localStorage.getItem('karaokelab_kicked_key') || '';
      // If the current URL has the banned key, block immediately
      if (kickedKey && urlKey && kickedKey === urlKey) {
        return true;
      }
    } catch (_) {}
    return false;
  });

  const [savedSongs, setSavedSongs] = useState<SongItem[]>([]);
  const [profiles, setProfiles] = useState<SingerProfile[]>([
    { id: 'profile_all', name: 'Todos', avatar: '👥', color: '#00f0ff', favoriteSongIds: [], createdAt: 0 },
  ]);
  const [activeProfileId, setActiveProfileId] = useState('profile_all');
  const [queuedFeedback, setQueuedFeedback] = useState<string | null>(null);
  const [customRequestTitle, setCustomRequestTitle] = useState('');

  // Initial mount & URL validation
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlKey = params.get('k') || '';
    const kickedKey = localStorage.getItem('karaokelab_kicked_key') || '';

    // If opened with the banned key, enforce kick
    if (kickedKey && urlKey && kickedKey === urlKey) {
      setKicked(true);
      return;
    }

    // If opened with a NEW QR key from a camera scan, UNBLOCK and clear old ban!
    if (kickedKey && urlKey && kickedKey !== urlKey) {
      localStorage.removeItem('karaokelab_kicked_key');
      localStorage.removeItem('karaokelab_kicked_host');
      setKicked(false);
    }

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
    const unsubKick = peerSync.onKicked((bannedKey) => {
      const currentUrlKey = new URLSearchParams(window.location.search).get('k') || bannedKey || 'banned';
      try {
        localStorage.setItem('karaokelab_kicked_key', currentUrlKey);
        localStorage.removeItem('karaokelab_guest_name');
      } catch (_) {}
      setKicked(true);
      setNameConfirmed(false);
    });

    return () => unsubKick();
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
          peerSync.initGuest(hostParam, (catalog) => {
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
          });
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
  }, [nameConfirmed, kicked]);

  const handleConfirmName = () => {
    const trimmed = guestName.trim() || 'Invitado';
    setGuestName(trimmed);
    localStorage.setItem('karaokelab_guest_name', trimmed);
    setNameConfirmed(true);
    peerSync.sendGuestName(trimmed);
  };

  const handleRequestSong = (song: SongItem) => {
    if (kicked) return;

    peerSync.sendSongRequestFromGuest({
      id: song.id,
      title: song.title,
      artist: song.artist || '',
    });

    tvBroadcast.sendRemoteCommand('ADD_TO_QUEUE', {
      id: song.id,
      title: song.title,
      artist: song.artist || '',
      guestName: guestName,
    });

    setQueuedFeedback(`¡"${song.title}" enviada a la cola! 🎤`);
    setTimeout(() => setQueuedFeedback(null), 4000);
  };

  const handleRequestCustomSong = (title: string) => {
    if (kicked || !title.trim()) return;

    peerSync.sendSongRequestFromGuest({ title: title.trim() });
    tvBroadcast.sendRemoteCommand('ADD_TO_QUEUE', {
      title: title.trim(),
      guestName: guestName,
    });

    setQueuedFeedback(`¡"${title.trim()}" enviada a la cola! 🎤`);
    setCustomRequestTitle('');
    setTimeout(() => setQueuedFeedback(null), 4000);
  };

  // ── Guest-side profile management ──
  const handleCreateProfile = (name: string, avatar: string, color: string) => {
    const newProfile: SingerProfile = {
      id: `guest_profile_${Date.now()}`,
      name,
      avatar,
      color,
      favoriteSongIds: [],
      createdAt: Date.now(),
    };
    const updated = [...profiles, newProfile];
    saveGuestProfiles(updated);
    setActiveProfileId(newProfile.id);
    localStorage.setItem(GUEST_ACTIVE_PROFILE_KEY, newProfile.id);
  };

  const handleDeleteProfile = (profileId: string) => {
    if (profileId === 'profile_all') return;
    const updated = profiles.filter((p) => p.id !== profileId);
    saveGuestProfiles(updated.length > 0 ? updated : [{ id: 'profile_all', name: 'Todos', avatar: '👥', color: '#00f0ff', favoriteSongIds: [], createdAt: 0 }]);
    setActiveProfileId('profile_all');
    localStorage.setItem(GUEST_ACTIVE_PROFILE_KEY, 'profile_all');
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
  };

  // ── KICKED / EXPELLED SCREEN ──
  if (kicked) {
    return (
      <div className="min-h-screen bg-[#06070d] text-white flex items-center justify-center p-4 font-sans select-none">
        <div className="w-full max-w-sm flex flex-col items-center gap-5 animate-in fade-in zoom-in-95 duration-300">
          
          {/* Expelled Icon Header */}
          <div className="relative flex items-center justify-center">
            <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-rose-500/20 via-rose-600/30 to-red-900/40 border border-rose-500/50 flex items-center justify-center shadow-[0_0_50px_rgba(244,63,94,0.35)]">
              <ShieldX className="w-12 h-12 text-rose-400" />
            </div>
            <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-xs shadow-md">
              🚫
            </div>
          </div>

          {/* Title & Description */}
          <div className="text-center flex flex-col gap-1">
            <h1 className="text-xl font-black uppercase tracking-wider text-rose-400">
              Dispositivo Expulsado
            </h1>
            <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
              El anfitrión ha desconectado este dispositivo de la sala.
            </p>
          </div>

          {/* Action Card: Must Scan QR with Camera */}
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
          {/* Logo */}
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#00f0ff] to-[#ff007f] flex items-center justify-center text-3xl shadow-[0_0_40px_rgba(0,240,255,0.4)]">
              🎤
            </div>
            <h1 className="text-2xl font-black italic uppercase tracking-wider bg-gradient-to-r from-[#00f0ff] to-[#ff007f] bg-clip-text text-transparent">
              KaraokeLab
            </h1>
            <p className="text-xs text-slate-400 font-mono">Control Remoto en Vivo</p>
          </div>

          {/* Name Input Card */}
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
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmName(); }}
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
            Tu nombre aparecerá cuando pidas canciones
          </p>
        </div>
      </div>
    );
  }

  // ── Main Remote View ──
  return (
    <div className="min-h-screen bg-[#080811] text-white p-3 flex flex-col gap-3 font-sans max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#00f0ff] to-[#ff007f] flex items-center justify-center font-black text-slate-950 text-xs shadow-md">
            🎤
          </div>
          <div>
            <h1 className="text-base font-black italic uppercase tracking-wider text-white">
              KaraokeLab Remote
            </h1>
            <p className="text-[10px] text-cyan-400 font-mono">
              Conectado como <span className="text-white font-bold">{guestName}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setNameConfirmed(false);
              localStorage.removeItem('karaokelab_guest_name');
            }}
            className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white text-[10px] font-bold cursor-pointer transition-all"
          >
            Cambiar Nombre
          </button>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold font-mono">
            ● En Vivo
          </span>
        </div>
      </div>

      {/* Queued Feedback Notification */}
      {queuedFeedback && (
        <div className="p-3 rounded-xl bg-emerald-950/90 border border-emerald-500/60 text-emerald-200 text-xs font-bold flex items-center gap-2 animate-in fade-in shadow-lg">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{queuedFeedback}</span>
        </div>
      )}

      {/* Quick Custom Song Request Bar */}
      <div className="p-3 rounded-2xl bg-slate-900/90 border border-cyan-500/40 flex flex-col gap-2 shadow-lg">
        <span className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5">
          <span>🎤</span>
          <span>¿No ves tu canción? Pídela directamente:</span>
        </span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Escribe el nombre de la canción o artista..."
            value={customRequestTitle}
            onChange={(e) => setCustomRequestTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customRequestTitle.trim()) handleRequestCustomSong(customRequestTitle.trim());
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

      {/* Main Song Library Component */}
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
        isGuestMode={true}
      />
    </div>
  );
};
