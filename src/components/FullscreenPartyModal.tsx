import React, { useEffect, useState } from 'react';
import { LyricLine, ArtistRole, VideoBackgroundConfig } from '../types';
import { X, Play, Pause, User, PartyPopper, Users, Sparkles, Music, Mic, Film } from 'lucide-react';
import confetti from 'canvas-confetti';
import { getDuetSinger } from './KaraokeDisplay';
import { computeIntelligentWordFills } from '../services/smartCueAnalyzer';
import { cleanLyricText, titleCaseArtist, resolveArtistInfo } from '../services/lrcParser';
import { VideoBackgroundSelectorModal } from './VideoBackgroundSelectorModal';
import { loadVideoBackgroundConfig, saveVideoBackgroundConfig, searchOfficialVideo } from '../services/videoBackgroundService';

interface FullscreenPartyModalProps {
  isOpen: boolean;
  onClose: () => void;
  lyrics: LyricLine[];
  currentLyric: LyricLine | null;
  currentIndex: number;
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
  songTitle: string;
  songArtist?: string;
  artists?: ArtistRole[];
  isPlaying: boolean;
  onTogglePlay: () => void;
  vocalGain: number;
  onVocalGainChange: (val: number) => void;
  isSmartVocalCue?: boolean;
  activeCueType?: 'intro' | 'chorus' | 'outro' | null;
  onToggleSmartVocalCue?: () => void;
  bpm: number;
  syncDelay?: number;
  onUpdateSyncDelay?: (val: number) => void;
  isDuetMode?: boolean;
  onToggleDuetMode?: () => void;
  activeSingerName?: string;
  activeSingerAvatar?: string;
  videoBgConfig?: VideoBackgroundConfig;
  onUpdateVideoBgConfig?: (newConfig: VideoBackgroundConfig) => void;
}

