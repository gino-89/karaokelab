import React, { useState, useEffect } from 'react';
import { SongItem, SingerProfile } from '../types';
import { getSongsFromDB, getProfilesFromStorage } from '../services/db';
import { tvBroadcast } from '../services/tvBroadcastService';
import { SongLibrary } from './SongLibrary';
import { Check } from 'lucide-react';

export const GuestRemoteView: React.FC = () => {
  const [savedSongs, setSavedSongs] = useState<SongItem[]>([]);
  const [profiles, setProfiles] = useState<SingerProfile[]>([]);
  const [queuedFeedback, setQueuedFeedback] = useState<string | null>(null);

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
    setProfiles(getProfilesFromStorage());

    // Listen to live catalog updates from host
    const unsub = tvBroadcast.onStateUpdate((state: any) => {
      if (state?.catalog && Array.isArray(state.catalog) && state.catalog.length > 0) {
        setSavedSongs(state.catalog);
      }
    });
    return () => unsub();
  }, []);

  const handleRequestSong = (song: SongItem) => {
    tvBroadcast.sendRemoteCommand('ADD_TO_QUEUE', {
      id: song.id,
      title: song.title,
      artist: song.artist || '',
    });

    setQueuedFeedback(`¡"${song.title}" enviada a la cola de reproducción en vivo! 🎤`);
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
            <p className="text-[10px] text-cyan-400 font-mono">Pedir Canciones de la Biblioteca</p>
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
