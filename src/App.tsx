import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SongItem, QueueItem, LyricLine, SingerProfile, YouTubeFavoriteTrack, VideoBackgroundConfig, VocalAutomationConfig } from './types';
import { VocalAutomationModal } from './components/VocalAutomationModal';
import { audioEngine, audioBufferToWavBlob } from './services/audioEngine';
import { separateAudioStems } from './services/stemSeparator';
import { analyzeStudioBPMAndKey, detectVocalPhrases } from './services/dspAnalysis';
import { parseLRC, generateGenericLyrics, detectIsDuetLyrics, formatLRC, parseArtistsFromLRC } from './services/lrcParser';
import { loadVideoBackgroundConfig, saveVideoBackgroundConfig, searchOfficialVideo } from './services/videoBackgroundService';
import { calibrateLyricsWithVocalStem } from './services/vocalSyncCalibrator';
import { classifyAllLyricsVocalGender, analyzeSongVocalProfile, analyzeSongVocalProfileSync, invalidateVocalProfileCache } from './services/vocalGenderClassifier';
import { searchLrclib } from './services/lrcApi';
import { fetchOnlineMetadata, cleanSongFilename } from './services/metadataApi';
import { discoverSongLyricsWithRoles } from './services/geniusLyricsApi';
import { transcribeVocalsWithWhisper } from './services/whisperApi';
import {
  saveSongToDB,
  getSongsFromDB,
  deleteSongFromDB,
  clearAllSongsFromDB,
  getProfilesFromStorage,
  saveProfilesToStorage,
  getActiveProfileIdFromStorage,
  setActiveProfileIdToStorage,
  getYouTubeFavoritesFromStorage,
  saveYouTubeFavoritesToStorage,
} from './services/db';
import { videoRecorder } from './services/videoRecorder';
import { analyzeSmartVocalCues, getActiveSmartCue } from './services/smartCueAnalyzer';
import { Header } from './components/Header';
import { AlertCircle, X } from 'lucide-react';
import { KaraokeDisplay } from './components/KaraokeDisplay';
import { MixerDeck } from './components/MixerDeck';
import { SongQueue } from './components/SongQueue';
import { SongLibrary } from './components/SongLibrary';
import { FullscreenPartyModal } from './components/FullscreenPartyModal';
import { LyricalVideoModal } from './components/LyricalVideoModal';
import { YouTubeModal } from './components/YouTubeModal';
import { CastTvModal } from './components/CastTvModal';
import { TvStandaloneDisplay } from './components/TvStandaloneDisplay';
import { GuestRemoteView } from './components/GuestRemoteView';
import { QrCodeModal } from './components/QrCodeModal';
import { peerSync } from './services/peerSyncService';
import { DspSettingsModal } from './components/DspSettingsModal';
import { DynamicVideoBackground } from './components/DynamicVideoBackground';
import { ShareSongModal } from './components/ShareSongModal';
import { AboutModal } from './components/AboutModal';
import {
  getSavedSyncFolderPath,
  chooseSyncFolder,
  syncSongsToFolder,
  importSongsFromFolder,
  base64ToBlob,
} from './services/folderSyncService';
import { aiEngineService } from './services/aiEngineService';
import { tvBroadcast } from './services/tvBroadcastService';
import { KaraokeScoreAndTransitionModal, KaraokePerformanceResult } from './components/KaraokeScoreAndTransitionModal';
import { karaokeScoringTracker } from './services/karaokeScoringEngine';

