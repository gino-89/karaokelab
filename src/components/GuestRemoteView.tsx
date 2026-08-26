import React, { useState, useEffect, useMemo } from 'react';
import { SongItem, YouTubeFavoriteTrack, SingerProfile } from '../types';
import { getSongsFromDB, getProfilesFromStorage, getYouTubeFavoritesFromStorage } from '../services/db';
import { tvBroadcast } from '../services/tvBroadcastService';
import { Search, Music2, Youtube, ListPlus, Check, Sparkles, User, Play, Clock } from 'lucide-react';

export const GuestRemoteView: React.FC = () => {
  const [savedSongs, setSavedSongs] = useState<SongItem[]>([]);
  const [youtubeFavorites, setYoutubeFavorites] = useState<YouTubeFavoriteTrack[]>([]);
  const [profiles, setProfiles] = useState<SingerProfile[]>([]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [guestName, setGuestName] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState<string>('guest');
  
  const [queuedFeedback, setQueuedFeedback] = useState<string | null>(null);
  const [tvState, setTvState] = useState<any>(null);

  useEffect(() => {
    // Load songs and profiles from local database with catalog fallback
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
    };
    loadSongs();
    setYoutubeFavorites(getYouTubeFavoritesFromStorage());
    setProfiles(getProfilesFromStorage());

    // Listen to live TV status and dynamic catalog sync
    const unsub = tvBroadcast.onStateUpdate((state: any) => {
      setTvState(state);
      if (state?.catalog && Array.isArray(state.catalog) && state.catalog.length > 0) {
        setSavedSongs((prev) => (prev.length === 0 ? state.catalog : prev));
      }
    });
    return () => unsub();
  }, []);

  // Filter local songs and YouTube favorites based on search query
  const filteredLocalSongs = useMemo(() => {
    if (!searchQuery.trim()) return savedSongs;
    const q = searchQuery.toLowerCase().trim();
    return savedSongs.filter(
      (s) => (s.title || '').toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q)
    );
  }, [savedSongs, searchQuery]);

  const filteredYouTube = useMemo(() => {
    if (!searchQuery.trim()) return youtubeFavorites;
    const q = searchQuery.toLowerCase().trim();
    return youtubeFavorites.filter(
      (yt) => (yt.title || '').toLowerCase().includes(q) || (yt.channel || '').toLowerCase().includes(q)
    );
  }, [youtubeFavorites, searchQuery]);

  const handleRequestSong = (title: string, artist?: string, isYouTube = false, videoId?: string, songId?: string) => {
    const singerName = guestName.trim() || (profiles.find((p) => p.id === selectedProfileId)?.name || 'Invitado');
    
    // Broadcast remote command to host engine
    tvBroadcast.sendRemoteCommand('ADD_TO_QUEUE', {
      id: songId,
      title,
      artist: artist || '',
      singerName,
      isYouTube,
      videoId,
    });

    setQueuedFeedback(`¡"${title}" se ha enviado a la cola a nombre de ${singerName}! 🎤`);
    setTimeout(() => setQueuedFeedback(null), 4000);
  };

  return (
    <div className="min-h-screen bg-[#080811] text-white p-4 flex flex-col gap-4 font-sans select-none max-w-md mx-auto">
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
            <p className="text-[10px] text-cyan-400 font-mono">Pedir Canciones en Vivo</p>
          </div>
        </div>

        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold font-mono">
          ● En Vivo
        </span>
      </div>

      {/* Currently Playing Bar */}
      {tvState && tvState.songTitle && (
        <div className="p-3 rounded-xl bg-slate-900/90 border border-cyan-500/30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] text-slate-400 font-mono uppercase font-bold">Sonando Ahora:</span>
              <span className="font-bold text-white truncate">{tvState.songTitle}</span>
            </div>
          </div>
        </div>
      )}

      {/* Queued Feedback Notification */}
      {queuedFeedback && (
        <div className="p-3 rounded-xl bg-emerald-950/90 border border-emerald-500/60 text-emerald-200 text-xs font-bold flex items-center gap-2 animate-in fade-in shadow-lg">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{queuedFeedback}</span>
        </div>
      )}

      {/* Singer Name Box */}
      <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 flex flex-col gap-2">
        <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-[#00f0ff]" />
          <span>¿Quién va a cantar?</span>
        </label>
        
        <input
          type="text"
          placeholder="Escribe tu nombre (ej: María, Carlos)..."
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#00f0ff]"
        />

        {profiles.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pt-1 no-scrollbar">
            {profiles.filter((p) => p.id !== 'profile_all').map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setSelectedProfileId(p.id);
                  setGuestName(p.name);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 cursor-pointer transition-all flex items-center gap-1 border ${
                  guestName === p.name
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <span>{p.avatar}</span>
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Search Input */}
      <div className="relative flex items-center">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar canción o artista..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#00f0ff]"
        />
      </div>

      {/* Song List Results */}
      <div className="flex-1 flex flex-col gap-2 overflow-y-auto max-h-[50vh]">
        {/* YouTube Section */}
        {filteredYouTube.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold font-mono text-red-400 uppercase tracking-wider flex items-center gap-1">
              <Youtube className="w-3 h-3 fill-current text-red-500" />
              <span>YouTube Karaoke ({filteredYouTube.length})</span>
            </span>
            {filteredYouTube.map((yt) => (
              <div
                key={yt.id}
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/90 border border-red-500/30 gap-2"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <img src={yt.thumbnail} alt={yt.title} className="w-12 h-9 rounded object-cover shrink-0 bg-slate-950" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-bold text-white truncate">{yt.title}</span>
                    <span className="text-[10px] text-slate-400 truncate">{yt.channel}</span>
                  </div>
                </div>

                <button
                  onClick={() => handleRequestSong(yt.title, yt.channel, true, yt.id)}
                  className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center gap-1 cursor-pointer transition-all shrink-0 shadow-md"
                >
                  <ListPlus className="w-3.5 h-3.5" />
                  <span>Encolar</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Local Songs Section */}
        {filteredLocalSongs.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-2">
            <span className="text-[10px] font-bold font-mono text-cyan-400 uppercase tracking-wider flex items-center gap-1">
              <Music2 className="w-3 h-3 text-cyan-400" />
              <span>Pistas Locales ({filteredLocalSongs.length})</span>
            </span>
            {filteredLocalSongs.map((song) => (
              <div
                key={song.id}
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 gap-2"
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-bold text-white truncate">{song.title}</span>
                  <span className="text-[10px] text-slate-400 truncate">{song.artist || 'Artista Desconocido'}</span>
                </div>

                <button
                  onClick={() => handleRequestSong(song.title, song.artist, false, undefined, song.id)}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1 cursor-pointer transition-all shrink-0 shadow-md"
                >
                  <ListPlus className="w-3.5 h-3.5" />
                  <span>Encolar</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {filteredLocalSongs.length === 0 && filteredYouTube.length === 0 && (
          <div className="py-12 text-center text-slate-500 text-xs font-mono">
            No hay canciones encontradas para "{searchQuery}"
          </div>
        )}
      </div>
    </div>
  );
};
