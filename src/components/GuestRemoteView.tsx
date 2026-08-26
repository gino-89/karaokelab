import React, { useState, useEffect } from 'react';
import { SongItem, SingerProfile } from '../types';
import { getSongsFromDB, getProfilesFromStorage, DEFAULT_PRESET_SONGS } from '../services/db';
import { tvBroadcast } from '../services/tvBroadcastService';
import { peerSync } from '../services/peerSyncService';
import { SongLibrary } from './SongLibrary';
import { Check, ListPlus } from 'lucide-react';

export const GuestRemoteView: React.FC = () => {
  const [savedSongs, setSavedSongs] = useState<SongItem[]>([]);
  const [profiles, setProfiles] = useState<SingerProfile[]>([]);
  const [queuedFeedback, setQueuedFeedback] = useState<string | null>(null);
  const [customRequestTitle, setCustomRequestTitle] = useState('');

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

      if (!songs || songs.length === 0) {
        songs = DEFAULT_PRESET_SONGS;
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
    setProfiles(getProfilesFromStorage());

    // Listen to live catalog updates from broadcast
    const unsub = tvBroadcast.onStateUpdate((state: any) => {
      if (state?.catalog && Array.isArray(state.catalog) && state.catalog.length > 0) {
        setSavedSongs(state.catalog);
      }
    });
    return () => unsub();
  }, []);

  const handleRequestSong = (song: SongItem) => {
    // Send via WebRTC P2P
    peerSync.sendSongRequestFromGuest({
      id: song.id,
      title: song.title,
      artist: song.artist || '',
    });

    // Send via local BroadcastChannel fallback
    tvBroadcast.sendRemoteCommand('ADD_TO_QUEUE', {
      id: song.id,
      title: song.title,
      artist: song.artist || '',
    });

    setQueuedFeedback(`¡"${song.title}" enviada a la cola de reproducción en vivo! 🎤`);
    setTimeout(() => setQueuedFeedback(null), 4000);
  };

  const handleRequestCustomSong = (title: string) => {
    if (!title.trim()) return;

    peerSync.sendSongRequestFromGuest({
      title: title.trim(),
    });

    tvBroadcast.sendRemoteCommand('ADD_TO_QUEUE', {
      title: title.trim(),
    });

    setQueuedFeedback(`¡"${title.trim()}" enviada a la cola de reproducción en vivo! 🎤`);
    setCustomRequestTitle('');
    setTimeout(() => setQueuedFeedback(null), 4000);
  };

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
            <p className="text-[10px] text-cyan-400 font-mono">Pedir Canciones en Vivo</p>
          </div>
        </div>

        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold font-mono">
          ● En Vivo
        </span>
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
              if (e.key === 'Enter' && customRequestTitle.trim()) {
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

      {/* Main Song Library Component */}
      <SongLibrary
        savedSongs={savedSongs}
        queue={[]}
        onFilesSelected={() => {}}
        onSelectSong={handleRequestSong}
        onDeleteSong={() => {}}
        onAddToQueue={handleRequestSong}
        profiles={profiles}
      />
    </div>
  );
};