export default function App() {
  // Current Song & Audio State
  const [currentSong, setCurrentSong] = useState<SongItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bpm, setBpm] = useState(128);
  const [detectedKey, setDetectedKey] = useState('Am');

  // Mixer Volumes & DSP
  const [vocalGain, setVocalGain] = useState(0.0);
  const [musicGain, setMusicGain] = useState(1.0);
  const [masterGain, setMasterGain] = useState(1.0);
  const [pitchShift, setPitchShift] = useState(0);
  const [isLooping, setIsLooping] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [micGain, setMicGain] = useState(1.0);

  // Synchronized Lyrics & Smart Vocal Cues
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const currentIndexRef = useRef(-1);
  const [isDuetMode, setIsDuetMode] = useState(false);
  const [isSmartVocalCue, setIsSmartVocalCue] = useState(false);
  const [activeCueType, setActiveCueType] = useState<'intro' | 'chorus' | 'outro' | null>(null);

  // Pre-analyzed Intelligent Song Structure Cues (Choruses, Lead-ins, Outros)
  const smartCues = useMemo(() => {
    return analyzeSmartVocalCues(lyrics);
  }, [lyrics]);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [savedSongs, setSavedSongs] = useState<SongItem[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [directUploadProgress, setDirectUploadProgress] = useState<{
    isProcessing: boolean;
    fileName: string;
    progress: number;
    step: string;
    currentIndex: number;
    totalCount: number;
  }>({
    isProcessing: false,
    fileName: '',
    progress: 0,
    step: '',
    currentIndex: 1,
    totalCount: 1,
  });

  // Video Export & Party Mode
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [isPartyMode, setIsPartyMode] = useState(false);
  const [isVideoStudioOpen, setIsVideoStudioOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isClearCacheModalOpen, setIsClearCacheModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [shareTargetSong, setShareTargetSong] = useState<SongItem | null>(null);
  const [syncDelay, setSyncDelay] = useState<number>(0.0);

  const handleOpenShareModal = (song?: SongItem) => {
    setShareTargetSong(song || currentSong);
    setIsShareModalOpen(true);
  };

  // Singer Profiles System
  const [profiles, setProfiles] = useState<SingerProfile[]>(() => getProfilesFromStorage());
  const [activeProfileId, setActiveProfileId] = useState<string>(() => getActiveProfileIdFromStorage());

  const activeProfile = useMemo(() => {
    return profiles.find((p) => p.id === activeProfileId) || profiles[0];
  }, [profiles, activeProfileId]);

  const handleSelectProfile = (id: string) => {
    setActiveProfileId(id);
    setActiveProfileIdToStorage(id);
  };

  const handleCreateProfile = (name: string, avatar: string, color: string) => {
    const newProfile: SingerProfile = {
      id: `profile_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      name: name.trim() || 'Cantante',
      avatar: avatar || '🎤',
      color: color || '#00f0ff',
      favoriteSongIds: [],
      createdAt: Date.now(),
    };
    const updated = [...profiles, newProfile];
    setProfiles(updated);
    saveProfilesToStorage(updated);
    setActiveProfileId(newProfile.id);
    setActiveProfileIdToStorage(newProfile.id);
  };

  const handleDeleteProfile = (id: string) => {
    if (id === 'profile_all') return;
    const updated = profiles.filter((p) => p.id !== id);
    setProfiles(updated);
    saveProfilesToStorage(updated);
    if (activeProfileId === id) {
      setActiveProfileId('profile_all');
      setActiveProfileIdToStorage('profile_all');
    }
  };

  const handleToggleFavoriteSong = (profileId: string, songId: string) => {
    setProfiles((prev) => {
      const updated = prev.map((p) => {
        if (p.id === profileId) {
          const isFav = p.favoriteSongIds.includes(songId);
          const newFavs = isFav
            ? p.favoriteSongIds.filter((id) => id !== songId)
            : [...p.favoriteSongIds, songId];
          return { ...p, favoriteSongIds: newFavs };
        }
        return p;
      });
      saveProfilesToStorage(updated);
      return updated;
    });
  };

  // YouTube Hybrid Search & Favorites Modal State
  const [isYouTubeModalOpen, setIsYouTubeModalOpen] = useState(false);
  const [youTubeEmbedId, setYouTubeEmbedId] = useState<string | null>(null);
  const [youtubeFavorites, setYoutubeFavorites] = useState<YouTubeFavoriteTrack[]>(getYouTubeFavoritesFromStorage());

  const handleToggleYouTubeFavorite = (
    track: { id: string; title: string; channel: string; duration: string; thumbnail: string; url: string },
    singerProfileId?: string
  ) => {
    const profId = singerProfileId || activeProfileId;
    setYoutubeFavorites((prev) => {
      const exists = prev.some((item) => item.id === track.id && (item.singerProfileId === profId || profId === 'profile_all'));
      let updated: YouTubeFavoriteTrack[];
      if (exists) {
        updated = prev.filter((item) => !(item.id === track.id && (item.singerProfileId === profId || profId === 'profile_all')));
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
      }
      saveYouTubeFavoritesToStorage(updated);
      peerSync.broadcastYouTubeFavoritesToGuests(updated);
      return updated;
    });
  };

  // ── Dual Screen TV & Chromecast / AirPlay Remote Control States ──
  const isTvDisplayMode = typeof window !== 'undefined' && (
    window.location.search.includes('tv=') ||
    window.location.search === '?tv' ||
    window.location.search.includes('mode=tv_display') ||
    window.location.search.includes('mode=tv') ||
    window.location.search.includes('tv_display') ||
    window.location.hash.includes('tv')
  );
  const isGuestMode = typeof window !== 'undefined' && !isTvDisplayMode && (
    window.location.search.includes('mode=guest') ||
    window.location.search.includes('guest') ||
    window.location.search.includes('remote') ||
    window.location.hash.includes('guest')
  );

  const [isCastModalOpen, setIsCastModalOpen] = useState(false);
  const [isCastingActive, setIsCastingActive] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [hostPeerId, setHostPeerId] = useState<string | null>(null);
  const [isDspModalOpen, setIsDspModalOpen] = useState(false);
  const [isVocalAutomationModalOpen, setIsVocalAutomationModalOpen] = useState(false);

  // ── 1-Click Silent Folder / USB Player Sync States ──
  const [syncTargetFolder, setSyncTargetFolder] = useState<string>(getSavedSyncFolderPath());
  const [isFolderSyncing, setIsFolderSyncing] = useState(false);
  const [syncToastMessage, setSyncToastMessage] = useState<string | null>(null);

  const handle1ClickSync = async () => {
    let target = syncTargetFolder;
    if (!target) {
      target = (await chooseSyncFolder()) || '';
      if (!target) return;
      setSyncTargetFolder(target);
    }

    setIsFolderSyncing(true);
    setSyncToastMessage('Sincronizando canciones con el Player...');
    try {
      const result = await syncSongsToFolder(savedSongs, profiles, (_p, msg) => {
        setSyncToastMessage(msg);
      }, target);

      if (result.syncedCount === 0) {
        setSyncToastMessage(`✓ Todo al día: ${result.totalInFolder} canciones ya sincronizadas en la carpeta`);
      } else {
        setSyncToastMessage(`✓ ¡Sincronizado! ${result.syncedCount} canciones nuevas añadidas al Player`);
      }
    } catch (err: any) {
      setSyncToastMessage(`Error al sincronizar: ${err?.message}`);
    } finally {
      setIsFolderSyncing(false);
      setTimeout(() => setSyncToastMessage(null), 5000);
    }
  };

  const handleChangeSyncFolder = async () => {
    const selected = await chooseSyncFolder();
    if (selected) {
      setSyncTargetFolder(selected);
      setSyncToastMessage(`✓ Carpeta de sincronización asignada a: ${selected.split(/[/\\]/).pop() || selected}`);
      setTimeout(() => setSyncToastMessage(null), 4000);
    }
  };

  const handleImportSyncedFolder = async () => {
    try {
      setIsFolderSyncing(true);
      setSyncToastMessage('Leyendo canciones desde la carpeta sincronizada o USB...');
      const res = await importSongsFromFolder((_p, msg) => {
        setSyncToastMessage(msg);
      });
      setSavedSongs(res.allSongs);
      setProfiles(res.allProfiles);
      setSyncToastMessage(`✓ ¡Éxito! ${res.importedCount} canciones cargadas a la biblioteca.`);
    } catch (err: any) {
      setSyncToastMessage(`Error al importar: ${err?.message}`);
    } finally {
      setIsFolderSyncing(false);
      setTimeout(() => setSyncToastMessage(null), 5000);
    }
  };

  // ── Global Drag & Drop Management (Browser & Tauri Native) ──
  const [isWindowDragging, setIsWindowDragging] = useState(false);
  const dragCounterRef = useRef(0);

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current++;
      if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
        setIsWindowDragging(true);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsWindowDragging(false);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsWindowDragging(false);

      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        handleFilesSelected(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  // Sync lightweight catalog to localStorage for guest mobile remote views
  useEffect(() => {
    if (savedSongs.length > 0) {
      try {
        const catalog = savedSongs.map((s) => ({
          id: s.id,
          title: s.title,
          artist: s.artist,
          genre: s.genre,
          bpm: s.bpm,
          duration: s.duration,
        }));
        localStorage.setItem('karaokelab_song_catalog', JSON.stringify(catalog));
      } catch (_) {}
    }
  }, [savedSongs]);

  // Use a ref so the WebRTC/BroadcastChannel callbacks always see the latest savedSongs
  const savedSongsRef = React.useRef(savedSongs);
  React.useEffect(() => { savedSongsRef.current = savedSongs; }, [savedSongs]);

  // Listen for guest song requests from mobile phones via BroadcastChannel & WebRTC P2P
  useEffect(() => {
    if (!isTvDisplayMode && !isGuestMode) {
      const handleRemoteRequest = (data: any) => {
        if (!data) return;
        const { id, title, artist, isYouTube, videoId, guestName } = data;
        const who = guestName || 'Invitado';

        if (isYouTube && videoId) {
          const ytTitle = title || 'Video de YouTube';
          const ytArtist = artist || 'YouTube';

          if (queue.some((q) => q.songData?.id === `yt_${videoId}` || q.songData?.videoBgId === videoId)) {
            showAlertToast(`ℹ️ "${ytTitle}" ya está en la cola.`);
            return;
          }

          const newItem: QueueItem = {
            id: `queue_yt_${videoId}_${Date.now()}`,
            fileName: `🎬 [YouTube] ${ytTitle}`,
            status: 'ready',
            progress: 100,
            songData: {
              id: `yt_${videoId}`,
              title: ytTitle,
              artist: ytArtist,
              duration: 240,
              bpm: 120,
              key: 'C',
              lyrics: [],
              originalFileName: `${ytTitle}.mp4`,
              videoBgId: videoId,
              videoBgMode: 'custom',
              videoBgCustomUrl: `https://www.youtube.com/watch?v=${videoId}`,
              createdAt: Date.now(),
            },
          };

          // Strictly add to queue and wait for its turn without autoplaying immediately
          setQueue((prev) => [...prev, newItem]);
          showAlertToast(`🎬 ${who} pidió "${ytTitle}" de YouTube · Agregada a la cola`);
          return;
        }

        // Always look up the REAL song from the host's current library (with audioBlob)
        const latestSongs = savedSongsRef.current;
        const matchedSong = latestSongs.find(
          (s) =>
            (id && s.id === id) ||
            (title && s.title && s.title.toLowerCase().trim() === title.toLowerCase().trim()) ||
            (title && s.title && s.title.toLowerCase().includes(title.toLowerCase()))
        );

        if (matchedSong) {
          // Add the REAL song object (with audioBlob) to the queue
          if (queue.some((q) => q.songData?.id === matchedSong.id)) {
            showAlertToast(`ℹ️ "${matchedSong.title}" ya está en la cola.`);
            return;
          }
          const newItem: QueueItem = {
            id: `queue_remote_${matchedSong.id}_${Date.now()}`,
            fileName: `${matchedSong.title}${matchedSong.artist ? ' - ' + matchedSong.artist : ''}`,
            status: 'ready',
            progress: 100,
            songData: matchedSong,
          };
          setQueue((prev) => [...prev, newItem]);
          showAlertToast(`🎤 ${who} pidió "${matchedSong.title}" · Agregada a la cola`);
        } else {
          showAlertToast(`⚠️ ${who} pidió "${title || 'Desconocida'}" · No encontrada en la biblioteca`);
        }
      };

      peerSync.initHost(
        (cmd, data) => {
          if (cmd === 'ADD_TO_QUEUE') {
            handleRemoteRequest(data);
          } else if (cmd === 'CREATE_PROFILE') {
            if (data?.name) {
              const newProfile: SingerProfile = {
                id: data.id || `profile_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                name: data.name.trim(),
                avatar: data.avatar || '🎤',
                color: data.color || '#00f0ff',
                favoriteSongIds: data.favoriteSongIds || [],
                createdAt: data.createdAt || Date.now(),
              };
              setProfiles((prev) => {
                const exists = prev.some((p) => p.id === newProfile.id);
                const updated = exists
                  ? prev.map((p) => (p.id === newProfile.id ? newProfile : p))
                  : [...prev, newProfile];
                saveProfilesToStorage(updated);
                peerSync.broadcastProfilesToGuests(updated);
                return updated;
              });
              showAlertToast(`👤 Perfil creado desde móvil: "${data.name}"`);
            }
          } else if (cmd === 'DELETE_PROFILE') {
            if (data?.profileId) {
              handleDeleteProfile(data.profileId);
            }
          } else if (cmd === 'TOGGLE_FAVORITE') {
            if (data?.profileId && data?.songId) {
              handleToggleFavoriteSong(data.profileId, data.songId);
            }
          } else if (cmd === 'TOGGLE_YT_FAVORITE') {
            if (data?.track) {
              handleToggleYouTubeFavorite(data.track, data.profileId);
            }
          }
        },
        (id) => setHostPeerId(id)
      );

      const unsub = tvBroadcast.onRemoteCommand((cmd, data) => {
        if (cmd === 'ADD_TO_QUEUE') handleRemoteRequest(data);
      });
      return () => unsub();
    }
  }, [isTvDisplayMode, isGuestMode]);

  // Sync catalog, profiles & YouTube favorites over WebRTC to connected guest mobile phones
  useEffect(() => {
    if (savedSongs.length > 0) {
      peerSync.broadcastCatalogToGuests(savedSongs);
    }
  }, [savedSongs]);

  useEffect(() => {
    if (profiles.length > 0) {
      peerSync.broadcastProfilesToGuests(profiles);
    }
  }, [profiles]);

  useEffect(() => {
    if (youtubeFavorites.length > 0) {
      peerSync.broadcastYouTubeFavoritesToGuests(youtubeFavorites);
    }
  }, [youtubeFavorites]);

  // ── Global Dynamic Video Background state ──
  const [videoBgConfig, setVideoBgConfig] = useState<VideoBackgroundConfig>(() => loadVideoBackgroundConfig());

  const handleUpdateVideoBgConfig = (newConfig: VideoBackgroundConfig) => {
    setVideoBgConfig(newConfig);
    saveVideoBackgroundConfig(newConfig);
    if (currentSong) {
      const updated: SongItem = {
        ...currentSong,
        videoBgId: newConfig.videoId,
        videoBgTitle: newConfig.videoTitle,
        videoBgMode: newConfig.mode,
        videoBgCustomUrl: newConfig.customUrlOrId,
        updatedAt: Date.now(),
      };
      setCurrentSong(updated);
      saveSongToDB(updated);
      setSavedSongs((prevList) => prevList.map((s) => (s.id === updated.id ? updated : s)));
    }
  };

  // Auto-search and sync official music video whenever currentSong changes (including auto-advance from queue)
  useEffect(() => {
    if (!currentSong?.title) return;

    // 1. If song ALREADY has a video saved in its JSON/database (whether auto, preset, or custom URL), use it directly with 0 API calls!
    if (currentSong.videoBgId) {
      setVideoBgConfig((prev) => ({
        ...prev,
        videoId: currentSong.videoBgId!,
        videoTitle: currentSong.videoBgTitle || (currentSong.artist ? `${currentSong.artist} - ${currentSong.title}` : currentSong.title),
        mode: currentSong.videoBgMode || 'custom',
        customUrlOrId: currentSong.videoBgCustomUrl,
      }));
      return;
    }

    // 2. If song does NOT have a custom video, reset to auto-search mode for THIS specific song (never spill previous song's custom video)
    if (!videoBgConfig.enabled) return;

    // Reset current videoId so previous song's video is NOT displayed
    setVideoBgConfig((prev) => ({
      ...prev,
      mode: 'auto',
      videoId: '',
      videoTitle: undefined,
      customUrlOrId: undefined,
    }));

    let isMounted = true;
    searchOfficialVideo(currentSong.title, currentSong.artist).then((res) => {
      if (isMounted && res && res.videoId) {
        setVideoBgConfig((prev) => ({
          ...prev,
          mode: 'auto',
          videoId: res.videoId,
          videoTitle: res.title,
        }));

        // Save into current song and persist to IndexedDB / JSON
        setCurrentSong((prevSong) => {
          if (!prevSong || prevSong.id !== currentSong.id) return prevSong;
          const updated: SongItem = {
            ...prevSong,
            videoBgId: res.videoId,
            videoBgTitle: res.title,
            videoBgMode: 'auto',
            updatedAt: Date.now(),
          };
          saveSongToDB(updated);
          setSavedSongs((prevList) => prevList.map((s) => (s.id === updated.id ? updated : s)));
          return updated;
        });
      } else if (isMounted) {
        // Fallback to high-def preset loop (Cyberpunk City) if no official video found
        setVideoBgConfig((prev) => ({
          ...prev,
          mode: 'preset',
          videoId: 'qC0vDKVPCrw',
          videoTitle: 'Cyberpunk Neon City (Loop)',
        }));
      }
    }).catch(() => {});

    return () => { isMounted = false; };
  }, [currentSong?.id, currentSong?.title, currentSong?.artist, currentSong?.videoBgId, videoBgConfig.enabled]);

  // Memoize catalogSummary so it only recomputes when savedSongs changes, NOT every 100ms or 33ms!
  const catalogSummary = useMemo(() => {
    return savedSongs.map((s) => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      genre: s.genre,
      bpm: s.bpm,
      duration: s.duration,
    }));
  }, [savedSongs]);

  // Broadcast state in real-time to external TV window / Chromecast (Throttled to max 10 FPS for fluid UI performance)
  const lastBroadcastRef = useRef<number>(0);
  useEffect(() => {
    if (!isTvDisplayMode && !isGuestMode) {
      const now = performance.now();
      // Only broadcast if 100ms passed OR if play/pause, song change, or index change occurred
      if (now - lastBroadcastRef.current >= 100 || !isPlaying || currentIndex === -1) {
        lastBroadcastRef.current = now;
        const activeProf = profiles.find((p) => p.id === activeProfileId);
        const nextQueueItem = queue[0];
        const statePayload = {
          songTitle: currentSong?.title || '',
          songArtist: currentSong?.artist,
          artistsList: currentSong?.artistsList,
          currentTime,
          duration,
          isPlaying,
          lyrics,
          currentIndex,
          activeSingerName: activeProf && activeProf.id !== 'profile_all' ? activeProf.name : undefined,
          activeSingerAvatar: activeProf && activeProf.id !== 'profile_all' ? activeProf.avatar : undefined,
          nextSongTitle: nextQueueItem?.song?.title,
          nextSongArtist: nextQueueItem?.song?.artist,
          bpm: currentSong?.bpm || 120,
          isDuetMode,
          youTubeEmbedId,
          videoBgConfig,
          catalog: catalogSummary,
        };
        tvBroadcast.broadcastState(statePayload);
        peerSync.broadcastTvState(statePayload);
      }
    }
  }, [
    isTvDisplayMode,
    isGuestMode,
    currentSong,
    currentTime,
    duration,
    isPlaying,
    lyrics,
    currentIndex,
    activeProfileId,
    profiles,
    catalogSummary,
    queue,
    isDuetMode,
    youTubeEmbedId,
    videoBgConfig,
    savedSongs,
  ]);

  if (isTvDisplayMode) {
    return <TvStandaloneDisplay />;
  }

  if (isGuestMode) {
    return <GuestRemoteView />;
  }

  // ── Karaoke Performance Score & Next Song Transition Modal ──
  const [scoreModalState, setScoreModalState] = useState<{
    isOpen: boolean;
    mode: 'score' | 'transition';
    performance: KaraokePerformanceResult | null;
    nextSong: SongItem | null;
    nextSinger: SingerProfile | null;
  }>({
    isOpen: false,
    mode: 'score',
    performance: null,
    nextSong: null,
    nextSinger: null,
  });

  const generatePerformanceResult = (song: SongItem, singer?: SingerProfile): KaraokePerformanceResult => {
    return karaokeScoringTracker.computeFinalScore(song, singer, isMicActive);
  };

  const handleStartNextSongFromModal = () => {
    const songToPlay = scoreModalState.nextSong;
    setScoreModalState((prev) => ({ ...prev, isOpen: false }));
    if (songToPlay) {
      loadSongIntoEngine(songToPlay, true);
    }
  };

  const handleSkipNextSongFromModal = () => {
    const currentNextId = scoreModalState.nextSong?.id;
    const remaining = queue.filter(
      (q) => q.songData?.id !== currentNextId && q.id !== currentNextId
    );
    setQueue(remaining);
    const nextAfter = remaining.find((q) => q.status === 'ready' && q.songData)?.songData || null;
    if (nextAfter) {
      setScoreModalState((prev) => ({
        ...prev,
        nextSong: nextAfter,
      }));
    } else {
      setScoreModalState((prev) => ({ ...prev, isOpen: false }));
    }
  };

  const handleReplayCurrentSongFromModal = () => {
    const songToReplay = scoreModalState.performance?.song;
    setScoreModalState((prev) => ({ ...prev, isOpen: false }));
    if (songToReplay) {
      loadSongIntoEngine(songToReplay, true);
    }
  };

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const exportTimerRef = useRef<number | null>(null);

  // Global Audio Unlocker for Safari & Chrome autoplay policies
  useEffect(() => {
    audioEngine.setVocalGain(0.0);
    const handleFirstInteraction = () => {
      audioEngine.resumeContextSync();
    };
    window.addEventListener('click', handleFirstInteraction);
    window.addEventListener('touchstart', handleFirstInteraction);
    window.addEventListener('keydown', handleFirstInteraction);
    return () => {
      window.removeEventListener('click', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    };
  }, []);

  // ── Global 1-Tap FastClick: suppress Safari's delayed ghost click after our synthetic click ──
  // CSS touch-action:manipulation (applied globally) eliminates the 300ms tap delay.
  // But some elements can still emit a ghost click after we call btn.click() ourselves.
  // This handler intercepts and drops those ghost clicks so actions fire EXACTLY ONCE.
  useEffect(() => {
    const suppressedElements = new WeakMap<HTMLElement, number>();

    // On touchend: fire the click immediately and record this element so we can suppress the ghost
    const handleTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length === 0 || e.touches.length > 0) return;

      const touch = e.changedTouches[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
      if (!target) return;

      // Skip text inputs and range sliders — browser handles those natively
      if (
        target.tagName === 'TEXTAREA' ||
        (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'range') ||
        (target.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes((target as HTMLInputElement).type))
      ) return;

      const btn = target.closest('button, [role="button"], a, label, input[type="checkbox"], input[type="radio"]') as HTMLElement | null;
      if (!btn || btn.hasAttribute('disabled') || (btn as any).disabled) return;

      // Prevent the native 300ms-delayed click and fire ours now
      try { if (e.cancelable) e.preventDefault(); } catch (_) {}
      suppressedElements.set(btn, Date.now());
      btn.click();
    };

    // Swallow the browser ghost click that arrives ~300ms after our synthetic click
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest('button, [role="button"], a, label') as HTMLElement | null;
      if (!btn) return;
      const suppressedAt = suppressedElements.get(btn);
      if (suppressedAt !== undefined) {
        const age = Date.now() - suppressedAt;
        if (age > 10 && age < 800) {
          // Ghost click from browser — drop it
          e.stopImmediatePropagation();
          e.preventDefault();
        }
        if (age >= 10) suppressedElements.delete(btn);
      }
    };

    window.addEventListener('touchend', handleTouchEnd, { passive: false, capture: true });
    window.addEventListener('click', handleClick, { capture: true });

    return () => {
      window.removeEventListener('touchend', handleTouchEnd, { capture: true });
      window.removeEventListener('click', handleClick, { capture: true });
    };
  }, []);

  // 1. Load saved songs from IndexedDB on startup (Purges any legacy demo track)
  useEffect(() => {
    async function initDB() {
      await deleteSongFromDB('demo_synthwave_2099');
      const stored = await getSongsFromDB();
      const cleanStored = stored.filter((s) => s.id !== 'demo_synthwave_2099');
      setSavedSongs(cleanStored);
    }
    initDB();
  }, []);

  // 2. High-precision audio playback position tracker with Smart Vocal Cues (Optimized 30 FPS state update)
  useEffect(() => {
    let animId: number;
    let lastFlushTime = 0;

    const updateTime = (timestamp: number) => {
      if (audioEngine.getIsPlaying()) {
        const t = audioEngine.getCurrentTime();

        // Throttle React root state re-renders to ~30 FPS (~33ms) so WebKit touch events are never dropped or starved
        if (timestamp - lastFlushTime >= 33) {
          lastFlushTime = timestamp;
          setCurrentTime(t);

          // Find active lyric line index
          if (lyrics.length > 0) {
            let activeIdx = -1;
            for (let i = 0; i < lyrics.length; i++) {
              if (t >= lyrics[i].time) {
                activeIdx = i;
              } else {
                break;
              }
            }
            if (activeIdx !== currentIndexRef.current) {
              currentIndexRef.current = activeIdx;
              setCurrentIndex(activeIdx);
            }
          }
        }

        // Evaluate Vocal Playback Modes in real-time Web Audio graph (60 FPS):
        // 1. If Guía Coros is ON -> uses dynamic smart cue detector (verses/choruses)
        // 2. If Voz Guía (40%) is ON -> uses manual constant volume
        // 3. If BOTH ARE OFF -> Plays EXACTLY as the acapella / vocal automation was custom edited!
        if (isSmartVocalCue) {
          const cue = getActiveSmartCue(t, smartCues);
          audioEngine.setVocalGain(cue.targetGain);
          setActiveCueType(cue.cueType);
        } else if (vocalGain > 0.05) {
          audioEngine.setVocalGain(vocalGain);
        } else {
          const automatedVocalGain = audioEngine.getAutomatedVocalGainAtTime(t);
          if (automatedVocalGain !== null) {
            audioEngine.setVocalGain(automatedVocalGain, 0.18);
          } else {
            audioEngine.setVocalGain(0.0);
          }
        }
      }
      animId = requestAnimationFrame(updateTime);
    };

    animId = requestAnimationFrame(updateTime);
    return () => cancelAnimationFrame(animId);
  }, [lyrics, isSmartVocalCue, smartCues, vocalGain]);

  // 3. Load a song into Web Audio Engine (Instant Fast-Path Playback)
  const loadSongIntoEngine = async (song: SongItem, autoPlay = false) => {
    try {
      audioEngine.clearBuffers();
      audioEngine.resumeContextSync();
      invalidateVocalProfileCache(); // Clear cache for new song
      let durationVal = song.duration;
      let finalSongLyrics = song.lyrics || [];
      const rawLrcVal = song.rawLrc;

      // Check if rawLrc has embedded artists list if song.artistsList was not set
      let songArtistsList = song.artistsList;
      if (!songArtistsList && rawLrcVal) {
        const parsedArts = parseArtistsFromLRC(rawLrcVal);
        if (parsedArts && parsedArts.length > 0) {
          songArtistsList = parsedArts;
        }
      }

      // 1. Instant Audio Decode & Buffer Assignment or YouTube Video
      let vocBuf: AudioBuffer | null = null;
      if (song.id?.startsWith('yt_') || (song.videoBgId && !song.audioBlob && !song.stems?.instrumentalBlob)) {
        const vidId = song.videoBgId || song.id.replace('yt_', '');
        setYouTubeEmbedId(vidId);
        setIsYouTubeModalOpen(true);
        setCurrentSong(song);
        showAlertToast(`🎬 Reproduciendo video de YouTube: "${song.title}"`);
        return;
      } else if (song.stems?.instrumentalBlob) {
        const instArrayBuf = await song.stems.instrumentalBlob.arrayBuffer();
        const instBuf = await audioEngine.decodeAudio(instArrayBuf.slice(0));
        if (song.stems.vocalsBlob) {
          const vocArrayBuf = await song.stems.vocalsBlob.arrayBuffer();
          vocBuf = await audioEngine.decodeAudio(vocArrayBuf.slice(0));
        }
        audioEngine.setStemBuffers(instBuf, vocBuf);
        durationVal = instBuf.duration;
      } else if (song.audioBlob && song.audioBlob.size > 100) {
        const arrayBuf = await song.audioBlob.arrayBuffer();
        const buffer = await audioEngine.decodeAudio(arrayBuf.slice(0));
        audioEngine.setAudioBuffer(buffer);
        durationVal = buffer.duration;
      } else {
        // Song has no local audio - show notification
        showAlertToast(`ℹ️ "${song.title}" no tiene audio local. Importa el archivo MP3 para reproducirla.`);
        return;
      }

      // 2. Duet Mode Check
      const hasDuetVoices = finalSongLyrics.some((l) => l.singer === 'singer2' || l.singer === 'both' || (l.singer && l.singer !== 'singer1' && l.singer !== 'artist-0')) || detectIsDuetLyrics(finalSongLyrics, song.artist);
      const isDuetVal = song.isDuet !== undefined ? song.isDuet : hasDuetVoices;
      setIsDuetMode(isDuetVal);

      const updatedSong: SongItem = {
        ...song,
        duration: durationVal,
        lyrics: finalSongLyrics,
        artistsList: songArtistsList,
        rawLrc: rawLrcVal || (finalSongLyrics.length > 0 ? formatLRC(finalSongLyrics, songArtistsList) : undefined),
        isDuet: isDuetVal,
      };

      setCurrentSong(updatedSong);
      setDuration(durationVal);
      setBpm(updatedSong.bpm || 128);
      setDetectedKey(updatedSong.key || 'Am');
      setLyrics(finalSongLyrics);
      setSyncDelay(updatedSong.syncOffset ?? 0.0);
      setCurrentTime(0);
      setCurrentIndex(-1);
      audioEngine.setVocalAutomationConfig(updatedSong.vocalAutomation || null);

      // When a song is loaded/played, remove it from the waiting queue so it passes to "● SONANDO"
      // and does NOT appear duplicated in the queue list below it!
      setQueue((prevQueue) =>
        prevQueue.filter(
          (q) => (q.songData && q.songData.id !== updatedSong.id) && q.id !== updatedSong.id
        )
      );

      // 3. START PLAYBACK INSTANTLY (0 delay)
      if (autoPlay) {
        audioEngine.play(0).then(() => {
          setIsPlaying(true);
          const ctx = audioEngine.getAudioContext();
          karaokeScoringTracker.init(ctx, audioEngine.getMicGainNode() || undefined);
          karaokeScoringTracker.startSession(song.bpm || 120, finalSongLyrics);
        }).catch((pErr) => console.warn('Instant play error:', pErr));
      }

      // 4. Background Asynchronous Enrichment (Non-blocking)
      setTimeout(async () => {
        let backgroundLyricsUpdated = false;
        let enrichedLyrics = finalSongLyrics;

        // Auto-fetch LRCLIB in background only if completely missing
        if ((!rawLrcVal || enrichedLyrics.length === 0) && typeof navigator !== 'undefined' && navigator.onLine) {
          try {
            const queryTerm = song.artist && song.artist !== 'Desconocido' ? `${song.artist} ${song.title}` : song.title;
            const autoLrcRes = await searchLrclib(queryTerm, song.duration);
            if (autoLrcRes && autoLrcRes.lyrics && autoLrcRes.lyrics.length > 0) {
              enrichedLyrics = autoLrcRes.lyrics;
              backgroundLyricsUpdated = true;
            }
          } catch (_) {}
        }

        if (backgroundLyricsUpdated) {
          const fullyUpdated: SongItem = {
            ...updatedSong,
            lyrics: enrichedLyrics,
            rawLrc: formatLRC(enrichedLyrics),
            updatedAt: Date.now(),
          };
          await saveSongToDB(fullyUpdated);
          setSavedSongs((prev) => prev.map((s) => (s.id === fullyUpdated.id ? fullyUpdated : s)));
          setLyrics(enrichedLyrics);
        }
      }, 50);

    } catch (err) {
      console.error('Error loading song into audio engine:', err);
    }
  };

  // Helper to update & persist song sync delay
  const handleUpdateSyncDelay = (newDelay: number) => {
    const clamped = Math.max(-5.0, Math.min(5.0, +newDelay.toFixed(1)));
    setSyncDelay(clamped);
    if (currentSong) {
      const updated = { ...currentSong, syncOffset: clamped };
      setCurrentSong(updated);
      saveSongToDB(updated);
      setSavedSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    }
  };

  // Helper to download individual Stems
  const handleDownloadStem = (song: SongItem, type: 'instrumental' | 'vocals') => {
    const blob = type === 'instrumental' ? song.stems?.instrumentalBlob : song.stems?.vocalsBlob;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${song.title.replace(/\s+/g, '_')}_${type === 'instrumental' ? 'Karaoke_SinVoz' : 'Vocales'}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Re-analyze exact BPM, Key, Lyrics Sync, and Vocal Gender for any song
  const handleReanalyzeSong = async (song: SongItem) => {
    try {
      let buf: AudioBuffer | null = null;
      let vocBuf: AudioBuffer | null = null;

      if (currentSong?.id === song.id) {
        buf = audioEngine.getAudioBuffer();
        vocBuf = audioEngine.getVocalsBuffer();
      }
      if (!buf && song.audioBlob) {
        const ab = await song.audioBlob.arrayBuffer();
        buf = await audioEngine.decodeAudio(ab.slice(0));
      }
      if (!vocBuf && song.stems?.vocalsBlob) {
        const vab = await song.stems.vocalsBlob.arrayBuffer();
        vocBuf = await audioEngine.decodeAudio(vab.slice(0));
      }

      let newBpm = song.bpm || 120;
      let newKey = song.key || 'Am';
      let newGenre = song.genre || 'General';
      let newArtist = song.artist || 'Desconocido';
      let newAlbum = song.album || '';
      let newTitle = song.title;

      if (buf) {
        const dspRes = await analyzeStudioBPMAndKey(buf, song.audioBlob);
        newBpm = dspRes.bpm;
        newKey = dspRes.key;

        // If online, enrich metadata from official music registry
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          const queryTerm = song.artist && song.artist !== 'Desconocido' ? `${song.artist} ${song.title}` : song.title;
          const onlineMeta = await fetchOnlineMetadata(queryTerm, buf.duration);
          if (onlineMeta) {
            if (onlineMeta.genre && onlineMeta.genre !== 'General') newGenre = onlineMeta.genre;
            if (onlineMeta.artist && newArtist === 'Desconocido') newArtist = onlineMeta.artist;
            if (onlineMeta.title && newTitle === song.title) newTitle = onlineMeta.title;
            if (onlineMeta.album && !newAlbum) newAlbum = onlineMeta.album;
          }
        }
      }

      // Re-calibrate lyrics sync & vocal gender
      let finalLyrics = song.lyrics || [];
      if (vocBuf && finalLyrics.length > 0) {
        const { calibratedLyrics } = calibrateLyricsWithVocalStem(finalLyrics, vocBuf);
        const baseLyrics = calibratedLyrics.length > 0 ? calibratedLyrics : finalLyrics;
        finalLyrics = await classifyAllLyricsVocalGender(baseLyrics, vocBuf, newArtist);
      } else {
        finalLyrics = await classifyAllLyricsVocalGender(finalLyrics, null, newArtist);
      }

      const updated: SongItem = {
        ...song,
        title: newTitle,
        artist: newArtist,
        album: newAlbum,
        genre: newGenre,
        bpm: newBpm,
        key: newKey,
        lyrics: finalLyrics,
      };

      if (currentSong?.id === song.id) {
        setBpm(newBpm);
        setDetectedKey(newKey);
        setLyrics(finalLyrics);
        setCurrentSong(updated);
        const profile = analyzeSongVocalProfileSync(finalLyrics, newArtist);
        setIsDuetMode(!!profile?.isDuet || detectIsDuetLyrics(finalLyrics, newArtist));
      }

      await saveSongToDB(updated);
      setSavedSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      console.warn('Re-analyze DSP error:', err);
    }
  };

  // Re-analyze exact BPM and Key for current song
  const handleReanalyzeCurrentSong = async () => {
    if (currentSong) {
      await handleReanalyzeSong(currentSong);
    }
  };

  // 4. Sequential Queue Processor (Processes 1 file at a time to keep UI fast & RAM low)
  useEffect(() => {
    if (isProcessingQueue) return;

    const nextItem = queue.find((q) => q.status === 'queued');
    if (!nextItem || !nextItem.file) return;

    const processItem = async (item: QueueItem) => {
      setIsProcessingQueue(true);
      const updateStatus = (status: QueueItem['status'], progress: number, currentStep?: string, errorMsg?: string) => {
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status, progress, currentStep, errorMsg } : q))
        );
      };

      try {
        // Step 1: Decode Audio
        updateStatus('decoding', 15, 'Decodificando archivo de audio...');
        const file = item.file!;
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioEngine.decodeAudio(arrayBuffer.slice(0));

        // Step 2: DSP Stems Separation (Instrumental Karaoke / Vocales)
        updateStatus('separating_stems', 35, 'Separando voz con STFT Phase-Preserved (Nitidez HD)...');
        const { stems, instrumentalBuffer, vocalsBuffer } = await separateAudioStems(audioBuffer, (p, step) => {
          updateStatus('separating_stems', 35 + Math.floor(p * 0.3), step);
        });

        // Step 3: Studio BPM, Key & Vocal Phrase Activity Detection
        updateStatus('generating_lyrics', 70, 'Calculando BPM y Tono exactos con Librosa DSP...');
        const { bpm: detectedBpmVal, key: detectedKeyVal } = await analyzeStudioBPMAndKey(audioBuffer, file);
        const vocalPhrases = detectVocalPhrases(vocalsBuffer);

        // Step 4: Online Metadata Discovery & Synchronized Lyrics (ID3, iTunes, Genius & LRCLIB)
        updateStatus('generating_lyrics', 75, 'Buscando metadatos oficiales y etiquetas ID3...');
        const parsedFilename = cleanSongFilename(item.fileName);
        const onlineMeta = await fetchOnlineMetadata(item.fileName, audioBuffer.duration, arrayBuffer);

        const finalTitle = onlineMeta?.title || parsedFilename.title || parsedFilename.query || item.fileName.replace(/\.[^/.]+$/, '');
        const finalArtist = onlineMeta?.artist || parsedFilename.artist || 'Desconocido';
        const finalAlbum = onlineMeta?.album || '';
        const finalGenre = onlineMeta?.genre || 'General';

        updateStatus('generating_lyrics', 80, 'Buscando letras estructuradas con roles de artistas (Genius / LRCLIB)...');
        const lyricsDiscovery = await discoverSongLyricsWithRoles(finalTitle, finalArtist, audioBuffer.duration);
        let finalLyrics: LyricLine[] = lyricsDiscovery.lyrics;
        let finalRawLrc = lyricsDiscovery.rawLrc;

        // If lyrics are plain text without timestamps or missing, run AI Forced Alignment or Whisper AI Transcription
        if (stems?.vocalsBlob) {
          if (finalLyrics.length === 0) {
            updateStatus('generating_lyrics', 85, 'Escuchando voz con IA Whisper para generar letra y timestamps exactos...');
            const whisperLyrics = await transcribeVocalsWithWhisper(stems.vocalsBlob);
            if (whisperLyrics && whisperLyrics.length > 0) {
              finalLyrics = whisperLyrics;
            }
          }
        }

        if (finalLyrics.length === 0) {
          finalLyrics = generateGenericLyrics(
            finalTitle,
            finalArtist,
            audioBuffer.duration,
            vocalPhrases
          );
        }

        // Step 4.5: Classify Vocal Gender & Duet Phrases (Hombre 👨 / Mujer 👩 / Dúo 👥)
        if (vocalsBuffer && finalLyrics.length > 0) {
          updateStatus('generating_lyrics', 90, 'Clasificando registro de voz por frase (Hombre 👨 / Mujer 👩 / Dúo 👥)...');
          try {
            finalLyrics = await classifyAllLyricsVocalGender(finalLyrics, vocalsBuffer, finalArtist);
          } catch (cErr) {
            console.warn('Vocal classification error during import:', cErr);
          }
        }

        // Step 5: Prepare Karaoke Video
        updateStatus('preparing_video', 95, 'Generando y preparando Video de Karaoke HD...');

        // Assemble Full SongItem
        const songData: SongItem = {
          id: `song_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          title: finalTitle,
          artist: finalArtist,
          album: finalAlbum,
          duration: audioBuffer.duration,
          bpm: detectedBpmVal,
          key: detectedKeyVal,
          rawLrc: finalRawLrc,
          lyrics: finalLyrics,
          originalFileName: item.fileName,
          audioBlob: file,
          stems,
          genre: finalGenre,
          createdAt: Date.now(),
        };

        // Save to IndexedDB
        await saveSongToDB(songData);
        setSavedSongs((prev) => [songData, ...prev.filter((s) => s.id !== songData.id)]);

        // Update item in queue as ready
        updateStatus('ready', 100, '¡Pipeline completado: Stems + Lyrics + Video!');

        // Load dual stems into audio engine for pristine karaoke playback
        audioEngine.setStemBuffers(instrumentalBuffer, vocalsBuffer);
        setCurrentSong(songData);
        setDuration(audioBuffer.duration);
        setBpm(detectedBpmVal);
        setDetectedKey(detectedKeyVal);
        setLyrics(finalLyrics);
        setCurrentTime(0);
        setCurrentIndex(-1);
      } catch (err: any) {
        console.error('Queue processing error:', err);
        updateStatus('error', 0, undefined, err?.message || 'Error al procesar archivo');
      } finally {
        setIsProcessingQueue(false);
      }
    };

    processItem(nextItem);
  }, [queue, isProcessingQueue, currentSong]);

  // 5. Batch Audio Processor (Processes 1 or multiple songs sequentially, loads 1st to player, saves all to library, NEVER adds to queue)
  const processBatchAudioFiles = async (audioFiles: File[]) => {
    const totalCount = audioFiles.length;
    if (totalCount === 0) return;

    for (let i = 0; i < totalCount; i++) {
      const file = audioFiles[i];
      const currentIndex = i + 1;
      const isFirst = i === 0;

      setDirectUploadProgress({
        isProcessing: true,
        fileName: file.name,
        progress: 10,
        step: 'Decodificando archivo de audio...',
        currentIndex,
        totalCount,
      });

      try {
        // Step 1: Decode Audio
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioEngine.decodeAudio(arrayBuffer.slice(0));

        // Step 2: Separate Stems (Instrumental & Vocals)
        setDirectUploadProgress((prev) => ({
          ...prev,
          isProcessing: true,
          fileName: file.name,
          progress: 30,
          step: 'Separando voz con STFT Phase-Preserved (Nitidez HD)...',
          currentIndex,
          totalCount,
        }));

        const { stems, instrumentalBuffer, vocalsBuffer } = await separateAudioStems(audioBuffer, (p, step) => {
          setDirectUploadProgress((prev) => ({
            ...prev,
            isProcessing: true,
            fileName: file.name,
            progress: 30 + Math.floor(p * 0.35),
            step,
            currentIndex,
            totalCount,
          }));
        });

        // Step 3: Studio BPM & Key
        setDirectUploadProgress((prev) => ({
          ...prev,
          isProcessing: true,
          fileName: file.name,
          progress: 70,
          step: 'Calculando BPM y Tono exactos con Librosa DSP...',
          currentIndex,
          totalCount,
        }));
        const { bpm: detectedBpmVal, key: detectedKeyVal } = await analyzeStudioBPMAndKey(audioBuffer, file);
        const vocalPhrases = detectVocalPhrases(vocalsBuffer);

        // Step 4: Metadata & Synced Lyrics
        setDirectUploadProgress((prev) => ({
          ...prev,
          isProcessing: true,
          fileName: file.name,
          progress: 80,
          step: 'Buscando metadatos oficiales y letra sincronizada...',
          currentIndex,
          totalCount,
        }));
        const parsedFilename = cleanSongFilename(file.name);
        const onlineMeta = await fetchOnlineMetadata(file.name, audioBuffer.duration, arrayBuffer);

        const finalTitle = onlineMeta?.title || parsedFilename.title || parsedFilename.query || file.name.replace(/\.[^/.]+$/, '');
        const finalArtist = onlineMeta?.artist || parsedFilename.artist || 'Desconocido';
        const finalAlbum = onlineMeta?.album || '';
        const finalGenre = onlineMeta?.genre || 'General';

        const lyricsDiscovery = await discoverSongLyricsWithRoles(finalTitle, finalArtist, audioBuffer.duration);
        let finalLyrics: LyricLine[] = lyricsDiscovery.lyrics;
        let finalRawLrc = lyricsDiscovery.rawLrc;

        if (finalLyrics.length === 0 && stems?.vocalsBlob) {
          setDirectUploadProgress((prev) => ({
            ...prev,
            isProcessing: true,
            fileName: file.name,
            progress: 88,
            step: 'Transcribiendo voz real con OpenAI Whisper AI...',
            currentIndex,
            totalCount,
          }));
          const whisperLyrics = await transcribeVocalsWithWhisper(stems.vocalsBlob);
          if (whisperLyrics && whisperLyrics.length > 0) {
            finalLyrics = whisperLyrics;
          }
        }

        if (finalLyrics.length === 0) {
          finalLyrics = generateGenericLyrics(finalTitle, finalArtist, audioBuffer.duration, vocalPhrases);
        } else if (vocalsBuffer) {
          // Acoustic Forced Alignment Calibration against isolated vocals stem
          const { calibratedLyrics } = calibrateLyricsWithVocalStem(finalLyrics, vocalsBuffer);
          const baseLyrics = calibratedLyrics.length > 0 ? calibratedLyrics : finalLyrics;
          finalLyrics = await classifyAllLyricsVocalGender(baseLyrics, vocalsBuffer, finalArtist);
        }

        const songData: SongItem = {
          id: `song_${Date.now()}_${Math.random().toString(36).substr(2, 6)}_${i}`,
          title: finalTitle,
          artist: finalArtist,
          album: finalAlbum,
          duration: audioBuffer.duration,
          bpm: detectedBpmVal,
          key: detectedKeyVal,
          rawLrc: finalRawLrc,
          lyrics: finalLyrics,
          originalFileName: file.name,
          audioBlob: file,
          stems,
          genre: finalGenre,
          createdAt: Date.now() - (totalCount - i) * 1000,
        };

        // Save to IndexedDB (Song Library)
        await saveSongToDB(songData);
        setSavedSongs((prev) => [songData, ...prev.filter((s) => s.id !== songData.id)]);

        // Load 1st song directly into audio player
        if (isFirst) {
          audioEngine.setStemBuffers(instrumentalBuffer, vocalsBuffer);
          setCurrentSong(songData);
          setDuration(audioBuffer.duration);
          setBpm(detectedBpmVal);
          setDetectedKey(detectedKeyVal);
          setLyrics(finalLyrics);
          setCurrentTime(0);
          setCurrentIndex(-1);
        }
      } catch (err: any) {
        console.error(`Error procesando canción ${file.name}:`, err);
      }
    }

    // Finished entire batch
    setDirectUploadProgress({
      isProcessing: false,
      fileName: '',
      progress: 100,
      step: '',
      currentIndex: 1,
      totalCount: 1,
    });
  };

  // 6. Handle File Uploads (Drag & Drop or Input)
  const handleFilesSelected = (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;

    // Check for .lrc file
    const lrcFile = fileList.find((f) => f.name.toLowerCase().endsWith('.lrc'));
    if (lrcFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text) {
          const parsed = parseLRC(text);
          if (parsed.length > 0) {
            setLyrics(parsed);
            if (currentSong) {
              const updated = { ...currentSong, lyrics: parsed, rawLrc: text };
              setCurrentSong(updated);
              saveSongToDB(updated);
            }
          }
        }
      };
      reader.readAsText(lrcFile);
    }

    // Process all audio files directly (loads 1st, saves all to library, NO queue additions)
    const audioFiles = fileList.filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)$/i.test(f.name));
    if (audioFiles.length > 0) {
      processBatchAudioFiles(audioFiles);
    }
  };

  const handleAddToQueue = (song: SongItem) => {
    if (queue.some((q) => q.songData?.id === song.id)) return;
    const newItem: QueueItem = {
      id: `queue_lib_${song.id}_${Date.now()}`,
      fileName: `${song.title}${song.artist ? ' - ' + song.artist : ''}`,
      status: 'ready',
      progress: 100,
      songData: song,
    };
    setQueue((prev) => [...prev, newItem]);
  };

  const handleRemoveFromQueue = (queueId: string) => {
    const itemToRemove = queue.find((q) => q.id === queueId);
    const isPlayingThisSong = !!(
      itemToRemove &&
      ((itemToRemove.songData && itemToRemove.songData.id === currentSong?.id) ||
        itemToRemove.id === currentSong?.id ||
        itemToRemove.id === `queue_active_${currentSong?.id}`)
    );

    if (isPlayingThisSong) {
      handleStop();
    }

    setQueue((prev) => prev.filter((q) => q.id !== queueId));
  };

  // Play next song in queue (skip current song and load next ready track)
  const handleNextInQueue = () => {
    const nextItem = queue.find((q) => q.status === 'ready' && q.songData && q.songData.id !== currentSong?.id);
    if (!nextItem || !nextItem.songData) return;

    setQueue((prevQueue) =>
      prevQueue.filter(
        (q) =>
          q.id !== nextItem.id &&
          (!currentSong || (q.songData?.id !== currentSong.id && q.id !== currentSong.id))
      )
    );

    audioEngine.stop();
    loadSongIntoEngine(nextItem.songData, true);
  };

  // Auto-play next song in queue with Score & Countdown Intermission when track ends
  useEffect(() => {
    const unsubscribe = audioEngine.onTrackEnded(() => {
      setIsPlaying(false);
      const finishedSong = currentSong;
      if (!finishedSong) return;

      setQueue((prevQueue) => {
        // Find if finished song is in queue and remove it
        const finishedIdx = prevQueue.findIndex(
          (q) => (q.songData && q.songData.id === finishedSong.id) || q.id === finishedSong.id
        );

        let nextQueue = [...prevQueue];
        if (finishedIdx >= 0) {
          nextQueue.splice(finishedIdx, 1);
        }

        // Find next ready song in queue
        const nextReadyItem = nextQueue.find((q) => q.status === 'ready' && q.songData);
        const nextSongData = nextReadyItem?.songData || null;

        // If there are no more songs in the queue, clear player so SONANDO is emptied
        if (!nextSongData) {
          setCurrentSong(null);
          setLyrics([]);
          setDuration(0);
          setCurrentTime(0);
          setCurrentIndex(-1);
          audioEngine.stop();
        }

        // Calculate performance score
        const perf = generatePerformanceResult(finishedSong, activeProfile);

        // Open Score & Transition Modal
        setScoreModalState({
          isOpen: true,
          mode: 'score',
          performance: perf,
          nextSong: nextSongData,
          nextSinger: activeProfile && activeProfile.id !== 'profile_all' ? activeProfile : null,
        });

        return nextQueue;
      });
    });

    return () => {
      unsubscribe();
    };
  }, [currentSong, activeProfile]);

  const handleUpdateSong = async (updated: SongItem) => {
    await saveSongToDB(updated);
    setSavedSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    if (currentSong?.id === updated.id) {
      setCurrentSong(updated);
      setBpm(updated.bpm);
    }
  };

  const handleSaveVocalAutomation = async (updatedSong: SongItem, config: VocalAutomationConfig) => {
    await saveSongToDB(updatedSong);
    setSavedSongs((prev) => prev.map((s) => (s.id === updatedSong.id ? updatedSong : s)));
    if (currentSong?.id === updatedSong.id) {
      setCurrentSong(updatedSong);
      audioEngine.setVocalAutomationConfig(config);
    }
    // Turn off manual 40% guide and smart cues so the newly edited automation takes over immediately!
    setVocalGain(0.0);
    setIsSmartVocalCue(false);
    setActiveCueType(null);
  };



  const [alertToast, setAlertToast] = useState<string | null>(null);

  const showAlertToast = (msg: string) => {
    setAlertToast(msg);
    setTimeout(() => {
      setAlertToast((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  // 7. Transport Controls Handlers
  const handlePlay = async () => {
    // If no song is loaded in player
    if (!currentSong) {
      // Check if there is a ready song in queue to play
      const nextInQueue = queue.find((q) => q.status === 'ready' && q.songData);
      if (nextInQueue && nextInQueue.songData) {
        await loadSongIntoEngine(nextInQueue.songData, true);
        return;
      }

      showAlertToast('⚠️ No hay ninguna pista en el reproductor. Selecciona una canción de la biblioteca o de la cola.');
      return;
    }

    // If no buffer loaded yet, load current song
    if (!audioEngine.getAudioBuffer()) {
      await loadSongIntoEngine(currentSong, true);
      return;
    }
    await audioEngine.play();
    setIsPlaying(true);
    const ctx = audioEngine.getAudioContext();
    karaokeScoringTracker.init(ctx, audioEngine.getMicGainNode() || undefined);
    karaokeScoringTracker.startSession(bpm, lyrics);
  };

  const handlePause = () => {
    audioEngine.pause();
    setIsPlaying(false);
  };

  const handleStop = () => {
    audioEngine.stop();
    setIsPlaying(false);
    setCurrentTime(0);
    setCurrentIndex(-1);
    setCurrentSong(null);
    setLyrics([]);
    setDuration(0);
  };

  const handleSeek = (seconds: number) => {
    audioEngine.seek(seconds);
    setCurrentTime(seconds);
  };

  const handleVocalGainChange = (val: number) => {
    if (val > 0.05) {
      setIsSmartVocalCue(false);
      setActiveCueType(null);
    } else {
      if (currentSong?.vocalAutomation) {
        audioEngine.setVocalAutomationConfig(currentSong.vocalAutomation);
      }
    }
    setVocalGain(val);
    audioEngine.setVocalGain(val);
  };

  const handleMusicGainChange = (val: number) => {
    setMusicGain(val);
    audioEngine.setMusicGain(val);
  };

  const handleMasterGainChange = (val: number) => {
    setMasterGain(val);
    audioEngine.setMasterGain(val);
  };

  const handlePitchShiftChange = (semitones: number) => {
    setPitchShift(semitones);
    audioEngine.setPitchShift(semitones);
  };

  const handleToggleLoop = () => {
    const next = !isLooping;
    setIsLooping(next);
    audioEngine.setLoop(next, 0, duration);
  };

  const handleToggleMic = async () => {
    const active = await audioEngine.enableMicrophone(!isMicActive);
    setIsMicActive(active);
    if (active) {
      const ctx = audioEngine.getAudioContext();
      const micGain = audioEngine.getMicGainNode();
      if (micGain) {
        karaokeScoringTracker.init(ctx, micGain);
      }
    }
  };

  const handleMicGainChange = (val: number) => {
    setMicGain(val);
    audioEngine.setMicGain(val);
  };

  const handleDeleteSong = async (id: string) => {
    await deleteSongFromDB(id);
    invalidateVocalProfileCache();
    setSavedSongs((prev) => prev.filter((s) => s.id !== id));
    setQueue((prev) => prev.filter((q) => q.songData?.id !== id && q.id !== id));
    if (currentSong?.id === id) {
      handleStop();
      setCurrentSong(null);
    }
  };

  // 8. Video Export Engine
  const handleStartVideoExport = () => {
    if (!canvasRef.current) return;

    // Ensure audio engine stream destination is ready
    const streamDest = audioEngine.getMediaStreamDestination();

    // Start playing from beginning with mixed audio
    handleSeek(0);
    handlePlay();

    const success = videoRecorder.startRecording(
      canvasRef.current,
      streamDest.stream
    );

    if (success) {
      setIsExportingVideo(true);
      setExportProgress(0);

      exportTimerRef.current = window.setInterval(() => {
        setExportProgress((p) => p + 1);
      }, 1000);
    }
  };

  const handleStopVideoExport = async () => {
    if (exportTimerRef.current) {
      clearInterval(exportTimerRef.current);
      exportTimerRef.current = null;
    }
    handlePause();
    setIsExportingVideo(false);
    await videoRecorder.stopRecording(currentSong?.title || 'Karaoke');
  };

  const handleExecuteClearCache = async () => {
    try {
      await clearAllSongsFromDB();
      localStorage.clear();
      setSavedSongs([]);
      setQueue([]);
      setCurrentSong(null);
      setLyrics([]);
      setIsClearCacheModalOpen(false);
      showAlertToast('✓ Se ha limpiado todo el caché y la biblioteca con éxito.');
      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (err: any) {
      showAlertToast(`Error al limpiar caché: ${err?.message}`);
    }
  };

  const handleSelectSongForPlayback = useCallback((song: SongItem) => {
    loadSongIntoEngine(song, true);
  }, []);

  const handleOpenYouTubeModalCallback = useCallback(() => {
    setYouTubeEmbedId(null);
    setIsYouTubeModalOpen(true);
  }, []);

  const handleOpenYouTubeEmbedCallback = useCallback((videoId: string) => {
    setYouTubeEmbedId(videoId);
    setIsYouTubeModalOpen(true);
  }, []);

  const handleRestoreLibraryCallback = useCallback((newSongs: SongItem[], newProfiles: SingerProfile[]) => {
    setSavedSongs(newSongs);
    setProfiles(newProfiles);
    setCurrentSong((prev) => {
      if (!prev) return null;
      const updatedCurrent = newSongs.find((s) => s.id === prev.id);
      if (updatedCurrent) {
        setLyrics(updatedCurrent.lyrics || []);
        if (updatedCurrent.isDuet !== undefined) {
          setIsDuetMode(updatedCurrent.isDuet);
        }
        return updatedCurrent;
      }
      return prev;
    });
  }, []);

  const currentLyric = currentIndex >= 0 && currentIndex < lyrics.length ? lyrics[currentIndex] : null;
  const nextLyric = currentIndex >= 0 && currentIndex < lyrics.length - 1 ? lyrics[currentIndex + 1] : null;

  return (
    <div className="min-h-screen bg-[#080811] text-slate-100 flex flex-col bg-grid-cyber selection:bg-[#ff007f] selection:text-white relative overflow-x-hidden">
      {/* Persistent Dynamic Video Background for Fullscreen Party Mode */}
      {isPartyMode && isPlaying && currentSong && videoBgConfig.enabled && videoBgConfig.mode !== 'off' && videoBgConfig.videoId && (
        <DynamicVideoBackground
          config={videoBgConfig}
          isPlaying={isPlaying}
          songKey={`${currentSong?.title}___${currentSong?.artist || ''}`}
          currentTime={currentTime}
          duration={duration}
          className="fixed inset-0 pointer-events-none transition-opacity duration-500 z-[48] opacity-100 visible"
        />
      )}

      {/* Header */}
      <Header
        onOpenAboutModal={() => setIsAboutModalOpen(true)}
        onOpenPartyMode={() => setIsPartyMode(true)}
        onOpenVideoStudio={() => setIsVideoStudioOpen(true)}
        onOpenCastModal={() => setIsCastModalOpen(true)}
        onOpenQrModal={() => setIsQrModalOpen(true)}
        onOpenDspSettings={() => setIsDspModalOpen(true)}
        onOpenShareModal={() => handleOpenShareModal()}
        onOpenPublishModal={() => handleOpenShareModal()}
        onSyncToFolder={handle1ClickSync}
        onChangeSyncFolder={handleChangeSyncFolder}
        onImportSyncedFolder={handleImportSyncedFolder}
        isFolderSyncing={isFolderSyncing}
        syncTargetFolder={syncTargetFolder}
        onClearCache={() => setIsClearCacheModalOpen(true)}
        isCastingActive={isCastingActive}
        onFilesSelected={handleFilesSelected}
        isPlaying={isPlaying}
        hasSongLoaded={!!currentSong}
      />

      {/* 1-Click Folder Sync Status Banner */}
      {syncToastMessage && (
        <div className="bg-amber-950/90 border-b border-amber-500/50 px-4 py-2 text-amber-200 text-xs font-bold flex items-center justify-between animate-in fade-in shadow-lg">
          <div className="flex items-center gap-2">
            <span className="text-amber-400 text-sm">{isFolderSyncing ? '⏳' : '⚡'}</span>
            <span>{syncToastMessage}</span>
          </div>
          <button
            onClick={() => setSyncToastMessage(null)}
            className="text-amber-400 hover:text-white text-xs font-bold px-2 py-0.5 rounded bg-amber-900/40 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Remote Control Active Banner */}
      {isCastingActive && (
        <div className="bg-emerald-950/80 border-b border-emerald-500/40 px-4 py-2 text-emerald-200 text-xs font-semibold flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="font-bold">🎮 MODO CONTROL REMOTO ACTIVO</span>
            <span className="hidden sm:inline text-[11px] text-emerald-400">
              · Transmitiendo en vivo a la pantalla TV / Chromecast / AirPlay
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsCastModalOpen(true)}
            className="px-2.5 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-300 text-[10px] font-bold cursor-pointer transition-all"
          >
            Ajustes TV
          </button>
        </div>
      )}

      {/* Main Dashboard */}
      <main className="flex-1 w-full max-w-[1600px] mx-auto px-2 sm:px-4 py-3 flex flex-col gap-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1">
          {/* Left Column: Processing Queue & Song Requests */}
          <div className="lg:col-span-3 flex flex-col gap-3">
            <SongQueue
              queue={queue}
              currentSong={currentSong}
              currentSongId={currentSong?.id}
              isPlaying={isPlaying}
              onSelectSong={handleSelectSongForPlayback}
              onTogglePlay={() => (isPlaying ? handlePause() : handlePlay())}
              onStop={handleStop}
              onRemoveFromQueue={handleRemoveFromQueue}
            />
          </div>

          {/* Center: Karaoke Stage (dominant) with integrated transport + mixer */}
          <div className="lg:col-span-6 flex flex-col gap-4">
            <KaraokeDisplay
              lyrics={lyrics}
              currentLyric={currentLyric}
              currentIndex={currentIndex}
              currentTime={currentTime}
              duration={duration}
              songTitle={currentSong?.title || ''}
              songArtist={currentSong?.artist}
              isPlaying={isPlaying}
              bpm={bpm}
              detectedKey={detectedKey}
              stems={currentSong?.stems}
              audioBlob={currentSong?.audioBlob}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={handleStop}
              onSeek={handleSeek}
              onNextInQueue={handleNextInQueue}
              hasNextInQueue={queue.some((q) => q.status === 'ready' && q.songData && q.songData.id !== currentSong?.id)}
              onToggleLoop={handleToggleLoop}
              isLooping={isLooping}
              onToggleMic={handleToggleMic}
              isMicActive={isMicActive}
              artists={currentSong?.artistsList}
              onUpdateArtists={(updatedArtists) => {
                setCurrentSong((prev) => {
                  if (!prev) return prev;
                  const updated: SongItem = {
                    ...prev,
                    artistsList: updatedArtists,
                    rawLrc: prev.lyrics ? formatLRC(prev.lyrics, updatedArtists) : prev.rawLrc,
                    updatedAt: Date.now(),
                  };
                  saveSongToDB(updated);
                  setSavedSongs((prevList) => prevList.map((s) => (s.id === updated.id ? updated : s)));
                  return updated;
                });
              }}
              onUpdateLyrics={(newLyrics, updatedArtists) => {
                setLyrics(newLyrics);
                setCurrentSong((prev) => {
                  if (!prev) return prev;
                  const activeArtists = updatedArtists || prev.artistsList;
                  const hasDuetVoices = newLyrics.some((l) => l.singer === 'singer2' || l.singer === 'both' || (l.singer && l.singer !== 'singer1' && l.singer !== 'artist-0')) || (activeArtists && activeArtists.length > 1) || detectIsDuetLyrics(newLyrics, prev.artist);
                  setIsDuetMode(hasDuetVoices);
                  const rawLrcFormatted = formatLRC(newLyrics, activeArtists);
                  const updated: SongItem = {
                    ...prev,
                    lyrics: newLyrics,
                    artistsList: activeArtists,
                    rawLrc: rawLrcFormatted,
                    isDuet: hasDuetVoices,
                    updatedAt: Date.now(),
                  };
                  saveSongToDB(updated);
                  setSavedSongs((prevList) => prevList.map((s) => (s.id === updated.id ? updated : s)));
                  return updated;
                });
              }}
              isDuetMode={isDuetMode}
              onToggleDuetMode={() => {
                setIsDuetMode((prev) => {
                  const next = !prev;
                  if (currentSong) {
                    const updated: SongItem = { ...currentSong, isDuet: next, updatedAt: Date.now() };
                    setCurrentSong(updated);
                    saveSongToDB(updated);
                    setSavedSongs((prevList) => prevList.map((s) => (s.id === updated.id ? updated : s)));
                  }
                  return next;
                });
              }}
              vocalGain={vocalGain}
              onToggleVocalGuide={() => {
                const nextGain = vocalGain > 0.05 ? 0.0 : 0.40;
                if (nextGain > 0.05) {
                  // Apagar Guía Coros cuando se activa Dueto (40%)
                  setIsSmartVocalCue(false);
                  setActiveCueType(null);
                }
                handleVocalGainChange(nextGain);
              }}
              isSmartVocalCue={isSmartVocalCue}
              activeCueType={activeCueType}
              onToggleSmartVocalCue={() => {
                setIsSmartVocalCue((prev) => {
                  const next = !prev;
                  if (next) {
                    // Apagar Dueto (volumen de voz a 0) cuando se activa Guía Coros
                    handleVocalGainChange(0.0);
                  } else {
                    audioEngine.setVocalGain(0.0);
                    setActiveCueType(null);
                  }
                  return next;
                });
              }}
              pitchShift={pitchShift}
              onPitchShiftChange={handlePitchShiftChange}
              onOpenVideoStudio={() => setIsVideoStudioOpen(true)}
              onDownloadStem={(type) => currentSong && handleDownloadStem(currentSong, type)}
              onOpenPartyMode={() => setIsPartyMode(true)}
              onReanalyzeDSP={handleReanalyzeCurrentSong}
              syncDelay={syncDelay}
              onUpdateSyncDelay={handleUpdateSyncDelay}
              onUpdateBpm={(newBpm) => {
                setBpm(newBpm);
                if (currentSong) {
                  const updated = { ...currentSong, bpm: newBpm };
                  setCurrentSong(updated);
                  saveSongToDB(updated);
                  setSavedSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
                }
              }}
              videoBgConfig={videoBgConfig}
              onUpdateVideoBgConfig={handleUpdateVideoBgConfig}
              onOpenVocalAutomation={() => setIsVocalAutomationModalOpen(true)}
            />
            <MixerDeck
              vocalGain={vocalGain}
              onVocalGainChange={handleVocalGainChange}
              musicGain={musicGain}
              onMusicGainChange={handleMusicGainChange}
              masterGain={masterGain}
              onMasterGainChange={handleMasterGainChange}
              pitchShift={pitchShift}
              onPitchShiftChange={handlePitchShiftChange}
              isMicActive={isMicActive}
              onToggleMic={handleToggleMic}
              micGain={micGain}
              onMicGainChange={handleMicGainChange}
              hasSongLoaded={!!currentSong}
              detectedKey={detectedKey}
              stems={currentSong?.stems}
            />
            {/* ── ACTION BAR: Stems + Video ─────────────────── */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => currentSong && handleDownloadStem(currentSong, 'instrumental')}
                disabled={!currentSong?.stems?.instrumentalBlob}
                className="flex flex-col items-center gap-1 py-3 px-2 rounded-xl border border-emerald-500/40 bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
                title="Descargar Pista Karaoke WAV"
              >
                <span className="text-base">⬇</span>
                <span className="text-xs font-bold uppercase tracking-wider">PISTA KARAOKE</span>
                <span className="text-[10px] text-emerald-400/70">WAV Calidad Máster</span>
              </button>

              <button
                onClick={() => setIsVideoStudioOpen(true)}
                className="flex flex-col items-center gap-1 py-3 px-2 rounded-xl border border-indigo-500/60 bg-indigo-950/60 hover:bg-indigo-900/80 text-white cursor-pointer transition-all shadow-md"
                title="Generar Video Karaoke HD"
              >
                <span className="text-base">✨</span>
                <span className="text-xs font-bold uppercase tracking-wider">ESTUDIO DE VIDEO</span>
                <span className="text-[10px] text-indigo-300/70">Video MP4 / WEBM HD</span>
              </button>

              <button
                onClick={() => currentSong && handleDownloadStem(currentSong, 'vocals')}
                disabled={!currentSong?.stems?.vocalsBlob}
                className="flex flex-col items-center gap-1 py-3 px-2 rounded-xl border border-purple-500/40 bg-purple-950/40 hover:bg-purple-900/60 text-purple-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
                title="Descargar Vocales Aisladas WAV"
              >
                <span className="text-base">⬇</span>
                <span className="text-xs font-bold uppercase tracking-wider">VOCALES AI</span>
                <span className="text-[10px] text-purple-400/70">WAV Aislado</span>
              </button>
            </div>
          </div>

          {/* Right: Upload + Library */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            <SongLibrary
              savedSongs={savedSongs}
              currentSongId={currentSong?.id}
              queue={queue}
              onFilesSelected={handleFilesSelected}
              onSelectSong={handleSelectSongForPlayback}
              onDeleteSong={handleDeleteSong}
              onAddToQueue={handleAddToQueue}
              onDownloadStem={handleDownloadStem}
              onUpdateSong={handleUpdateSong}
              onReanalyzeSong={handleReanalyzeSong}
              onOpenPublishModal={handleOpenShareModal}
              isProcessingUpload={directUploadProgress.isProcessing}
              uploadProgress={directUploadProgress.progress}
              uploadStep={directUploadProgress.step}
              uploadFileName={directUploadProgress.fileName}
              uploadCurrentIndex={directUploadProgress.currentIndex}
              uploadTotalCount={directUploadProgress.totalCount}
              profiles={profiles}
              activeProfileId={activeProfileId}
              onSelectProfile={handleSelectProfile}
              onCreateProfile={handleCreateProfile}
              onDeleteProfile={handleDeleteProfile}
              onToggleFavoriteSong={handleToggleFavoriteSong}
              onOpenYouTubeModal={handleOpenYouTubeModalCallback}
              youtubeFavorites={youtubeFavorites}
              onToggleYouTubeFavorite={handleToggleYouTubeFavorite}
              onOpenYouTubeEmbed={handleOpenYouTubeEmbedCallback}
              onRestoreLibrary={handleRestoreLibraryCallback}
            />
          </div>
        </div>
      </main>

      {/* Fullscreen Party Mode */}
      <FullscreenPartyModal
        isOpen={isPartyMode}
        onClose={() => setIsPartyMode(false)}
        lyrics={lyrics}
        currentLyric={currentLyric}
        currentIndex={currentIndex}
        currentTime={currentTime}
        duration={duration}
        onSeek={handleSeek}
        songTitle={currentSong?.title || 'CYBER TRACK'}
        songArtist={currentSong?.artist}
        artists={currentSong?.artistsList}
        isPlaying={isPlaying}
        onTogglePlay={() => (isPlaying ? handlePause() : handlePlay())}
        vocalGain={vocalGain}
        onVocalGainChange={handleVocalGainChange}
        isSmartVocalCue={isSmartVocalCue}
        activeCueType={activeCueType}
        onToggleSmartVocalCue={() => {
          setIsSmartVocalCue((prev) => {
            const next = !prev;
            if (next) {
              handleVocalGainChange(0.0);
              setIsDuetMode(false);
            } else {
              setActiveCueType(null);
              audioEngine.setVocalGain(vocalGain);
            }
            return next;
          });
        }}
        bpm={bpm}
        syncDelay={syncDelay}
        onUpdateSyncDelay={handleUpdateSyncDelay}
        isDuetMode={isDuetMode}
        onToggleDuetMode={() => {
          setIsDuetMode((prev) => {
            const next = !prev;
            if (next) {
              setIsSmartVocalCue(false);
              handleVocalGainChange(0.0);
              setActiveCueType(null);
            }
            if (currentSong) {
              const updated: SongItem = { ...currentSong, isDuet: next, updatedAt: Date.now() };
              setCurrentSong(updated);
              saveSongToDB(updated);
              setSavedSongs((prevList) => prevList.map((s) => (s.id === updated.id ? updated : s)));
            }
            return next;
          });
        }}
        activeSingerName={activeProfile && activeProfile.id !== 'profile_all' ? activeProfile.name : undefined}
        activeSingerAvatar={activeProfile && activeProfile.id !== 'profile_all' ? activeProfile.avatar : undefined}
        videoBgConfig={videoBgConfig}
        onUpdateVideoBgConfig={handleUpdateVideoBgConfig}
      />

      {/* AI Karaoke Video Studio */}
      <LyricalVideoModal
        isOpen={isVideoStudioOpen}
        onClose={() => setIsVideoStudioOpen(false)}
        song={currentSong}
        lyrics={lyrics}
        duration={duration}
      />

      {/* ── Karaoke Performance Scoring & Next Song 5s Countdown Transition ── */}
      <KaraokeScoreAndTransitionModal
        isOpen={scoreModalState.isOpen}
        mode={scoreModalState.mode}
        performance={scoreModalState.performance}
        nextSong={scoreModalState.nextSong}
        nextSinger={scoreModalState.nextSinger}
        onStartNextSong={handleStartNextSongFromModal}
        onSkipNextSong={handleSkipNextSongFromModal}
        onClose={() => {
          setScoreModalState((prev) => ({ ...prev, isOpen: false }));
          if (!scoreModalState.nextSong) {
            handleStop();
          }
        }}
      />

      {/* ── YouTube Hybrid Search & Favorites Modal ── */}
      <YouTubeModal
        isOpen={isYouTubeModalOpen}
        onClose={() => {
          setIsYouTubeModalOpen(false);
          setYouTubeEmbedId(null);
        }}
        youtubeFavorites={youtubeFavorites}
        onToggleYouTubeFavorite={handleToggleYouTubeFavorite}
        profiles={profiles}
        activeProfileId={activeProfileId}
        initialEmbedId={youTubeEmbedId}
      />

      {/* ── Chromecast / AirPlay Dual Screen TV Cast Modal ── */}
      <CastTvModal
        isOpen={isCastModalOpen}
        onClose={() => setIsCastModalOpen(false)}
        songTitle={currentSong?.title || ''}
        songArtist={currentSong?.artist}
        isPlaying={isPlaying}
        isCastingActive={isCastingActive}
        onToggleCasting={(active) => setIsCastingActive(active)}
        hostPeerId={hostPeerId}
      />

      {/* ── Party QR Code Guest Song Request Modal ── */}
      <QrCodeModal
        isOpen={isQrModalOpen}
        hostPeerId={hostPeerId}
        onClose={() => setIsQrModalOpen(false)}
      />

      {/* ── DSP Audio Latency & Hardware Settings Modal ── */}
      <DspSettingsModal
        isOpen={isDspModalOpen}
        onClose={() => setIsDspModalOpen(false)}
        syncDelay={syncDelay}
        onUpdateSyncDelay={handleUpdateSyncDelay}
      />

      {/* ── Modal de Información del Sistema / About (Gino El Arquitecto) ── */}
      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
      />

      {/* ── Modal de Compartir Canciones (Google Drive, HTML, Web, Links) ── */}
      <ShareSongModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        savedSongs={savedSongs}
        currentSong={shareTargetSong || currentSong}
        currentLyrics={lyrics}
        profiles={profiles}
        syncTargetFolder={syncTargetFolder}
      />

      {/* ── Editor de Automatización de Voz Guía Modal (Timeline & Waveform) ── */}
      {currentSong && (
        <VocalAutomationModal
          isOpen={isVocalAutomationModalOpen}
          onClose={() => setIsVocalAutomationModalOpen(false)}
          song={currentSong}
          currentTime={currentTime}
          duration={duration}
          lyrics={lyrics}
          onSaveAutomation={handleSaveVocalAutomation}
          onSeek={handleSeek}
          isPlaying={isPlaying}
          onPlay={handlePlay}
          onPause={handlePause}
        />
      )}

      {/* ── Modal de Confirmación de Limpieza de Caché ── */}
      {isClearCacheModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200 pointer-events-auto">
          <div className="w-full max-w-md bg-slate-900 border border-rose-500/50 rounded-2xl p-6 shadow-[0_0_50px_rgba(244,63,94,0.3)] flex flex-col gap-4 text-center">
            <div className="w-14 h-14 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto text-2xl border border-rose-500/40">
              🗑️
            </div>
            <div>
              <h3 className="text-lg font-black text-white">¿Limpiar todo el Caché?</h3>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Esta acción eliminará todas las canciones guardadas en el almacenamiento local e IndexedDB, reiniciando la biblioteca de KaraokeLab Studio.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 mt-2">
              <button
                onClick={() => setIsClearCacheModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold border border-slate-700 cursor-pointer transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleExecuteClearCache}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 hover:brightness-110 text-white text-xs font-black shadow-[0_0_20px_rgba(244,63,94,0.4)] cursor-pointer transition-all"
              >
                Sí, Borrar Todo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Visual Drag & Drop Overlay ── */}
      {isWindowDragging && (
        <div className="fixed inset-0 z-[100] bg-[#05060a]/85 backdrop-blur-md border-4 border-dashed border-[#00f0ff] rounded-3xl m-4 flex flex-col items-center justify-center pointer-events-none animate-in fade-in zoom-in-95 duration-200">
          <div className="w-24 h-24 rounded-full bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/50 flex items-center justify-center text-4xl mb-4 animate-bounce shadow-[0_0_50px_rgba(0,240,255,0.4)]">
            🎵
          </div>
          <h2 className="text-2xl font-black text-white uppercase tracking-widest text-shadow-neon">
            Suelta tus canciones aquí
          </h2>
          <p className="text-sm text-cyan-300 font-medium mt-2">
            MP3, WAV, FLAC, M4A o archivos LRC para procesar con IA
          </p>
        </div>
      )}

      {/* ── Global Alert Warning Toast ── */}
      {alertToast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-3 duration-300 pointer-events-auto">
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-950/95 border border-amber-500/80 rounded-xl text-amber-200 text-xs font-bold shadow-[0_0_25px_rgba(245,158,11,0.35)] backdrop-blur-md">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 animate-bounce" />
            <span>{alertToast}</span>
            <button
              onClick={() => setAlertToast(null)}
              className="ml-2 text-amber-400 hover:text-white p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
