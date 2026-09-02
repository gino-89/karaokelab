import React, { useEffect, useState, useRef } from 'react';
import { tvBroadcast, TvStatePayload } from '../services/tvBroadcastService';
import { peerSync, ConnectionStatus } from '../services/peerSyncService';
import { getDuetSinger } from './KaraokeDisplay';
import { cleanLyricText, resolveArtistInfo } from '../services/lrcParser';
import { computeIntelligentWordFills } from '../services/smartCueAnalyzer';
import { Music, Tv, Maximize2, Wifi, WifiOff, Sparkles } from 'lucide-react';
import { DynamicVideoBackground } from './DynamicVideoBackground';
import { VideoBackgroundConfig } from '../types';
import { KaraokeScoreAndTransitionModal } from './KaraokeScoreAndTransitionModal';
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
    const handleStateUpdate = (newState: TvStatePayload) => {
      setTvState((prev) => {
        if (!prev) return newState;
        if (newState.isTick) {
          // Fast-path delta tick: update time, duration, isPlaying, currentIndex, timestamp, scoreModalState
          return {
            ...prev,
            currentTime: newState.currentTime,
            duration: newState.duration || prev.duration,
            isPlaying: newState.isPlaying !== undefined ? newState.isPlaying : prev.isPlaying,
            currentIndex: newState.currentIndex !== undefined ? newState.currentIndex : prev.currentIndex,
            scoreModalState: newState.scoreModalState !== undefined ? newState.scoreModalState : prev.scoreModalState,
            timestamp: newState.timestamp || Date.now(),
          };
        }
        // Full update: update metadata, lyrics, configuration, and reset youTubeEmbedId if missing
        return {
          ...prev,
          ...newState,
          youTubeEmbedId: 'youTubeEmbedId' in newState ? newState.youTubeEmbedId : null,
          lyrics: newState.lyrics !== undefined ? newState.lyrics : prev.lyrics,
          songTitle: newState.songTitle !== undefined ? newState.songTitle : prev.songTitle,
          songArtist: newState.songArtist !== undefined ? newState.songArtist : prev.songArtist,
        };
      });
      setConnectionStatus('connected');
      if (newState?.videoBgConfig) {
        setVideoBgConfig(newState.videoBgConfig);
      }
    };

    // 1. Cross-Device WebRTC P2P Connection (Smart TV / Tablets / Apple TV)
    if (targetHostId) {
      peerSync.initTvDisplay(
        targetHostId,
        handleStateUpdate,
        (status) => {
          setConnectionStatus(status);
        }
      );
    }

    // 2. Same-Device BroadcastChannel (Multi-monitor / Independent browser window)
    const unsub = tvBroadcast.onStateUpdate(handleStateUpdate);

    return () => {
      unsub();
    };
  }, [targetHostId]);

  // Synchronize Host isPlaying and Seeking directly to the TV's YouTube player with millimetric precision
  const ytTvIframeRef = useRef<HTMLIFrameElement>(null);
  const lastSyncTimeRef = useRef<number>(0);

  // Clean and extract standard YouTube video ID
  const cleanYoutubeId = (() => {
    const raw = tvState?.youTubeEmbedId || '';
    if (!raw) return '';
    const trimmed = raw.trim().replace(/^yt_/, '');
    const match = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (match && match[1]) return match[1];
    const simpleMatch = trimmed.match(/^[\w-]{11}$/);
    if (simpleMatch) return simpleMatch[0];
    return trimmed;
  })();

  // Instant Play / Pause lockstep synchronization (Seek to exact timestamp + trigger Play/Pause command)
  useEffect(() => {
    if (!cleanYoutubeId) return;

    try {
      const win = ytTvIframeRef.current?.contentWindow;
      if (win) {
        if (tvState?.currentTime !== undefined) {
          win.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [tvState.currentTime, true] }), '*');
        }
        if (tvState?.isPlaying) {
          win.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: '' }), '*');
        } else {
          win.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' }), '*');
        }
      }
    } catch (_) {}
  }, [tvState?.isPlaying, cleanYoutubeId]);

  // Live seek synchronization when host scrubs timeline
  useEffect(() => {
    if (!cleanYoutubeId || tvState?.currentTime === undefined) return;
    const diff = Math.abs(tvState.currentTime - lastSyncTimeRef.current);
    if (diff > 1.5) {
      lastSyncTimeRef.current = tvState.currentTime;
      try {
        const win = ytTvIframeRef.current?.contentWindow;
        if (win) {
          win.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [tvState.currentTime, true] }), '*');
        }
      } catch (_) {}
    } else {
      lastSyncTimeRef.current = tvState.currentTime;
    }
  }, [tvState?.currentTime, cleanYoutubeId]);

  // Listen for YouTube video end events on TV screen and notify host
  useEffect(() => {
    if (!cleanYoutubeId) return;

    let hasNotified = false;
    const handleTvYtMessage = (event: MessageEvent) => {
      try {
        let data = event.data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch (_) { return; }
        }

        const state = data?.info?.playerState !== undefined
          ? data.info.playerState
          : data?.event === 'onStateChange'
            ? data.info
            : data?.infoDelivery?.playerState;

        if ((state === 0 || state === '0') && !hasNotified) {
          hasNotified = true;
          console.log('✓ YouTube TV video ended, sending TRACK_ENDED to host...');
          tvBroadcast.sendRemoteCommand('TRACK_ENDED');
        }
      } catch (_) {}
    };

    window.addEventListener('message', handleTvYtMessage);
    return () => window.removeEventListener('message', handleTvYtMessage);
  }, [cleanYoutubeId]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { });
    } else {
      document.exitFullscreen().catch(() => { });
    }
  };

  const isStandby = !tvState || !tvState.songTitle;

  const {
    songTitle = '',
    songArtist,
    artistsList,
    currentTime = 0,
    duration = 0,
    isPlaying = false,
    lyrics = [],
    currentIndex = -1,
    activeSingerName,
    activeSingerAvatar,
    nextSongTitle,
    nextSongArtist,
    nextSongRequestedBy,
    isDuetMode,
    youTubeEmbedId,
  } = tvState || {};

  const safeLyrics = Array.isArray(lyrics) ? lyrics : [];
  const currentLyric = currentIndex >= 0 && currentIndex < safeLyrics.length ? safeLyrics[currentIndex] : null;
  const nextLyric = currentIndex >= 0 && currentIndex < safeLyrics.length - 1 ? safeLyrics[currentIndex + 1] : (currentIndex === -1 && safeLyrics.length > 0 ? safeLyrics[0] : null);

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

  const effectiveVideoBgConfig = tvState?.videoBgConfig || videoBgConfig;

  return (
    <div className="fixed inset-0 bg-[#060714] text-white flex flex-col justify-between p-6 sm:p-10 select-none overflow-hidden font-sans">
      {/* 1. Dynamic Video Background Layer (Permanently mounted - never unmounts on song transitions) */}
      <DynamicVideoBackground
        config={effectiveVideoBgConfig}
        isPlaying={isPlaying}
        songKey={`${songTitle}___${songArtist || ''}`}
        currentTime={currentTime}
        duration={duration}
      />

      {/* 2. Standby Welcome Overlay when no song is playing */}
      {isStandby && (
        <div
          onClick={toggleFullscreen}
          className="absolute inset-0 z-30 bg-[#05050c]/95 backdrop-blur-md text-white flex flex-col items-center justify-between p-8 sm:p-12 font-sans select-none overflow-hidden cursor-pointer"
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
              <span className={`px-3 py-1 rounded-full text-xs font-mono font-bold flex items-center gap-1.5 border ${connectionStatus === 'connected'
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
      )}

      {/* 3. Fullscreen YouTube Cinema Video Player (When playing YouTube songs) */}
      {!isStandby && cleanYoutubeId && (
        <div className="absolute inset-0 w-full h-full z-25 bg-black flex items-center justify-center overflow-hidden select-none">
          <iframe
            ref={ytTvIframeRef}
            key={`yt_tv_${cleanYoutubeId}`}
            src={`https://www.youtube.com/embed/${cleanYoutubeId}?autoplay=1&mute=1&controls=0&playsinline=1&enablejsapi=1&rel=0`}
            title="YouTube Karaoke TV"
            className="w-full h-full border-0 pointer-events-none scale-[1.06]"
            style={{ width: '100vw', height: '100vh' }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            onLoad={() => {
              try {
                const win = ytTvIframeRef.current?.contentWindow;
                if (win) {
                  win.postMessage(JSON.stringify({ event: 'listening', id: cleanYoutubeId }), '*');
                }
              } catch (_) {}
            }}
          />
          <div
            onClick={toggleFullscreen}
            className="absolute inset-0 z-30 cursor-pointer"
            title="Haz clic para Pantalla Completa"
          />
        </div>
      )}

      {/* Ambient Visualizer Background */}
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
            <div className="flex flex-col text-right px-4 py-2 rounded-2xl bg-amber-950/70 border border-amber-500/60 shadow-[0_0_25px_rgba(245,158,11,0.4)] animate-pulse">
              <span className="text-amber-300 font-mono font-black text-xs sm:text-sm uppercase tracking-widest flex items-center justify-end gap-1">
                <span>▶ SIGUIENTE CANCIÓN:</span>
              </span>
              <span className="text-[#00f0ff] font-black text-base sm:text-lg md:text-xl truncate max-w-[280px] sm:max-w-[420px]">
                {nextSongTitle}
              </span>
              {nextSongRequestedBy && (
                <span className="text-pink-300 font-bold text-xs sm:text-sm truncate max-w-[280px] sm:max-w-[420px] flex items-center justify-end gap-1">
                  <span>🎤 {nextSongRequestedBy}</span>
                </span>
              )}
            </div>
          )}

          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-white cursor-pointer transition-colors"
            title="Pantalla Completa (F11)"
          >
            <Maximize2 className="w-4 h-4 text-cyan-400" />
          </button>
        </div>
      </div>

      {/* Main Lyrics Center Display */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center py-6 text-center max-w-7xl mx-auto w-full px-2 sm:px-4">
        <div className="flex flex-col items-center justify-between gap-4 w-full flex-1 min-h-0 py-2 overflow-hidden">
          {/* Slot 1: Active Singer Badge / Countdown */}
          <div className="h-9 flex items-center justify-center shrink-0">
            {showCountdown ? (
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
            ) : null}
          </div>

          {/* Current Active Line (Always visible on pause, perfectly frozen in place) */}
          <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center my-auto overflow-hidden">
            {currentLyric ? (
              (() => {
                const textClean = cleanLyricText(currentLyric.text);
                const textLen = textClean.length;
                const fontSizeClass = textLen <= 25
                  ? 'text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-black'
                  : textLen <= 45
                    ? 'text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-black'
                    : 'text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-black';

                return (
                  <div className={`flex flex-wrap items-center justify-center gap-x-5 sm:gap-x-7 gap-y-3 font-black ${fontSizeClass} leading-tight tracking-tight text-center max-w-full drop-shadow-[0_4px_12px_rgba(0,0,0,0.95)]`}>
                    {computeIntelligentWordFills(
                      { ...currentLyric, text: textClean },
                      currentTime,
                      nextLyric?.time,
                      128
                    ).map((item, wIdx) => {
                      return (
                        <span key={wIdx} className="relative inline-block select-none">
                          {/* Layer 1: Base Unsung Word (Clear, high-contrast text with solid outline) */}
                          <span
                            className="text-white/65 inline-block"
                            style={{ textShadow: '0 2px 6px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,0.9)' }}
                          >
                            {item.word}
                          </span>

                          {/* Layer 2: Active Sweeping Highlight Word (Solid, vibrant glyph fill with outline) */}
                          {item.fillPercentage > 0 && (
                            <span
                              className="absolute inset-0 inline-block pointer-events-none"
                              style={{
                                clipPath: `inset(0 ${Math.max(0, Math.min(100, 100 - item.fillPercentage))}% 0 0)`,
                                color: curArtist.color,
                                textShadow: '0 2px 6px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,0.9)',
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
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <Music className="w-12 h-12 text-slate-500" />
                <p className="text-2xl sm:text-3xl md:text-4xl font-black tracking-wider text-slate-300 animate-pulse">
                  ♫ [SOLO INSTRUMENTAL] ♫
                </p>
              </div>
            )}
          </div>

          {/* Next Upcoming Line Preview */}
          {nextLyric ? (
            <div className="mt-3 px-6 py-3 rounded-2xl bg-slate-950/85 border border-slate-700/80 max-w-3xl w-full flex flex-col items-center shadow-lg">
              <span className="text-sm sm:text-base md:text-lg font-mono font-black uppercase tracking-widest block mb-1" style={{ color: nextArtist.color }}>
                {`[A CONTINUACIÓN: ${nextArtist.isBoth ? '👥 DÚO' : '🎤 ' + nextArtist.name.toUpperCase()}]`}
              </span>
              <p className="text-2xl sm:text-3xl md:text-4xl font-extrabold truncate max-w-2xl text-center" style={{ color: nextArtist.color }}>
                {cleanLyricText(nextLyric.text)}
              </p>
            </div>
          ) : null}
        </div>
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

      {/* 4. Score & 10-Second Transition Celebration Modal on TV Display */}
      <KaraokeScoreAndTransitionModal
        isOpen={!!tvState?.scoreModalState?.isOpen}
        performance={tvState?.scoreModalState?.performance || null}
        nextSong={tvState?.scoreModalState?.nextSong || null}
        nextSinger={tvState?.scoreModalState?.nextSinger || null}
        onStartNextSong={() => {}}
        onReplayCurrentSong={() => {}}
        onClose={() => {}}
        isReadOnly={true}
        muteAudio={true}
      />
    </div>
  );
};
