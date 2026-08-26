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
  Volume2, 
  CheckCircle2, 
  Zap 
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
  mode: 'score' | 'transition';
  performance: KaraokePerformanceResult | null;
  nextSong: SongItem | null;
  nextSinger?: SingerProfile | null;
  onStartNextSong: () => void;
  onSkipNextSong?: () => void;
  onReplayCurrentSong: () => void;
  onClose: () => void;
  isPartyMode?: boolean;
}

export const KaraokeScoreAndTransitionModal: React.FC<KaraokeScoreAndTransitionModalProps> = ({
  isOpen,
  mode: initialMode,
  performance,
  nextSong,
  nextSinger,
  onStartNextSong,
  onSkipNextSong,
  onReplayCurrentSong,
  onClose,
  isPartyMode = false,
}) => {
  const [currentStep, setCurrentStep] = useState<'score' | 'transition'>(initialMode);
  const [countdown, setCountdown] = useState<number>(5);
  const [isCountdownPaused, setIsCountdownPaused] = useState<boolean>(false);
  const [animatedScore, setAnimatedScore] = useState<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sync step when modal opens & play crowd applause
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(initialMode);
      setCountdown(5);
      setIsCountdownPaused(false);
      setAnimatedScore(0);
      if (initialMode === 'score' && performance) {
        soundEffects.playApplause(performance.score);
      }
    }
  }, [isOpen, initialMode, performance]);

  // Animate score counter up
  useEffect(() => {
    if (isOpen && currentStep === 'score' && performance) {
      const targetScore = performance.score;
      const duration = 1200; // 1.2s
      const startTime = performanceNow();

      let animationFrameId: number;
      const step = () => {
        const now = performanceNow();
        const progress = Math.min(1, (now - startTime) / duration);
        // Ease out expo
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
  }, [isOpen, currentStep, performance]);

  // Helper for performance.now()
  function performanceNow() {
    return typeof window !== 'undefined' && window.performance ? window.performance.now() : Date.now();
  }

  // Particle Confetti Burst Effect
  useEffect(() => {
    if (!isOpen || currentStep !== 'score' || !canvasRef.current) return;

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
        y: height * 0.45,
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
  }, [isOpen, currentStep]);

  // Auto-advance from Score screen to Next Song Countdown (Hands-free automatic transition)
  const [scoreAutoSeconds, setScoreAutoSeconds] = useState<number>(5);
  // Auto-close countdown when there are NO MORE songs in the queue (3 seconds)
  const [closeAutoSeconds, setCloseAutoSeconds] = useState<number>(3);

  useEffect(() => {
    if (!isOpen || currentStep !== 'score') return;

    if (nextSong) {
      setScoreAutoSeconds(5);
      const interval = setInterval(() => {
        setScoreAutoSeconds((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            setCurrentStep('transition');
            setCountdown(5);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(interval);
    } else {
      setCloseAutoSeconds(3);
      const interval = setInterval(() => {
        setCloseAutoSeconds((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            onClose();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [isOpen, currentStep, nextSong, onClose]);

  // 5-second Countdown Timer Logic
  useEffect(() => {
    if (!isOpen || currentStep !== 'transition' || isCountdownPaused) return;

    if (countdown <= 0) {
      onStartNextSong();
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        soundEffects.playCountdownBeep(prev <= 2);
        if (prev <= 1) {
          clearInterval(timer);
          onStartNextSong();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, currentStep, countdown, isCountdownPaused, onStartNextSong]);

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 select-none ${
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
      {/* ── STEP 1: KARAOKE PERFORMANCE SCORE SCREEN ───────────────── */}
      {/* ───────────────────────────────────────────────────────────── */}
      {currentStep === 'score' && performance && (
        <div className="relative z-20 w-full max-w-xl bg-slate-900/90 border border-slate-700/80 rounded-3xl p-6 sm:p-8 shadow-[0_0_80px_rgba(0,240,255,0.25)] flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
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
            <span>PUNTUACIÓN FINAL</span>
            <Sparkles className="w-4 h-4 text-cyan-300" />
          </div>

          {/* Singer Badge */}
          {performance.singer && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/90 border border-slate-700 text-xs font-bold text-slate-200 mb-4">
              <span className="text-base">{performance.singer.avatar}</span>
              <span>Cantante:</span>
              <span className="text-cyan-400 font-extrabold">{performance.singer.name}</span>
            </div>
          )}

          {/* Song Name */}
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-wide truncate max-w-md">
            {performance.song.title}
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 font-medium mb-6">
            {performance.song.artist || 'KaraokeLab Engine'}
          </p>

          {/* Large Animated Score Ring / Box */}
          <div className="relative flex flex-col items-center justify-center mb-6">
            <div className="w-40 h-40 sm:w-48 sm:h-48 rounded-full bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 border-4 border-cyan-400/80 shadow-[0_0_50px_rgba(0,240,255,0.4)] flex flex-col items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-500/20 via-transparent to-transparent animate-pulse" />
              
              <span className="text-5xl sm:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white via-cyan-100 to-cyan-400 font-mono tracking-tight">
                {animatedScore}
              </span>
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mt-1">
                de 100 Puntos
              </span>
            </div>

            {/* Stars Rating */}
            <div className="flex items-center gap-1.5 mt-3">
              {[1, 2, 3, 4, 5].map((starIdx) => {
                const isFilled = starIdx <= performance.stars;
                return (
                  <Star
                    key={starIdx}
                    className={`w-6 h-6 transition-all duration-300 ${
                      isFilled
                        ? 'text-amber-400 fill-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.8)] scale-110'
                        : 'text-slate-700'
                    }`}
                  />
                );
              })}
            </div>
          </div>

          {/* Rank Badge */}
          <div className="mb-6">
            <span className={`px-5 py-2 rounded-2xl text-sm sm:text-base font-black tracking-wider shadow-lg uppercase inline-flex items-center gap-2 ${performance.rankColor}`}>
              <Flame className="w-5 h-5 fill-current animate-pulse" />
              {performance.rank}
            </span>
          </div>

          {/* Detailed Performance Metrics */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3 w-full mb-8">
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-2.5 flex flex-col items-center">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Afinación</span>
              <span className="text-base sm:text-lg font-black text-cyan-400 font-mono mt-0.5">
                {performance.pitchAccuracy}%
              </span>
            </div>
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-2.5 flex flex-col items-center">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Ritmo / Tiempo</span>
              <span className="text-base sm:text-lg font-black text-[#ff007f] font-mono mt-0.5">
                {performance.rhythmScore}%
              </span>
            </div>
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-2.5 flex flex-col items-center">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Letras Cantadas</span>
              <span className="text-base sm:text-lg font-black text-[#00ff9d] font-mono mt-0.5">
                {performance.lyricsCompletion}%
              </span>
            </div>
          </div>

          {/* If no next song in queue, show clear completion status */}
          {!nextSong && (
            <div className="w-full flex items-center justify-center gap-2 mb-4 text-xs font-bold text-amber-300 bg-amber-500/10 border border-amber-500/20 py-2 rounded-xl">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span>¡Has completado la lista! Excelente actuación.</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3 w-full">
            <button
              onClick={onReplayCurrentSong}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 font-bold text-xs flex items-center gap-2 cursor-pointer transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Repetir Canción</span>
            </button>

            {nextSong ? (
              <button
                onClick={() => {
                  setCurrentStep('transition');
                  setCountdown(5);
                }}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#00f0ff] to-[#ff007f] hover:brightness-110 text-white font-extrabold text-xs flex items-center gap-2 cursor-pointer transition-all shadow-[0_0_20px_rgba(0,240,255,0.4)]"
              >
                <span>Siguiente Ahora</span>
                <SkipForward className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:brightness-110 text-slate-950 font-black text-xs flex items-center gap-2 cursor-pointer transition-all shadow-[0_0_20px_rgba(16,185,129,0.4)]"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Cerrar ({closeAutoSeconds}s)</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* ── STEP 2: NEXT SONG TRANSITION & 5-SECOND COUNTDOWN ──────── */}
      {/* ───────────────────────────────────────────────────────────── */}
      {currentStep === 'transition' && nextSong && (
        <div className="relative z-20 w-full max-w-xl bg-slate-900/95 border border-slate-700/90 rounded-3xl p-6 sm:p-8 shadow-[0_0_90px_rgba(255,0,127,0.3)] flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer transition-colors"
            title="Cancelar"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Next Song Header Badge */}
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-pink-500/20 border border-pink-400/50 text-[#ff007f] text-xs font-black tracking-widest uppercase mb-4 shadow-[0_0_20px_rgba(255,0,127,0.3)]">
            <Sparkles className="w-4 h-4 animate-spin" />
            <span>PRÓXIMA CANCIÓN</span>
            <Music className="w-4 h-4" />
          </div>

          {/* Next Singer Turn Badge */}
          {nextSinger ? (
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-indigo-900/80 to-purple-900/80 border border-indigo-400/60 text-xs font-bold text-white mb-6 shadow-md">
              <span className="text-lg">{nextSinger.avatar}</span>
              <span className="text-slate-300">Turno al micrófono:</span>
              <span className="text-cyan-300 font-extrabold text-sm">{nextSinger.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300 mb-6">
              <Mic2 className="w-3.5 h-3.5 text-cyan-400" />
              <span>¡Prepárate para cantar!</span>
            </div>
          )}

          {/* Next Song Card with Icon & Metadata */}
          <div className="w-full bg-slate-950/80 border border-slate-800 rounded-2xl p-4 sm:p-5 flex items-center gap-4 mb-6 text-left">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-gradient-to-br from-[#ff007f]/30 to-[#00f0ff]/30 border border-slate-700 flex items-center justify-center shrink-0 shadow-inner">
              <Music className="w-7 h-7 text-cyan-300" />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-bold uppercase tracking-wider text-[#ff007f]">
                {nextSong.genre || 'Pista de Karaoke'}
              </span>
              <h3 className="text-lg sm:text-xl font-black text-white truncate">
                {nextSong.title}
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 truncate">
                {nextSong.artist || 'Artista Desconocido'}
              </p>
            </div>
          </div>

          {/* Animated 5-Second Countdown Big Circle */}
          <div className="flex flex-col items-center justify-center mb-8">
            <div className="relative flex items-center justify-center w-28 h-28 sm:w-32 sm:h-32">
              {/* Circular SVG Ring */}
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  className="stroke-slate-800"
                  strokeWidth="8"
                  fill="transparent"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  className="stroke-[#ff007f] transition-all duration-1000 ease-linear"
                  strokeWidth="8"
                  strokeDasharray={326.7}
                  strokeDashoffset={326.7 * (1 - countdown / 5)}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>

              <div className="absolute flex flex-col items-center justify-center">
                <span className="text-4xl sm:text-5xl font-black text-white font-mono animate-pulse">
                  {countdown}
                </span>
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                  segundos
                </span>
              </div>
            </div>

            <p className="text-xs font-bold text-cyan-300 tracking-wide mt-3 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
              <span>Comenzando automáticamente...</span>
            </p>
          </div>

          {/* Countdown Controls */}
          <div className="flex flex-wrap items-center justify-center gap-3 w-full">
            <button
              onClick={() => setIsCountdownPaused((prev) => !prev)}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs border border-slate-700 cursor-pointer transition-colors"
            >
              {isCountdownPaused ? '▶ Reanudar Conteo' : '⏸ Pausar Conteo'}
            </button>

            {onSkipNextSong && (
              <button
                onClick={onSkipNextSong}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs border border-slate-700 cursor-pointer transition-colors"
              >
                Saltar Canción
              </button>
            )}

            <button
              onClick={onStartNextSong}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:brightness-110 text-slate-950 font-black text-xs flex items-center gap-2 cursor-pointer transition-all shadow-[0_0_25px_rgba(16,185,129,0.4)]"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>¡Comenzar Ya!</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
