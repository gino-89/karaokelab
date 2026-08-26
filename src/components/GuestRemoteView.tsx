import React, { useState, useEffect, useCallback } from 'react';
import { SongItem, SingerProfile } from '../types';
import { getSongsFromDB, getProfilesFromStorage, saveProfilesToStorage, getActiveProfileIdFromStorage, setActiveProfileIdToStorage } from '../services/db';
import { tvBroadcast } from '../services/tvBroadcastService';
import { peerSync } from '../services/peerSyncService';
import { SongLibrary } from './SongLibrary';
import { Check, ListPlus, UserRound } from 'lucide-react';

const GUEST_PROFILE_KEY = 'karaokelab_guest_profiles';
const GUEST_ACTIVE_PROFILE_KEY = 'karaokelab_guest_active_profile';

export const GuestRemoteView: React.FC = () => {
  const [guestName, setGuestName] = useState('');
  const [nameConfirmed, setNameConfirmed] = useState(false);
  const [savedSongs, setSavedSongs] = useState<SongItem[]>([]);
  const [profiles, setProfiles] = useState<SingerProfile[]>([
    { id: 'profile_all', name: 'Todos', avatar: '👥', color: '#00f0ff', favoriteSongIds: [], createdAt: 0 },
  ]);
  const [activeProfileId, setActiveProfileId] = useState('profile_all');
  const [queuedFeedback, setQueuedFeedback] = useState<string | null>(null);
  const [customRequestTitle, setCustomRequestTitle] = useState('');

  // Check if guest already has a saved name
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
    // Load active profile
    const activeId = localStorage.getItem(GUEST_ACTIVE_PROFILE_KEY) || 'profile_all';
    setActiveProfileId(activeId);
  }, []);

  // Save profiles to localStorage whenever they change
  const saveGuestProfiles = useCallback((updatedProfiles: SingerProfile[]) => {
    setProfiles(updatedProfiles);
    try {
      localStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify(updatedProfiles));
    } catch (_) {}
  }, []);

  // Connect to host and load songs once name is confirmed
  useEffect(() => {
    if (!nameConfirmed) return;

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

      // Connect WebRTC P2P to Host if host parameter present in URL
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
  }, [nameConfirmed]);

  const handleConfirmName = () => {
    const trimmed = guestName.trim() || 'Invitado';
    setGuestName(trimmed);
    localStorage.setItem('karaokelab_guest_name', trimmed);
    setNameConfirmed(true);
    peerSync.sendGuestName(trimmed);
  };

  const handleRequestSong = (song: SongItem) => {
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
    if (!title.trim()) return;

    peerSync.sendSongRequestFromGuest({ title: title.trim() });
    tvBroadcast.sendRemoteCommand('ADD_TO_QUEUE', {
      title: title.trim(),
      guestName: guestName,
    });

    setQueuedFeedback(`¡"${title.trim()}" enviada a la cola! 🎤`);
    setCustomRequestTitle('');
    setTimeout(() => setQueuedFeedback(null), 4000);
  };

  // ── Guest-side profile management (stored in guest's localStorage only) ──
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

      {/* Main Song Library Component — guest mode: no delete, with full profile management */}
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
