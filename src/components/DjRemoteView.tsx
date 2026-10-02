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
} from 'lucide-react';
import { peerSync, ConnectionStatus } from '../services/peerSyncService';
import { SongItem, SingerProfile, ChatMessage } from '../types';
import { transposeKey } from '../services/dspAnalysis';

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
  });

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

  // Modals & Overlays
  const [isGuestQrModalOpen, setIsGuestQrModalOpen] = useState(false);

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

  // Parse Room ID from URL
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room') || urlParams.get('host') || urlParams.get('join') || urlParams.get('tv') || '';
    
    let effectiveHost = roomParam;
    if (effectiveHost && !effectiveHost.startsWith('klab_host_')) {
      effectiveHost = `klab_host_${effectiveHost}`;
    }

    if (!effectiveHost) {
      // Fallback: search localStorage
      try {
        const saved = localStorage.getItem('karaokelab_p2p_host_id');
        if (saved) effectiveHost = saved;
      } catch (_) {}
    }

    if (!effectiveHost) {
      effectiveHost = 'klab_host_default';
    }

    setTargetHostId(effectiveHost);
    setRoomCode(effectiveHost.replace('klab_host_', '').toUpperCase());

    // Initialize WebRTC connection to host
    peerSync.initDjRemote(
      effectiveHost,
      (state) => {
        if (!state) return;
        setDjState((prev) => ({
          ...prev,
          ...state,
          queue: state.queue || prev.queue,
          catalog: state.catalog || prev.catalog,
          requests: state.requests || prev.requests,
          chatMessages: state.chatMessages || prev.chatMessages || [],
        }));

        if (state.pitchShift !== undefined) setLocalPitch(state.pitchShift);
        if (state.bpm !== undefined) setLocalBpm(state.bpm);
        if (state.vocalGain !== undefined) setLocalVocalGain(state.vocalGain);
        if (state.musicGain !== undefined) setLocalMusicGain(state.musicGain);
        if (state.isDjServiceEnabled !== undefined) setIsHostDisabled(!state.isDjServiceEnabled);
      },
      (disabled) => {
        setIsHostDisabled(disabled);
      },
      (status) => {
        setConnectionStatus(status);
      }
    );

    return () => {
      peerSync.disconnectDjRemote();
    };
  }, []);

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
  const handleSendDjMessage = (textToSend: string) => {
    const clean = textToSend.trim();
    if (!clean) return;
    sendAction('sendChatMessage', { text: clean });
    setChatInputText('');
    showToast('💬 Mensaje enviado a la sala', 'cyan');
  };

  // Auto-scroll chat to bottom when messages change or tab becomes active
  useEffect(() => {
    if (activeTab === 'chat') {
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [djState.chatMessages, activeTab]);

  // Master Play / Pause with validation
  const handleTogglePlay = () => {
    if (djState.isPlaying) {
      sendAction('togglePlay');
      showToast('⏸️ Pausado', 'pink');
      return;
    }

    const hasSong = Boolean(djState.songTitle && djState.songTitle.trim() !== '');
    const hasQueue = Boolean(djState.queue && djState.queue.length > 0);

    if (!hasSong && !hasQueue) {
      showToast('⚠️ No hay canciones en el reproductor ni en la cola', 'pink');
      return;
    }

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

  // Catalog filtering
  const filteredCatalog = useMemo(() => {
    if (!searchQuery.trim()) {
      return djState.catalog.slice(0, 50);
    }
    const q = searchQuery.toLowerCase().trim();
    return djState.catalog.filter(
      (s) =>
        (s.title && s.title.toLowerCase().includes(q)) ||
        (s.artist && s.artist.toLowerCase().includes(q)) ||
        (s.genre && s.genre.toLowerCase().includes(q))
    );
  }, [djState.catalog, searchQuery]);

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
    return Math.min(100, Math.max(0, (djState.currentTime / djState.duration) * 100));
  }, [djState.currentTime, djState.duration]);

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
        <div className="flex items-center gap-2">
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
            <span>{formatTime(djState.currentTime)}</span>
            <span>{formatTime(djState.duration)}</span>
          </div>
        </div>
      </section>

      {/* ─── MAIN CONTENT CONTAINER ─── */}
      <main className="flex-1 overflow-y-auto px-4 py-3 flex flex-col space-y-3.5 pb-20">

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

            {/* Results Count */}
            <div className="flex justify-between items-center px-1 text-[10.5px] font-mono text-slate-400">
              <span>{filteredCatalog.length} canciones encontradas</span>
              {searchQuery && (
                <span className="text-cyan-400">Filtrando "{searchQuery}"</span>
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
                  Intenta con otro término o borra la búsqueda.
                </p>
              </div>
            ) : (
              <div className="flex flex-col space-y-2">
                {filteredCatalog.map((song) => {
                  const isEnqueued = actionButtonFeedback[`queue_${song.id}`];
                  const isPlayingNow = actionButtonFeedback[`play_${song.id}`];

                  return (
                    <div
                      key={song.id}
                      className="p-3 rounded-2xl bg-[#0c0e1a] border border-white/10 hover:border-cyan-500/40 flex items-center justify-between gap-2.5 transition-all"
                    >
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-black text-white truncate">
                          {song.title}
                        </h4>
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
        {/* PESTAÑA 4: CHAT DE LA SALA & PETICIONES (ESTILO WHATSAPP) */}
        {/* ═════════════════════════════════════════════════════════ */}
        {activeTab === 'chat' && (
          <div className="flex flex-col space-y-2.5 animate-in fade-in duration-200">
            {/* Header / Info bar */}
            <div className="flex items-center justify-between px-1 shrink-0">
              <div className="flex items-center gap-1.5 font-mono">
                <MessageSquare className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-black uppercase tracking-wider text-cyan-300">
                  Chat de la Sala ({djState.chatMessages?.length || 0})
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

            {/* If there are pending customer song requests, show a compact accordion/card at top */}
            {djState.requests && djState.requests.length > 0 && (
              <div className="p-2.5 rounded-2xl bg-pink-950/30 border border-pink-500/40 flex flex-col gap-2">
                <div className="flex items-center justify-between text-[10.5px] font-bold text-pink-300">
                  <span className="flex items-center gap-1">
                    <span>🎵</span> Peticiones de canciones pendientes ({djState.requests.length})
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {djState.requests.map((req) => (
                    <div
                      key={req.id}
                      className="p-2 rounded-xl bg-[#0c0e1a] border border-pink-500/20 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-pink-950 text-pink-300">
                            {req.tableNumber ? req.tableNumber : 'Mesa'}
                          </span>
                          <span className="text-[11px] font-bold text-white truncate">
                            {req.title}
                          </span>
                        </div>
                        <p className="text-[9.5px] text-slate-400 truncate">
                          {req.singerName || 'Cliente'} • {req.artist || 'Karaoke'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            sendAction('approveRequest', { id: req.id });
                            showToast(`✓ Aprobada: ${req.title}`, 'emerald');
                          }}
                          className="px-2 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/50 text-emerald-300 text-[10px] font-bold flex items-center gap-1 active:scale-95 cursor-pointer"
                        >
                          <Check className="w-3 h-3" />
                          <span>Aceptar</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            sendAction('dismissRequest', { id: req.id });
                            showToast('✕ Descartada', 'pink');
                          }}
                          className="p-1 rounded-lg bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30 active:scale-95 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Chat message bubbles stream (WhatsApp Style) */}
            <div className="min-h-[280px] max-h-[48vh] overflow-y-auto p-3 rounded-2xl bg-[#080a14] border border-cyan-500/20 flex flex-col space-y-3 shadow-inner scrollbar-thin">
              {(!djState.chatMessages || djState.chatMessages.length === 0) ? (
                <div className="py-12 flex flex-col items-center justify-center text-center p-4">
                  <div className="w-12 h-12 rounded-2xl bg-cyan-950/60 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mb-2 shadow-[0_0_20px_rgba(0,240,255,0.15)]">
                    <MessageSquare className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-bold text-slate-200">
                    No hay mensajes en la sala todavía
                  </p>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
                    Los mensajes, dedicatorias y pedidos de los clientes desde sus mesas aparecerán aquí en vivo.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsGuestQrModalOpen(true)}
                    className="mt-4 px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-300 text-xs font-bold active:scale-95 transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Mostrar QR para Mesas</span>
                  </button>
                </div>
              ) : (
                djState.chatMessages.map((msg, idx) => {
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
                      {/* Sender Info Header */}
                      <div className={`flex items-center gap-1.5 mb-1 px-1 ${isDj ? 'flex-row-reverse' : 'flex-row'}`}>
                        <span className="text-xs">{msg.avatar || (isDj ? '🎧' : '🎤')}</span>
                        <div className={`flex items-center gap-1.5 ${isDj ? 'flex-row-reverse' : 'flex-row'}`}>
                          <span
                            className={`text-[10px] font-black ${
                              isDj ? 'text-pink-400' : 'text-cyan-300'
                            }`}
                          >
                            {isDj ? 'DJ (Cabina) 🎧' : (msg.senderName || 'Cliente')}
                          </span>
                          {!isDj && msg.tableNumber && (
                            <span className="px-1.5 py-0.2 rounded bg-pink-950/80 border border-pink-500/40 text-[8.5px] font-black text-pink-300 font-mono">
                              🪑 {msg.tableNumber}
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] text-slate-500 font-mono">
                          {msg.timestamp
                            ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : ''}
                        </span>
                      </div>

                      {/* Message Bubble (WhatsApp style) */}
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

            {/* Quick Emojis Reaction Bar */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-1 px-0.5 scrollbar-none shrink-0">
              {['🎤', '🔥', '👏', '🥳', '❤️', '🍻', '🎉', '⚡', '💃', '⭐', '🙌'].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleSendDjMessage(emoji)}
                  className="px-2.5 py-1.5 rounded-xl bg-[#0c0e1a] hover:bg-cyan-950/60 border border-white/10 hover:border-cyan-400/60 text-sm cursor-pointer transition-all shrink-0 hover:scale-110 active:scale-95 shadow-sm"
                  title={`Enviar ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>

            {/* Message Input Composer */}
            <div className="flex items-center gap-2 shrink-0 pt-0.5">
              <input
                type="text"
                placeholder="Escribe a la sala como DJ..."
                value={chatInputText}
                onChange={(e) => setChatInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && chatInputText.trim()) {
                    handleSendDjMessage(chatInputText);
                  }
                }}
                className="flex-1 bg-[#0c0e1a] border border-cyan-500/40 focus:border-cyan-300 rounded-2xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 outline-none shadow-[0_0_15px_rgba(0,240,255,0.08)] transition-all font-medium"
              />
              <button
                type="button"
                onClick={() => handleSendDjMessage(chatInputText)}
                disabled={!chatInputText.trim()}
                className="p-2.5 rounded-2xl bg-gradient-to-r from-pink-500 to-purple-600 disabled:opacity-40 text-white cursor-pointer shadow-md hover:scale-105 active:scale-95 transition-all flex items-center justify-center shrink-0"
                title="Enviar mensaje"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
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
            {((djState.chatMessages && djState.chatMessages.length > 0) || (djState.requests && djState.requests.length > 0)) && (
              <span className="absolute -top-1 -right-2 px-1.5 py-0.2 rounded-full bg-pink-500 text-white font-mono font-black text-[9px] animate-pulse">
                {(djState.chatMessages?.length || 0) + (djState.requests?.length || 0)}
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

    </div>
  );
};
