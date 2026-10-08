import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Sliders,
  Play,
  Pause,
  Square,
  SkipForward,
  RotateCcw,
  Volume2,
  Mic,
  Music,
  Lock,
  Unlock,
  QrCode,
  Power,
  ListMusic,
  Search,
  MessageSquare,
  Sparkles,
  Check,
  X,
  Plus,
  Radio,
  RefreshCw,
  Clock,
  User,
  ShieldAlert,
  Zap,
  ChevronRight,
  Disc,
  Send,
  Sparkle,
  Star,
  ChevronDown,
  ChevronUp,
  Filter,
} from 'lucide-react';
import { peerSync, ConnectionStatus } from '../services/peerSyncService';
import { SongItem, SingerProfile, ChatMessage } from '../types';
import { transposeKey } from '../services/dspAnalysis';
import { searchMatches } from '../utils/textUtils';

interface DjRemoteState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  songTitle: string;
  songArtist?: string;
  detectedKey: string;
  bpm: number;
  pitchShift: number;
  vocalGain: number;
  musicGain: number;
  isCleanTrack: boolean;
  isGuideVoiceActive: boolean;
  queue: Array<{
    id: string;
    songId?: string;
    title: string;
    artist?: string;
    requestedBy?: string;
    tableNumber?: string;
    status?: string;
  }>;
  catalog: Array<{
    id: string;
    title: string;
    artist?: string;
    genre?: string;
    bpm?: number;
    duration?: number;
  }>;
  requests: Array<{
    id: string;
    songId?: string;
    title: string;
    artist?: string;
    singerName?: string;
    tableNumber?: string;
    timestamp: number;
    isYouTube?: boolean;
    videoId?: string;
  }>;
  chatMessages: ChatMessage[];
  profiles?: SingerProfile[];
  hostPeerId?: string;
  roomCode?: string;
  isDjServiceEnabled?: boolean;
}