export const FullscreenPartyModal: React.FC<FullscreenPartyModalProps> = ({
  isOpen,
  onClose,
  lyrics,
  currentLyric,
  currentIndex,
  currentTime,
  duration,
  onSeek,
  songTitle,
  songArtist,
  artists,
  isPlaying,
  onTogglePlay,
  vocalGain,
  onVocalGainChange,
  isSmartVocalCue = false,
  activeCueType = null,
  onToggleSmartVocalCue,
  bpm,
  syncDelay = 0.0,
  onUpdateSyncDelay,
  isDuetMode = false,
  onToggleDuetMode,
  activeSingerName,
  activeSingerAvatar,
  videoBgConfig: externalVideoBgConfig,
  onUpdateVideoBgConfig: externalOnUpdateVideoBgConfig,
}) => {
  const [score, setScore] = useState(95);
  const [localVideoBgConfig, setLocalVideoBgConfig] = useState<VideoBackgroundConfig>(() => loadVideoBackgroundConfig());
  const [isVideoBgModalOpen, setIsVideoBgModalOpen] = useState(false);

  const videoBgConfig = externalVideoBgConfig || localVideoBgConfig;

  const handleUpdateVideoBgConfig = (newConfig: VideoBackgroundConfig) => {
    if (externalOnUpdateVideoBgConfig) {
      externalOnUpdateVideoBgConfig(newConfig);
    } else {
      setLocalVideoBgConfig(newConfig);
      saveVideoBackgroundConfig(newConfig);
    }
  };

  useEffect(() => {
    if (externalVideoBgConfig) return;
    if (!songTitle || !videoBgConfig.enabled || videoBgConfig.mode !== 'auto') return;

    let isMounted = true;
    searchOfficialVideo(songTitle, songArtist).then((res) => {
      if (isMounted && res && res.videoId) {
        setLocalVideoBgConfig((prev) => {
          if (prev.mode !== 'auto') return prev;
          const next = { ...prev, videoId: res.videoId, videoTitle: res.title };
          saveVideoBackgroundConfig(next);
          return next;
        });
      }
    }).catch(() => {});

    return () => { isMounted = false; };
  }, [songTitle, songArtist, videoBgConfig.enabled, videoBgConfig.mode, externalVideoBgConfig]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') {
        e.preventDefault();
        onTogglePlay();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onTogglePlay]);

  if (!isOpen) return null;

  const triggerConfetti = () => {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#ffdd00', '#10b981', '#6366f1', '#ec4899', '#00f0ff'],
    });
    setScore((prev) => Math.min(100, prev + 1));
  };

  const nextLyric = currentIndex >= 0 && currentIndex < lyrics.length - 1 ? lyrics[currentIndex + 1] : (currentIndex === -1 && lyrics.length > 0 ? lyrics[0] : null);

  const currentSinger = currentLyric ? getDuetSinger(currentLyric, currentIndex, null, songArtist) : 'singer1';
  const nextSinger = nextLyric ? getDuetSinger(nextLyric, currentIndex + 1, null, songArtist) : 'singer1';

  const curArtist = resolveArtistInfo(currentLyric?.singer || currentSinger, artists, songArtist, songTitle);
  const nextArtist = resolveArtistInfo(nextLyric?.singer || nextSinger, artists, songArtist, songTitle);

  // Calculate word-level progression or smooth linear progress
  const lineDuration = currentLyric ? currentLyric.duration || 3.5 : 1;
  const elapsed = currentLyric ? Math.max(0, currentTime - currentLyric.time) : 0;
  const lineProgress = Math.min(100, Math.max(0, (elapsed / lineDuration) * 100));

  const words = currentLyric ? currentLyric.text.split(' ') : [];
  const activeWordIndex = Math.floor((lineProgress / 100) * words.length);

  // Time remaining to next line for countdown (ONLY when no current lyric is playing)
  const isBreak = !currentLyric && nextLyric;
  const secondsToNext = isBreak ? nextLyric.time - currentTime : 0;
  const showCountdown = isBreak && secondsToNext > 0.5 && secondsToNext <= 5.0;

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const seekProgress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 bg-[#080811]/80 backdrop-blur-[2px] text-white flex flex-col justify-between p-6 sm:p-10 select-none overflow-hidden animate-in fade-in duration-300 pointer-events-auto">
      {/* Background Pulsing Party Glow */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-25 blur-3xl transition-all duration-700"
        style={{
          background: isPlaying
            ? isDuetMode
              ? `radial-gradient(circle at 50% 40%, ${curArtist.color} 0%, transparent 75%)`
              : 'radial-gradient(circle at 50% 40%, #059669 0%, transparent 75%)'
            : 'radial-gradient(circle at 50% 40%, #1e1b4b 0%, transparent 75%)'
        }}
      />

      {/* ── Top TV Mode Header ── */}
      <div className="relative z-10 flex items-center justify-between border-b border-slate-800/80 pb-4 shrink-0">
        {/* Track Title & Artist */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#00f0ff] to-[#ff007f] flex items-center justify-center font-black text-slate-950 text-xl shadow-lg">
            K
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex flex-wrap items-center gap-2">
              {songTitle}
              <span className="text-xs px-2.5 py-0.5 rounded-full font-mono font-bold bg-amber-400/20 text-amber-300 border border-amber-400/40">
                MODO TV
              </span>
              {activeSingerName && (
                <span className="text-xs px-3 py-0.5 rounded-full font-mono font-bold bg-gradient-to-r from-indigo-500/30 to-cyan-500/30 text-cyan-300 border border-cyan-400/50 flex items-center gap-1.5 shadow-[0_0_12px_rgba(0,240,255,0.3)]">
                  <span>{activeSingerAvatar || '🎤'}</span>
                  <span>{activeSingerName}</span>
                </span>
              )}
            </h1>
            {songArtist && <p className="text-sm font-medium text-slate-400">{songArtist}</p>}
          </div>
        </div>

        {/* Action Buttons: Video Bg, Duet Mode, Confetti, Close */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsVideoBgModalOpen(true)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all shadow-md ${
              videoBgConfig.enabled && videoBgConfig.mode !== 'off'
                ? 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40 shadow-[0_0_15px_rgba(217,70,239,0.3)]'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}
            title="Ambiente de Video de Fondo Dinámico (YouTube / Neón)"
          >
            <Film className="w-4 h-4 text-fuchsia-400" />
            <span className="hidden sm:inline">FONDO</span>
          </button>

          {onToggleDuetMode && (
            <button
              onClick={onToggleDuetMode}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all shadow-md ${
                isDuetMode
                  ? 'border-[#00f0ff] bg-[#00f0ff]/20 text-[#00f0ff] shadow-[0_0_15px_rgba(0,240,255,0.4)] font-black'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'
              }`}
              title="Alterna colores para 2 cantantes (Cian / Rosa)"
            >
              <User className="w-4 h-4" />
              <span>{isDuetMode ? 'DUETO: ACTIVO' : 'MODO DUETO'}</span>
            </button>
          )}

          <button
            onClick={triggerConfetti}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-emerald-500 hover:from-amber-400 hover:to-emerald-400 text-slate-950 font-bold text-xs tracking-wider cursor-pointer shadow-lg transition-transform active:scale-95"
            title="¡Aplausos y Fiesta!"
          >
            <PartyPopper className="w-4 h-4" />
            <span className="hidden sm:inline">¡APLAUSOS!</span>
          </button>

          <button
            onClick={onClose}
            className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 cursor-pointer transition-colors"
            title="Salir de Pantalla Completa (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── Center Giant Teleprompter Stage (With Singer Names & Smooth Typography) ── */}
      <div className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-between text-center max-w-6xl mx-auto w-full select-none px-4 py-2 gap-2 overflow-hidden">
        {/* Slot 1: Singer Name / Cue / Countdown (Strictly Singer & Cues, No [Verso] tag) */}
        <div className="h-9 w-full flex items-center justify-center shrink-0">
          {isPlaying && (
            showCountdown ? (
              <div className="inline-flex items-center gap-2 px-5 py-1.5 rounded-full bg-amber-500/20 text-amber-300 text-sm sm:text-base font-bold animate-pulse">
                <span>● ● ● ¡Prepárate para cantar en {Math.ceil(secondsToNext)}s!</span>
                {nextLyric && (
                  <span className="font-mono text-xs px-2.5 py-0.5 rounded-full bg-black/60 text-amber-200">
                    {nextArtist.isBoth ? '👥 Todos' : `🎤 ${nextArtist.name}`}
                  </span>
                )}
              </div>
            ) : isSmartVocalCue && activeCueType ? (
              <div className="inline-flex items-center gap-2 animate-in fade-in">
                {activeCueType === 'intro' && (
                  <span className="px-4 py-1 rounded-full text-xs font-mono font-black bg-indigo-500/30 text-indigo-300 shadow-[0_0_15px_rgba(99,102,241,0.5)] animate-pulse">
                    ✨ ENTRADA GUÍA VOCAL (VOZ ORIGINAL)
                  </span>
                )}
                {activeCueType === 'chorus' && (
                  <span className="px-4 py-1 rounded-full text-xs font-mono font-black bg-purple-500/30 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.5)] animate-pulse">
                    ✨ CORO GUÍA ACTIVO (ACOMPAÑAMIENTO)
                  </span>
                )}
                {activeCueType === 'outro' && (
                  <span className="px-4 py-1 rounded-full text-xs font-mono font-black bg-cyan-500/30 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.5)] animate-pulse">
                    ✨ REMATE / SEGUNDA VOZ
                  </span>
                )}
              </div>
            ) : currentLyric ? (
              <div
                className="inline-flex items-center gap-2 font-mono text-sm sm:text-base font-bold uppercase tracking-wider"
                style={{ color: curArtist.color }}
              >
                <span>{curArtist.isBoth ? '👥' : '🎤'}</span>
                <span>{curArtist.isBoth ? `DÚO · ${curArtist.name.toUpperCase()}` : `VOZ: ${curArtist.name.toUpperCase()}`}</span>
              </div>
            ) : null
          )}
        </div>

        {/* Slot 2: Dynamic-Scaled Active Lyric (Prevents Overlap) */}
        <div className="flex-1 min-h-0 w-full max-w-5xl mx-auto flex flex-col items-center justify-center px-4 overflow-hidden my-auto">
          {!isPlaying ? (
            <div className="flex flex-col items-center gap-3 text-slate-500 opacity-60">
              <div className="w-16 h-16 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-center shadow-inner">
                <Music className="w-8 h-8 text-cyan-400/50" />
              </div>
              <p className="text-xl sm:text-2xl font-bold tracking-wider text-slate-400 font-mono">
                {songTitle ? `LISTO PARA REPRODUCIR · ${songTitle}` : 'MODO TV · LISTO'}
              </p>
            </div>
          ) : currentLyric ? (
            (() => {
              const textClean = cleanLyricText(currentLyric.text);
              const textLen = textClean.length;
              // Dynamic font size: automatically adapts to line length to guarantee zero overlap
              const fontSizeClass = textLen <= 22
                ? 'text-4xl sm:text-6xl md:text-7xl lg:text-8xl'
                : textLen <= 45
                  ? 'text-3xl sm:text-5xl md:text-6xl lg:text-7xl'
                  : textLen <= 70
                    ? 'text-2xl sm:text-4xl md:text-5xl lg:text-6xl'
                    : 'text-xl sm:text-3xl md:text-4xl lg:text-5xl';

              return (
                <div className={`flex flex-wrap items-center justify-center gap-x-4 sm:gap-x-5 gap-y-2 font-black ${fontSizeClass} leading-snug tracking-tight text-center max-w-full`}>
                  {computeIntelligentWordFills(
                    { ...currentLyric, text: textClean },
                    Math.max(0, currentTime - syncDelay),
                    nextLyric?.time,
                    bpm
                  ).map((item, wIdx) => {
                    return (
                      <span key={wIdx} className="relative inline-block select-none">
                        {/* Layer 1: Base Unsung Word (Clean, crisp dim text) */}
                        <span className="text-white/25 inline-block">
                          {item.word}
                        </span>

                        {/* Layer 2: Active Sweeping Highlight Word (Strictly inside letter glyphs) */}
                        {item.fillPercentage > 0 && (
                          <span
                            className="absolute inset-0 inline-block pointer-events-none"
                            style={{
                              clipPath: `inset(0 ${Math.max(0, Math.min(100, 100 - item.fillPercentage))}% 0 0)`,
                              color: curArtist.color,
                            }}
                          >
                            {item.word}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              );
            })()
          ) : (
            <div className="flex flex-col items-center gap-3 text-slate-500 animate-pulse">
              <Music className="w-12 h-12 text-slate-600" />
              <p className="text-xl sm:text-3xl font-bold tracking-wider text-slate-400">
                ♫ [SOLO INSTRUMENTAL] ♫
              </p>
            </div>
          )}
        </div>

        {/* Slot 3: Upcoming Line Preview */}
        <div className="h-14 w-full max-w-4xl flex flex-col items-center justify-center shrink-0">
          {isPlaying && nextLyric ? (
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[11px] font-bold uppercase tracking-widest font-mono" style={{ color: nextArtist.color }}>
                {`[PRÓXIMA: ${nextArtist.isBoth ? '👥 DÚO' : '🎤 ' + nextArtist.name.toUpperCase()}]`}
              </span>
              <p
                onClick={() => onSeek(nextLyric.time)}
                className="text-base sm:text-xl font-bold truncate max-w-3xl cursor-pointer hover:opacity-80 transition-opacity"
                style={{ color: nextArtist.color }}
              >
                {cleanLyricText(nextLyric.text)}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative z-10 flex flex-col gap-3 p-4 rounded-2xl bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 max-w-4xl mx-auto w-full shadow-2xl shrink-0">
        
        {/* ── Live Playback Progress / Scrub Bar ── */}
        <div className="flex items-center gap-3 px-1">
          <span className="text-xs font-mono text-slate-300 tabular-nums w-10">{fmt(currentTime)}</span>
          <div className="flex-1 relative h-6 flex items-center">
            {/* Background Track */}
            <div className="w-full h-2.5 bg-slate-950 border border-slate-700/80 rounded-full overflow-hidden relative shadow-inner">
              <div
                className={`h-full rounded-full ${
                  !isDuetMode
                    ? 'bg-gradient-to-r from-amber-400 to-emerald-400'
                    : 'bg-gradient-to-r from-[#00f0ff] via-[#ff007f] to-[#ffe600]'
                }`}
                style={{ width: `${Math.max(0, Math.min(100, seekProgress))}%` }}
              />
            </div>

            {/* Glowing Hardware Thumb Knob */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white border-2 border-slate-900 shadow-[0_0_10px_rgba(255,255,255,0.9)] pointer-events-none z-10"
              style={{ left: `${Math.max(0, Math.min(100, seekProgress))}%` }}
            />

            {/* Live Interactive Range Slider for Dragging & Clicking */}
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 100}
              step={0.1}
              value={currentTime}
              onChange={(e) => onSeek(parseFloat(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
              title={`Posición: ${fmt(currentTime)} / ${fmt(duration)}`}
            />
          </div>
          <span className="text-xs font-mono text-slate-300 tabular-nums w-10 text-right">{fmt(duration)}</span>
        </div>

        {/* ── Buttons Row ── */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-1 border-t border-slate-800/80">
          {/* Play/Pause */}
          <button
            onClick={onTogglePlay}
            className="flex items-center gap-2 px-6 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm tracking-wider cursor-pointer shadow-lg transition-transform active:scale-95"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{isPlaying ? 'PAUSAR' : 'REANUDAR'}</span>
          </button>

          {/* Vocal Guide Buttons: 1. Voz Guía (40%), 2. Guía Inteligente Coros/Entradas */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onVocalGainChange(vocalGain > 0.05 ? 0.0 : 0.40)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                vocalGain > 0.05
                  ? 'bg-cyan-600 text-white border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.5)] font-black'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
              }`}
              title="Voz Guía 40%: Activa la voz original del artista al 40% de volumen para acompañar tu canto"
            >
              <Mic className="w-4 h-4 text-cyan-200" />
              <span>{vocalGain > 0.05 ? `VOZ GUÍA: 40%` : 'VOZ GUÍA 40%'}</span>
            </button>
            {onToggleSmartVocalCue && (
              <button
                onClick={onToggleSmartVocalCue}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                  isSmartVocalCue
                    ? 'bg-indigo-600 text-white border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.6)] font-black'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                }`}
                title="Guía Inteligente: Activa la voz original automáticamente en coros, entradas y salidas"
              >
                <Sparkles className="w-4 h-4 text-indigo-300" />
                <span>{isSmartVocalCue ? 'GUÍA COROS: ON' : 'GUÍA COROS'}</span>
              </button>
            )}
          </div>

          {/* Sync Timing Calibration */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs font-mono text-slate-300">
            <span className="text-[11px] text-slate-400 font-bold uppercase">Calibrar:</span>
            <button
              onClick={() => onUpdateSyncDelay && onUpdateSyncDelay(syncDelay - 0.2)}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold cursor-pointer"
              title="Adelantar Letra -0.2s"
            >
              -0.2s
            </button>
            <span className="text-amber-300 font-bold font-mono px-1">{syncDelay > 0 ? `+${syncDelay.toFixed(1)}s` : `${syncDelay.toFixed(1)}s`}</span>
            <button
              onClick={() => onUpdateSyncDelay && onUpdateSyncDelay(syncDelay + 0.2)}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold cursor-pointer"
              title="Atrasar Letra +0.2s"
            >
              +0.2s
            </button>
          </div>
        </div>
      </div>

      {/* Dynamic Video Background Selector Modal */}
      <VideoBackgroundSelectorModal
        isOpen={isVideoBgModalOpen}
        onClose={() => setIsVideoBgModalOpen(false)}
        config={videoBgConfig}
        onChangeConfig={handleUpdateVideoBgConfig}
        songTitle={songTitle}
        songArtist={songArtist}
      />
    </div>
  );
};
