import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { SongItem, SingerProfile, YouTubeFavoriteTrack, ChatMessage } from '../types';
import { getSongsFromDB, getYouTubeFavoritesFromStorage, saveYouTubeFavoritesToStorage, getChatMessagesFromStorage, saveChatMessagesToStorage } from '../services/db';
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
  MessageSquare,
  Send,
  MessageCircle,
  Trash2,
  Lock,
  KeyRound,
} from 'lucide-react';

const GUEST_PROFILE_KEY = 'karaokelab_guest_profiles';
const GUEST_ACTIVE_PROFILE_KEY = 'karaokelab_guest_active_profile';

export const GuestRemoteView: React.FC = () => {
  const [guestName, setGuestName] = useState('');
  const [guestPin, setGuestPin] = useState<string>('');
  const [inputPin, setInputPin] = useState<string>('');
  const [pinChallengeModal, setPinChallengeModal] = useState<{
    show: boolean;
    existingProfile?: SingerProfile;
    targetName: string;
    errorMsg?: string;
  } | null>(null);
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
  const [myProfileId, setMyProfileId] = useState<string>(() => localStorage.getItem('karaokelab_guest_my_profile_id') || '');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [customRequestTitle, setCustomRequestTitle] = useState('');
  const [kickReason, setKickReason] = useState<'kicked' | 'expired_qr' | string>('kicked');

  // Table System State
  const [tableNumber, setTableNumber] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlTable = params.get('table');
      if (urlTable) {
        const formatted = urlTable.toLowerCase().startsWith('mesa') ? urlTable : `Mesa ${urlTable}`;
        localStorage.setItem('karaokelab_guest_table_number', formatted);
        return formatted;
      }
      return localStorage.getItem('karaokelab_guest_table_number') || 'Mesa 1';
    }
    return 'Mesa 1';
  });
  const [isEditTableOpen, setIsEditTableOpen] = useState(false);
  const [tempTableNumber, setTempTableNumber] = useState('');

  // Mobile Room Chat States
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() =>
    getChatMessagesFromStorage('karaokelab_guest_chat_messages')
  );
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInputText, setChatInputText] = useState('');
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);

  // Live Room Queue State & Mis Pedidos modal
  const [roomQueue, setRoomQueue] = useState<any[]>([]);
  const [isMyQueueOpen, setIsMyQueueOpen] = useState(false);

  useEffect(() => {
    const unsub = peerSync.onQueueReceived((queue) => {
      setRoomQueue(queue);
    });
    return () => unsub();
  }, []);



  useEffect(() => {
    const unsub = peerSync.onProfileRejected((payload) => {
      setNameConfirmed(false);
      setGuestPin('');
      setInputPin('');
      localStorage.removeItem('karaokelab_guest_name');
      localStorage.removeItem('karaokelab_guest_pin');
      setFeedback({
        type: 'error',
        message: `⚠️ El nombre "${payload.name}" ya pertenece a otro cliente registrado en la sala con otro PIN. Por favor usa tu PIN correcto o ingresa un nombre diferente (ej. ${payload.name} P., ${payload.name} ${tableNumber}).`,
      });
      setTimeout(() => setFeedback(null), 7000);
    });
    return () => unsub();
  }, [tableNumber]);

  const myQueueItems = useMemo(() => {
    const name = guestName.trim().toLowerCase();
    const table = tableNumber.trim().toLowerCase();
    return roomQueue.filter((q) => {
      if (name && q.requestedBy && q.requestedBy.toLowerCase().trim() === name) return true;
      if (table && q.tableNumber && q.tableNumber.toLowerCase().trim() === table) return true;
      return false;
    });
  }, [roomQueue, guestName, tableNumber]);

  const isSongInMyQueue = useCallback(
    (songId: string, songTitle?: string) => {
      const name = guestName.trim().toLowerCase();
      const table = tableNumber.trim().toLowerCase();
      const sId = String(songId || '');
      const sTitle = (songTitle || '').toLowerCase().trim();

      return roomQueue.some((q) => {
        const isMine =
          !name ||
          (q.requestedBy && q.requestedBy.toLowerCase().trim() === name) ||
          (table && q.tableNumber && q.tableNumber.toLowerCase().trim() === table);
        if (!isMine) return false;

        const qSongId = String(q.songId || q.songData?.id || '');
        if (sId && (qSongId === sId || qSongId === `yt_${sId}` || sId === `yt_${qSongId}` || (q.id && q.id.includes(sId)))) {
          return true;
        }

        if (sTitle) {
          const qTitle = (q.title || q.songData?.title || q.fileName || '').toLowerCase().trim();
          if (qTitle && (qTitle === sTitle || qTitle.includes(sTitle) || sTitle.includes(qTitle))) {
            return true;
          }
        }
        return false;
      });
    },
    [roomQueue, guestName, tableNumber]
  );

  const handleCancelQueueItem = (songId?: string, queueItemId?: string, songTitle?: string) => {
    peerSync.sendRemoveFromQueueFromGuest({
      songId,
      queueItemId,
      songTitle,
      guestName: guestName.trim(),
    });
    setRoomQueue((prev) =>
      prev.filter((q) => {
        if (queueItemId && q.id === queueItemId) return false;
        if (songId && (q.songId === songId || q.songData?.id === songId || q.id.includes(songId))) return false;
        if (songTitle) {
          const qTitle = (q.title || q.songData?.title || q.fileName || '').toLowerCase().trim();
          const targetTitle = songTitle.toLowerCase().trim();
          if (qTitle && (qTitle === targetTitle || qTitle.includes(targetTitle))) return false;
        }
        return true;
      })
    );
    setFeedback({ type: 'success', message: `¡Pedido de "${songTitle || 'canción'}" cancelado! 🗑️` });
    setTimeout(() => setFeedback(null), 3000);
  };

  // Save guest chat messages to localStorage with 12-hour auto TTL pruning
  useEffect(() => {
    saveChatMessagesToStorage('karaokelab_guest_chat_messages', chatMessages);
  }, [chatMessages]);

  useEffect(() => {
    const unsub = peerSync.onChatMessageReceived((msg) => {
      setChatMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      if (!isChatOpen) {
        setUnreadChatCount((prev) => prev + 1);
      }
    });
    return () => unsub();
  }, [isChatOpen]);

  // Auto scroll to bottom of chat when new messages arrive or chat opens
  useEffect(() => {
    if (isChatOpen) {
      setTimeout(() => {
        chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 60);
    }
  }, [chatMessages, isChatOpen]);

  const handleSendGuestChatMessage = (text: string) => {
    if (!text.trim()) return;
    const myName = guestName.trim() || 'Invitado';
    const myProf = profiles.find((p) => p.id === myProfileId);
    const msg: ChatMessage = {
      id: `msg_guest_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      senderName: myName,
      senderProfileId: myProfileId,
      tableNumber: tableNumber,
      text: text.trim(),
      timestamp: Date.now(),
      avatar: myProf?.avatar || '🎤',
      color: myProf?.color || '#00f0ff',
      isHost: false,
    };
    setChatMessages((prev) => [...prev, msg]);
    peerSync.sendChatMessageFromGuest(msg);
    setChatInputText('');
  };

  // Pull-to-Refresh state for mobile devices
  const [pullDistance, setPullDistance] = useState(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const touchStartYRef = useRef(0);
  const isPullingRef = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY <= 5 && !isPullRefreshing) {
      touchStartYRef.current = e.touches[0].clientY;
      isPullingRef.current = true;
    } else {
      isPullingRef.current = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isPullingRef.current || isPullRefreshing) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - touchStartYRef.current;

    if (diff > 0 && window.scrollY <= 5) {
      const distance = Math.min(85, Math.pow(diff, 0.82));
      setPullDistance(distance);
    } else {
      setPullDistance(0);
    }
  };

  const handleTouchEnd = () => {
    if (!isPullingRef.current || isPullRefreshing) return;
    isPullingRef.current = false;

    if (pullDistance >= 55) {
      executePullRefresh();
    } else {
      setPullDistance(0);
    }
  };

  const executePullRefresh = () => {
    setIsPullRefreshing(true);
    setPullDistance(60);

    // Haptic feedback if available on device
    try {
      if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(40);
      }
    } catch (_) {}

    // Clean filters & re-sync with host
    setActiveProfileId('profile_all');
    setCustomRequestTitle('');

    const params = new URLSearchParams(window.location.search);
    const hostParam = params.get('host');
    if (hostParam && peerSync.getConnectionStatus() === 'connected') {
      peerSync.sendGuestName(guestName.trim() || 'Invitado');
    }

    setFeedback({ type: 'success', message: '¡Biblioteca sincronizada y actualizada! 🔄' });

    setTimeout(() => {
      setIsPullRefreshing(false);
      setPullDistance(0);
      setTimeout(() => setFeedback(null), 3000);
    }, 1000);
  };

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
      const savedName = localStorage.getItem('karaokelab_guest_name');
      const savedPin = localStorage.getItem('karaokelab_guest_pin');
      if (savedName && savedPin && savedPin.length === 4) {
        setGuestName(savedName);
        setGuestPin(savedPin);
        setNameConfirmed(true);
      } else {
        setNameConfirmed(false);
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

    setActiveProfileId('profile_all');

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

  useEffect(() => {
    const unsub = peerSync.onProfilesReceived((syncedProfiles) => {
      if (syncedProfiles && Array.isArray(syncedProfiles) && syncedProfiles.length > 0) {
        setProfiles(syncedProfiles);
        saveGuestProfiles(syncedProfiles);
      }
    });
    return () => unsub();
  }, [saveGuestProfiles]);

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
                setProfiles(syncedProfiles);
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

  // Ensure guest's personal profile ID is linked once name is confirmed
  useEffect(() => {
    if (!nameConfirmed || !guestName.trim()) return;
    const trimmed = guestName.trim();
    const existing = profiles.find(
      (p) => p.name.toLowerCase().trim() === trimmed.toLowerCase().trim() && p.id !== 'profile_all'
    );
    if (existing && myProfileId !== existing.id) {
      setMyProfileId(existing.id);
      localStorage.setItem('karaokelab_guest_my_profile_id', existing.id);
    }
  }, [nameConfirmed, guestName, profiles, myProfileId]);

  const handleConfirmName = (overrideName?: string, overridePin?: string) => {
    const trimmed = (overrideName || guestName).trim();
    if (!trimmed) {
      setFeedback({ type: 'error', message: '⚠️ Debes ingresar tu nombre de cantante para entrar.' });
      setTimeout(() => setFeedback(null), 3500);
      return;
    }

    const pinToUse = (overridePin !== undefined ? overridePin : (guestPin || inputPin)).trim();
    if (!pinToUse || pinToUse.length !== 4) {
      setFeedback({ type: 'error', message: '⚠️ Debes ingresar un PIN obligatorio de 4 dígitos para proteger tu perfil (ej. 1234).' });
      setTimeout(() => setFeedback(null), 4000);
      return;
    }

    // Check if profile with this name already exists in room
    const existing = profiles.find(
      (p) => p.name.toLowerCase().trim() === trimmed.toLowerCase().trim() && p.id !== 'profile_all'
    );

    if (existing) {
      if (existing.pin && existing.pin !== pinToUse) {
        setPinChallengeModal({
          show: true,
          existingProfile: existing,
          targetName: trimmed,
          errorMsg: `🔒 El nombre "${trimmed}" ya pertenece a otro cliente registrado en la sala y el PIN ingresado no coincide.`,
        });
        setFeedback({ type: 'error', message: `❌ El PIN ingresado no coincide con el perfil "${trimmed}". Si eres otro cliente, elige un nombre diferente.` });
        setTimeout(() => setFeedback(null), 4500);
        return;
      }

      setGuestName(trimmed);
      setGuestPin(existing.pin || pinToUse);
      localStorage.setItem('karaokelab_guest_name', trimmed);
      localStorage.setItem('karaokelab_guest_pin', existing.pin || pinToUse);
      setMyProfileId(existing.id);
      localStorage.setItem('karaokelab_guest_my_profile_id', existing.id);
      setNameConfirmed(true);
      peerSync.sendGuestName(trimmed, tableNumber, existing.pin || pinToUse);
      setPinChallengeModal(null);
      return;
    }

    setGuestName(trimmed);
    setGuestPin(pinToUse);
    localStorage.setItem('karaokelab_guest_name', trimmed);
    localStorage.setItem('karaokelab_guest_pin', pinToUse);
    setNameConfirmed(true);
    peerSync.sendGuestName(trimmed, tableNumber, pinToUse);
    setPinChallengeModal(null);

    const newProfId = `profile_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newProf: SingerProfile = {
      id: newProfId,
      name: trimmed,
      avatar: '🎤',
      color: '#00f0ff',
      favoriteSongIds: [],
      tableNumber: tableNumber,
      pin: pinToUse,
      createdAt: Date.now(),
    };
    const updated = [...profiles, newProf];
    saveGuestProfiles(updated);
    setMyProfileId(newProfId);
    localStorage.setItem('karaokelab_guest_my_profile_id', newProfId);
    peerSync.sendCreateProfileFromGuest(newProf);
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
      tableNumber: tableNumber,
    };

    setRoomQueue((prev) => [
      ...prev,
      {
        id: `queue_opt_${song.id}_${Date.now()}`,
        requestedBy: guestName.trim(),
        tableNumber: tableNumber.trim(),
        songId: song.id,
        title: song.title,
        artist: song.artist || '',
      },
    ]);

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
    const profId = myProfileId || singerProfileId || activeProfileId;
    if (!profId || profId === 'profile_all') return;

    setYoutubeFavorites((prev) => {
      const exists = prev.some((fav) => fav.id === track.id && fav.singerProfileId === profId);
      let updated: YouTubeFavoriteTrack[];
      if (exists) {
        updated = prev.filter((fav) => !(fav.id === track.id && fav.singerProfileId === profId));
        setFeedback({ type: 'success', message: `¡"${track.title}" quitada de tus favoritos! ⭐` });
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
        setFeedback({ type: 'success', message: `¡"${track.title}" guardada en tus favoritos! ⭐` });
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
    setMyProfileId(newProfile.id);
    localStorage.setItem('karaokelab_guest_my_profile_id', newProfile.id);
    setActiveProfileId(newProfile.id);
    localStorage.setItem(GUEST_ACTIVE_PROFILE_KEY, newProfile.id);

    // Send profile to Host so it appears and saves in main library
    peerSync.sendCreateProfileFromGuest(newProfile);
    setFeedback({ type: 'success', message: `¡Perfil "${newProfile.name}" guardado en la biblioteca principal! 👤` });
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleDeleteProfile = (profileId: string) => {
    if (profileId === 'profile_all') return;
    if (myProfileId && profileId !== myProfileId) {
      setFeedback({ type: 'error', message: '⚠️ Solo puedes eliminar tu propio perfil de cantante.' });
      setTimeout(() => setFeedback(null), 3500);
      return;
    }
    const updated = profiles.filter((p) => p.id !== profileId);
    saveGuestProfiles(updated.length > 0 ? updated : [{ id: 'profile_all', name: 'Todos', avatar: '👥', color: '#00f0ff', favoriteSongIds: [], createdAt: 0 }]);
    setActiveProfileId('profile_all');
    localStorage.setItem(GUEST_ACTIVE_PROFILE_KEY, 'profile_all');
    setMyProfileId('');
    localStorage.removeItem('karaokelab_guest_my_profile_id');

    // Notify Host to delete profile
    peerSync.sendDeleteProfileFromGuest(profileId);
    setFeedback({ type: 'success', message: 'Tu perfil de cantante ha sido eliminado.' });
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleSelectProfile = (profileId: string) => {
    setActiveProfileId(profileId);
    localStorage.setItem(GUEST_ACTIVE_PROFILE_KEY, profileId);
  };

  const handleToggleFavoriteSong = (profileId: string, songId: string) => {
    const targetProfId = myProfileId || profileId || activeProfileId;
    if (!targetProfId || targetProfId === 'profile_all') return;

    setProfiles((prev) => {
      const updated = prev.map((p) => {
        if (p.id !== targetProfId) return p;
        const favs = p.favoriteSongIds.includes(songId)
          ? p.favoriteSongIds.filter((id) => id !== songId)
          : [...p.favoriteSongIds, songId];
        return { ...p, favoriteSongIds: favs };
      });
      saveGuestProfiles(updated);
      peerSync.sendToggleFavoriteFromGuest(targetProfId, songId);
      return updated;
    });
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

          {/* Feedback / Error Alert Banner */}
          {feedback && (
            <div
              className={`w-full p-3.5 rounded-xl border text-xs font-bold flex items-start gap-2.5 shadow-lg animate-in slide-in-from-top-2 duration-200 ${
                feedback.type === 'error'
                  ? 'bg-rose-950/95 border-rose-500/80 text-rose-200 shadow-[0_0_25px_rgba(244,63,94,0.35)]'
                  : 'bg-emerald-950/95 border-emerald-500/80 text-emerald-200 shadow-[0_0_25px_rgba(52,211,153,0.35)]'
              }`}
            >
              <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${feedback.type === 'error' ? 'text-rose-400' : 'text-emerald-400'}`} />
              <span className="leading-relaxed flex-1 font-sans">{feedback.message}</span>
            </div>
          )}

          <div className="w-full p-5 rounded-2xl bg-slate-900/90 border border-cyan-500/30 shadow-[0_0_30px_rgba(0,240,255,0.15)] flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-cyan-300">
                <UserRound className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Tu Nombre / Cantante</span>
              </div>
              <input
                type="text"
                placeholder="Ej. Carlos, María..."
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmName();
                }}
                autoFocus
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#00f0ff] focus:shadow-[0_0_15px_rgba(0,240,255,0.2)] transition-all"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-slate-300">
                <div className="flex items-center gap-2 text-pink-400">
                  <span className="text-sm">🪑</span>
                  <span className="text-xs font-bold uppercase tracking-wider">Nº de Mesa / Ubicación</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">(Opcional)</span>
              </div>
              <input
                type="text"
                placeholder="Ej. Mesa 5, Barra 2, VIP..."
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmName();
                }}
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-pink-500 focus:shadow-[0_0_15px_rgba(255,0,127,0.2)] transition-all"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-slate-300">
                <div className="flex items-center gap-2 text-amber-400 font-bold">
                  <KeyRound className="w-4 h-4" />
                  <span className="text-xs uppercase tracking-wider">PIN de 4 Dígitos</span>
                </div>
                <span className="text-[10px] text-amber-300 font-mono font-bold">(Requerido 🔒)</span>
              </div>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="**** (Obligatorio 4 dígitos)"
                value={guestPin}
                onChange={(e) => setGuestPin(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmName();
                }}
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 font-mono tracking-widest text-center focus:outline-none focus:border-amber-400 focus:shadow-[0_0_15px_rgba(245,158,11,0.2)] transition-all font-bold"
              />
            </div>

            <button
              type="button"
              onClick={() => handleConfirmName()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-[#00f0ff] to-[#bd00ff] text-slate-950 font-black text-sm cursor-pointer shadow-[0_0_20px_rgba(0,240,255,0.3)] hover:shadow-[0_0_30px_rgba(0,240,255,0.5)] hover:scale-[1.02] active:scale-[0.98] transition-all mt-1"
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
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="min-h-screen bg-[#080811] text-white p-3 max-w-md mx-auto space-y-3 pb-16 font-sans select-none"
    >
      {/* Pull to refresh visual indicator bar */}
      <div
        className="overflow-hidden transition-all duration-200 ease-out flex items-center justify-center pointer-events-none select-none"
        style={{
          height: isPullRefreshing ? '48px' : `${pullDistance}px`,
          opacity: pullDistance > 8 || isPullRefreshing ? 1 : 0,
        }}
      >
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-cyan-500/50 shadow-[0_0_15px_rgba(0,240,255,0.3)] text-cyan-300 text-xs font-bold">
          <RefreshCw
            className={`w-3.5 h-3.5 text-[#00f0ff] ${isPullRefreshing ? 'animate-spin' : ''}`}
            style={{ transform: !isPullRefreshing ? `rotate(${pullDistance * 4}deg)` : undefined }}
          />
          <span>
            {isPullRefreshing
              ? 'Sincronizando biblioteca...'
              : pullDistance >= 55
              ? '¡Suelta para actualizar! 🚀'
              : 'Desliza para actualizar'}
          </span>
        </div>
      </div>

      {/* Sticky Header & Navigation for Mobile Phones */}
      <div className="sticky top-0 z-[100] -mx-3 -mt-3 px-3 pt-3 bg-[#080814] border-b border-slate-800/80 pb-2.5 space-y-2 shadow-2xl">
        {/* Header Main Row */}
        <div className="flex items-center justify-between gap-2 px-1">
          {/* Left: Brand Logo + Status Dot + Singer & Table Info */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-cyan-400 via-blue-500 to-pink-500 flex items-center justify-center font-black text-slate-950 text-xs shadow-[0_0_12px_rgba(0,240,255,0.35)] shrink-0">
              🎤
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-black italic uppercase tracking-wider text-white">
                  KaraokeLab
                </span>
                {connStatus === 'connected' ? (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" title="En Vivo (Conectado)" />
                ) : connStatus === 'reconnecting' ? (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" title="Reconectando..." />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-rose-500" title="Desconectado" />
                )}
              </div>
              <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono truncate">
                <span className="truncate max-w-[90px] text-slate-200 font-bold">{guestName}</span>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => {
                    setTempTableNumber(tableNumber);
                    setIsEditTableOpen(true);
                  }}
                  className="text-pink-400 font-bold hover:underline flex items-center gap-0.5 shrink-0 cursor-pointer"
                  title="Cambiar de Mesa / Ubicación"
                >
                  <span>🪑 {tableNumber}</span>
                  <span className="text-[8px] opacity-70">✏️</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right: Actions (Mis Pedidos + Chat + Change Singer Name) */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsMyQueueOpen(true)}
              className={`px-2.5 py-1 rounded-xl border text-[11px] font-black flex items-center gap-1.5 cursor-pointer transition-all shadow-sm ${
                myQueueItems.length > 0
                  ? 'bg-gradient-to-r from-pink-600 to-purple-600 border-pink-400 text-white shadow-[0_0_14px_rgba(255,0,127,0.45)] animate-pulse'
                  : 'bg-slate-900/80 border-slate-700/80 text-slate-300 hover:text-white hover:border-slate-600'
              }`}
            >
              <span>📋 Mis Pedidos</span>
              {myQueueItems.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-white text-slate-950 font-mono text-[9.5px] font-black shrink-0">
                  {myQueueItems.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setIsChatOpen(true);
                setUnreadChatCount(0);
              }}
              className="relative p-1.5 rounded-xl bg-slate-900/80 border border-slate-700/80 text-pink-400 hover:text-pink-300 hover:border-pink-500/50 text-xs cursor-pointer transition-all hover:bg-slate-800 shrink-0"
              title="Chat de la Sala y Saludos 💬"
            >
              <MessageSquare className="w-3.5 h-3.5 text-pink-400" />
              {unreadChatCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-pink-500 text-white font-mono text-[9px] font-black flex items-center justify-center animate-pulse shadow-md">
                  {unreadChatCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setNameConfirmed(false);
                setGuestPin('');
                setInputPin('');
                localStorage.removeItem('karaokelab_guest_name');
                localStorage.removeItem('karaokelab_guest_pin');
              }}
              className="p-1.5 rounded-xl bg-slate-900/80 border border-slate-700/80 text-slate-400 hover:text-white text-xs cursor-pointer transition-all hover:bg-slate-800 shrink-0"
              title="Cambiar nombre de cantante"
            >
              <UserRound className="w-3.5 h-3.5 text-slate-300" />
            </button>
          </div>
        </div>

        {/* Remote Navigation Tabs: Local Library vs YouTube Online Search */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950/80 rounded-xl border border-slate-800/80 shadow-inner">
          <button
            type="button"
            onClick={() => setRemoteTab('library')}
            className={`py-1.5 px-3 rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              remoteTab === 'library'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-[0_0_15px_rgba(0,240,255,0.3)] font-black'
                : 'text-slate-400 hover:text-white font-bold hover:bg-slate-900/50'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Biblioteca ({savedSongs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setRemoteTab('youtube')}
            className={`py-1.5 px-3 rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              remoteTab === 'youtube'
                ? 'bg-gradient-to-r from-red-600 to-pink-600 text-white shadow-[0_0_15px_rgba(239,68,68,0.35)] font-black'
                : 'text-slate-400 hover:text-white font-bold hover:bg-slate-900/50'
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
            <div className="flex items-center justify-between pb-1 pt-1.5 text-xs border-t border-slate-800/80">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-400 font-mono shrink-0">Cantante activo:</span>
                <span className="px-2.5 py-0.5 rounded-xl bg-gradient-to-r from-pink-500/20 to-purple-500/20 border border-pink-500/40 text-pink-300 font-black text-[11px] flex items-center gap-1">
                  <span>🎤</span>
                  <span>{guestName}</span>
                  <span className="text-[9px] text-pink-400 font-mono">({tableNumber})</span>
                </span>
              </div>
              <span className="text-[9px] text-slate-500 font-mono">🔒 Perfil Personal</span>
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
                  (fav) => fav.id === item.id && fav.singerProfileId === (myProfileId || activeProfileId)
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
                      {isSongInMyQueue(item.id, item.title) ? (
                        <button
                          type="button"
                          onClick={() => handleCancelQueueItem(`yt_${item.id}`, undefined, item.title)}
                          className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white text-xs font-black transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 animate-pulse"
                          title="Toca para cancelar este pedido de la cola"
                        >
                          <Check className="w-3.5 h-3.5 text-white" />
                          <span>✓ En Cola · Cancelar ❌</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRequestYouTubeSong(item)}
                          className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-500 hover:to-pink-500 text-white text-xs font-black transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                        >
                          <ListPlus className="w-3.5 h-3.5" />
                          <span>Pedir a la Cola 🎤</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleToggleYouTubeFavorite(item, myProfileId || activeProfileId)}
                        className={`p-2 rounded-xl text-xs font-bold transition-all border flex items-center justify-center cursor-pointer ${
                          isFav
                            ? 'bg-amber-500 text-slate-950 border-amber-400 font-black shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                            : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-700'
                        }`}
                        title={isFav ? 'Quitar de mis favoritos' : 'Guardar en mis favoritos'}
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

          {/* Main Song Library Component (Guest Mode: no delete buttons, with profile management and YouTube favorites) */}
          <SongLibrary
            savedSongs={savedSongs}
            queue={roomQueue}
            onFilesSelected={() => {}}
            onSelectSong={(song) => {
              if (isSongInMyQueue(song.id, song.title)) {
                handleCancelQueueItem(song.id, undefined, song.title);
              } else {
                handleRequestSong(song);
              }
            }}
            onDeleteSong={() => {}}
            onAddToQueue={(song) => {
              if (isSongInMyQueue(song.id, song.title)) {
                handleCancelQueueItem(song.id, undefined, song.title);
              } else {
                handleRequestSong(song);
              }
            }}
            profiles={profiles}
            activeProfileId={activeProfileId}
            onSelectProfile={handleSelectProfile}
            onCreateProfile={handleCreateProfile}
            onDeleteProfile={handleDeleteProfile}
            onToggleFavoriteSong={handleToggleFavoriteSong}
            youtubeFavorites={youtubeFavorites}
            onToggleYouTubeFavorite={handleToggleYouTubeFavorite}
            isGuestMode={true}
            guestRestrictedProfileId={myProfileId}
          />
        </div>
      )}

      {/* ── Floating Mobile Chat Button (Bottom-Right) ── */}
      <button
        type="button"
        onClick={() => {
          setIsChatOpen(true);
          setUnreadChatCount(0);
        }}
        className="fixed bottom-5 right-5 z-40 w-13 h-13 rounded-full bg-gradient-to-tr from-pink-500 to-purple-600 text-white flex items-center justify-center shadow-[0_0_25px_rgba(255,0,127,0.5)] border border-pink-400/50 hover:scale-110 active:scale-95 transition-all cursor-pointer"
        title="Abrir Chat de la Sala"
      >
        <MessageSquare className="w-6 h-6" />
        {unreadChatCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white font-mono text-[10px] font-black flex items-center justify-center animate-bounce border border-slate-950 shadow-md">
            {unreadChatCount}
          </span>
        )}
      </button>

      {/* ── Mobile WhatsApp / Cyberpunk Style Chat Sheet ── */}
      {isChatOpen && (
        <div
          className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex flex-col justify-end animate-in fade-in duration-200"
          onClick={() => setIsChatOpen(false)}
        >
          <div
            className="w-full max-w-md mx-auto bg-[#090a14] border-t border-pink-500/40 rounded-t-3xl h-[85vh] flex flex-col shadow-[0_0_50px_rgba(255,0,127,0.3)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-3.5 border-b border-slate-800 bg-[#0e0f21] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-pink-500 to-purple-600 flex items-center justify-center text-white text-base font-black shadow-md">
                  💬
                </div>
                <div>
                  <h3 className="text-xs font-black text-white uppercase tracking-wider">
                    Chat de la Sala
                  </h3>
                  <p className="text-[10px] text-pink-400 font-mono flex items-center gap-1.5">
                    <span>Conectado como: <strong className="text-white">{guestName}</strong></span>
                    <span className="px-1.5 py-0.2 rounded bg-pink-500/20 text-pink-300 border border-pink-500/40 text-[9px] font-black">
                      🪑 {tableNumber}
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsChatOpen(false)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all border border-slate-700 hover:border-rose-500 shadow-sm"
              >
                <X className="w-4 h-4 text-rose-400" />
                <span>Cerrar</span>
              </button>
            </div>

            {/* Message List */}
            <div className="flex-1 p-3.5 overflow-y-auto space-y-3 scrollbar-thin">
              {(() => {
                const myThreadMsgs = chatMessages.filter((m) => {
                  if (m.senderProfileId && myProfileId && m.senderProfileId === myProfileId) return true;
                  if (m.senderName === guestName) return true;
                  if (m.isHost && (m.targetProfileId === myProfileId || m.targetProfileId === guestName)) return true;
                  if (m.isHost && !m.targetProfileId) return true;
                  return false;
                });

                if (myThreadMsgs.length === 0) {
                  return (
                    <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 gap-2 p-4">
                      <div className="w-12 h-12 rounded-2xl bg-pink-500/10 border border-pink-500/30 flex items-center justify-center text-pink-400 text-xl">
                        💬
                      </div>
                      <p className="text-xs font-bold text-slate-300">Chat Privado con el Host / DJ</p>
                      <p className="text-[11px] text-slate-500 leading-relaxed max-w-xs">
                        Escribe un saludo o pedido especial directamente al anfitrión del Karaoke.
                      </p>
                    </div>
                  );
                }

                return myThreadMsgs.map((msg) => {
                  const isMe = msg.senderProfileId === myProfileId || msg.senderName === guestName;
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${msg.isHost ? 'items-start' : isMe ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 px-1">
                        <span className="text-xs">{msg.avatar || (msg.isHost ? '🎧' : '🎤')}</span>
                        <div className="flex flex-col">
                          <span
                            className={`text-[10px] font-bold ${
                              msg.isHost ? 'text-pink-400' : isMe ? 'text-cyan-300' : 'text-purple-300'
                            }`}
                          >
                            {msg.isHost ? 'Host / DJ 🎧' : isMe ? 'Tú' : msg.senderName}
                          </span>
                          {!msg.isHost && (msg.tableNumber || tableNumber) && (
                            <span className="text-[8.5px] font-black text-pink-300">
                              🪑 {msg.tableNumber || tableNumber}
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] text-slate-500 font-mono self-start mt-0.5">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <div
                        className={`px-3.5 py-2 rounded-2xl max-w-[85%] text-xs font-medium leading-relaxed shadow-md ${
                          msg.isHost
                            ? 'bg-gradient-to-r from-pink-700 to-purple-800 text-white rounded-tl-none border border-pink-500/40'
                            : isMe
                            ? 'bg-cyan-600 text-slate-950 font-semibold rounded-tr-none shadow-[0_0_15px_rgba(0,240,255,0.2)]'
                            : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-none'
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  );
                });
              })()}
              <div ref={chatMessagesEndRef} />
            </div>

            {/* Quick Emojis & Input Bar */}
            <div className="p-3 border-t border-slate-800 bg-[#0d0e1d] flex flex-col gap-2">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {['🎤', '🔥', '👏', '🥳', '❤️', '🍻', '🎉', '⚡'].map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleSendGuestChatMessage(`${emoji}`)}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-pink-500/50 text-sm cursor-pointer transition-all shrink-0 hover:scale-110 active:scale-95"
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Escribe un mensaje o pedido..."
                  value={chatInputText}
                  onChange={(e) => setChatInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && chatInputText.trim()) {
                      handleSendGuestChatMessage(chatInputText);
                    }
                  }}
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-pink-500"
                />
                <button
                  type="button"
                  onClick={() => handleSendGuestChatMessage(chatInputText)}
                  disabled={!chatInputText.trim()}
                  className="p-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 disabled:opacity-40 text-white text-xs font-black cursor-pointer shadow-md hover:scale-105 active:scale-95 transition-all"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Mis Pedidos / Mi Fila Modal ── */}
      {isMyQueueOpen && (
        <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex flex-col justify-end animate-in fade-in duration-200">
          <div className="w-full max-w-md mx-auto bg-[#090a14] border-t border-indigo-500/40 rounded-t-3xl h-[75vh] flex flex-col shadow-[0_0_50px_rgba(99,102,241,0.35)] overflow-hidden">
            {/* Header */}
            <div className="p-3.5 border-b border-slate-800 bg-[#0e0f21] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white text-base font-black shadow-md">
                  📋
                </div>
                <div>
                  <h3 className="text-xs font-black text-white uppercase tracking-wider">
                    Mis Canciones en Cola ({myQueueItems.length})
                  </h3>
                  <p className="text-[10px] text-indigo-300 font-mono">
                    Cantante: <strong className="text-white">{guestName}</strong> · <span className="text-pink-400">🪑 {tableNumber}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMyQueueOpen(false)}
                className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* List of Requested Songs */}
            <div className="flex-1 p-3.5 overflow-y-auto space-y-2.5 scrollbar-thin">
              {myQueueItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 gap-2 p-6">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 text-xl">
                    🎤
                  </div>
                  <p className="text-xs font-bold text-slate-300">No tienes canciones en la cola</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed max-w-xs">
                    Busca en la biblioteca o YouTube y presiona <b>"+ Pedir Canción"</b> para agregarte a la fila del Karaoke.
                  </p>
                </div>
              ) : (
                myQueueItems.map((qItem, idx) => (
                  <div
                    key={qItem.id || idx}
                    className="p-3 rounded-2xl bg-slate-900/90 border border-indigo-500/30 flex items-center justify-between gap-3 shadow-lg"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-8 h-8 rounded-xl bg-indigo-950 border border-indigo-500/40 text-indigo-300 font-mono text-xs font-black flex items-center justify-center shrink-0 shadow-inner">
                        #{idx + 1}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-extrabold text-white truncate">
                          {qItem.songData?.title || qItem.title || qItem.fileName}
                        </span>
                        <span className="text-[10.5px] text-slate-400 truncate">
                          {qItem.songData?.artist || qItem.artist || 'Artista'}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCancelQueueItem(qItem.songData?.id, qItem.id, qItem.songData?.title || qItem.title || qItem.fileName)}
                      className="px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-xs font-bold shrink-0 cursor-pointer transition-all flex items-center gap-1 shadow-sm active:scale-95"
                      title="Cancelar este pedido"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Cancelar</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Table Modal Overlay ── */}
      {isEditTableOpen && (
        <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xs bg-[#0c0d1b] border border-pink-500/40 rounded-2xl p-4 flex flex-col gap-3 shadow-[0_0_40px_rgba(255,0,127,0.35)] animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-1.5 text-pink-400 font-bold text-xs">
                <span>🪑</span>
                <span>Cambiar de Mesa</span>
              </div>
              <button
                type="button"
                onClick={() => setIsEditTableOpen(false)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-slate-300 leading-snug">
              ¿Te mudaste de mesa? Ingresa tu nueva ubicación:
            </p>
            <input
              type="text"
              placeholder="Ej. Mesa 7, VIP 2, Barra..."
              value={tempTableNumber}
              onChange={(e) => setTempTableNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tempTableNumber.trim()) {
                  const formatted = tempTableNumber.trim().toLowerCase().startsWith('mesa')
                    ? tempTableNumber.trim()
                    : `Mesa ${tempTableNumber.trim()}`;
                  setTableNumber(formatted);
                  localStorage.setItem('karaokelab_guest_table_number', formatted);
                  setIsEditTableOpen(false);
                  if (peerSync.getConnectionStatus() === 'connected') {
                    peerSync.sendGuestName(guestName.trim(), formatted);
                  }
                  setFeedback({ type: 'success', message: `¡Ubicación actualizada a ${formatted}! 🪑` });
                  setTimeout(() => setFeedback(null), 3000);
                }
              }}
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-pink-500"
            />
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsEditTableOpen(false)}
                className="flex-1 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs hover:bg-slate-700 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!tempTableNumber.trim()) return;
                  const formatted = tempTableNumber.trim().toLowerCase().startsWith('mesa')
                    ? tempTableNumber.trim()
                    : `Mesa ${tempTableNumber.trim()}`;
                  setTableNumber(formatted);
                  localStorage.setItem('karaokelab_guest_table_number', formatted);
                  setIsEditTableOpen(false);
                  if (peerSync.getConnectionStatus() === 'connected') {
                    peerSync.sendGuestName(guestName.trim(), formatted);
                  }
                  setFeedback({ type: 'success', message: `¡Ubicación actualizada a ${formatted}! 🪑` });
                  setTimeout(() => setFeedback(null), 3000);
                }}
                className="flex-1 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white font-black text-xs cursor-pointer shadow-md"
              >
                Guardar 🪑
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PIN Challenge / Name Conflict Modal ── */}
      {pinChallengeModal?.show && (
        <div className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#0c0d1b] border border-amber-500/50 rounded-2xl p-5 flex flex-col gap-4 shadow-[0_0_50px_rgba(245,158,11,0.35)] animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider font-mono">
                <Lock className="w-4 h-4" />
                <span>Perfil Existente Protegido</span>
              </div>
              <button
                type="button"
                onClick={() => setPinChallengeModal(null)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              El nombre <strong className="text-white">"{pinChallengeModal.targetName}"</strong> ya pertenece a otro cliente registrado en la sala.
            </p>

            <div className="flex flex-col gap-1.5 bg-slate-950 p-3 rounded-xl border border-slate-800">
              <label className="text-[11px] font-bold text-amber-300 flex items-center gap-1 font-mono uppercase">
                <KeyRound className="w-3.5 h-3.5" />
                <span>Ingresa tu PIN de 4 dígitos para recuperar el perfil</span>
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="****"
                value={inputPin}
                onChange={(e) => setInputPin(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (pinChallengeModal.existingProfile?.pin === inputPin.trim()) {
                      handleConfirmName(pinChallengeModal.targetName, inputPin.trim());
                    } else {
                      setFeedback({ type: 'error', message: '❌ PIN incorrecto. Si eres otro cliente, ingresa con otro nombre (ej. Juan P., Juan Mesa 5).' });
                    }
                  }
                }}
                className="w-full text-center tracking-[0.5em] text-lg font-mono py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-amber-400"
              />
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  if (pinChallengeModal.existingProfile?.pin === inputPin.trim() || !pinChallengeModal.existingProfile?.pin) {
                    handleConfirmName(pinChallengeModal.targetName, inputPin.trim());
                  } else {
                    setFeedback({ type: 'error', message: '❌ PIN incorrecto. Si eres otro cliente, ingresa con otro nombre (ej. Juan P., Juan Mesa 5).' });
                  }
                }}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs cursor-pointer shadow-md transition-all"
              >
                🔓 Validar PIN y Recuperar Perfil
              </button>

              <button
                type="button"
                onClick={() => {
                  const suggested = `${pinChallengeModal.targetName} ${tableNumber}`;
                  setPinChallengeModal(null);
                  setGuestName(suggested);
                }}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs cursor-pointer transition-all border border-slate-700"
              >
                ✏️ Usar Otro Nombre (ej. {pinChallengeModal.targetName} {tableNumber})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Top-Layer Overlay for Lost Connection (Overlays Chat, Edit Table, & All Screens) ── */}
      {(connStatus === 'disconnected' || connStatus === 'failed') && (
        <div className="fixed inset-0 z-[999999] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-200 select-none">
          <div className="w-full max-w-sm bg-[#0d0914] border-2 border-rose-500/80 rounded-3xl shadow-[0_0_80px_rgba(244,63,94,0.5)] p-6 flex flex-col items-center gap-5 text-center relative animate-in zoom-in-95 duration-200">
            {/* Glowing Icon */}
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-rose-500/20 via-rose-600/30 to-red-950/60 border border-rose-500/80 flex items-center justify-center shadow-[0_0_40px_rgba(244,63,94,0.4)] animate-pulse">
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
              <p className="text-xs text-slate-200 leading-relaxed max-w-xs font-medium">
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
                className="w-full py-2.5 px-3 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white text-[11px] font-bold cursor-pointer transition-all border border-slate-700/60 flex items-center justify-center gap-1.5"
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
    </div>
  );
};
