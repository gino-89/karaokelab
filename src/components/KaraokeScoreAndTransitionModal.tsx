import React, { useState, useEffect, useRef } from 'react';
import { 
  Trophy, 
  Sparkles, 
  Play, 
  SkipForward, 
  RotateCcw, 
  X, 
  Flame, 
  Star, 
  Mic2, 
  Music, 
  CheckCircle2, 
  Zap,
  Pause
} from 'lucide-react';
import { SongItem, SingerProfile } from '../types';
import { soundEffects } from '../services/soundEffects';

export interface KaraokePerformanceResult {
  song: SongItem;
  singer?: SingerProfile;
  score: number; // 0 to 100
  pitchAccuracy: number; // 0 to 100
  rhythmScore: number; // 0 to 100
  lyricsCompletion: number; // 0 to 100
  rank: string;
  rankColor: string;
  stars: number; // 1 to 5
}

interface KaraokeScoreAndTransitionModalProps {
  isOpen: boolean;
  mode?: 'score' | 'transition';
  performance: KaraokePerformanceResult | null;
  nextSong: SongItem | null;
  nextSinger?: SingerProfile | null;
  onStartNextSong: () => void;
  onSkipNextSong?: () => void;
  onReplayCurrentSong: () => void;
  onClose: () => void;
  isPartyMode?: boolean;
  muteAudio?: boolean;
  isReadOnly?: boolean;
}

