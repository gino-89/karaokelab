import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SongItem, QueueItem, LyricLine, SingerProfile, YouTubeFavoriteTrack, VideoBackgroundConfig, VocalAutomationConfig, ChatMessage } from './types';
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
import { AlertCircle, X, MessageSquare, Send, MessageCircle } from 'lucide-react';
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
  const queueRef = useRef<QueueItem[]>(queue);
  queueRef.current = queue;
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
    peerSync.broadcastProfilesToGuests(updated);
    setActiveProfileId(newProfile.id);
    setActiveProfileIdToStorage(newProfile.id);
  };

  const handleDeleteProfile = (id: string) => {
    if (id === 'profile_all') return;
    const updated = profiles.filter((p) => p.id !== id);
    setProfiles(updated);
    saveProfilesToStorage(updated);
    peerSync.broadcastProfilesToGuests(updated);
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
      peerSync.broadcastProfilesToGuests(updated);
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

  // ── Room Live Chat States ──
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [unreadByProfile, setUnreadByProfile] = useState<Record<string, number>>({});
  const [hostChatText, setHostChatText] = useState('');
  const [liveChatBanner, setLiveChatBanner] = useState<ChatMessage | null>(null);
  const [selectedChatProfileId, setSelectedChatProfileId] = useState<string | null>(null);
  const hostChatMessagesEndRef = useRef<HTMLDivElement | null>(null);

  const handleSelectChatProfile = (profId: string) => {
    setSelectedChatProfileId(profId);
    const prof = profiles.find((p) => p.id === profId);
    const count = unreadByProfile[profId] || (prof?.name ? unreadByProfile[prof.name] : 0) || 0;
    if (count > 0) {
      setUnreadByProfile((prev) => {
        const next = { ...prev };
        delete next[profId];
        if (prof?.name) delete next[prof.name];
        return next;
      });
      setUnreadChatCount((prev) => Math.max(0, prev - count));
    }
  };

  useEffect(() => {
    if (isChatOpen && selectedChatProfileId) {
      setTimeout(() => {
        hostChatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 60);
    }
  }, [chatMessages, isChatOpen, selectedChatProfileId]);

  const handleSendHostChatMessage = (text: string, targetProfId?: string) => {
    if (!text.trim()) return;
    const activeTargetId = targetProfId || selectedChatProfileId || undefined;
    const msg: ChatMessage = {
      id: `msg_host_${Date.now()}`,
      senderName: 'Host / DJ 🎧',
      targetProfileId: activeTargetId,
      text: text.trim(),
      timestamp: Date.now(),
      avatar: '🎧',
      color: '#ff007f',
      isHost: true,
    };
    setChatMessages((prev) => [...prev, msg]);
    peerSync.broadcastChatMessageToGuests(msg);
    setHostChatText('');
  };

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
      const recentRequestsRef = new Map<string, number>();

      const handleRemoteRequest = (data: any) => {
        if (!data) return;
        const { id, title, artist, isYouTube, videoId, guestName, requestId } = data;
        const who = guestName || 'Invitado';
        const dedupeKey = requestId || (isYouTube ? `yt_${videoId}` : (id || title));
        const now = Date.now();

        // Drop duplicate network/channel requests arriving within 3 seconds
        if (dedupeKey && recentRequestsRef.has(dedupeKey)) {
          const lastTime = recentRequestsRef.get(dedupeKey)!;
          if (now - lastTime < 3000) {
            return;
          }
        }
        if (dedupeKey) {
          recentRequestsRef.set(dedupeKey, now);
        }

        const isYt = isYouTube || (typeof id === 'string' && id.startsWith('yt_')) || !!data.videoBgId;
        const effectiveVideoId = videoId || data.videoBgId || (typeof id === 'string' && id.startsWith('yt_') ? id.replace('yt_', '') : null);

        if (isYt && effectiveVideoId) {
          const ytTitle = title || 'Video de YouTube';
          const ytArtist = artist || 'YouTube';

          setQueue((prev) => {
            if (prev.some((q) => q.songData?.id === `yt_${effectiveVideoId}` || q.songData?.videoBgId === effectiveVideoId || q.id.includes(effectiveVideoId))) {
              showAlertToast(`ℹ️ "${ytTitle}" ya está en la cola.`);
              return prev;
            }

            const newItem: QueueItem = {
              id: `queue_yt_${effectiveVideoId}_${Date.now()}`,
              fileName: `🎬 [YouTube] ${ytTitle}`,
              status: 'ready',
              progress: 100,
              requestedBy: who,
              songData: {
                id: `yt_${effectiveVideoId}`,
                title: ytTitle,
                artist: ytArtist,
                duration: 240,
                bpm: 120,
                key: 'C',
                lyrics: [],
                originalFileName: `${ytTitle}.mp4`,
                videoBgId: effectiveVideoId,
                videoBgMode: 'custom',
                videoBgCustomUrl: `https://www.youtube.com/watch?v=${effectiveVideoId}`,
                createdAt: Date.now(),
              },
            };

            showAlertToast(`🎬 ${who} pidió "${ytTitle}" de YouTube · Agregada a la cola`);
            return [...prev, newItem];
          });
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
          setQueue((prev) => {
            if (prev.some((q) => q.songData?.id === matchedSong.id || q.id.includes(matchedSong.id))) {
              showAlertToast(`ℹ️ "${matchedSong.title}" ya está en la cola.`);
              return prev;
            }

            const newItem: QueueItem = {
              id: `queue_remote_${matchedSong.id}_${Date.now()}`,
              fileName: `${matchedSong.title}${matchedSong.artist ? ' - ' + matchedSong.artist : ''}`,
              status: 'ready',
              progress: 100,
              requestedBy: who,
              songData: matchedSong,
            };

            showAlertToast(`🎤 ${who} pidió "${matchedSong.title}" · Agregada a la cola`);
            return [...prev, newItem];
          });
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
              const prof = profiles.find((p) => p.id === data.profileId);
              if (prof && prof.id !== 'profile_all') {
                showAlertToast(`⭐ "${data.track.title}" asignado a ${prof.name}`);
              }
            }
          } else if (cmd === 'CHAT_MESSAGE') {
            if (data?.text) {
              const msg: ChatMessage = {
                id: data.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
                senderName: data.senderName || 'Invitado',
                senderProfileId: data.senderProfileId,
                text: data.text.trim(),
                timestamp: data.timestamp || Date.now(),
                avatar: data.avatar || '💬',
                color: data.color || '#00f0ff',
                isHost: !!data.isHost,
              };
              setChatMessages((prev) => {
                if (prev.some((m) => m.id === msg.id)) return prev;
                return [...prev, msg];
              });
              setLiveChatBanner(msg);
              setTimeout(() => setLiveChatBanner((curr) => (curr?.id === msg.id ? null : curr)), 6000);
              const senderKey = msg.senderProfileId || msg.senderName;
              if (!isChatOpen || selectedChatProfileId !== senderKey) {
                setUnreadByProfile((prev) => ({
                  ...prev,
                  [senderKey]: (prev[senderKey] || 0) + 1,
                }));
                setUnreadChatCount((prev) => prev + 1);
              }
              peerSync.broadcastChatMessageToGuests(msg);
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

  // Broadcast state in real-time to external TV window / Chromecast (Ultra-lightweight Delta Sync)
  const lastBroadcastRef = useRef<number>(0);
  const lastFullSyncRef = useRef<number>(0);
  const lastSongIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isTvDisplayMode && !isGuestMode) {
      const now = performance.now();
      const isNewSong = currentSong?.id !== lastSongIdRef.current;
      const isFullSyncNeeded = isNewSong || (now - lastFullSyncRef.current >= 2500) || !isPlaying;

      // Broadcast every 60ms-80ms for ultra-smooth lyric tracking
      if (now - lastBroadcastRef.current >= 60 || isNewSong || !isPlaying) {
        lastBroadcastRef.current = now;
        const activeProf = profiles.find((p) => p.id === activeProfileId);
        const nextQueueItem = queue[0];

        if (isFullSyncNeeded) {
          lastFullSyncRef.current = now;
          lastSongIdRef.current = currentSong?.id || null;

          // Full state payload (sent on song change, play/pause, or periodic 2.5s heartbeat)
          const fullPayload = {
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
            nextSongTitle: nextQueueItem?.songData?.title || (nextQueueItem?.fileName ? nextQueueItem.fileName.replace(/^🎬\s*\[YouTube\]\s*/, '') : undefined),
            nextSongArtist: nextQueueItem?.songData?.artist,
            nextSongRequestedBy: nextQueueItem?.requestedBy,
            bpm: currentSong?.bpm || 120,
            isDuetMode,
            youTubeEmbedId,
            videoBgConfig,
            timestamp: Date.now(),
            isTick: false,
          };
          tvBroadcast.broadcastState(fullPayload);
          peerSync.broadcastTvState(fullPayload);
        } else {
          // Ultra-lightweight delta tick (only 4 small numbers, zero CPU/crypto/bandwidth overhead)
          const tickPayload = {
            currentTime,
            duration,
            isPlaying,
            currentIndex,
            timestamp: Date.now(),
            isTick: true,
          };
          tvBroadcast.broadcastState(tickPayload);
          peerSync.broadcastTvState(tickPayload);
        }
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
    queue,
    isDuetMode,
    youTubeEmbedId,
    videoBgConfig,
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

  // ── Global 1-Tap: CSS touch-action:manipulation (in index.css) eliminates the 300ms iOS tap delay.
  // We do NOT add any synthetic click() calls here — those duplicate React's own event handlers
  // and cause double-fires or blocked taps during playback re-renders.
  // The only thing needed is unlocking the AudioContext on first user gesture.

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

  // 2. High-precision audio playback position tracker with Smart Vocal Cues (Hybrid rAF + Background Interval)
  useEffect(() => {
    let animId: number | null = null;
    let intervalId: any = null;
    let lastFlushTime = 0;

    const tick = (timestamp = performance.now()) => {
      if (audioEngine.getIsPlaying()) {
        const t = audioEngine.getCurrentTime();

        // Throttle React root state re-renders to ~25 FPS (~40ms) so WebKit touch events are never dropped or starved
        if (timestamp - lastFlushTime >= 40) {
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

        // Evaluate Vocal Playback Modes in real-time Web Audio graph:
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
      } else if (isPlaying && youTubeEmbedId) {
        if (lastFlushTime === 0) {
          lastFlushTime = timestamp;
        }
        if (timestamp - lastFlushTime >= 80) {
          const delta = (timestamp - lastFlushTime) / 1000;
          lastFlushTime = timestamp;
          setCurrentTime((prev) => prev + delta);
        }
      } else {
        lastFlushTime = 0;
      }
    };

    // 1. Foreground smooth animation loop
    const rAfLoop = (time: number) => {
      tick(time);
      animId = requestAnimationFrame(rAfLoop);
    };
    animId = requestAnimationFrame(rAfLoop);

    // 2. Background resilient fallback interval (continues updating and broadcasting TV state when tab is hidden/switched)
    intervalId = setInterval(() => {
      if (document.hidden && audioEngine.getIsPlaying()) {
        tick(performance.now());
      }
    }, 40);

    return () => {
      if (animId) cancelAnimationFrame(animId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [lyrics, isSmartVocalCue, smartCues, vocalGain, isPlaying, youTubeEmbedId]);

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
        const cleanVidId = vidId.replace('yt_', '');
        setYouTubeEmbedId(vidId);
        setIsYouTubeModalOpen(false);
        setCurrentSong(song);
        setIsPlaying(true);
        setDuration(song.duration || 240);
        setCurrentTime(0);
        setLyrics([]);
        // Cleanly remove this YouTube song from the waiting queue
        setQueue((prevQueue) =>
          prevQueue.filter((q) => {
            const qClean = q.songData?.id ? q.songData.id.replace('yt_', '') : q.id.replace('yt_', '');
            return q.id !== song.id && q.songData?.id !== song.id && qClean !== cleanVidId;
          })
        );
        showAlertToast(`🎬 Reproduciendo video de YouTube: "${song.title}"`);
        return;
      }

      setYouTubeEmbedId(null);

      if (song.stems?.instrumentalBlob) {
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
      // and does NOT appear duplicated or reappear later in the queue list!
      const cleanUpdatedId = updatedSong.id.replace('yt_', '');
      setQueue((prevQueue) =>
        prevQueue.filter((q) => {
          const qClean = q.songData?.id ? q.songData.id.replace('yt_', '') : q.id.replace('yt_', '');
          return q.id !== updatedSong.id && q.songData?.id !== updatedSong.id && qClean !== cleanUpdatedId;
        })
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
    setQueue((prev) => {
      if (prev.some((q) => q.songData?.id === song.id || q.id === song.id || (q.songData?.title && q.songData.title.toLowerCase() === song.title.toLowerCase() && q.songData.artist === song.artist))) {
        showAlertToast(`ℹ️ "${song.title}" ya está en la cola.`);
        return prev;
      }
      const newItem: QueueItem = {
        id: `queue_lib_${song.id}_${Date.now()}`,
        fileName: `${song.title}${song.artist ? ' - ' + song.artist : ''}`,
        status: 'ready',
        progress: 100,
        songData: song,
      };
      showAlertToast(`➕ "${song.title}" agregada a la cola`);
      return [...prev, newItem];
    });
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
  const handleNextInQueue = useCallback(() => {
    const curSong = currentSong;
    const curId = curSong?.id;
    const cleanCurId = curId ? curId.replace(/^yt_/, '') : null;

    const currentQueue = queueRef.current;

    // Find the first ready item in queue that is NOT the finished song
    const nextItem = currentQueue.find((q) => {
      if (q.status !== 'ready' || !q.songData) return false;
      if (!cleanCurId) return true;
      const cleanQId = q.songData.id.replace(/^yt_/, '');
      return cleanQId !== cleanCurId && q.id !== curId && q.songData.id !== curId;
    });

    // Remove the finished song and next song from the queue immediately
    setQueue((prevQueue) =>
      prevQueue.filter((q) => {
        const qClean = q.songData?.id ? q.songData.id.replace(/^yt_/, '') : q.id.replace(/^yt_/, '');
        if (cleanCurId && (q.id === curId || q.songData?.id === curId || qClean === cleanCurId)) {
          return false;
        }
        if (nextItem && (q.id === nextItem.id || q.songData?.id === nextItem.songData?.id)) {
          return false;
        }
        return true;
      })
    );

    if (!nextItem || !nextItem.songData) {
      console.log('No next item in queue, clearing player');
      handleStop();
      return;
    }

    // Stop current track and load next song
    audioEngine.stop();
    setYouTubeEmbedId(null);
    loadSongIntoEngine(nextItem.songData, true);
  }, [currentSong]);

  // Auto-play next song in queue with Score & Countdown Intermission when track ends
  useEffect(() => {
    const unsubscribe = audioEngine.onTrackEnded(() => {
      setIsPlaying(false);
      const finishedSong = currentSong;
      if (!finishedSong) return;

      const curId = finishedSong.id;
      const cleanCurId = curId.replace(/^yt_/, '');

      setQueue((prevQueue) => {
        // Completely purge finished song from queue
        let nextQueue = prevQueue.filter((q) => {
          const qClean = q.songData?.id ? q.songData.id.replace(/^yt_/, '') : q.id.replace(/^yt_/, '');
          return q.id !== curId && q.songData?.id !== curId && qClean !== cleanCurId;
        });

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

    // If it's a YouTube track, just set isPlaying to true (do not reload buffer)
    if (youTubeEmbedId || currentSong.id?.startsWith('yt_') || (currentSong.videoBgId && !currentSong.audioBlob && !currentSong.stems?.instrumentalBlob)) {
      setIsPlaying(true);
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
    setYouTubeEmbedId(null);
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

  const handleTimeUpdate = useCallback((t: number, d?: number) => {
    setCurrentTime(t);
    if (d && d > 0) {
      setDuration(d);
    }
  }, []);

  const handleOpenAboutModal = useCallback(() => setIsAboutModalOpen(true), []);
  const handleOpenPartyMode = useCallback(() => setIsPartyMode(true), []);
  const handleOpenVideoStudio = useCallback(() => setIsVideoStudioOpen(true), []);
  const handleOpenCastModal = useCallback(() => setIsCastModalOpen(true), []);
  const handleOpenQrModal = useCallback(() => setIsQrModalOpen(true), []);
  const handleOpenDspSettings = useCallback(() => setIsDspModalOpen(true), []);
  const handleOpenShareModalCallback = useCallback(() => handleOpenShareModal(), [handleOpenShareModal]);
  const handleClearCacheCallback = useCallback(() => setIsClearCacheModalOpen(true), []);

  const handleVocalGainChange = useCallback((val: number) => {
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
  }, [currentSong]);

  const handleMusicGainChange = useCallback((val: number) => {
    setMusicGain(val);
    audioEngine.setMusicGain(val);
  }, []);

  const handleMasterGainChange = useCallback((val: number) => {
    setMasterGain(val);
    audioEngine.setMasterGain(val);
  }, []);

  const handlePitchShiftChange = useCallback((semitones: number) => {
    setPitchShift(semitones);
    audioEngine.setPitchShift(semitones);
  }, []);

  const handleToggleLoop = useCallback(() => {
    setIsLooping((prev) => {
      const next = !prev;
      audioEngine.setLoop(next, 0, duration);
      return next;
    });
  }, [duration]);

  const handleToggleMic = useCallback(async () => {
    setIsMicActive((prev) => {
      const next = !prev;
      audioEngine.enableMicrophone(next).then((active) => {
        setIsMicActive(active);
        if (active) {
          const ctx = audioEngine.getAudioContext();
          const micGainNode = audioEngine.getMicGainNode();
          if (micGainNode) {
            karaokeScoringTracker.init(ctx, micGainNode);
          }
        }
      });
      return prev;
    });
  }, []);

  const handleMicGainChange = useCallback((val: number) => {
    setMicGain(val);
    audioEngine.setMicGain(val);
  }, []);

  const handleDeleteSong = useCallback(async (id: string) => {
    await deleteSongFromDB(id);
    invalidateVocalProfileCache();
    setSavedSongs((prev) => prev.filter((s) => s.id !== id));
    setQueue((prev) => prev.filter((q) => q.songData?.id !== id && q.id !== id));
    if (currentSong?.id === id) {
      handleStop();
      setCurrentSong(null);
    }
  }, [currentSong?.id, handleStop]);

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
    setQueue((prevQueue) =>
      prevQueue.filter(
        (q) =>
          q.songData?.id !== song.id &&
          q.id !== song.id &&
          (!song.id.startsWith('yt_') || q.songData?.id !== `yt_${song.id.replace('yt_', '')}`)
      )
    );
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
      {isPartyMode && currentSong && videoBgConfig.enabled && videoBgConfig.mode !== 'off' && videoBgConfig.videoId && (
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
        onOpenAboutModal={handleOpenAboutModal}
        onOpenPartyMode={handleOpenPartyMode}
        onOpenVideoStudio={handleOpenVideoStudio}
        onOpenCastModal={handleOpenCastModal}
        onOpenQrModal={handleOpenQrModal}
        onOpenChatModal={() => {
          setIsChatOpen(true);
          setUnreadChatCount(0);
        }}
        unreadChatCount={unreadChatCount}
        onOpenDspSettings={handleOpenDspSettings}
        onOpenShareModal={handleOpenShareModalCallback}
        onOpenPublishModal={handleOpenShareModalCallback}
        onSyncToFolder={handle1ClickSync}
        onChangeSyncFolder={handleChangeSyncFolder}
        onImportSyncedFolder={handleImportSyncedFolder}
        isFolderSyncing={isFolderSyncing}
        syncTargetFolder={syncTargetFolder}
        onClearCache={handleClearCacheCallback}
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
              youTubeEmbedId={youTubeEmbedId}
              bpm={bpm}
              detectedKey={detectedKey}
              stems={currentSong?.stems}
              audioBlob={currentSong?.audioBlob}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={handleStop}
              onSeek={handleSeek}
              onTimeUpdate={handleTimeUpdate}
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

      {/* ── Live Room Chat Pop-up Toast Banner ── */}
      {liveChatBanner && (
        <div className="fixed top-16 right-6 z-50 animate-in slide-in-from-top-4 fade-in duration-300 pointer-events-auto">
          <div
            onClick={() => {
              setIsChatOpen(true);
              if (liveChatBanner.senderProfileId) {
                setSelectedChatProfileId(liveChatBanner.senderProfileId);
              }
              setUnreadChatCount(0);
              setLiveChatBanner(null);
            }}
            className="px-4 py-3 rounded-2xl bg-[#0c0d1a]/95 border border-pink-500/60 shadow-[0_0_30px_rgba(255,0,127,0.35)] flex items-center gap-3 max-w-sm backdrop-blur-md cursor-pointer hover:scale-105 transition-all"
          >
            <span className="text-2xl shrink-0">{liveChatBanner.avatar || '💬'}</span>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-pink-300 truncate">
                  {liveChatBanner.senderName}
                </span>
                <span className="text-[9px] text-slate-400 font-mono shrink-0">
                  {new Date(liveChatBanner.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-xs text-white font-medium line-clamp-2 leading-snug mt-0.5">
                {liveChatBanner.text}
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLiveChatBanner(null);
              }}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── WhatsApp / Cyberpunk Room Chat Side Drawer (Private 1-on-1 Chats) ── */}
      {isChatOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
          <div className="w-full max-w-2xl bg-[#090a14] border-l border-pink-500/40 h-full flex shadow-[0_0_50px_rgba(255,0,127,0.25)] overflow-hidden">
            {/* Left Column: Contact / Conversation Threads List */}
            <div className="w-64 border-r border-slate-800 bg-[#0c0d1b] flex flex-col h-full shrink-0">
              <div className="p-3.5 border-b border-slate-800 bg-[#0e0f21] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-pink-400" />
                  <h3 className="text-xs font-black text-white uppercase tracking-wider">Conversaciones</h3>
                </div>
                <span className="text-[10px] font-mono text-pink-300 font-bold px-1.5 py-0.5 rounded bg-pink-950/60 border border-pink-500/30">
                  {profiles.filter((p) => p.id !== 'profile_all').length}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-1 p-2 scrollbar-thin">
                {profiles.filter((p) => p.id !== 'profile_all').length === 0 ? (
                  <div className="p-4 text-center text-slate-500 text-xs leading-relaxed">
                    No hay cantantes o perfiles creados aún.
                  </div>
                ) : (
                  profiles
                    .filter((p) => p.id !== 'profile_all')
                    .map((prof) => {
                      const isSelected = selectedChatProfileId === prof.id;
                      const unreadCount = unreadByProfile[prof.id] || unreadByProfile[prof.name] || 0;
                      const hasUnread = unreadCount > 0 && !isSelected;

                      const threadMsgs = chatMessages.filter(
                        (m) =>
                          m.senderProfileId === prof.id ||
                          m.targetProfileId === prof.id ||
                          m.senderName === prof.name
                      );
                      const lastMsg = threadMsgs[threadMsgs.length - 1];

                      return (
                        <button
                          key={prof.id}
                          onClick={() => handleSelectChatProfile(prof.id)}
                          className={`w-full p-2.5 rounded-xl flex items-center gap-2.5 text-left transition-all cursor-pointer relative ${
                            isSelected
                              ? 'bg-gradient-to-r from-pink-600/30 to-purple-600/30 border border-pink-500/50 shadow-md'
                              : hasUnread
                              ? 'bg-pink-950/40 border border-pink-500/80 shadow-[0_0_15px_rgba(255,0,127,0.35)] animate-pulse'
                              : 'hover:bg-slate-900 border border-transparent'
                          }`}
                        >
                          <div className={`w-9 h-9 rounded-xl border flex items-center justify-center text-lg shrink-0 shadow-inner relative ${
                            hasUnread ? 'bg-pink-950 border-pink-400 text-pink-300' : 'bg-slate-900 border-slate-700'
                          }`}>
                            {prof.avatar || '🎤'}
                            {hasUnread && (
                              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-pink-500 animate-ping border border-slate-950" />
                            )}
                          </div>
                          <div className="flex flex-col min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className={`text-xs truncate ${hasUnread ? 'font-black text-pink-200' : 'font-bold text-slate-200'}`}>
                                {prof.name}
                              </span>
                              {hasUnread ? (
                                <span className="px-1.5 py-0.2 rounded-full bg-pink-500 text-white font-mono text-[9px] font-black shadow-md animate-bounce shrink-0">
                                  {unreadCount} nuevo{unreadCount > 1 ? 's' : ''}
                                </span>
                              ) : lastMsg ? (
                                <span className="text-[9px] text-slate-500 font-mono shrink-0">
                                  {new Date(lastMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              ) : null}
                            </div>
                            <p className={`text-[10.5px] truncate mt-0.5 ${hasUnread ? 'font-semibold text-pink-300' : 'text-slate-400'}`}>
                              {lastMsg ? lastMsg.text : 'Sin mensajes'}
                            </p>
                          </div>
                        </button>
                      );
                    })
                )}
              </div>
            </div>

            {/* Right Column: Active Private Chat Thread */}
            <div className="flex-1 flex flex-col h-full bg-[#080913]">
              {/* Header */}
              <div className="p-3.5 border-b border-slate-800 bg-[#0e0f21] flex items-center justify-between">
                {selectedChatProfileId ? (
                  (() => {
                    const activeProf = profiles.find((p) => p.id === selectedChatProfileId);
                    return (
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-pink-500 to-purple-600 flex items-center justify-center text-white text-lg font-black shadow-md">
                          {activeProf?.avatar || '👤'}
                        </div>
                        <div>
                          <h3 className="text-xs font-black text-white uppercase tracking-wider">
                            Chat Privado con {activeProf?.name || 'Cantante'}
                          </h3>
                          <p className="text-[10px] text-emerald-400 font-mono">
                            ● Mensajes directos en vivo
                          </p>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-pink-400" />
                    <h3 className="text-xs font-black text-white uppercase tracking-wider">
                      Selecciona un Cantante para Chatear
                    </h3>
                  </div>
                )}

                <button
                  onClick={() => setIsChatOpen(false)}
                  className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Message History */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 scrollbar-thin">
                {!selectedChatProfileId ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 gap-2 p-4">
                    <MessageSquare className="w-12 h-12 text-pink-500/30" />
                    <p className="text-xs font-bold text-slate-300">Selecciona un cantante de la lista</p>
                    <p className="text-[11px] text-slate-500 max-w-xs">
                      Haz clic en cualquiera de los cantantes conectados a la izquierda para chatear en privado con él.
                    </p>
                  </div>
                ) : (
                  (() => {
                    const activeProf = profiles.find((p) => p.id === selectedChatProfileId);
                    const threadMsgs = chatMessages.filter(
                      (m) =>
                        m.senderProfileId === selectedChatProfileId ||
                        m.targetProfileId === selectedChatProfileId ||
                        m.senderName === activeProf?.name
                    );

                    if (threadMsgs.length === 0) {
                      return (
                        <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 gap-2 p-4">
                          <MessageSquare className="w-10 h-10 text-pink-500/20" />
                          <p className="text-xs font-bold text-slate-400">Sin mensajes con {activeProf?.name}</p>
                          <p className="text-[11px] text-slate-500 max-w-xs">
                            Envía un saludo o responde a sus pedidos de canciones directamente aquí.
                          </p>
                        </div>
                      );
                    }

                    return threadMsgs.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${msg.isHost ? 'items-end' : 'items-start'}`}
                      >
                        <div className="flex items-center gap-1.5 mb-1 px-1">
                          <span className="text-xs">{msg.avatar || (msg.isHost ? '🎧' : '🎤')}</span>
                          <span
                            className={`text-[10px] font-bold ${
                              msg.isHost ? 'text-pink-400' : 'text-cyan-300'
                            }`}
                          >
                            {msg.senderName}
                          </span>
                          <span className="text-[9px] text-slate-500 font-mono">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        <div
                          className={`px-3.5 py-2.5 rounded-2xl max-w-[85%] text-xs font-medium leading-relaxed shadow-md ${
                            msg.isHost
                              ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white rounded-tr-none'
                              : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-none'
                          }`}
                        >
                          {msg.text}
                        </div>
                      </div>
                    ));
                  })()
                )}
                <div ref={hostChatMessagesEndRef} />
              </div>

              {/* Input Bar */}
              {selectedChatProfileId && (
                <div className="p-3 border-t border-slate-800 bg-[#0d0e1d] flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                    {['🎤', '🔥', '👏', '🥳', '❤️', '🍻', '🎉', '🎧', '⚡'].map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => handleSendHostChatMessage(`${emoji}`, selectedChatProfileId)}
                        className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-pink-500/50 text-sm cursor-pointer transition-all shrink-0 hover:scale-110 active:scale-95"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder={`Escribe un mensaje privado para ${profiles.find((p) => p.id === selectedChatProfileId)?.name || 'el cantante'}...`}
                      value={hostChatText}
                      onChange={(e) => setHostChatText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && hostChatText.trim()) {
                          handleSendHostChatMessage(hostChatText, selectedChatProfileId);
                        }
                      }}
                      className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-pink-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleSendHostChatMessage(hostChatText, selectedChatProfileId)}
                      disabled={!hostChatText.trim()}
                      className="p-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 disabled:opacity-40 text-white text-xs font-black cursor-pointer shadow-md hover:scale-105 active:scale-95 transition-all"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ── Floating Main Host Chat Button (Bottom-Left) ── */}
      <button
        type="button"
        onClick={() => {
          setIsChatOpen((prev) => !prev);
          setUnreadChatCount(0);
        }}
        className={`fixed bottom-6 left-6 z-40 w-16 h-16 sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center border-2 transition-all cursor-pointer shadow-[0_0_35px_rgba(255,0,127,0.4)] hover:scale-110 active:scale-95 ${
          unreadChatCount > 0
            ? 'bg-gradient-to-tr from-pink-600 via-purple-600 to-pink-500 text-white border-pink-300 shadow-[0_0_40px_rgba(255,0,127,0.85)] animate-pulse ring-4 ring-pink-500/50'
            : 'bg-[#0a0b18]/95 text-pink-300 border-pink-500/60 hover:border-pink-400 hover:text-white backdrop-blur-md'
        }`}
        title="Abrir Chat de la Sala"
      >
        <MessageSquare className={`w-8 h-8 sm:w-10 sm:h-10 ${unreadChatCount > 0 ? 'animate-bounce text-white' : 'text-pink-400'}`} />
        {unreadChatCount > 0 && (
          <span className="absolute -top-2 -right-2 w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-pink-500 text-white font-mono text-xs sm:text-sm font-black flex items-center justify-center animate-bounce border-2 border-slate-950 shadow-xl">
            {unreadChatCount}
          </span>
        )}
      </button>
    </div>
  );
}
