import React from 'react';
import { Gauge, KeyRound, Clock, Zap, Mic } from 'lucide-react';

interface TelemetryHUDProps {
  bpm: number;
  detectedKey: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  vocalGain: number;
  musicGain: number;
  pitchShift: number;
  isMicActive: boolean;
}

export const TelemetryHUD: React.FC<TelemetryHUDProps> = ({
  bpm,
  detectedKey,
  currentTime,
  duration,
  isPlaying,
  vocalGain,
  musicGain,
  pitchShift,
  isMicActive,
}) => {
  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs) || secs < 0) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const remaining = Math.max(0, duration - currentTime);
  const vocalReductionPercent = Math.round(Math.max(0, (1 - vocalGain) * 100));

  // Pulse animation period based on BPM
  const beatPeriod = bpm > 0 ? 60 / bpm : 0.5;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3.5 w-full">
      {/* 1. BPM Detector HUD */}
      <div className="cyber-card p-3 rounded-xl border border-cyan-500/30 flex items-center justify-between relative overflow-hidden group">
        <div className="flex flex-col">
          <span className="text-[10px] font-mono-code uppercase tracking-wider text-cyan-400/80 flex items-center gap-1">
            <Gauge className="w-3 h-3 text-cyan-400" />
            TEMPO BPM
          </span>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="text-xl sm:text-2xl font-cyber font-bold text-white tracking-wider text-glow-cyan">
              {bpm || '--'}
            </span>
            <span className="text-[10px] font-mono-code text-cyan-400">BPM</span>
          </div>
          <span className="text-[9px] font-hud text-slate-400">DETECCIÓN DE ENERGÍA</span>
        </div>

        {/* Pulsing Neon Beat Ring */}
        <div className="relative flex items-center justify-center w-10 h-10">
          <div
            className={`w-8 h-8 rounded-full border-2 border-cyan-400 flex items-center justify-center transition-all ${
              isPlaying ? 'glow-cyan' : 'opacity-40'
            }`}
            style={{
              animation: isPlaying ? `cyberPulse ${beatPeriod}s infinite` : 'none',
            }}
          >
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#00f0ff]" />
          </div>
        </div>
      </div>

      {/* 2. Musical Key Detector HUD */}
      <div className="cyber-card-magenta p-3 rounded-xl border border-magenta-500/30 flex items-center justify-between relative overflow-hidden group">
        <div className="flex flex-col">
          <span className="text-[10px] font-mono-code uppercase tracking-wider text-magenta-400/80 flex items-center gap-1">
            <KeyRound className="w-3 h-3 text-magenta-400" />
            TONO MUSICAL
          </span>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="text-xl sm:text-2xl font-cyber font-bold text-white tracking-wider text-glow-magenta">
              {detectedKey || 'Auto'}
            </span>
          </div>
          <span className="text-[9px] font-hud text-slate-400">CORRELACIÓN CHROMAGRAM</span>
        </div>

        <div className="flex flex-col items-end justify-center">
          <span className={`text-[10px] font-mono-code px-1.5 py-0.5 rounded border ${
            pitchShift !== 0 
              ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300' 
              : 'bg-magenta-950/40 border-magenta-500/30 text-magenta-300'
          }`}>
            {pitchShift > 0 ? `+${pitchShift}` : pitchShift < 0 ? `${pitchShift}` : 'ORIGINAL'} ST
          </span>
          <span className="text-[8px] font-hud text-slate-400 mt-1">PITCH SHIFT</span>
        </div>
      </div>

      {/* 3. Time Display HUD */}
      <div className="cyber-card p-3 rounded-xl border border-emerald-500/30 flex items-center justify-between relative overflow-hidden group">
        <div className="flex flex-col">
          <span className="text-[10px] font-mono-code uppercase tracking-wider text-emerald-400/80 flex items-center gap-1">
            <Clock className="w-3 h-3 text-emerald-400" />
            TIEMPO DIGITAL
          </span>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-xl sm:text-2xl font-mono-code font-bold text-white tracking-wider text-glow-green">
              {formatTime(currentTime)}
            </span>
            <span className="text-xs font-mono-code text-slate-400">/ {formatTime(duration)}</span>
          </div>
          <span className="text-[9px] font-hud text-emerald-400/80">RESTANTE: -{formatTime(remaining)}</span>
        </div>

        <div className="relative w-8 h-8 flex items-center justify-center">
          <svg className="w-8 h-8 transform -rotate-90">
            <circle cx="16" cy="16" r="13" stroke="rgba(255,255,255,0.1)" strokeWidth="2.5" fill="none" />
            <circle
              cx="16"
              cy="16"
              r="13"
              stroke="#00ff9d"
              strokeWidth="2.5"
              strokeDasharray={81.68}
              strokeDashoffset={duration > 0 ? 81.68 - (currentTime / duration) * 81.68 : 81.68}
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </div>
      </div>

      {/* 4. DSP Vocal & Mic Status HUD */}
      <div className="cyber-card p-3 rounded-xl border border-cyan-500/30 flex items-center justify-between relative overflow-hidden group">
        <div className="flex flex-col">
          <span className="text-[10px] font-mono-code uppercase tracking-wider text-cyan-300 flex items-center gap-1">
            <Zap className="w-3 h-3 text-cyan-400" />
            ESTADO DSP KARAOKE
          </span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs font-mono-code px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/40 text-cyan-300">
              VOZ: {Math.round(vocalGain * 100)}%
            </span>
            <span className="text-xs font-mono-code px-1.5 py-0.5 rounded bg-pink-950/60 border border-pink-500/40 text-pink-300">
              MÚSICA: {Math.round(musicGain * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-1 mt-1 text-[9px] font-hud text-slate-300">
            {isMicActive ? (
              <span className="flex items-center gap-1 text-emerald-300">
                <Mic className="w-2.5 h-2.5 text-emerald-400 animate-pulse" /> MIC ACTIVO
              </span>
            ) : (
              <span className="text-slate-400">MIC EN REPOSO</span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center">
          <div className="w-2 h-10 bg-slate-800 rounded-full overflow-hidden flex flex-col justify-end p-0.5 border border-cyan-500/30">
            <div
              className="w-full bg-gradient-to-t from-cyan-400 to-magenta-400 rounded-full transition-all"
              style={{ height: `${Math.min(100, Math.max(10, vocalGain * 50 + musicGain * 50))}%` }}
            />
          </div>
          <span className="text-[7px] font-mono-code text-cyan-400 mt-0.5">MIX</span>
        </div>
      </div>
    </div>
  );
};
