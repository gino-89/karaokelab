import React from 'react';
import { LyricLine } from '../types';
import { cleanLyricText } from '../services/lrcParser';

interface StageCountdownCardProps {
  secondsToNext: number;
  nextLyric: LyricLine;
  artist: {
    name: string;
    color: string;
    isBoth: boolean;
  };
  variant?: 'standard' | 'tv';
}

export const StageCountdownCard: React.FC<StageCountdownCardProps> = ({
  secondsToNext,
  nextLyric,
  artist,
  variant = 'standard',
}) => {
  const countNum = Math.ceil(secondsToNext);
  const isUrgent = countNum <= 1;

  const cardPadding = variant === 'tv' ? 'p-8 sm:p-10' : 'p-4 sm:p-6';
  const cardMaxWidth = variant === 'tv' ? 'max-w-4xl' : 'max-w-2xl';
  const numberTextSize = variant === 'tv' ? 'text-6xl sm:text-7xl md:text-8xl' : 'text-5xl sm:text-6xl';
  const quoteTextSize = variant === 'tv'
    ? 'text-2xl sm:text-3xl md:text-4xl lg:text-5xl'
    : 'text-lg sm:text-xl md:text-2xl';

  return (
    <div
      className={`w-full ${cardMaxWidth} mx-auto ${cardPadding} rounded-3xl bg-slate-950/90 backdrop-blur-2xl border-2 border-amber-400/50 shadow-[0_0_50px_rgba(251,191,36,0.3)] flex flex-col items-center justify-center gap-3 sm:gap-4 text-center select-none animate-in zoom-in-95 duration-200`}
    >
      {/* 1. Número grande y animación: "⏱️ 4... 3... 2... 1... ¡PREPÁRATE PARA CANTAR!" */}
      <div className="flex flex-col items-center gap-1.5 sm:gap-2">
        <div className="flex items-center justify-center gap-3">
          <span
            key={countNum}
            className={`font-black font-mono tracking-tighter ${numberTextSize} text-transparent bg-clip-text bg-gradient-to-b from-amber-200 via-amber-400 to-amber-600 drop-shadow-[0_0_30px_rgba(251,191,36,0.7)] animate-pulse`}
          >
            ⏱️ {countNum}
          </span>
        </div>

        {/* Animated Countdown Timeline Ribbon */}
        <div className="inline-flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-1 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-300 font-mono font-black text-[11px] sm:text-xs md:text-sm tracking-widest uppercase shadow-[0_0_15px_rgba(251,191,36,0.3)]">
          <span className={countNum === 4 ? 'text-white font-extrabold scale-110' : 'opacity-60'}>4...</span>
          <span className={countNum === 3 ? 'text-white font-extrabold scale-110' : 'opacity-60'}>3...</span>
          <span className={countNum === 2 ? 'text-white font-extrabold scale-110' : 'opacity-60'}>2...</span>
          <span className={countNum === 1 ? 'text-white font-extrabold scale-110' : 'opacity-60'}>1...</span>
          <span className={`ml-1 ${isUrgent ? 'text-[#00f0ff] animate-bounce font-black' : 'text-amber-200'}`}>
            ¡PREPÁRATE PARA CANTAR!
          </span>
        </div>
      </div>

      {/* 2. Placa del cantante: "🎤 CANTA: [NOMBRE]" o "👥 TODOS / DÚO" */}
      <div
        className="inline-flex items-center gap-2 px-4 sm:px-5 py-1 sm:py-1.5 rounded-full border-2 font-mono font-black text-xs sm:text-sm md:text-base uppercase tracking-wider shadow-lg transition-transform hover:scale-105"
        style={{
          borderColor: artist.color || '#00f0ff',
          color: artist.color || '#00f0ff',
          backgroundColor: `${artist.color || '#00f0ff'}20`,
          boxShadow: `0 0 20px ${artist.color || '#00f0ff'}35`,
        }}
      >
        <span className="text-sm sm:text-base md:text-lg">{artist.isBoth ? '👥' : '🎤'}</span>
        <span>{artist.isBoth ? 'TODOS / DÚO' : `CANTA: ${artist.name.toUpperCase()}`}</span>
      </div>

      {/* 3. Texto del verso que sigue entre comillas: "[Texto de la siguiente frase]" */}
      <div className="w-full px-2">
        <p className={`font-black text-white text-center leading-snug drop-shadow-[0_2px_10px_rgba(0,0,0,0.95)] italic ${quoteTextSize}`}>
          &ldquo;{cleanLyricText(nextLyric.text)}&rdquo;
        </p>
      </div>
    </div>
  );
};
