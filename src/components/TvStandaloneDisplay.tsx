import React, { useEffect, useState } from 'react';
import { tvBroadcast, TvStatePayload } from '../services/tvBroadcastService';
import { getDuetSinger } from './KaraokeDisplay';
import { cleanLyricText, titleCaseArtist, resolveArtistInfo } from '../services/lrcParser';
import { computeIntelligentWordFills } from '../services/smartCueAnalyzer';
import { Music, Users, Sparkles, Tv, Maximize2 } from 'lucide-react';
import { DynamicVideoBackground } from './DynamicVideoBackground';
import { VideoBackgroundConfig } from '../types';
import { loadVideoBackgroundConfig, searchOfficialVideo } from '../services/videoBackgroundService';

export const TvStandaloneDisplay: React.FC = () => {
  const [tvState, setTvState] = useState<TvStatePayload | null>(() => tvBroadcast.getInitialState());
  const [videoBgConfig, setVideoBgConfig] = useState<VideoBackgroundConfig>(() => loadVideoBackgroundConfig());

  useEffect(() => {
    const unsub = tvBroadcast.onStateUpdate((newState) => {
      setTvState(newState);
      if (newState.videoBgConfig) {
        setVideoBgConfig(newState.videoBgConfig);
      }
    });
    return () => unsub();
  }, []);

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

  if (!tvState) {
    return (
      <div className="fixed inset-0 bg-[#05050c] text-white flex flex-col items-center justify-center p-8 gap-4 font-sans select-none">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#00f0ff] to-[#ff007f] flex items-center justify-center animate-pulse shadow-[0_0_30px_rgba(0,240,255,0.4)]">
          <Tv className="w-8 h-8 text-slate-950" />
        </div>
        <h1 className="text-2xl font-black italic tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-white via-cyan-200 to-white uppercase">
          KaraokeLab // Pantalla TV
        </h1>
        <p className="text-sm font-mono text-cyan-400">Esperando conexión del Control Remoto...</p>
        <span className="text-xs text-slate-500 max-w-sm text-center">
          Esta pantalla se actualizará automáticamente cuando reproduzcas una canción desde el control remoto.
        </span>
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
      {/* Dynamic Video Background Layer (when not in explicit YouTube mode) */}
      {!youTubeEmbedId && (
        <DynamicVideoBackground
          config={videoBgConfig}
          isPlaying={isPlaying}
          songKey={`${songTitle}___${songArtist || ''}`}
          currentTime={currentTime}
          duration={duration}
        />
      )}

      {/* Animated Visualizer Background */}
      <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900 via-slate-950 to-black animate-pulse" />

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
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center py-6 text-center max-w-5xl mx-auto w-full">
        {youTubeEmbedId ? (
          /* Embedded YouTube Video Mode for TV */
          <div className="w-full max-w-4xl aspect-video rounded-2xl overflow-hidden shadow-2xl border border-red-500/40 bg-black">
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
            <div className="h-8 flex items-center justify-center shrink-0">
              {isPlaying && (
                showCountdown ? (
                  <div className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs sm:text-sm font-bold animate-pulse">
                    <span>● ● ● ¡Prepárate para cantar en {Math.ceil(secondsToNext)}s!</span>
                    {nextLyric && (
                      <span className="font-mono text-xs px-2 py-0.5 rounded-full bg-black/60 text-amber-200">
                        {nextArtist.isBoth ? '👥 Todos' : `🎤 ${nextArtist.name}`}
                      </span>
                    )}
                  </div>
                ) : currentLyric ? (
                  <div
                    className="inline-flex items-center gap-2 font-mono text-xs sm:text-sm font-bold uppercase tracking-wider"
                    style={{ color: curArtist.color }}
                  >
                    <span>{curArtist.isBoth ? '👥' : '🎤'}</span>
                    <span>{curArtist.isBoth ? `DÚO · ${curArtist.name.toUpperCase()}` : `VOZ: ${curArtist.name.toUpperCase()}`}</span>
                  </div>
                ) : null
              )}
            </div>

            {/* Current Active Line (Dynamic Scaling to Prevent Overlap) */}
            <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center my-auto overflow-hidden">
              {!isPlaying ? (
                <div className="flex flex-col items-center gap-3 text-slate-500 opacity-60">
                  <div className="w-16 h-16 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-center shadow-inner">
                    <Music className="w-8 h-8 text-cyan-400/50" />
                  </div>
                  <p className="text-xl sm:text-2xl font-bold tracking-wider text-slate-400 font-mono">
                    {songTitle ? `EN ESPERA · ${songTitle}` : 'ESCENARIO EN ESPERA'}
                  </p>
                </div>
              ) : currentLyric ? (
                (() => {
                  const textClean = cleanLyricText(currentLyric.text);
                  const textLen = textClean.length;
                  const fontSizeClass = textLen <= 25
                    ? 'text-3xl sm:text-5xl md:text-6xl font-extrabold'
                    : textLen <= 50
                      ? 'text-2xl sm:text-4xl md:text-5xl font-extrabold'
                      : 'text-xl sm:text-3xl md:text-4xl font-extrabold';

                  return (
                    <div className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-black ${fontSizeClass} leading-snug tracking-tight text-center max-w-full`}>
                      {computeIntelligentWordFills(
                        { ...currentLyric, text: textClean },
                        currentTime,
                        nextLyric?.time,
                        128
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
                <div className="flex flex-col items-center gap-2 text-slate-500 animate-pulse">
                  <Music className="w-10 h-10 text-slate-600" />
                  <p className="text-xl sm:text-2xl font-bold tracking-wider text-slate-400">
                    ♫ [SOLO INSTRUMENTAL] ♫
                  </p>
                </div>
              )}
            </div>

            {/* Next Upcoming Line Preview */}
            {isPlaying && nextLyric ? (
              <div className="mt-4 p-3 rounded-2xl bg-slate-950/70 border border-slate-800/80 max-w-xl w-full flex flex-col items-center">
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest block mb-1" style={{ color: nextArtist.color }}>
                  {`[A CONTINUACIÓN: ${nextArtist.isBoth ? '👥 DÚO' : '🎤 ' + nextArtist.name.toUpperCase()}]`}
                </span>
                <p className="text-lg sm:text-xl font-bold truncate max-w-lg" style={{ color: nextArtist.color }}>
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