export const DjRemoteView: React.FC = () => {
  // Tabs: 'controls' | 'queue' | 'catalog' | 'chat'
  const [activeTab, setActiveTab] = useState<'controls' | 'queue' | 'catalog' | 'chat'>('controls');

  // Connection & Host State
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('reconnecting');
  const [isHostDisabled, setIsHostDisabled] = useState(false);
  const [isSleepMode, setIsSleepMode] = useState(false);
  const [targetHostId, setTargetHostId] = useState<string>('');
  const [roomCode, setRoomCode] = useState<string>('');

  // DJ Synced State from Host
  const [djState, setDjState] = useState<DjRemoteState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    songTitle: '',
    songArtist: '',
    detectedKey: 'Am',
    bpm: 120,
    pitchShift: 0,
    vocalGain: 0.0,
    musicGain: 1.0,
    isCleanTrack: false,
    isGuideVoiceActive: false,
    queue: [],
    catalog: [],
    requests: [],
    chatMessages: [],
    profiles: [],
  });

  // Selected Chat Profile / Table Thread (Individual 1-on-1 conversations)
  const [selectedChatProfileId, setSelectedChatProfileId] = useState<string | null>(null);

  // Read status tracking per thread ID
  const [readTimestampsByThread, setReadTimestampsByThread] = useState<Record<string, number>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('karaokelab_dj_read_timestamps');
        if (saved) return JSON.parse(saved);
      } catch (_) {}
    }
    return {};
  });

  const markThreadAsRead = useCallback((threadId: string) => {
    setReadTimestampsByThread((prev) => {
      const next = { ...prev, [threadId]: Date.now() };
      try {
        localStorage.setItem('karaokelab_dj_read_timestamps', JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  }, []);

  // DJ Chat composer & auto-scroll
  const [chatInputText, setChatInputText] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Local optimistic controls for super snappy UI
  const [localPitch, setLocalPitch] = useState(0);
  const [localBpm, setLocalBpm] = useState(120);
  const [localVocalGain, setLocalVocalGain] = useState(0.0);
  const [localMusicGain, setLocalMusicGain] = useState(1.0);

  // Security Lock for Live Mixer (6 seconds timer)
  const [isMixerUnlocked, setIsMixerUnlocked] = useState(false);
  const [unlockRemainingSeconds, setUnlockRemainingSeconds] = useState(6);
  const lockTimerRef = useRef<any>(null);
  const lockIntervalRef = useRef<any>(null);

  // Search & Catalog
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedCatalogProfileId, setSelectedCatalogProfileId] = useState<string | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [showOnlyFavorites, setShowOnlyFavorites] = useState<boolean>(false);
  const [isSingersFilterOpen, setIsSingersFilterOpen] = useState<boolean>(false);
  const [isArtistsFilterOpen, setIsArtistsFilterOpen] = useState<boolean>(false);

  // Modals & Overlays
  const [isGuestQrModalOpen, setIsGuestQrModalOpen] = useState(false);
  const [isRoomCodeModalOpen, setIsRoomCodeModalOpen] = useState(false);
  const [tempRoomCodeInput, setTempRoomCodeInput] = useState('');

  // Action Feedback Toasts
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'cyan' | 'pink' | 'emerald' } | null>(null);
  const [actionButtonFeedback, setActionButtonFeedback] = useState<Record<string, string>>({});

  const showToast = useCallback((text: string, type: 'cyan' | 'pink' | 'emerald' = 'cyan') => {
    setToastMessage({ text, type });
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate?.(25);
      } catch (_) {}
    }
    setTimeout(() => {
      setToastMessage((prev) => (prev?.text === text ? null : prev));
    }, 2200);
  }, []);

  // Dynamic PWA Manifest & App Identity for DJ Remote mode
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const originalTitle = document.title;
    document.title = 'KaraokeLab DJ Remote';

    // Update manifest link to point to manifest-dj.json
    const manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    const originalManifest = manifestLink?.getAttribute('href') || '/manifest.json';
    if (manifestLink) {
      manifestLink.setAttribute('href', '/manifest-dj.json');
    }

    // Update Apple Mobile Web App title (used when adding to Home Screen on iOS)
    const appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]') as HTMLMetaElement | null;
    const originalAppleTitle = appleTitleMeta?.getAttribute('content') || 'KaraokeLab Player';
    if (appleTitleMeta) {
      appleTitleMeta.setAttribute('content', 'KaraokeLab DJ');
    }

    // Update application-name
    const appNameMeta = document.querySelector('meta[name="application-name"]') as HTMLMetaElement | null;
    const originalAppName = appNameMeta?.getAttribute('content') || 'KaraokeLab Player';
    if (appNameMeta) {
      appNameMeta.setAttribute('content', 'KaraokeLab DJ');
    }

    // Update theme-color
    const themeColorMeta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    const originalThemeColor = themeColorMeta?.getAttribute('content') || '#080811';
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', '#0c0e18');
    }

    return () => {
      document.title = originalTitle;
      if (manifestLink) manifestLink.setAttribute('href', originalManifest);
      if (appleTitleMeta) appleTitleMeta.setAttribute('content', originalAppleTitle);
      if (appNameMeta) appNameMeta.setAttribute('content', originalAppName);
      if (themeColorMeta) themeColorMeta.setAttribute('content', originalThemeColor);
    };
  }, []);

  // Playback sync ref and smooth interpolated timeline for 60fps/10fps fluid progression
  const lastPlaybackSyncRef = useRef<{ serverTime: number; receivedAt: number; isPlaying: boolean }>({
    serverTime: 0,
    receivedAt: Date.now(),
    isPlaying: false,
  });
  const [interpolatedTime, setInterpolatedTime] = useState(0);

  // Safe State Reducer (Guards all incoming fields so partial ticks/catalog syncs never wipe songTitle/time)
  const handleIncomingDjState = useCallback((state: any) => {
    if (!state) return;

    setDjState((prev) => {
      const next = { ...prev };

      if (state.isPlaying !== undefined) next.isPlaying = Boolean(state.isPlaying);
      if (state.currentTime !== undefined) next.currentTime = Number(state.currentTime) || 0;
      if (state.duration !== undefined) next.duration = Number(state.duration) || 0;
      if (state.songTitle !== undefined) {
        if (state.songTitle || !next.isPlaying || !prev.songTitle) {
          next.songTitle = state.songTitle;
        }
      }
      if (state.songArtist !== undefined) {
        if (state.songArtist || !next.isPlaying || !prev.songArtist) {
          next.songArtist = state.songArtist;
        }
      }
      if (state.detectedKey !== undefined) next.detectedKey = state.detectedKey;
      if (state.bpm !== undefined) next.bpm = state.bpm;
      if (state.pitchShift !== undefined) next.pitchShift = state.pitchShift;
      if (state.vocalGain !== undefined) next.vocalGain = state.vocalGain;
      if (state.musicGain !== undefined) next.musicGain = state.musicGain;
      if (state.isCleanTrack !== undefined) next.isCleanTrack = state.isCleanTrack;
      if (state.isGuideVoiceActive !== undefined) next.isGuideVoiceActive = state.isGuideVoiceActive;

      if (state.queue && Array.isArray(state.queue)) next.queue = state.queue;
      if (state.catalog && Array.isArray(state.catalog)) next.catalog = state.catalog;
      if (state.requests && Array.isArray(state.requests)) next.requests = state.requests;
      if (state.chatMessages && Array.isArray(state.chatMessages)) next.chatMessages = state.chatMessages;
      if (state.profiles && Array.isArray(state.profiles)) next.profiles = state.profiles;
      if (state.isDjServiceEnabled !== undefined) next.isDjServiceEnabled = state.isDjServiceEnabled;

      return next;
    });

    if (state.currentTime !== undefined || state.isPlaying !== undefined) {
      lastPlaybackSyncRef.current = {
        serverTime: state.currentTime !== undefined ? Number(state.currentTime) || 0 : lastPlaybackSyncRef.current.serverTime,
        receivedAt: Date.now(),
        isPlaying: state.isPlaying !== undefined ? Boolean(state.isPlaying) : lastPlaybackSyncRef.current.isPlaying,
      };
      if (state.currentTime !== undefined) {
        setInterpolatedTime(Number(state.currentTime) || 0);
      }
    }

    if (state.pitchShift !== undefined) setLocalPitch(state.pitchShift);
    if (state.bpm !== undefined) setLocalBpm(state.bpm);
    if (state.vocalGain !== undefined) setLocalVocalGain(state.vocalGain);
    if (state.musicGain !== undefined) setLocalMusicGain(state.musicGain);
    if (state.isDjServiceEnabled !== undefined) setIsHostDisabled(!state.isDjServiceEnabled);
  }, []);

  // Smooth timeline updater: ticks smoothly every 100ms when song is playing
  useEffect(() => {
    if (!djState.isPlaying || !djState.duration) {
      setInterpolatedTime(djState.currentTime || 0);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = (Date.now() - lastPlaybackSyncRef.current.receivedAt) / 1000;
      const current = Math.min(djState.duration, Math.max(0, lastPlaybackSyncRef.current.serverTime + elapsed));
      setInterpolatedTime(current);
    }, 100);

    return () => clearInterval(interval);
  }, [djState.isPlaying, djState.duration]);

  // Parse Room ID from URL & persistent storage
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room') || urlParams.get('host') || urlParams.get('join') || urlParams.get('tv') || '';
    
    let effectiveHost = roomParam;
    if (effectiveHost && !effectiveHost.startsWith('klab_host_')) {
      effectiveHost = `klab_host_${effectiveHost}`;
    }

    if (!effectiveHost) {
      // Fallback: search localStorage for previous successful DJ room connection
      try {
        const saved = localStorage.getItem('karaokelab_dj_target_host') || localStorage.getItem('karaokelab_p2p_host_id');
        if (saved) effectiveHost = saved;
      } catch (_) {}
    }

    if (!effectiveHost || effectiveHost === 'klab_host_default') {
      effectiveHost = 'klab_host_default';
      setIsRoomCodeModalOpen(true);
    } else {
      try {
        localStorage.setItem('karaokelab_dj_target_host', effectiveHost);
      } catch (_) {}
    }

    setTargetHostId(effectiveHost);
    setRoomCode(effectiveHost.replace('klab_host_', '').toUpperCase());

    // 1. Initialize WebRTC connection to host
    peerSync.initDjRemote(
      effectiveHost,
      handleIncomingDjState,
      (disabled) => {
        setIsHostDisabled(disabled);
      },
      (status) => {
        setConnectionStatus(status);
      }
    );

    // 2. Listen for direct live chat messages over WebRTC
    const unsubChat = peerSync.onChatMessageReceived((msg) => {
      if (!msg) return;
      setDjState((prev) => {
        if (prev.chatMessages?.some((m) => m.id === msg.id)) return prev;
        return {
          ...prev,
          chatMessages: [...(prev.chatMessages || []), msg],
        };
      });
    });

    // 3. Screen WakeLock (Keeps phone screen permanently on while on DJ Remote)
    let wakeLockSentinel: any = null;
    const requestWakeLock = async () => {
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        try {
          if (!wakeLockSentinel) {
            wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
            wakeLockSentinel.addEventListener('release', () => {
              wakeLockSentinel = null;
            });
          }
        } catch (_) {}
      }
    };
    requestWakeLock();

    // 4. Instant Lifecycle Auto-Reconnect on returning to browser / unlocking phone
    const handleLifecycleWake = () => {
      requestWakeLock();
      if (!isSleepMode) {
        // Immediate ping/reconnect
        peerSync.reconnectDjRemote();
        // Guaranteed secondary attempt after 600ms as phone antenna re-associates with WiFi
        setTimeout(() => {
          if (peerSync.getConnectionStatus() !== 'connected') {
            peerSync.reconnectDjRemote(true);
          }
        }, 600);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleLifecycleWake();
      }
    };

    const handleUserInteraction = () => {
      requestWakeLock();
      if (!isSleepMode && peerSync.getConnectionStatus() === 'disconnected') {
        peerSync.reconnectDjRemote();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleLifecycleWake);
    window.addEventListener('pageshow', handleLifecycleWake);
    window.addEventListener('touchstart', handleUserInteraction, { passive: true });
    window.addEventListener('pointerdown', handleUserInteraction, { passive: true });
    window.addEventListener('click', handleUserInteraction, { passive: true });

    // 5. Active Connection Watchdog (auto-heals silent network drops without manual page reload)
    const watchdogTimer = setInterval(() => {
      if (!isSleepMode && document.visibilityState === 'visible') {
        const currentStatus = peerSync.getConnectionStatus();
        if (currentStatus === 'disconnected') {
          peerSync.reconnectDjRemote();
        }
      }
    }, 2500);

    return () => {
      unsubChat();
      if (wakeLockSentinel) {
        try {
          wakeLockSentinel.release();
        } catch (_) {}
        wakeLockSentinel = null;
      }
      clearInterval(watchdogTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleLifecycleWake);
      window.removeEventListener('pageshow', handleLifecycleWake);
      window.removeEventListener('touchstart', handleUserInteraction);
      window.removeEventListener('pointerdown', handleUserInteraction);
      window.removeEventListener('click', handleUserInteraction);
      peerSync.disconnectDjRemote();
    };
  }, [isSleepMode]);

  // Sync state values to local states if updated externally
  useEffect(() => {
    setLocalPitch(djState.pitchShift || 0);
  }, [djState.pitchShift]);

  useEffect(() => {
    setLocalBpm(djState.bpm || 120);
  }, [djState.bpm]);

  useEffect(() => {
    setLocalVocalGain(djState.vocalGain !== undefined ? djState.vocalGain : 0.0);
  }, [djState.vocalGain]);

  useEffect(() => {
    setLocalMusicGain(djState.musicGain !== undefined ? djState.musicGain : 1.0);
  }, [djState.musicGain]);

  // Mixer Security Lock auto-lock timer
  const resetUnlockTimer = useCallback(() => {
    setIsMixerUnlocked(true);
    setUnlockRemainingSeconds(6);

    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    if (lockIntervalRef.current) clearInterval(lockIntervalRef.current);

    lockIntervalRef.current = setInterval(() => {
      setUnlockRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(lockIntervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    lockTimerRef.current = setTimeout(() => {
      setIsMixerUnlocked(false);
      setUnlockRemainingSeconds(6);
      if (lockIntervalRef.current) clearInterval(lockIntervalRef.current);
    }, 6000);
  }, []);

  const handleToggleLock = () => {
    if (isMixerUnlocked) {
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      if (lockIntervalRef.current) clearInterval(lockIntervalRef.current);
      setIsMixerUnlocked(false);
      setUnlockRemainingSeconds(6);
    } else {
      resetUnlockTimer();
      showToast('🔓 Faders desbloqueados por 6s', 'cyan');
    }
  };

  // Dispatch DJ Action to Host Web Player
  const sendAction = useCallback((action: string, payload?: any) => {
    peerSync.sendDjAction(action, payload);
  }, []);

  // Send DJ Chat Message
  const handleSendDjMessage = (textToSend: string, targetId?: string) => {
    const clean = textToSend.trim();
    if (!clean) return;
    const effectiveTargetId = targetId || selectedChatProfileId || undefined;
    const targetThread = conversationThreads.find((t) => t.id === effectiveTargetId);

    const optimisticMsg: ChatMessage = {
      id: `msg_dj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      senderName: 'DJ (Cabina)',
      senderProfileId: 'profile_dj',
      targetProfileId: effectiveTargetId,
      tableNumber: targetThread?.tableNumber,
      text: clean,
      timestamp: Date.now(),
      avatar: '🎧',
      color: '#00f0ff',
      isHost: true,
    };

    // Optimistically insert locally so it appears instantly on the DJ's screen (0ms)
    setDjState((prev) => {
      const msgs = prev.chatMessages || [];
      if (msgs.some((m) => m.id === optimisticMsg.id)) return prev;
      return {
        ...prev,
        chatMessages: [...msgs, optimisticMsg],
      };
    });

    sendAction('sendChatMessage', {
      id: optimisticMsg.id,
      text: clean,
      targetProfileId: effectiveTargetId,
      tableNumber: targetThread?.tableNumber,
    });
    setChatInputText('');
    showToast('💬 Mensaje enviado', 'cyan');
  };

  // Compute individual conversation threads per person/table
  const conversationThreads = useMemo(() => {
    const threadsMap = new Map<string, {
      id: string;
      name: string;
      avatar: string;
      tableNumber?: string;
      color?: string;
      lastMessage?: string;
      lastTimestamp?: number;
      messagesCount?: number;
    }>();

    // 1. Add all registered profiles from host
    (djState.profiles || []).forEach((p) => {
      if (p.id !== 'profile_all') {
        threadsMap.set(p.id, {
          id: p.id,
          name: p.name,
          avatar: p.avatar || '🎤',
          tableNumber: p.tableNumber,
          color: p.color || '#00f0ff',
        });
      }
    });

    // 2. Add senders from incoming chat messages who might not have a formal profile
    (djState.chatMessages || []).forEach((m) => {
      if (!m.isHost && m.senderProfileId !== 'profile_dj' && m.senderName !== 'DJ (Cabina)') {
        const key = m.senderProfileId || m.senderName;
        if (!threadsMap.has(key)) {
          threadsMap.set(key, {
            id: key,
            name: m.senderName || 'Cliente',
            avatar: m.avatar || '🎤',
            tableNumber: m.tableNumber,
            color: m.color || '#00f0ff',
          });
        } else if (m.tableNumber && !threadsMap.get(key)!.tableNumber) {
          threadsMap.get(key)!.tableNumber = m.tableNumber;
        }
      }
    });

    // 3. Attach last message, timestamp and unread count for each contact thread
    const result = Array.from(threadsMap.values()).map((thread) => {
      const threadMsgs = (djState.chatMessages || []).filter(
        (m) =>
          m.senderProfileId === thread.id ||
          m.targetProfileId === thread.id ||
          m.senderName === thread.name ||
          (thread.tableNumber && m.tableNumber === thread.tableNumber)
      );
      const lastMsg = threadMsgs[threadMsgs.length - 1];
      const lastReadTime = readTimestampsByThread[thread.id] || 0;
      const unreadMsgs = threadMsgs.filter(
        (m) =>
          !m.isHost &&
          m.senderProfileId !== 'profile_dj' &&
          m.senderName !== 'DJ (Cabina)' &&
          m.timestamp > lastReadTime
      );
      const unreadCount = selectedChatProfileId === thread.id && activeTab === 'chat' ? 0 : unreadMsgs.length;

      return {
        ...thread,
        lastMessage: lastMsg ? lastMsg.text : 'Sin mensajes',
        lastTimestamp: lastMsg ? lastMsg.timestamp : 0,
        messagesCount: threadMsgs.length,
        unreadCount,
      };
    });

    // Sort: unread first, then by newest timestamp
    return result.sort((a, b) => {
      if ((b.unreadCount || 0) !== (a.unreadCount || 0)) {
        return (b.unreadCount || 0) - (a.unreadCount || 0);
      }
      return (b.lastTimestamp || 0) - (a.lastTimestamp || 0);
    });
  }, [djState.profiles, djState.chatMessages, readTimestampsByThread, selectedChatProfileId, activeTab]);

  // Total unread count across all conversation threads
  const totalUnreadChatCount = useMemo(() => {
    return conversationThreads.reduce((acc, t) => acc + (t.unreadCount || 0), 0);
  }, [conversationThreads]);

  const selectedThread = useMemo(() => {
    if (!selectedChatProfileId) return null;
    return (
      conversationThreads.find((t) => t.id === selectedChatProfileId) || {
        id: selectedChatProfileId,
        name: 'Cliente',
        avatar: '🎤',
        tableNumber: undefined,
        color: '#00f0ff',
        lastMessage: '',
        lastTimestamp: 0,
        messagesCount: 0,
        unreadCount: 0,
      }
    );
  }, [selectedChatProfileId, conversationThreads]);

  // Mark active conversation thread as read
  useEffect(() => {
    if (activeTab === 'chat' && selectedChatProfileId) {
      markThreadAsRead(selectedChatProfileId);
    }
  }, [activeTab, selectedChatProfileId, djState.chatMessages, markThreadAsRead]);

  // Auto-scroll chat to bottom when messages change or tab/thread becomes active
  useEffect(() => {
    if (activeTab === 'chat' && selectedChatProfileId) {
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [djState.chatMessages, activeTab, selectedChatProfileId]);

  // Master Play / Pause with validation
  const handleTogglePlay = () => {
    if (djState.isPlaying) {
      setDjState((prev) => ({ ...prev, isPlaying: false }));
      sendAction('togglePlay');
      showToast('⏸️ Pausado', 'pink');
      return;
    }

    const hasSong = Boolean((djState.songTitle && djState.songTitle.trim() !== '') || djState.duration > 0);
    const hasQueue = Boolean(djState.queue && djState.queue.length > 0);

    if (!hasSong && !hasQueue) {
      showToast('⚠️ No hay canciones en el reproductor ni en la cola', 'pink');
      return;
    }

    setDjState((prev) => ({ ...prev, isPlaying: true }));
    sendAction('togglePlay');
    if (!hasSong && hasQueue) {
      showToast(`▶ Iniciando cola: ${djState.queue[0].title}`, 'emerald');
    } else {
      showToast('▶ Reproduciendo', 'emerald');
    }
  };

  // Sleep / Disconnect button handler
  const handleToggleSleep = () => {
    if (isSleepMode) {
      setIsSleepMode(false);
      peerSync.reconnectDjRemote();
      showToast('⚡ Conectando al Web Player...', 'emerald');
    } else {
      setIsSleepMode(true);
      peerSync.disconnectDjRemote();
    }
  };

  // Reconnect from host disabled
  const handleRetryHostConnection = () => {
    setIsHostDisabled(false);
    peerSync.reconnectDjRemote();
    showToast('🔄 Reintentando enlace con la sala...', 'cyan');
  };

  // Transpose calculation
  const currentKeyDisplay = useMemo(() => {
    const origKey = djState.detectedKey || 'Am';
    const cleanOrig = origKey.trim();
    if (localPitch === 0) {
      return `${cleanOrig} (ORG)`;
    }
    const shifted = transposeKey(cleanOrig, localPitch);
    const sign = localPitch > 0 ? `+${localPitch}` : `${localPitch}`;
    return `${shifted} (${sign})`;
  }, [djState.detectedKey, localPitch]);

  // Unique artists list from catalog
  const uniqueArtists = useMemo(() => {
    const map = new Map<string, number>();
    (djState.catalog || []).forEach((s) => {
      const art = s.artist?.trim();
      if (art && art !== 'Desconocido') {
        map.set(art, (map.get(art) || 0) + 1);
      }
    });
    return Array.from(map.entries())
      .map(([artist, count]) => ({ artist, count }))
      .sort((a, b) => b.count - a.count || a.artist.localeCompare(b.artist));
  }, [djState.catalog]);

  // Selected singer profile object
  const activeCatalogProfile = useMemo(() => {
    if (!selectedCatalogProfileId) return null;
    return (djState.profiles || []).find((p) => p.id === selectedCatalogProfileId) || null;
  }, [selectedCatalogProfileId, djState.profiles]);

  // Catalog filtering by singer profiles, favorites, artists and search
  const filteredCatalog = useMemo(() => {
    let list = djState.catalog || [];

    // 1. Filter by specific singer profile's favorites
    if (activeCatalogProfile) {
      const favIds = new Set(activeCatalogProfile.favoriteSongIds || []);
      list = list.filter((s) => favIds.has(s.id));
    } else if (showOnlyFavorites) {
      // Global favorites across all registered profiles
      const allFavIds = new Set<string>();
      (djState.profiles || []).forEach((p) => {
        (p.favoriteSongIds || []).forEach((id) => allFavIds.add(id));
      });
      list = list.filter((s) => allFavIds.has(s.id));
    }

    // 2. Filter by specific artist
    if (selectedArtist) {
      const targetArt = selectedArtist.trim().toLowerCase();
      list = list.filter((s) => s.artist?.trim().toLowerCase() === targetArt);
    }

    // 3. Filter by search query (accent-insensitive, tilde-insensitive, and ñ/n matching)
    if (searchQuery.trim()) {
      list = list.filter(
        (s) =>
          searchMatches(s.title, searchQuery) ||
          searchMatches(s.artist, searchQuery) ||
          searchMatches(s.genre, searchQuery)
      );
    } else if (!activeCatalogProfile && !showOnlyFavorites && !selectedArtist) {
      // Limit initial default view for snappy performance
      list = list.slice(0, 60);
    }

    return list;
  }, [djState.catalog, searchQuery, activeCatalogProfile, showOnlyFavorites, selectedArtist, djState.profiles]);

  // Format mm:ss
  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs) || secs < 0) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Progress percent
  const progressPercent = useMemo(() => {
    if (!djState.duration || djState.duration <= 0) return 0;
    return Math.min(100, Math.max(0, (interpolatedTime / djState.duration) * 100));
  }, [interpolatedTime, djState.duration]);

  // Guest QR URL
  const guestQrUrl = typeof window !== 'undefined'
    ? `${window.location.origin}?mode=guest&host=${targetHostId}`
    : `http://localhost:3000/?mode=guest&host=${targetHostId}`;
  const guestQrImage = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(guestQrUrl)}&color=00f0ff&bgcolor=06070e`;

  return (
    <div className="fixed inset-0 w-full h-full bg-[#06070e] text-white flex flex-col font-sans select-none overflow-hidden touch-manipulation">
      
      {/* ─── A. BARRA SUPERIOR (HEADER COMPACTO MODO VERTICAL) ─── */}
      <header className="w-full bg-[#0c0e18] border-b border-cyan-500/20 px-3.5 py-2 flex items-center justify-between z-30 shrink-0 shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <span className="text-base font-black tracking-tight flex items-center gap-1.5 font-mono">
            <span className="text-pink-500">🎤</span>
            <span className="bg-gradient-to-r from-cyan-400 via-white to-pink-400 bg-clip-text text-transparent">
              KaraokeLab
            </span>
          </span>
          <span className="px-1.5 py-0.5 rounded-md bg-gradient-to-r from-cyan-500/20 to-pink-500/20 border border-cyan-400/40 text-[9px] font-black text-cyan-300 font-mono tracking-wider uppercase">
            DJ REMOTE
          </span>
        </div>

        {/* Action Buttons & Status LED */}
        <div className="flex items-center gap-1.5">
          {/* Room Code Badge (Tappable to change room) */}
          <button
            type="button"
            onClick={() => {
              setTempRoomCodeInput(roomCode === 'DEFAULT' ? '' : roomCode || '');
              setIsRoomCodeModalOpen(true);
            }}
            className={`px-2 py-1 rounded-lg ${
              roomCode === 'DEFAULT' || !roomCode
                ? 'bg-amber-500/20 border-amber-400/80 text-amber-300 animate-pulse'
                : 'bg-[#121626] border-cyan-500/40 text-cyan-300 hover:bg-cyan-950/50'
            } border active:scale-95 transition-all flex items-center gap-1 text-[11px] font-bold cursor-pointer font-mono`}
            title="Código de Sala DJ (Toca para cambiar de sala)"
          >
            <Radio className="w-3 h-3 text-cyan-400 shrink-0" />
            <span className="text-white font-black">
              {roomCode === 'DEFAULT' || !roomCode ? 'Ingresar Sala' : roomCode}
            </span>
          </button>

          {/* QR Clientes */}
          <button
            type="button"
            onClick={() => setIsGuestQrModalOpen(true)}
            className="px-2 py-1 rounded-lg bg-[#121626] hover:bg-cyan-950/50 border border-cyan-500/40 text-cyan-300 active:scale-95 transition-all flex items-center gap-1 text-[11px] font-bold cursor-pointer"
            title="Mostrar QR de Pedidos para Clientes"
          >
            <QrCode className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-mono">QR</span>
          </button>

          {/* 🔌 Reposo Button (30x30px square with subtle red border) */}
          <button
            type="button"
            onClick={handleToggleSleep}
            className="w-[30px] h-[30px] rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/40 active:scale-95 transition-all flex items-center justify-center cursor-pointer text-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.15)]"
            title="Pausar conexión para ahorrar batería"
          >
            <Power className="w-3.5 h-3.5 text-rose-400" />
          </button>

          {/* LED Pulsante */}
          <div className="flex items-center pl-0.5">
            <span
              className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                djState.isPlaying
                  ? 'bg-[#00ff9d] shadow-[0_0_10px_#00ff9d] animate-pulse'
                  : 'bg-slate-600'
              }`}
              title={djState.isPlaying ? 'Música sonando' : 'Música en pausa'}
            />
          </div>
        </div>
      </header>

      {/* ─── BANNER DE ESTADO / RECONEXIÓN AUTOMÁTICA EN VIVO ─── */}
      {connectionStatus !== 'connected' && !isSleepMode && (
        <div
          onClick={() => {
            window.location.reload();
          }}
          className="w-full bg-gradient-to-r from-cyan-950 via-indigo-950 to-pink-950 border-b border-cyan-500/30 px-3.5 py-2 flex items-center justify-between z-40 text-xs font-bold text-white shadow-md cursor-pointer transition-all active:scale-[0.99]"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-pink-400 animate-ping shrink-0" />
            <span className="text-[11px] truncate text-slate-200 font-semibold">
              {connectionStatus === 'reconnecting' ? 'Reconectando con la cabina...' : 'Conexión en espera · Toca para reconectar'}
            </span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              window.location.reload();
            }}
            className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-cyan-500/40 to-pink-500/40 hover:from-cyan-500/60 hover:to-pink-500/60 border border-cyan-400/60 text-[10px] font-mono text-cyan-200 font-black shrink-0 active:scale-95 cursor-pointer shadow-[0_0_10px_rgba(0,240,255,0.3)]"
          >
            Reconectar ⚡
          </button>
        </div>
      )}

      {/* ─── B. TARJETA DE CANCIÓN ACTUAL (NOW PLAYING) ─── */}
      <section className="w-full bg-[#0a0c16] border-b border-white/5 px-4 py-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-black text-white truncate leading-tight tracking-wide">
              {djState.songTitle ? djState.songTitle : '— Sin canción activa —'}
            </h2>
            <p className="text-[11px] text-cyan-400/80 truncate font-medium mt-0.5">
              {djState.songArtist ? djState.songArtist : 'KaraokeLab Studio Engine'}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="px-2 py-0.5 rounded-md bg-[#121626] border border-cyan-500/30 text-[10px] font-mono text-cyan-300 font-bold">
              {djState.detectedKey || 'Am'}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-[#121626] border border-pink-500/30 text-[10px] font-mono text-pink-300 font-bold">
              {localBpm} BPM
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-2.5">
          <div className="w-full h-1.5 rounded-full bg-slate-900 border border-white/10 overflow-hidden relative">
            <div
              className="h-full bg-gradient-to-r from-[#00f0ff] via-purple-500 to-[#ff007f] transition-all duration-300 shadow-[0_0_8px_rgba(0,240,255,0.7)]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-[10px] font-mono text-slate-400 mt-1">
            <span>{formatTime(interpolatedTime)}</span>
            <span>{formatTime(djState.duration)}</span>
          </div>
        </div>
      </section>

      {/* ─── MAIN CONTENT CONTAINER ─── */}
      <main className={`flex-1 flex flex-col min-h-0 ${activeTab === 'chat' && selectedChatProfileId ? 'overflow-hidden px-3 pt-2 pb-20' : 'overflow-y-auto px-4 py-3 pb-20 space-y-3.5'}`}>

        {/* ═════════════════════════════════════════════════════════ */}
        {/* PESTAÑA 1: MANDOS (CONTROL MAESTRO)                       */}
        {/* ═════════════════════════════════════════════════════════ */}
        {activeTab === 'controls' && (
          <div className="flex flex-col space-y-3 animate-in fade-in duration-200">
            
            {/* 1. Tonalidad & Tempo (Pitch & BPM Compact Box) */}
            <div className="grid grid-cols-2 gap-2.5">
              {/* Pitch Controller */}
              <div className="p-2.5 rounded-2xl bg-[#0c0e1a] border border-cyan-500/30 flex flex-col justify-between shadow-[0_0_15px_rgba(0,240,255,0.05)]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-cyan-400 font-mono tracking-wider">
                    TONO / PITCH
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setLocalPitch(0);
                      sendAction('setPitch', { semitones: 0 });
                      showToast('Tono original restablecido (0)', 'cyan');
                    }}
                    className="px-1.5 py-0.5 rounded bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-500/40 text-[9px] font-black text-cyan-300 font-mono active:scale-95 transition-all cursor-pointer"
                  >
                    ORG
                  </button>
                </div>

                <div className="my-1.5 text-center">
                  <span className="text-xs font-black font-mono text-white tracking-wide block truncate">
                    {currentKeyDisplay}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.max(-6, localPitch - 1);
                      setLocalPitch(next);
                      sendAction('setPitch', { semitones: next });
                    }}
                    className="py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-cyan-500/30 active:scale-95 text-cyan-300 font-black text-sm flex items-center justify-center cursor-pointer transition-all"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.min(6, localPitch + 1);
                      setLocalPitch(next);
                      sendAction('setPitch', { semitones: next });
                    }}
                    className="py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-cyan-500/30 active:scale-95 text-cyan-300 font-black text-sm flex items-center justify-center cursor-pointer transition-all"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* BPM / Tempo Controller */}
              <div className="p-2.5 rounded-2xl bg-[#0c0e1a] border border-pink-500/30 flex flex-col justify-between shadow-[0_0_15px_rgba(255,0,127,0.05)]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-pink-400 font-mono tracking-wider">
                    TEMPO / BPM
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {localBpm}
                  </span>
                </div>

                <div className="my-1.5 text-center">
                  <span className="text-sm font-black font-mono text-pink-300 tracking-wide">
                    {localBpm} <span className="text-[10px] text-pink-400/80 font-normal">BPM</span>
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.max(40, localBpm - 2);
                      setLocalBpm(next);
                      sendAction('setBpm', { bpm: next });
                    }}
                    className="py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-pink-500/30 active:scale-95 text-pink-300 font-black text-sm flex items-center justify-center cursor-pointer transition-all"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.min(240, localBpm + 2);
                      setLocalBpm(next);
                      sendAction('setBpm', { bpm: next });
                    }}
                    className="py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-pink-500/30 active:scale-95 text-pink-300 font-black text-sm flex items-center justify-center cursor-pointer transition-all"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* 2. Reproducción (Transporte Maestro) */}
            <div className="p-3 rounded-2xl bg-[#0b0d18] border border-white/10 flex flex-col space-y-2.5">
              {/* Main Transport Row: STOP, PLAY/PAUSE, NEXT */}
              <div className="grid grid-cols-3 gap-2 items-center">
                {/* ⏹️ STOP */}
                <button
                  type="button"
                  onClick={() => {
                    sendAction('stop');
                    showToast('⏹️ Reproducción detenida', 'pink');
                  }}
                  className="py-3 px-2 rounded-2xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/60 active:scale-95 transition-all cursor-pointer flex flex-col items-center justify-center gap-1 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.15)]"
                >
                  <Square className="w-5 h-5 fill-rose-500/40 text-rose-400" />
                  <span className="text-[10px] font-black uppercase tracking-wider">STOP</span>
                </button>

                {/* ▶ PLAY / ⏸️ PAUSE (Grande, Neón Esmeralda/Ámbar) */}
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  className={`py-3.5 px-2 rounded-2xl active:scale-95 transition-all cursor-pointer flex flex-col items-center justify-center gap-1 ${
                    djState.isPlaying
                      ? 'bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.35)]'
                      : 'bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400 text-emerald-300 shadow-[0_0_22px_rgba(16,185,129,0.45)]'
                  }`}
                >
                  {djState.isPlaying ? (
                    <Pause className="w-6 h-6 fill-amber-300 text-amber-300" />
                  ) : (
                    <Play className="w-6 h-6 fill-emerald-300 text-emerald-300" />
                  )}
                  <span className="text-[11px] font-black uppercase tracking-wider">
                    {djState.isPlaying ? 'PAUSAR' : 'PLAY'}
                  </span>
                </button>

                {/* ⏭️ SIGUIENTE */}
                <button
                  type="button"
                  onClick={() => {
                    sendAction('nextSong');
                    showToast('⏭️ Saltando a siguiente canción', 'cyan');
                  }}
                  className="py-3 px-2 rounded-2xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/60 active:scale-95 transition-all cursor-pointer flex flex-col items-center justify-center gap-1 text-cyan-300 shadow-[0_0_12px_rgba(0,240,255,0.15)]"
                >
                  <SkipForward className="w-5 h-5 fill-cyan-400/40 text-cyan-300" />
                  <span className="text-[10px] font-black uppercase tracking-wider">SIGUIENTE</span>
                </button>
              </div>

              {/* Full-width: Reiniciar Canción */}
              <button
                type="button"
                onClick={() => {
                  sendAction('restart');
                  showToast('⏮️ Canción reiniciada a 00:00', 'cyan');
                }}
                className="w-full py-2 px-3 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-white/10 active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2 text-xs font-bold text-slate-300"
              >
                <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
                <span>Reiniciar Canción</span>
              </button>
            </div>

            {/* 3. Funciones de Guía */}
            <div className="grid grid-cols-2 gap-2.5">
              {/* Voz Guía 40% */}
              {(() => {
                const isClean = Boolean(djState.isCleanTrack);
                const isGuideActive = Boolean(djState.isGuideVoiceActive || (localVocalGain >= 0.35 && !isClean));
                return (
                  <button
                    type="button"
                    onClick={() => {
                      sendAction('toggleGuideVoice');
                      showToast(
                        isGuideActive ? '🎤 Voz Guía apagada' : '🎤 Voz Guía activada al 40%',
                        'pink'
                      );
                    }}
                    className={`py-2.5 px-3 rounded-2xl border active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wide ${
                      isGuideActive
                        ? 'bg-pink-500/25 border-pink-400 text-pink-200 shadow-[0_0_15px_rgba(255,0,127,0.4)]'
                        : 'bg-[#0c0e1a] border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Mic className={`w-4 h-4 ${isGuideActive ? 'text-pink-400' : 'text-slate-500'}`} />
                    <span>Voz Guía 40%</span>
                    {isGuideActive && (
                      <span className="w-2 h-2 rounded-full bg-pink-400 shadow-[0_0_6px_#ff007f] animate-pulse shrink-0" />
                    )}
                  </button>
                );
              })()}

              {/* Pista Limpia */}
              {(() => {
                const isClean = Boolean(djState.isCleanTrack);
                return (
                  <button
                    type="button"
                    onClick={() => {
                      sendAction('toggleCleanTrack');
                      showToast(
                        isClean ? '✨ Pista Limpia apagada' : '✨ Pista Limpia activada',
                        'cyan'
                      );
                    }}
                    className={`py-2.5 px-3 rounded-2xl border active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wide ${
                      isClean
                        ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 shadow-[0_0_15px_rgba(0,240,255,0.4)]'
                        : 'bg-[#0c0e1a] border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Sparkles className={`w-4 h-4 ${isClean ? 'text-cyan-400' : 'text-slate-500'}`} />
                    <span>Pista Limpia</span>
                    {isClean && (
                      <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_#00f0ff] animate-pulse shrink-0" />
                    )}
                  </button>
                );
              })()}
            </div>

            {/* 4. Mezcla de Audio en Vivo (Faders con Candado de Seguridad) */}
            <div className="p-3.5 rounded-3xl bg-[#090b14] border border-cyan-500/30 shadow-[0_0_20px_rgba(0,240,255,0.08)] flex flex-col space-y-3">
              
              {/* Candado Header */}
              <div className="flex items-center justify-between pb-1 border-b border-white/5">
                <div className="flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-200">
                    Faders en Vivo
                  </span>
                </div>

                {/* Lock Button */}
                <button
                  type="button"
                  onClick={handleToggleLock}
                  className={`px-2.5 py-1 rounded-xl border text-xs font-black font-mono transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 ${
                    isMixerUnlocked
                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.35)]'
                      : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                  }`}
                >
                  {isMixerUnlocked ? (
                    <>
                      <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                      <span>🔓 Desbloqueado ({unlockRemainingSeconds}s)</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-3.5 h-3.5 text-rose-400" />
                      <span>🔒 Bloqueado</span>
                    </>
                  )}
                </button>
              </div>

              {/* Faders Area */}
              <div
                className={`flex flex-col space-y-3.5 transition-opacity duration-300 ${
                  isMixerUnlocked ? 'opacity-100' : 'opacity-45 pointer-events-none'
                }`}
                onTouchStart={resetUnlockTimer}
              >
                {/* Fader 1: Voz Original */}
                <div className="flex flex-col space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-pink-300 flex items-center gap-1.5">
                      <Mic className="w-3.5 h-3.5 text-pink-400" />
                      Voz Original
                    </span>
                    <span className="font-mono font-bold text-pink-400 text-[11px]">
                      {localVocalGain === 0 ? '0% (MUTE)' : `${Math.round(localVocalGain * 100)}%`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={localVocalGain}
                    onChange={(e) => {
                      resetUnlockTimer();
                      const val = parseFloat(e.target.value);
                      setLocalVocalGain(val);
                      sendAction('setVocalGain', { val });
                    }}
                    className="w-full accent-pink-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
                  />
                </div>

                {/* Fader 2: Música / Instrumental */}
                <div className="flex flex-col space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-cyan-300 flex items-center gap-1.5">
                      <Music className="w-3.5 h-3.5 text-cyan-400" />
                      Música / Instrumental
                    </span>
                    <span className="font-mono font-bold text-cyan-400 text-[11px]">
                      {Math.round(localMusicGain * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={localMusicGain}
                    onChange={(e) => {
                      resetUnlockTimer();
                      const val = parseFloat(e.target.value);
                      setLocalMusicGain(val);
                      sendAction('setMusicGain', { val });
                    }}
                    className="w-full accent-cyan-400 cursor-pointer h-2 bg-slate-800 rounded-lg"
                  />
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ═════════════════════════════════════════════════════════ */}
        {/* PESTAÑA 2: COLA (QUEUE)                                   */}
        {/* ═════════════════════════════════════════════════════════ */}
        {activeTab === 'queue' && (
          <div className="flex flex-col space-y-2.5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-black uppercase tracking-wider text-cyan-300 flex items-center gap-1.5 font-mono">
                <ListMusic className="w-4 h-4 text-cyan-400" />
                <span>Lista de Turnos ({djState.queue.length})</span>
              </h3>
              {djState.queue.length > 0 && (
                <span className="text-[10px] text-slate-400 font-mono">
                  En orden de reproducción
                </span>
              )}
            </div>

            {djState.queue.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center p-4 bg-[#0a0c16] rounded-3xl border border-white/5">
                <Disc className="w-12 h-12 text-slate-700 animate-spin" />
                <p className="mt-3 text-sm font-bold text-slate-400">
                  No hay canciones en la cola
                </p>
                <p className="text-xs text-slate-500 mt-1 max-w-xs">
                  Busca en el Catálogo o aprueba peticiones de los invitados para armar la tanda.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('catalog')}
                  className="mt-4 px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-300 text-xs font-bold active:scale-95 transition-all cursor-pointer"
                >
                  Ir al Catálogo
                </button>
              </div>
            ) : (
              <div className="flex flex-col space-y-2">
                {djState.queue.map((item, idx) => (
                  <div
                    key={item.id || idx}
                    className="p-3 rounded-2xl bg-[#0c0e1a] border border-cyan-500/20 hover:border-cyan-500/40 flex items-center justify-between gap-2.5 shadow-sm transition-all"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="w-6 h-6 rounded-lg bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 font-mono font-black text-xs flex items-center justify-center shrink-0">
                        #{idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-black text-white truncate">
                          {item.title}
                        </h4>
                        <p className="text-[10.5px] text-cyan-400/80 truncate font-medium">
                          {item.artist || 'Artista'}
                          {item.requestedBy && (
                            <span className="text-pink-300 font-bold ml-1.5">
                              • 🎤 {item.requestedBy} {item.tableNumber ? `(${item.tableNumber})` : ''}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* ▶ Tocar */}
                      <button
                        type="button"
                        onClick={() => {
                          sendAction('playQueueItem', { id: item.id, songId: item.songId });
                          showToast(`▶ Reproduciendo: ${item.title}`, 'emerald');
                        }}
                        className="px-2.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/50 text-emerald-300 text-[11px] font-black uppercase flex items-center gap-1 active:scale-95 transition-all cursor-pointer"
                      >
                        <Play className="w-3 h-3 fill-emerald-300" />
                        <span>Tocar</span>
                      </button>

                      {/* ✕ Eliminar */}
                      <button
                        type="button"
                        onClick={() => {
                          sendAction('removeFromQueue', { id: item.id });
                          showToast(`✕ Eliminado de la cola`, 'pink');
                        }}
                        className="p-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 active:scale-95 transition-all cursor-pointer"
                        title="Eliminar de la cola"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═════════════════════════════════════════════════════════ */}
        {/* PESTAÑA 3: CATÁLOGO / BÚSQUEDA                             */}
        {/* ═════════════════════════════════════════════════════════ */}
        {activeTab === 'catalog' && (
          <div className="flex flex-col space-y-3 animate-in fade-in duration-200">
            
            {/* Search Bar with Instant Clear & Keyboard Blur on Enter */}
            <div className="relative w-full">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                placeholder="Buscar por título, artista o género..."
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    searchInputRef.current?.blur();
                  }
                }}
                className="w-full bg-[#0c0e1a] border border-cyan-500/40 focus:border-cyan-300 rounded-2xl pl-10 pr-10 py-2.5 text-xs text-white placeholder-slate-500 outline-none shadow-[0_0_15px_rgba(0,240,255,0.08)] transition-all font-medium"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Top Collapsible Filter Toggles Bar */}
            <div className="flex items-center gap-2">
              {/* Botón Desplegable: Cantantes & Favoritos */}
              <button
                type="button"
                onClick={() => {
                  setIsSingersFilterOpen((prev) => !prev);
                  if (!isSingersFilterOpen) setIsArtistsFilterOpen(false);
                }}
                className={`flex-1 py-1.5 px-2.5 rounded-xl border text-[11px] font-bold transition-all flex items-center justify-between active:scale-95 cursor-pointer ${
                  selectedCatalogProfileId || showOnlyFavorites
                    ? 'bg-pink-500/20 border-pink-400/80 text-pink-200 shadow-[0_0_10px_rgba(255,0,127,0.25)]'
                    : isSingersFilterOpen
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-[#0c0e1a] border-white/10 text-slate-300 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <User className="w-3.5 h-3.5 text-pink-400 shrink-0" />
                  <span className="truncate">
                    {activeCatalogProfile
                      ? `${activeCatalogProfile.avatar || '👤'} ${activeCatalogProfile.name}`
                      : showOnlyFavorites
                      ? '⭐ Favoritos'
                      : 'Cantantes & Favs'}
                  </span>
                </div>
                {isSingersFilterOpen ? (
                  <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
                )}
              </button>

              {/* Botón Desplegable: Artistas */}
              {uniqueArtists.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setIsArtistsFilterOpen((prev) => !prev);
                    if (!isArtistsFilterOpen) setIsSingersFilterOpen(false);
                  }}
                  className={`flex-1 py-1.5 px-2.5 rounded-xl border text-[11px] font-bold transition-all flex items-center justify-between active:scale-95 cursor-pointer ${
                    selectedArtist
                      ? 'bg-cyan-500/20 border-cyan-400/80 text-cyan-200 shadow-[0_0_10px_rgba(0,240,255,0.25)]'
                      : isArtistsFilterOpen
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                      : 'bg-[#0c0e1a] border-white/10 text-slate-300 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <Music className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="truncate">
                      {selectedArtist ? selectedArtist : `Artistas (${uniqueArtists.length})`}
                    </span>
                  </div>
                  {isArtistsFilterOpen ? (
                    <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
                  )}
                </button>
              )}

              {/* Reset Filters Icon Button if any filter is active */}
              {(selectedCatalogProfileId || showOnlyFavorites || selectedArtist) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCatalogProfileId(null);
                    setShowOnlyFavorites(false);
                    setSelectedArtist(null);
                  }}
                  className="p-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/50 text-rose-300 active:scale-95 transition-all shrink-0 cursor-pointer"
                  title="Restablecer filtros"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Panel Desplegable 1: Cantantes & Favoritos */}
            {isSingersFilterOpen && (
              <div className="p-2.5 rounded-2xl bg-[#0a0c16] border border-pink-500/30 shadow-[0_0_15px_rgba(255,0,127,0.08)] flex flex-col space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span className="font-bold text-pink-300 uppercase tracking-wider flex items-center gap-1">
                    <span>Biblioteca de Cantantes</span>
                  </span>
                  {(selectedCatalogProfileId || showOnlyFavorites) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCatalogProfileId(null);
                        setShowOnlyFavorites(false);
                      }}
                      className="text-pink-400 font-bold hover:underline"
                    >
                      Todos ✕
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar touch-pan-x">
                  {/* Chip: Todos */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCatalogProfileId(null);
                      setShowOnlyFavorites(false);
                    }}
                    className={`px-3 py-1.5 rounded-xl border text-[11px] font-bold shrink-0 transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer ${
                      !selectedCatalogProfileId && !showOnlyFavorites
                        ? 'bg-pink-500/25 border-pink-400 text-pink-200 shadow-[0_0_10px_rgba(255,0,127,0.3)]'
                        : 'bg-[#0c0e1a] border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>Todos</span>
                  </button>

                  {/* Chip: ⭐ Todos los Favoritos */}
                  {(() => {
                    const totalFavs = (djState.profiles || []).reduce(
                      (acc, p) => acc + (p.favoriteSongIds?.length || 0),
                      0
                    );
                    if (totalFavs === 0) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCatalogProfileId(null);
                          setShowOnlyFavorites((prev) => !prev);
                        }}
                        className={`px-3 py-1.5 rounded-xl border text-[11px] font-bold shrink-0 transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer ${
                          showOnlyFavorites && !selectedCatalogProfileId
                            ? 'bg-amber-500/25 border-amber-400 text-amber-300 shadow-[0_0_14px_rgba(245,158,11,0.35)]'
                            : 'bg-[#0c0e1a] border-white/10 text-slate-400 hover:text-amber-300'
                        }`}
                      >
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                        <span>Favoritos ({totalFavs})</span>
                      </button>
                    );
                  })()}

                  {/* Chips de Perfiles */}
                  {(djState.profiles || []).map((prof) => {
                    const isSelected = selectedCatalogProfileId === prof.id;
                    const favCount = prof.favoriteSongIds?.length || 0;
                    return (
                      <button
                        key={prof.id}
                        type="button"
                        onClick={() => {
                          setShowOnlyFavorites(false);
                          setSelectedCatalogProfileId((curr) => (curr === prof.id ? null : prof.id));
                        }}
                        className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold shrink-0 transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer ${
                          isSelected
                            ? 'bg-pink-500/25 border-pink-400 text-pink-200 shadow-[0_0_14px_rgba(255,0,127,0.35)]'
                            : 'bg-[#0c0e1a] border-white/10 text-slate-300 hover:text-white'
                        }`}
                      >
                        <span className="text-xs">{prof.avatar || '🎤'}</span>
                        <span className="truncate max-w-[95px]">{prof.name}</span>
                        {favCount > 0 && (
                          <span className="px-1.5 py-0.2 rounded-md bg-pink-500/30 text-pink-300 text-[9px] font-mono">
                            ★ {favCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Panel Desplegable 2: Artistas */}
            {isArtistsFilterOpen && uniqueArtists.length > 0 && (
              <div className="p-2.5 rounded-2xl bg-[#0a0c16] border border-cyan-500/30 shadow-[0_0_15px_rgba(0,240,255,0.08)] flex flex-col space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span className="font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1">
                    <span>Artistas ({uniqueArtists.length})</span>
                  </span>
                  {selectedArtist && (
                    <button
                      type="button"
                      onClick={() => setSelectedArtist(null)}
                      className="text-cyan-400 font-bold hover:underline"
                    >
                      Ver todos ✕
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar touch-pan-x">
                  <button
                    type="button"
                    onClick={() => setSelectedArtist(null)}
                    className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold shrink-0 transition-all active:scale-95 cursor-pointer ${
                      !selectedArtist
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                        : 'bg-[#0c0e1a] border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    Todos
                  </button>
                  {uniqueArtists.slice(0, 30).map(({ artist, count }) => {
                    const isSelected = selectedArtist === artist;
                    return (
                      <button
                        key={artist}
                        type="button"
                        onClick={() => setSelectedArtist((curr) => (curr === artist ? null : artist))}
                        className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold shrink-0 transition-all active:scale-95 flex items-center gap-1 cursor-pointer ${
                          isSelected
                            ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 shadow-[0_0_10px_rgba(0,240,255,0.3)]'
                            : 'bg-[#0c0e1a] border-white/10 text-slate-400 hover:text-white'
                        }`}
                      >
                        <span className="truncate max-w-[110px]">{artist}</span>
                        <span className="text-[9px] text-slate-500 font-mono">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Results Count & Active Filter Indicator */}
            <div className="flex justify-between items-center px-1 text-[10.5px] font-mono text-slate-400">
              <span>{filteredCatalog.length} canciones</span>
              {activeCatalogProfile && (
                <span className="text-pink-400 flex items-center gap-1 truncate max-w-[170px]">
                  <span>⭐ Favoritos de {activeCatalogProfile.name}</span>
                </span>
              )}
              {showOnlyFavorites && !activeCatalogProfile && (
                <span className="text-amber-400 flex items-center gap-1">
                  <span>⭐ Todos los Favoritos</span>
                </span>
              )}
              {selectedArtist && (
                <span className="text-cyan-400 truncate max-w-[150px]">
                  🎤 {selectedArtist}
                </span>
              )}
              {searchQuery && !activeCatalogProfile && !selectedArtist && !showOnlyFavorites && (
                <span className="text-cyan-400">"{searchQuery}"</span>
              )}
            </div>

            {/* Catalog List */}
            {filteredCatalog.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center p-4 bg-[#0a0c16] rounded-3xl border border-white/5">
                <Search className="w-10 h-10 text-slate-600" />
                <p className="mt-3 text-sm font-bold text-slate-400">
                  No se encontraron coincidencias
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {activeCatalogProfile
                    ? `El cantante ${activeCatalogProfile.name} no tiene canciones marcadas como favoritas.`
                    : 'Intenta con otro término o restablece los filtros.'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col space-y-2">
                {filteredCatalog.map((song) => {
                  const isEnqueued = actionButtonFeedback[`queue_${song.id}`];
                  const isPlayingNow = actionButtonFeedback[`play_${song.id}`];
                  const isSongFavorite = (djState.profiles || []).some((p) =>
                    (p.favoriteSongIds || []).includes(song.id)
                  );

                  return (
                    <div
                      key={song.id}
                      className="p-3 rounded-2xl bg-[#0c0e1a] border border-white/10 hover:border-cyan-500/40 flex items-center justify-between gap-2.5 transition-all"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-xs font-black text-white truncate">
                            {song.title}
                          </h4>
                          {isSongFavorite && (
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />
                          )}
                        </div>
                        <p className="text-[10.5px] text-cyan-400/80 truncate font-medium mt-0.5">
                          {song.artist || 'Artista'}
                          {song.bpm ? ` • ${song.bpm} BPM` : ''}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* ➕ Cola */}
                        <button
                          type="button"
                          onClick={() => {
                            sendAction('addLibrarySongToQueue', { id: song.id, title: song.title });
                            setActionButtonFeedback((prev) => ({ ...prev, [`queue_${song.id}`]: '✓ Encolada' }));
                            showToast(`✓ "${song.title}" añadida a la cola`, 'pink');
                            setTimeout(() => {
                              setActionButtonFeedback((prev) => {
                                const copy = { ...prev };
                                delete copy[`queue_${song.id}`];
                                return copy;
                              });
                            }, 2000);
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-pink-500/20 hover:bg-pink-500/30 border border-pink-400/50 text-pink-300 text-[11px] font-black uppercase flex items-center gap-1 active:scale-95 transition-all cursor-pointer"
                        >
                          {isEnqueued ? (
                            <>
                              <Check className="w-3 h-3 text-pink-300" />
                              <span>{isEnqueued}</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3 h-3" />
                              <span>Cola</span>
                            </>
                          )}
                        </button>

                        {/* ▶ Tocar */}
                        <button
                          type="button"
                          onClick={() => {
                            sendAction('playLibrarySongNow', { id: song.id, title: song.title });
                            setActionButtonFeedback((prev) => ({ ...prev, [`play_${song.id}`]: '▶ Sonando' }));
                            showToast(`▶ Reproduciendo: "${song.title}"`, 'cyan');
                            setTimeout(() => {
                              setActionButtonFeedback((prev) => {
                                const copy = { ...prev };
                                delete copy[`play_${song.id}`];
                                return copy;
                              });
                            }, 2000);
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-300 text-[11px] font-black uppercase flex items-center gap-1 active:scale-95 transition-all cursor-pointer"
                        >
                          {isPlayingNow ? (
                            <>
                              <Disc className="w-3 h-3 animate-spin text-cyan-300" />
                              <span>{isPlayingNow}</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 fill-cyan-300" />
                              <span>Tocar</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═════════════════════════════════════════════════════════ */}
        {/* PESTAÑA 4: CHAT INDIVIDUAL POR PERSONA / MESA (WHATSAPP)  */}
        {/* ═════════════════════════════════════════════════════════ */}
        {activeTab === 'chat' && (
          <div className={`flex flex-col ${selectedChatProfileId ? 'flex-1 min-h-0 h-full overflow-hidden' : 'space-y-2.5'} animate-in fade-in duration-200`}>
            {/* ── CASO A: BANDEJA DE CONVERSACIONES (LISTA DE CHATS) ── */}
            {!selectedChatProfileId ? (
              <div className="flex flex-col space-y-2.5">
                {/* Header */}
                <div className="flex items-center justify-between px-1 shrink-0">
                  <div className="flex items-center gap-1.5 font-mono">
                    <MessageSquare className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-cyan-300">
                      Conversaciones ({conversationThreads.length})
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsGuestQrModalOpen(true)}
                    className="text-[10px] text-pink-400 hover:underline flex items-center gap-1 font-bold cursor-pointer"
                  >
                    <QrCode className="w-3 h-3" />
                    <span>QR Mesas</span>
                  </button>
                </div>

                {conversationThreads.length === 0 ? (
                  <div className="py-14 flex flex-col items-center justify-center text-center p-5 bg-[#0a0c16] rounded-3xl border border-white/5">
                    <div className="w-14 h-14 rounded-2xl bg-cyan-950/60 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mb-3 shadow-[0_0_20px_rgba(0,240,255,0.15)]">
                      <MessageSquare className="w-7 h-7" />
                    </div>
                    <p className="text-sm font-bold text-slate-200">
                      No hay conversaciones activas
                    </p>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
                      Cuando los clientes escaneen el código QR de sus mesas o envíen un mensaje, aparecerán aquí sus chats individuales.
                    </p>
                    <button
                      type="button"
                      onClick={() => setIsGuestQrModalOpen(true)}
                      className="mt-4 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500/20 to-pink-500/20 hover:from-cyan-500/30 hover:to-pink-500/30 border border-cyan-400/50 text-cyan-300 text-xs font-bold active:scale-95 transition-all cursor-pointer flex items-center gap-2 shadow-sm"
                    >
                      <QrCode className="w-4 h-4 text-pink-400" />
                      <span>Mostrar QR para Clientes</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col space-y-2">
                    {conversationThreads.map((thread) => {
                      const hasUnread = Boolean(thread.unreadCount && thread.unreadCount > 0);

                      return (
                        <button
                          key={thread.id}
                          type="button"
                          onClick={() => {
                            setSelectedChatProfileId(thread.id);
                            markThreadAsRead(thread.id);
                          }}
                          className={`w-full p-3 rounded-2xl border active:scale-[0.98] transition-all cursor-pointer flex items-center justify-between gap-3 text-left shadow-sm group ${
                            hasUnread
                              ? 'bg-pink-950/35 border-pink-500/70 shadow-[0_0_15px_rgba(255,0,127,0.2)]'
                              : 'bg-[#0c0e1a] border-cyan-500/20 hover:border-cyan-500/50 hover:bg-[#101426]'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className={`w-11 h-11 rounded-2xl border flex items-center justify-center text-xl shrink-0 shadow-inner group-hover:scale-105 transition-transform relative ${
                              hasUnread ? 'bg-pink-950 border-pink-400 text-pink-300' : 'bg-[#14182c] border-cyan-500/30'
                            }`}>
                              {thread.avatar}
                              {hasUnread && (
                                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-pink-500 animate-ping border border-black" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className={`text-xs truncate transition-colors ${
                                  hasUnread ? 'font-black text-pink-200' : 'font-bold text-white group-hover:text-cyan-300'
                                }`}>
                                  {thread.name}
                                </h4>
                                {hasUnread ? (
                                  <span className="px-2 py-0.5 rounded-full bg-pink-500 text-white font-mono text-[9px] font-black shadow-[0_0_10px_#ff007f] animate-bounce shrink-0">
                                    {thread.unreadCount} nuevo{thread.unreadCount > 1 ? 's' : ''}
                                  </span>
                                ) : thread.lastTimestamp ? (
                                  <span className="text-[9px] text-slate-500 font-mono shrink-0">
                                    {new Date(thread.lastTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {thread.tableNumber && (
                                  <span className="px-1.5 py-0.2 rounded bg-pink-950/80 border border-pink-500/40 text-[8.5px] font-black text-pink-300 font-mono shrink-0">
                                    🪑 {thread.tableNumber}
                                  </span>
                                )}
                                <p className={`text-[11px] truncate flex-1 ${hasUnread ? 'text-pink-300 font-semibold' : 'text-slate-400'}`}>
                                  {thread.lastMessage}
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className={`flex items-center gap-1 shrink-0 transition-colors ${
                            hasUnread ? 'text-pink-400' : 'text-slate-500 group-hover:text-cyan-400'
                          }`}>
                            <ChevronRight className="w-4 h-4" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* ── CASO B: CHAT PRIVADO 1-A-1 CON LA PERSONA/MESA SELECCIONADA ── */
              <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden space-y-2 animate-in fade-in slide-in-from-right-2 duration-200">
                {/* Contact Top Bar with Back Button (Fixed at top) */}
                <div className="shrink-0 p-2.5 rounded-2xl bg-[#0c0e1a] border border-cyan-500/30 flex items-center justify-between gap-2 shadow-md z-10">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => setSelectedChatProfileId(null)}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 text-xs font-bold active:scale-95 transition-all cursor-pointer flex items-center gap-1 shrink-0 shadow-sm"
                    >
                      <span>←</span>
                      <span>Volver</span>
                    </button>

                    <div className="w-8 h-8 rounded-xl bg-[#14182c] border border-pink-500/40 flex items-center justify-center text-base shrink-0 shadow-inner">
                      {selectedThread?.avatar || '🎤'}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-xs font-black text-white truncate">
                          {selectedThread?.name || 'Cliente'}
                        </h3>
                        {selectedThread?.tableNumber && (
                          <span className="px-1.5 py-0.2 rounded bg-pink-950/80 border border-pink-500/40 text-[8.5px] font-black text-pink-300 font-mono">
                            🪑 {selectedThread.tableNumber}
                          </span>
                        )}
                      </div>
                      <p className="text-[9.5px] text-emerald-400 font-mono flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Chat directo 1 a 1</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Private Messages Stream (Only this scrolls) */}
                {(() => {
                  const currentThreadMsgs = (djState.chatMessages || []).filter((m) => {
                    const tId = selectedThread?.id;
                    const tName = (selectedThread?.name || '').toLowerCase().trim();
                    const tTable = (selectedThread?.tableNumber || '').toLowerCase().trim();

                    // Messages sent by this person/table
                    if (tId && m.senderProfileId && m.senderProfileId === tId) return true;
                    if (tName && m.senderName && m.senderName.toLowerCase().trim() === tName) return true;
                    if (tTable && m.tableNumber && m.tableNumber.toLowerCase().trim() === tTable) return true;

                    // Messages sent by DJ to this person/table
                    if (m.isHost || m.senderProfileId === 'profile_dj' || m.senderName === 'DJ (Cabina)' || m.senderName === 'Host / DJ') {
                      if (!m.targetProfileId) return true;
                      const target = m.targetProfileId.toLowerCase().trim();
                      if (tId && target === tId.toLowerCase()) return true;
                      if (tName && target === tName) return true;
                      if (tTable && (target === tTable || target.replace('mesa', '').trim() === tTable.replace('mesa', '').trim())) return true;
                    }
                    return false;
                  });

                  return (
                    <div className="flex-1 min-h-0 overflow-y-auto p-3 rounded-2xl bg-[#080a14] border border-cyan-500/20 flex flex-col space-y-3 shadow-inner scrollbar-thin">
                      {currentThreadMsgs.length === 0 ? (
                        <div className="py-12 flex flex-col items-center justify-center text-center p-4">
                          <MessageSquare className="w-10 h-10 text-slate-600 mb-2" />
                          <p className="text-xs font-bold text-slate-300">
                            No hay mensajes previos con {selectedThread?.name}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-1 max-w-xs">
                            Escribe una respuesta abajo o envía un emoji para iniciar la conversación.
                          </p>
                        </div>
                      ) : (
                        currentThreadMsgs.map((msg, idx) => {
                          const isDj = Boolean(
                            msg.isHost ||
                            msg.senderProfileId === 'profile_dj' ||
                            msg.senderName === 'DJ (Cabina)' ||
                            msg.senderName === 'Host / DJ'
                          );

                          return (
                            <div
                              key={msg.id || idx}
                              className={`flex flex-col ${isDj ? 'items-end' : 'items-start'} transition-all`}
                            >
                              <div className={`flex items-center gap-1.5 mb-1 px-1 ${isDj ? 'flex-row-reverse' : 'flex-row'}`}>
                                <span className="text-xs">{msg.avatar || (isDj ? '🎧' : '🎤')}</span>
                                <span
                                  className={`text-[10px] font-black ${
                                    isDj ? 'text-pink-400' : 'text-cyan-300'
                                  }`}
                                >
                                  {isDj ? 'DJ (Cabina) 🎧' : (msg.senderName || 'Cliente')}
                                </span>
                                <span className="text-[9px] text-slate-500 font-mono">
                                  {msg.timestamp
                                    ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                    : ''}
                                </span>
                              </div>

                              <div
                                className={`px-3.5 py-2.5 rounded-2xl max-w-[85%] text-xs font-medium leading-relaxed shadow-md select-text ${
                                  isDj
                                    ? 'bg-gradient-to-r from-pink-600 to-purple-700 text-white rounded-tr-none border border-pink-400/50 shadow-[0_0_15px_rgba(255,0,127,0.25)]'
                                    : 'bg-[#0f1224] border border-cyan-500/30 text-slate-100 rounded-tl-none shadow-[0_0_10px_rgba(0,240,255,0.05)]'
                                }`}
                              >
                                {msg.text}
                              </div>
                            </div>
                          );
                        })
                      )}
                      <div ref={chatEndRef} />
                    </div>
                  );
                })()}

                {/* Quick Emojis Reaction Bar (Fixed above input) */}
                <div className="shrink-0 flex items-center gap-1.5 overflow-x-auto py-1 px-0.5 scrollbar-none z-10">
                  {['🎤', '🔥', '👏', '🥳', '❤️', '🍻', '🎉', '⚡', '💃', '⭐', '🙌'].map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => handleSendDjMessage(emoji, selectedThread?.id)}
                      className="px-2.5 py-1.5 rounded-xl bg-[#0c0e1a] hover:bg-cyan-950/60 border border-white/10 hover:border-cyan-400/60 text-sm cursor-pointer transition-all shrink-0 hover:scale-110 active:scale-95 shadow-sm"
                      title={`Enviar ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>

                {/* Message Input Composer for Private Chat (Fixed at bottom) */}
                <div className="shrink-0 flex items-center gap-2 pt-0.5 z-10">
                  <input
                    type="text"
                    placeholder={`Responder a ${selectedThread?.name || 'la mesa'}...`}
                    value={chatInputText}
                    onChange={(e) => setChatInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && chatInputText.trim()) {
                        handleSendDjMessage(chatInputText, selectedThread?.id);
                      }
                    }}
                    className="flex-1 bg-[#0c0e1a] border border-cyan-500/40 focus:border-cyan-300 rounded-2xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 outline-none shadow-[0_0_15px_rgba(0,240,255,0.08)] transition-all font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => handleSendDjMessage(chatInputText, selectedThread?.id)}
                    disabled={!chatInputText.trim()}
                    className="p-2.5 rounded-2xl bg-gradient-to-r from-pink-500 to-purple-600 disabled:opacity-40 text-white cursor-pointer shadow-md hover:scale-105 active:scale-95 transition-all flex items-center justify-center shrink-0"
                    title="Enviar mensaje"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      </main>

      {/* ─── G. BARRA DE NAVEGACIÓN INFERIOR (FIJA) ─── */}
      <nav className="fixed bottom-0 left-0 right-0 h-16 bg-[#080a14] border-t border-cyan-500/20 px-2 flex items-center justify-around z-40 shadow-[0_-4px_25px_rgba(0,0,0,0.7)]">
        
        {/* Tab 1: Mandos */}
        <button
          type="button"
          onClick={() => setActiveTab('controls')}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
            activeTab === 'controls'
              ? 'text-cyan-300 font-black'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="relative">
            <Sliders className={`w-5 h-5 ${activeTab === 'controls' ? 'text-cyan-400 scale-110 drop-shadow-[0_0_8px_rgba(0,240,255,0.7)]' : ''}`} />
          </div>
          <span className="text-[10.5px] mt-1 tracking-tight">Mandos</span>
        </button>

        {/* Tab 2: Cola */}
        <button
          type="button"
          onClick={() => setActiveTab('queue')}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
            activeTab === 'queue'
              ? 'text-cyan-300 font-black'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="relative">
            <ListMusic className={`w-5 h-5 ${activeTab === 'queue' ? 'text-cyan-400 scale-110 drop-shadow-[0_0_8px_rgba(0,240,255,0.7)]' : ''}`} />
            {djState.queue && djState.queue.length > 0 && (
              <span className="absolute -top-1 -right-2 px-1.5 py-0.2 rounded-full bg-cyan-500 text-black font-mono font-black text-[9px]">
                {djState.queue.length}
              </span>
            )}
          </div>
          <span className="text-[10.5px] mt-1 tracking-tight">Cola</span>
        </button>

        {/* Tab 3: Catálogo */}
        <button
          type="button"
          onClick={() => setActiveTab('catalog')}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
            activeTab === 'catalog'
              ? 'text-cyan-300 font-black'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="relative">
            <Search className={`w-5 h-5 ${activeTab === 'catalog' ? 'text-cyan-400 scale-110 drop-shadow-[0_0_8px_rgba(0,240,255,0.7)]' : ''}`} />
          </div>
          <span className="text-[10.5px] mt-1 tracking-tight">Catálogo</span>
        </button>

        {/* Tab 4: Chat */}
        <button
          type="button"
          onClick={() => setActiveTab('chat')}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
            activeTab === 'chat'
              ? 'text-pink-300 font-black'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="relative">
            <MessageSquare className={`w-5 h-5 ${activeTab === 'chat' ? 'text-pink-400 scale-110 drop-shadow-[0_0_8px_rgba(255,0,127,0.7)]' : ''}`} />
            {totalUnreadChatCount > 0 && (
              <span className="absolute -top-1 -right-2 px-1.5 py-0.2 rounded-full bg-pink-500 text-white font-mono font-black text-[9px] animate-pulse shadow-[0_0_8px_#ff007f]">
                {totalUnreadChatCount}
              </span>
            )}
          </div>
          <span className="text-[10.5px] mt-1 tracking-tight">Chat</span>
        </button>

      </nav>

      {/* ─── TOAST FLOATING NOTIFICATION ─── */}
      {toastMessage && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-black/90 border border-cyan-400 text-cyan-300 text-xs font-bold shadow-[0_0_25px_rgba(0,240,255,0.4)] animate-in fade-in slide-in-from-top-3 duration-200 pointer-events-none flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-pink-400" />
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* ─── H. MODALES Y OVERLAYS ESPECIALES ─── */}

      {/* 1. Modal QR Clientes (?mode=guest) */}
      {isGuestQrModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setIsGuestQrModalOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-[#0a0c16] border border-cyan-500/40 rounded-3xl p-5 flex flex-col items-center text-center relative shadow-[0_0_50px_rgba(0,240,255,0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIsGuestQrModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-500 to-pink-500 flex items-center justify-center mb-2 shadow-[0_0_15px_rgba(0,240,255,0.5)]">
              <QrCode className="w-5 h-5 text-black" />
            </div>

            <h3 className="text-base font-black text-white uppercase tracking-wide">
              QR para Invitados / Mesas
            </h3>
            <p className="text-xs text-slate-400 mt-1 max-w-xs">
              Muestra este código a los clientes para que envíen sus pedidos directo a tu pestaña de 💬 Peticiones.
            </p>

            <div className="my-4 p-2 bg-[#06070e] border border-cyan-400/50 rounded-2xl">
              <img
                src={guestQrImage}
                alt="QR Invitados"
                className="w-52 h-52 object-contain rounded-xl"
              />
            </div>

            <span className="px-3 py-1 rounded-full bg-cyan-950/80 border border-cyan-500/40 text-xs font-mono font-bold text-cyan-300">
              SALA: <span className="text-white">{roomCode}</span>
            </span>
          </div>
        </div>
      )}

      {/* 2. Pantalla de Reposo (#disconnectedOverlay) */}
      {isSleepMode && (
        <div
          id="disconnectedOverlay"
          className="fixed inset-0 z-50 bg-[#06070e] flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300"
        >
          <div className="w-20 h-20 rounded-3xl bg-slate-900 border border-cyan-500/30 flex items-center justify-center shadow-[0_0_35px_rgba(0,240,255,0.15)] mb-4">
            <Power className="w-10 h-10 text-cyan-400" />
          </div>

          <h2 className="text-xl font-black text-white uppercase tracking-wider">
            Control DJ en Reposo
          </h2>
          <p className="text-xs text-slate-400 max-w-xs mt-2 leading-relaxed">
            Se ha detenido la conexión y el consumo de red para ahorrar batería mientras el teléfono esté guardado en el bolsillo.
          </p>

          <button
            type="button"
            onClick={handleToggleSleep}
            className="mt-6 py-3.5 px-8 rounded-2xl bg-gradient-to-r from-cyan-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-black font-black text-sm uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 shadow-[0_0_30px_rgba(0,240,255,0.4)] active:scale-95"
          >
            <Zap className="w-4 h-4 fill-black" />
            <span>⚡ Reconectar Ahora</span>
          </button>
        </div>
      )}

      {/* 3. Pantalla de Bloqueo por Anfitrión (#hostDisabledOverlay) */}
      {isHostDisabled && !isSleepMode && (
        <div
          id="hostDisabledOverlay"
          className="fixed inset-0 z-50 bg-[#06070e]/95 backdrop-blur-lg flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300"
        >
          <div className="w-20 h-20 rounded-3xl bg-rose-950/40 border border-rose-500/50 flex items-center justify-center shadow-[0_0_40px_rgba(244,63,94,0.35)] mb-4">
            <ShieldAlert className="w-10 h-10 text-rose-400" />
          </div>

          <h2 className="text-lg font-black text-rose-300 uppercase tracking-wide">
            🚫 Control DJ Deshabilitado por la Computadora
          </h2>
          <p className="text-xs text-slate-400 max-w-xs mt-2 leading-relaxed">
            El operador del Web Player ha pausado temporalmente el acceso para celulares.
          </p>

          <button
            type="button"
            onClick={handleRetryHostConnection}
            className="mt-6 py-3 px-6 rounded-2xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500 text-rose-200 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 shadow-[0_0_20px_rgba(244,63,94,0.3)] active:scale-95"
          >
            <RefreshCw className="w-4 h-4" />
            <span>🔄 Reintentar Conexión</span>
          </button>
        </div>
      )}

      {/* 4. Modal para Cambiar / Ingresar Código de Sala */}
      {isRoomCodeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-3xl bg-[#0c0e18] border border-cyan-500/40 p-6 flex flex-col items-center text-center shadow-[0_0_50px_rgba(0,240,255,0.2)]">
            <div className="w-14 h-14 rounded-2xl bg-cyan-950/50 border border-cyan-500/50 flex items-center justify-center mb-3">
              <Radio className="w-7 h-7 text-cyan-400 animate-pulse" />
            </div>

            <h3 className="text-lg font-black text-white uppercase tracking-wider">
              Conectar a Sala DJ
            </h3>
            <p className="text-xs text-slate-400 mt-1 mb-4">
              Ingresa el código de sala mostrado en la pantalla de la computadora o en el botón DJ:
            </p>

            <div className="w-full relative mb-4">
              <input
                type="text"
                value={tempRoomCodeInput}
                onChange={(e) => setTempRoomCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="EJ: 9A4X"
                maxLength={10}
                className="w-full py-3 px-4 rounded-xl bg-slate-900/90 border-2 border-cyan-500/60 text-center font-mono text-2xl font-black text-white tracking-widest uppercase focus:outline-none focus:border-cyan-400 shadow-[0_0_20px_rgba(0,240,255,0.2)]"
              />
            </div>

            <div className="flex gap-2 w-full">
              <button
                type="button"
                onClick={() => setIsRoomCodeModalOpen(false)}
                className="flex-1 py-3 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs uppercase cursor-pointer hover:bg-slate-700 active:scale-95 transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const cleaned = tempRoomCodeInput.trim().toLowerCase();
                  if (!cleaned) return;
                  const newHost = cleaned.startsWith('klab_host_') ? cleaned : `klab_host_${cleaned}`;
                  setTargetHostId(newHost);
                  setRoomCode(cleaned.replace('klab_host_', '').toUpperCase());
                  try {
                    localStorage.setItem('karaokelab_dj_target_host', newHost);
                  } catch (_) {}
                  peerSync.initDjRemote(
                    newHost,
                    handleIncomingDjState,
                    (disabled) => setIsHostDisabled(disabled),
                    (status) => setConnectionStatus(status)
                  );
                  setIsRoomCodeModalOpen(false);
                  showToast('⚡ Conectando a sala ' + cleaned.toUpperCase(), 'cyan');
                }}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-400 text-black font-black text-xs uppercase cursor-pointer hover:from-cyan-400 hover:to-emerald-300 shadow-[0_0_20px_rgba(0,240,255,0.4)] active:scale-95 transition-all"
              >
                Conectar ⚡
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
