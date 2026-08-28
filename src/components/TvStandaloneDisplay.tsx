import React, { useEffect, useState } from 'react';
import { tvBroadcast, TvStatePayload } from '../services/tvBroadcastService';
import { peerSync, ConnectionStatus } from '../services/peerSyncService';
import { getDuetSinger } from './KaraokeDisplay';
import { cleanLyricText, resolveArtistInfo } from '../services/lrcParser';
import { computeIntelligentWordFills } from '../services/smartCueAnalyzer';
import { Music, Tv, Maximize2, Wifi, WifiOff, Sparkles } from 'lucide-react';
import { DynamicVideoBackground } from './DynamicVideoBackground';
import { VideoBackgroundConfig } from '../types';
import { loadVideoBackgroundConfig, searchOfficialVideo } from '../services/videoBackgroundService';

export const TvStandaloneDisplay: React.FC = () => {
  const [tvState, setTvState] = useState<TvStatePayload | null>(() => tvBroadcast.getInitialState());
  const [videoBgConfig, setVideoBgConfig] = useState<VideoBackgroundConfig>(() => loadVideoBackgroundConfig());
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('reconnecting');

  // Read target host ID from URL (?tv=code or ?join=xxx or ?host=xxx)
  const queryParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const tvParam = queryParams?.get('tv');
  const joinParam = queryParams?.get('join') || queryParams?.get('host');
  
  let rawHostId = joinParam || (tvParam && tvParam !== '1' && tvParam !== 'true' ? tvParam : null);
  let targetHostId = rawHostId;
  if (targetHostId && !targetHostId.startsWith('klab_host_')) {
    targetHostId = `klab_host_${targetHostId}`;
  }

  useEffect(() => {
    // 1. Cross-Device WebRTC P2P Connection (Smart TV / Tablets / Apple TV)
    if (targetHostId) {
      peerSync.initTvDisplay(
        targetHostId,
        (newState: TvStatePayload) => {
          setTvState(newState);
          setConnectionStatus('connected');
          if (newState?.videoBgConfig) {
            setVideoBgConfig(newState.videoBgConfig);
          }
        },
        (status) => {
          setConnectionStatus(status);
        }
      );
    }

    // 2. Same-Device BroadcastChannel (Multi-monitor / Independent browser window)
    const unsub = tvBroadcast.onStateUpdate((newState) => {
      setTvState(newState);
      setConnectionStatus('connected');
      if (newState?.videoBgConfig) {
        setVideoBgConfig(newState.videoBgConfig);
      }
    });

    return () => {
      unsub();
    };
  }, [targetHostId]);

  useEffect(() => {
    if (tvState?.videoBgConfig) return;
    if (!tvState?.songTitle || !videoBgConfig.enabled || videoBgConfig.mode !== 'auto') return;

    let isMounted = true;
    searchOfficialVideo(tvState.songTitle, tvState.songArtist).then((res) => {
      if (isMounted && res && res.videoId) {
        setVideoBgConfig((prev) => (prev.mode === 'auto' ? { ...prev, videoId: res.videoId, videoTitle: res.title } : prev));
      }
    }).catch(() => {});

    return () => { isMounted = false; };
  }, [tvState?.songTitle, tvState?.songArtist, videoBgConfig.enabled, videoBgConfig.mode, tvState?.videoBgConfig]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  if (!tvState || !tvState.songTitle) {
    return (
      <div
        onClick={toggleFullscreen}
        className="fixed inset-0 bg-[#05050c] text-white flex flex-col items-center justify-between p-8 sm:p-12 font-sans select-none overflow-hidden cursor-pointer"
      >
        {/* Ambient background glow */}
        <div className="absolute w-[500px] h-[500px] bg-gradient-to-tr from-[#00f0ff]/15 to-[#ff007f]/15 rounded-full blur-[140px] pointer-events-none" />

        {/* Top bar */}
        <div className="relative z-10 w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl overflow-hidden border border-cyan-400/60 shadow-[0_0_15px_rgba(0,240,255,0.4)]">
              <img src="/logo-highres.jpg" alt="Logo" className="w-full h-full object-cover" />
            </div>
            <span className="font-cyber font-black tracking-widest text-base sm:text-lg text-white">
              KARAOKELAB <span className="text-[#00f0ff]">TV</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-mono font-bold flex items-center gap-1.5 border ${
              connectionStatus === 'connected'
                ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                : 'bg-amber-950/80 border-amber-500/60 text-amber-300 animate-pulse'
            }`}>
              {connectionStatus === 'connected' ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              <span>{connectionStatus === 'connected' ? 'Sincronizado P2P' : targetHostId ? 'Conectando al anfitrión...' : 'Esperando Transmisión'}</span>
            </span>

            <button
              onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
              className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Pantalla Completa (F11)"
            >
              <Maximize2 className="w-4 h-4 text-cyan-400" />
            </button>
          </div>
        </div>

        {/* Center Welcome Card */}
        <div className="relative z-10 flex flex-col items-center justify-center text-center max-w-lg space-y-5 my-auto">
          <div className="relative">
            <div className="w-24 h-24 rounded-3xl bg-gradient-to-tr from-[#00f0ff] via-indigo-600 to-[#ff007f] p-0.5 shadow-[0_0_50px_rgba(0,240,255,0.4)] animate-pulse flex items-center justify-center">
              <div className="w-full h-full bg-[#080814] rounded-3xl flex items-center justify-center">
                <Tv className="w-12 h-12 text-cyan-300" />
              </div>
            </div>
            <Sparkles className="w-6 h-6 text-pink-400 absolute -top-2 -right-2 animate-bounce" />
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl font-black tracking-wider uppercase bg-clip-text text-transparent bg-gradient-to-r from-white via-cyan-200 to-pink-300">
              Pantalla Smart TV
            </h1>
            <p className="text-sm font-mono text-cyan-400 font-bold">
              {targetHostId
                ? `Conectado a la Sala: ${targetHostId.replace('klab_host_', '').toUpperCase()}`
                : 'Modo Escenario Dual Activo'}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 text-xs text-slate-400 space-y-1.5 shadow-xl">
            <p className="text-slate-200 font-bold">✓ Pantalla lista y conectada en tiempo real</p>
            <p>Selecciona y reproduce cualquier canción en tu control remoto (iPad / PC / Móvil) para que la letra y los fondos aparezcan aquí automáticamente.</p>
          </div>

          <span className="text-[11px] font-mono text-slate-500 hover:text-slate-400 transition-colors">
            Haz clic o toca en cualquier lugar para Pantalla Completa
          </span>
        </div>

        {/* Bottom footer */}
        <div className="relative z-10 text-[10px] font-mono text-slate-600">
          KaraokeLab Web Player · DSP Teleprompter Engine v2.0
        </div>
      </div>
    );
  }

  const {
    songTitle,
    songArtist,
    artistsList,
    currentTime,
    duration,
    isPlaying,
    lyrics,
    currentIndex,
    activeSingerName,
    activeSingerAvatar,
    nextSongTitle,
    nextSongArtist,
    isDuetMode,
    youTubeEmbedId,
  } = tvState;

  const currentLyric = currentIndex >= 0 && currentIndex < lyrics.length ? lyrics[currentIndex] : null;
  const nextLyric = currentIndex >= 0 && currentIndex < lyrics.length - 1 ? lyrics[currentIndex + 1] : (currentIndex === -1 && lyrics.length > 0 ? lyrics[0] : null);

  const currentSinger = currentLyric ? getDuetSinger(currentLyric, currentIndex, null, songArtist) : 'singer1';
  const nextSinger = nextLyric ? getDuetSinger(nextLyric, currentIndex + 1, null, songArtist) : 'singer1';

  const curArtist = resolveArtistInfo(currentLyric?.singer || currentSinger, artistsList, songArtist, songTitle);
  const nextArtist = resolveArtistInfo(nextLyric?.singer || nextSinger, artistsList, songArtist, songTitle);

  // Time remaining to next line for countdown (ONLY when no current lyric is playing)
  const isBreak = !currentLyric && nextLyric;
  const secondsToNext = isBreak ? nextLyric.time - currentTime : 0;
  const showCountdown = isBreak && secondsToNext > 0.5 && secondsToNext <= 5.0;

  // Smooth line progress calculation
  const lineDuration = currentLyric ? currentLyric.duration || 3.5 : 1;
  const elapsed = currentLyric ? Math.max(0, currentTime - currentLyric.time) : 0;
  const lineProgress = Math.min(100, Math.max(0, (elapsed / lineDuration) * 100));

  return (
    <div className="fixed inset-0 bg-[#040409] text-white flex flex-col justify-between p-6 sm:p-10 select-none overflow-hidden font-sans">
      {/* Dynamic Video Background Layer (Hardware-accelerated, zero-blur for 60fps TV rendering) */}
      {!youTubeEmbedId && (
        <DynamicVideoBackground
          config={{
            ...videoBgConfig,
            blurAmount: 0,
            overlayOpacity: Math.max(0.80, videoBgConfig.overlayOpacity ?? 0.84),
          }}
          isPlaying={isPlaying}
          songKey={`${songTitle}___${songArtist || ''}`}
          currentTime={currentTime}
          duration={duration}
        />
      )}

      {/* Ambient Visualizer Background Layer (No pulse animation to save TV CPU/GPU) */}
      <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900 via-slate-950 to-black" />

      {/* Top Header Bar for TV */}
      <div className="relative z-10 flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl overflow-hidden border border-cyan-400/60 shadow-[0_0_15px_rgba(0,240,255,0.6)] shrink-0">
            <img
              src="/logo-highres.jpg"
              alt="KaraokeLab TV Emblem"
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white truncate max-w-xl">
              {songTitle || 'Selecciona una Canción'}
            </h1>
            <p className="text-xs font-mono text-cyan-400 font-bold">
              {songArtist || 'KaraokeLab TV'}
            </p>
          </div>
        </div>

        {/* Singer Profile Badge & Fullscreen Button */}
        <div className="flex items-center gap-3">
          {activeSingerName && (
            <div className="px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-cyan-500/40 text-cyan-300 font-bold text-xs flex items-center gap-2 shadow-lg">
              <span className="text-base">{activeSingerAvatar || '🎤'}</span>
              <span>Cantando: {activeSingerName}</span>
            </div>
          )}

          {nextSongTitle && (
            <div className="hidden md:flex flex-col text-right font-mono text-[10px]">
              <span className="text-slate-400 font-bold">SIGUIENTE:</span>
              <span className="text-amber-300 font-bold truncate max-w-[180px]">{nextSongTitle}</span>
            </div>
          )}

          <button
            onClick={() => {
              if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
              } else {
                document.exitFullscreen().catch(() => {});
              }
            }}
            className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-white cursor-pointer transition-colors"
            title="Pantalla Completa (F11)"
          >
            <Maximize2 className="w-4 h-4 text-cyan-400" />
          </button>
        </div>
      </div>

      {/* Main Lyrics Center Display */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center py-6 text-center max-w-7xl mx-auto w-full px-2 sm:px-4">
        {youTubeEmbedId ? (
          /* Embedded YouTube Video Mode for TV */
          <div className="w-full max-w-5xl aspect-video rounded-2xl overflow-hidden shadow-2xl border border-red-500/40 bg-black">
            <iframe
              src={`https://www.youtube.com/embed/${youTubeEmbedId}?autoplay=1&controls=0&modestbranding=1&rel=0`}
              title="YouTube Karaoke TV"
              className="w-full h-full border-0"
              allow="autoplay; encrypted-media"
            />
          </div>
        ) : (
          /* Standard Lyrical Teleprompter Display for TV */
          <div className="flex flex-col items-center justify-between gap-4 w-full flex-1 min-h-0 py-2 overflow-hidden">
            {/* Slot 1: Active Singer Badge / Countdown (Strictly Singer & Cues, No [Verso] tag) */}
            <div className="h-9 flex items-center justify-center shrink-0">
              {isPlaying && (
                showCountdown ? (
                  <div className="inline-flex items-center gap-2 px-5 py-1.5 rounded-full bg-amber-500/20 text-amber-300 text-sm sm:text-base font-black animate-pulse">
                    <span>● ● ● ¡Prepárate para cantar en {Math.ceil(secondsToNext)}s!</span>
                    {nextLyric && (
                      <span className="font-mono text-xs sm:text-sm px-2.5 py-0.5 rounded-full bg-black/60 text-amber-200">
                        {nextArtist.isBoth ? '👥 Todos' : `🎤 ${nextArtist.name}`}
                      </span>
                    )}
                  </div>
                ) : currentLyric ? (
                  <div
                    className="inline-flex items-center gap-2 font-mono text-sm sm:text-base font-extrabold uppercase tracking-widest"
                    style={{ color: curArtist.color }}
                  >
                    <span className="text-base sm:text-lg">{curArtist.isBoth ? '👥' : '🎤'}</span>
                    <span>{curArtist.isBoth ? `DÚO · ${curArtist.name.toUpperCase()}` : `VOZ: ${curArtist.name.toUpperCase()}`}</span>
                  </div>
                ) : null
              )}
            </div>

            {/* Current Active Line (Large Grand Scale for Smart TV) */}
            <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center my-auto overflow-hidden">
              {!isPlaying ? (
                <div className="flex flex-col items-center gap-3 text-slate-500 opacity-60">
                  <div className="w-20 h-20 rounded-3xl bg-slate-900/90 border border-slate-800 flex items-center justify-center shadow-inner">
                    <Music className="w-10 h-10 text-cyan-400/50" />
                  </div>
                  <p className="text-2xl sm:text-3xl md:text-4xl font-black tracking-wider text-slate-400 font-mono">
                    {songTitle ? `EN ESPERA · ${songTitle}` : 'ESCENARIO EN ESPERA'}
                  </p>
                </div>
              ) : currentLyric ? (
                (() => {
                  const textClean = cleanLyricText(currentLyric.text);
                  const textLen = textClean.length;
                  const fontSizeClass = textLen <= 25
                    ? 'text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-black'
                    : textLen <= 45
                      ? 'text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-black'
                      : 'text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-black';

                  return (
                    <div className={`flex flex-wrap items-center justify-center gap-x-5 sm:gap-x-7 gap-y-3 font-black ${fontSizeClass} leading-tight tracking-tight text-center max-w-full`}>
                      {computeIntelligentWordFills(
                        { ...currentLyric, text: textClean },
                        currentTime,
                        nextLyric?.time,
                        128
                      ).map((item, wIdx) => {
                        return (
                          <span key={wIdx} className="relative inline-block select-none">
                            {/* Layer 1: Base Unsung Word (Clean, solid dim text without shadows) */}
                            <span className="text-white/30 inline-block">
                              {item.word}
                            </span>

                            {/* Layer 2: Active Sweeping Highlight Word (Solid, crisp glyph fill without glow) */}
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
                  <p className="text-2xl sm:text-3xl md:text-4xl font-black tracking-wider text-slate-400">
                    ♫ [SOLO INSTRUMENTAL] ♫
                  </p>
                </div>
              )}
            </div>

            {/* Next Upcoming Line Preview */}
            {isPlaying && nextLyric ? (
              <div className="mt-3 px-6 py-3 rounded-2xl bg-slate-950/75 border border-slate-800/80 max-w-2xl w-full flex flex-col items-center">
                <span className="text-xs sm:text-sm font-mono font-bold uppercase tracking-widest block mb-1" style={{ color: nextArtist.color }}>
                  {`[A CONTINUACIÓN: ${nextArtist.isBoth ? '👥 DÚO' : '🎤 ' + nextArtist.name.toUpperCase()}]`}
                </span>
                <p className="text-xl sm:text-2xl md:text-3xl font-bold truncate max-w-xl text-center" style={{ color: nextArtist.color }}>
                  {cleanLyricText(nextLyric.text)}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Bottom Progress Bar */}
      <div className="relative z-10 flex items-center justify-between text-xs font-mono text-slate-400 gap-4 pt-2">
        <span className="font-bold text-cyan-400">
          {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')}
        </span>
        <div className="flex-1 h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
          <div
            className="h-full bg-gradient-to-r from-[#00f0ff] to-[#ff007f] transition-all duration-200"
            style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
          />
        </div>
        <span>
          {Math.floor(duration / 60)}:{Math.floor(duration % 60).toString().padStart(2, '0')}
        </span>
      </div>
    </div>
  );
};