export const KaraokeScoreAndTransitionModal: React.FC<KaraokeScoreAndTransitionModalProps> = ({
  isOpen,
  performance,
  nextSong,
  nextSinger,
  onStartNextSong,
  onSkipNextSong,
  onReplayCurrentSong,
  onClose,
  isPartyMode = false,
  muteAudio = false,
  isReadOnly = false,
}) => {
  const [countdown, setCountdown] = useState<number>(10);
  const [isCountdownPaused, setIsCountdownPaused] = useState<boolean>(false);
  const [animatedScore, setAnimatedScore] = useState<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sync countdown when modal opens & play crowd applause
  useEffect(() => {
    if (isOpen) {
      setCountdown(10);
      setIsCountdownPaused(false);
      setAnimatedScore(0);
      if (!muteAudio && performance) {
        soundEffects.playApplause(performance.score);
      }
    }
  }, [isOpen, performance, muteAudio]);

  // Animate score counter up
  useEffect(() => {
    if (isOpen && performance) {
      const targetScore = performance.score;
      const duration = 1200; // 1.2s
      const startTime = performanceNow();

      let animationFrameId: number;
      const step = () => {
        const now = performanceNow();
        const progress = Math.min(1, (now - startTime) / duration);
        const current = Math.round(targetScore * (1 - Math.pow(2, -10 * progress)));
        setAnimatedScore(current);

        if (progress < 1) {
          animationFrameId = requestAnimationFrame(step);
        } else {
          setAnimatedScore(targetScore);
        }
      };

      animationFrameId = requestAnimationFrame(step);
      return () => cancelAnimationFrame(animationFrameId);
    }
  }, [isOpen, performance]);

  // Helper for performance.now()
  function performanceNow() {
    return typeof window !== 'undefined' && window.performance ? window.performance.now() : Date.now();
  }

  // Particle Confetti Burst Effect
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);

    const colors = ['#00f0ff', '#ff007f', '#00ff9d', '#ffd700', '#a855f7', '#ffffff'];
    const particleCount = 60;
    const particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      color: string;
      rotation: number;
      rotationSpeed: number;
      opacity: number;
    }> = [];

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: width / 2 + (Math.random() - 0.5) * 80,
        y: height * 0.35,
        vx: (Math.random() - 0.5) * 14,
        vy: (Math.random() - 0.8) * 15,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 10,
        opacity: 1,
      });
    }

    let animId: number;
    const render = () => {
      ctx.clearRect(0, 0, width, height);

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.35; // gravity
        p.vx *= 0.98;
        p.rotation += p.rotationSpeed;
        p.opacity = Math.max(0, p.opacity - 0.008);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });

      if (particles.some((p) => p.opacity > 0.05)) {
        animId = requestAnimationFrame(render);
      }
    };

    animId = requestAnimationFrame(render);

    const handleResize = () => {
      if (!canvasRef.current) return;
      width = canvasRef.current.width = canvasRef.current.offsetWidth;
      height = canvasRef.current.height = canvasRef.current.offsetHeight;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen]);

  // 10-second Countdown Timer Logic
  useEffect(() => {
    if (!isOpen || isCountdownPaused || isReadOnly) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        const nextVal = prev - 1;
        if (!muteAudio && nextSong && nextVal <= 4 && nextVal > 0) {
          soundEffects.playCountdownBeep(nextVal <= 2);
        }
        return Math.max(0, nextVal);
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, isCountdownPaused, isReadOnly, muteAudio, nextSong]);

  // Asynchronously trigger next song / close when countdown reaches 0 (prevents setState in render warning)
  useEffect(() => {
    if (!isOpen || isReadOnly || countdown > 0) return;

    if (nextSong) {
      onStartNextSong();
    } else {
      onClose();
    }
  }, [isOpen, isReadOnly, countdown, nextSong, onStartNextSong, onClose]);

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 select-none ${
      isPartyMode 
        ? 'bg-black/95 backdrop-blur-2xl' 
        : 'bg-slate-950/90 backdrop-blur-xl'
    }`}>
      {/* Background Canvas for Confetti */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
      />

      {/* Background Glow effects */}
      <div className="absolute w-[600px] h-[600px] bg-gradient-to-tr from-[#00f0ff]/15 via-[#ff007f]/15 to-amber-500/10 rounded-full blur-[140px] pointer-events-none" />

      {/* ───────────────────────────────────────────────────────────── */}
      {/* ── UNIFIED KARAOKE PERFORMANCE SCORE & 10s COUNTDOWN MODAL ──── */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div className="relative z-20 w-full max-w-2xl bg-slate-900/95 border border-slate-700/90 rounded-3xl p-5 sm:p-7 shadow-[0_0_90px_rgba(0,240,255,0.25)] flex flex-col items-center text-center animate-in zoom-in-95 duration-200 overflow-y-auto max-h-[95vh]">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer transition-colors"
          title="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Top Header Badge */}
        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-amber-500/20 via-pink-500/20 to-cyan-500/20 border border-amber-400/40 text-amber-300 text-xs font-black tracking-widest uppercase mb-3 shadow-[0_0_20px_rgba(245,158,11,0.3)]">
          <Trophy className="w-4 h-4 text-amber-400 fill-amber-400 animate-bounce" />
          <span>PUNTUACIÓN Y PRÓXIMA CANCIÓN</span>
          <Sparkles className="w-4 h-4 text-cyan-300" />
        </div>

        {/* Singer Badge & Song Title */}
        {performance && (
          <div className="flex flex-col items-center gap-1 mb-3">
            {performance.singer && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/90 border border-slate-700 text-xs font-bold text-slate-200">
                <span className="text-base">{performance.singer.avatar}</span>
                <span>Cantante:</span>
                <span className="text-cyan-400 font-extrabold">{performance.singer.name}</span>
              </div>
            )}
            <h2 className="text-lg sm:text-xl font-black text-white tracking-wide truncate max-w-md">
              {performance.song.title}
            </h2>
          </div>
        )}

        {/* Middle Section: Score Box + Performance Metrics */}
        {performance && (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 w-full mb-4 bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4">
            {/* Score Ring */}
            <div className="flex flex-col items-center justify-center shrink-0">
              <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 border-3 border-cyan-400/80 shadow-[0_0_35px_rgba(0,240,255,0.3)] flex flex-col items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-500/20 via-transparent to-transparent animate-pulse" />
                <span className="text-4xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white via-cyan-100 to-cyan-400 font-mono tracking-tight">
                  {animatedScore}
                </span>
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
                  Puntos
                </span>
              </div>

              {/* Rank Badge */}
              <span className={`mt-2 px-3 py-1 rounded-xl text-xs font-black tracking-wider shadow-md uppercase inline-flex items-center gap-1.5 ${performance.rankColor}`}>
                <Flame className="w-3.5 h-3.5 fill-current animate-pulse" />
                {performance.rank}
              </span>
            </div>

            {/* Metrics Breakdown & Stars */}
            <div className="flex flex-col items-center sm:items-start flex-1 w-full gap-2.5">
              {/* Stars */}
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((starIdx) => {
                  const isFilled = starIdx <= performance.stars;
                  return (
                    <Star
                      key={starIdx}
                      className={`w-5 h-5 transition-all duration-300 ${
                        isFilled
                          ? 'text-amber-400 fill-amber-400 drop-shadow-[0_0_6px_rgba(245,158,11,0.8)] scale-110'
                          : 'text-slate-700'
                      }`}
                    />
                  );
                })}
              </div>

              {/* 3 Metric Pills */}
              <div className="grid grid-cols-3 gap-2 w-full">
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2 flex flex-col items-center">
                  <span className="text-[9px] font-bold text-slate-400 uppercase">Afinación</span>
                  <span className="text-sm font-black text-cyan-400 font-mono mt-0.5">
                    {performance.pitchAccuracy}%
                  </span>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2 flex flex-col items-center">
                  <span className="text-[9px] font-bold text-slate-400 uppercase">Ritmo</span>
                  <span className="text-sm font-black text-[#ff007f] font-mono mt-0.5">
                    {performance.rhythmScore}%
                  </span>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2 flex flex-col items-center">
                  <span className="text-[9px] font-bold text-slate-400 uppercase">Letras</span>
                  <span className="text-sm font-black text-[#00ff9d] font-mono mt-0.5">
                    {performance.lyricsCompletion}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* ── NEXT SONG CARD & 10-SECOND COUNTDOWN ───────────────────── */}
        {/* ───────────────────────────────────────────────────────────── */}
        {nextSong ? (
          <div className="w-full bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 border border-slate-700/80 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 mb-5 shadow-lg">
            {/* Left: Next Song Details */}
            <div className="flex items-center gap-3 min-w-0 text-left w-full sm:w-auto flex-1">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#ff007f]/30 to-[#00f0ff]/30 border border-slate-700 flex items-center justify-center shrink-0">
                <Music className="w-6 h-6 text-cyan-300" />
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#ff007f] flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  <span>PRÓXIMA CANCIÓN:</span>
                </span>
                <h3 className="text-base font-black text-white truncate">
                  {nextSong.title}
                </h3>
                <p className="text-xs text-slate-400 truncate">
                  {nextSong.artist || 'Artista Desconocido'}
                  {nextSinger && (
                    <span className="text-cyan-300 font-bold ml-2">
                      • 🎤 {nextSinger.name}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Right: 10-Second Countdown Circle */}
            <div className="relative flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 shrink-0">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  className="stroke-slate-800"
                  strokeWidth="7"
                  fill="transparent"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  className="stroke-[#ff007f] transition-all duration-1000 ease-linear"
                  strokeWidth="7"
                  strokeDasharray={263.8}
                  strokeDashoffset={263.8 * (1 - countdown / 10)}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>

              <div className="absolute flex flex-col items-center justify-center">
                <span className="text-2xl sm:text-3xl font-black text-white font-mono animate-pulse">
                  {countdown}
                </span>
                <span className="text-[8px] font-bold uppercase tracking-widest text-slate-400">
                  seg
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full flex items-center justify-center gap-2 mb-5 text-xs font-bold text-amber-300 bg-amber-500/10 border border-amber-500/20 py-2.5 rounded-xl">
            <Trophy className="w-4 h-4 text-amber-400" />
            <span>¡Has completado la cola! Excelente actuación. ({countdown}s)</span>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* ── ACTION BUTTONS ─────────────────────────────────────────── */}
        {/* ───────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-center gap-2.5 w-full">
          <button
            onClick={onReplayCurrentSong}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all"
            title="Volver a cantar la canción actual"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Volver a Cantar</span>
          </button>

          {nextSong ? (
            <>
              <button
                onClick={() => setIsCountdownPaused((prev) => !prev)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs border border-slate-700 cursor-pointer transition-colors flex items-center gap-1.5"
              >
                {isCountdownPaused ? <Play className="w-3.5 h-3.5 text-cyan-400 fill-current" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
                <span>{isCountdownPaused ? 'Reanudar' : 'Pausar'}</span>
              </button>

              {onSkipNextSong && (
                <button
                  onClick={onSkipNextSong}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs border border-slate-700 cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                  <span>Saltar Canción</span>
                </button>
              )}

              <button
                onClick={onStartNextSong}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:brightness-110 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer transition-all shadow-[0_0_20px_rgba(16,185,129,0.4)]"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>¡Cantar Ahora!</span>
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="px-6 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:brightness-110 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer transition-all shadow-[0_0_20px_rgba(16,185,129,0.4)]"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Cerrar</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
