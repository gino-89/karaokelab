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

  const boxPadding = variant === 'tv' ? 'px-8 sm:px-12 py-3.5 sm:py-4.5' : 'px-6 sm:px-8 py-2.5 sm:py-3.5';
  const boxGap = variant === 'tv' ? 'gap-4 sm:gap-5' : 'gap-3 sm:gap-4';
  const numberTextSize = variant === 'tv' ? 'text-3xl sm:text-4xl md:text-5xl' : 'text-2xl sm:text-3xl';
  const titleTextSize = variant === 'tv' ? 'text-base sm:text-xl md:text-2xl' : 'text-sm sm:text-base md:text-lg';
  const quoteTextSize = variant === 'tv'
    ? 'text-3xl sm:text-5xl md:text-6xl'
    : 'text-2xl sm:text-3xl md:text-4xl';

  return (
    <div className="w-full flex flex-col items-center justify-center gap-3 sm:gap-4 text-center select-none bg-transparent animate-in fade-in zoom-in-95 duration-200">
      {/* 1. Caja de conteo dorada flotante: ⏱️ 2 ¡PREPÁRATE PARA CANTAR! */}
      <div
        className={`inline-flex items-center justify-center ${boxGap} ${boxPadding} rounded-2xl sm:rounded-3xl border border-amber-400/80 bg-black/45 backdrop-blur-sm shadow-[0_0_20px_rgba(251,191,36,0.18)] transition-transform`}
      >
        <span className="text-2xl sm:text-3xl md:text-4xl leading-none select-none">
          ⏱️
        </span>
        <span
          key={countNum}
          className={`font-black font-mono leading-none tracking-tight text-amber-400 ${numberTextSize} animate-pulse drop-shadow-[0_0_12px_rgba(251,191,36,0.6)]`}
        >
          {countNum}
        </span>
        <span className={`font-black font-mono tracking-wider uppercase leading-none text-amber-300/95 ${titleTextSize}`}>
          ¡PREPÁRATE PARA CANTAR!
        </span>
      </div>

      {/* 2. Placa del cantante: 🎤 CANTA: [NOMBRE] */}
      <div
        className="inline-flex items-center justify-center gap-2 px-5 sm:px-6 py-1 sm:py-1.5 rounded-full border font-mono font-bold text-xs sm:text-sm tracking-wider uppercase shadow-[0_0_15px_rgba(0,240,255,0.25)] transition-all"
        style={{
          borderColor: artist.color ? `${artist.color}cc` : '#00f0ffcc',
          color: artist.color || '#00f0ff',
          backgroundColor: `${artist.color || '#00f0ff'}1a`,
          boxShadow: `0 0 16px ${artist.color || '#00f0ff'}30`,
        }}
      >
        <span className="text-sm sm:text-base">🎤</span>
        <span>{artist.isBoth ? 'CANTA: TODOS / DÚO' : `CANTA: ${artist.name.toUpperCase()}`}</span>
      </div>

      {/* 3. Texto del verso que sigue entre comillas: "Fui tu gran amor" */}
      <div className="w-full px-4 max-w-4xl mx-auto">
        <p className={`font-black text-white text-center leading-snug drop-shadow-[0_2px_12px_rgba(0,0,0,0.95)] ${quoteTextSize}`}>
          &ldquo;{cleanLyricText(nextLyric.text)}&rdquo;
        </p>
      </div>
    </div>
  );
};
