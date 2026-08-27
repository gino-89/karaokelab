import React, { useState, useRef, useCallback } from 'react';
import { Sliders, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { AudioStems } from '../types';

/**
 * useTap: returns touch event props for a button that fires `action` on 1-tap.
 * - Tracks touchstart position to distinguish tap from scroll.
 * - Calls e.preventDefault() in touchend to kill the browser 300ms ghost click.
 * - Works correctly even during audio playback re-renders on iOS/iPadOS.
 */
function useTap(action: () => void) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      startRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (!startRef.current) return;
      const dx = Math.abs(e.changedTouches[0].clientX - startRef.current.x);
      const dy = Math.abs(e.changedTouches[0].clientY - startRef.current.y);
      startRef.current = null;
      if (dx < 12 && dy < 12) {
        e.preventDefault(); // ← kills the ghost click so onClick doesn't double-fire
        action();
      }
    },
  };
}

interface MixerDeckProps {
  vocalGain: number;
  onVocalGainChange: (val: number) => void;
  musicGain: number;
  onMusicGainChange: (val: number) => void;
  masterGain: number;
  onMasterGainChange: (val: number) => void;
  pitchShift: number;
  onPitchShiftChange: (val: number) => void;
  isMicActive: boolean;
  onToggleMic: () => void;
  micGain: number;
  onMicGainChange: (val: number) => void;
  hasSongLoaded: boolean;
  detectedKey?: string;
  stems?: AudioStems;
}

export const MixerDeck: React.FC<MixerDeckProps> = React.memo(({
  vocalGain,
  onVocalGainChange,
  musicGain,
  onMusicGainChange,
  masterGain,
  onMasterGainChange,
  pitchShift,
  onPitchShiftChange,
  isMicActive,
  onToggleMic,
  micGain,
  onMicGainChange,
  hasSongLoaded,
  detectedKey = 'Am',
  stems,
}) => {
  const [previousVocalGain, setPreviousVocalGain] = useState(1.0);
  const [previousMusicGain, setPreviousMusicGain] = useState(1.0);
  const [previousMasterGain, setPreviousMasterGain] = useState(1.0);

  const dbLabel = (g: number) => {
    if (g <= 0.001) return '-∞ dB';
    const db = 20 * Math.log10(g);
    if (Math.abs(db) < 0.15) return '0.0 dB';
    return (db > 0 ? '+' : '') + db.toFixed(1) + ' dB';
  };

  // Toggle Mute helpers
  const toggleMuteVocal = useCallback(() => {
    if (vocalGain > 0) {
      setPreviousVocalGain(vocalGain);
      onVocalGainChange(0);
    } else {
      onVocalGainChange(previousVocalGain || 1.0);
    }
  }, [vocalGain, previousVocalGain, onVocalGainChange]);

  const toggleMuteMusic = useCallback(() => {
    if (musicGain > 0) {
      setPreviousMusicGain(musicGain);
      onMusicGainChange(0);
    } else {
      onMusicGainChange(previousMusicGain || 1.0);
    }
  }, [musicGain, previousMusicGain, onMusicGainChange]);

  const toggleMuteMaster = useCallback(() => {
    if (masterGain > 0) {
      setPreviousMasterGain(masterGain);
      onMasterGainChange(0);
    } else {
      onMasterGainChange(previousMasterGain || 1.0);
    }
  }, [masterGain, previousMasterGain, onMasterGainChange]);

  // useTap: 1-tap handlers with e.preventDefault() to kill ghost clicks on iOS during playback
  const tapMuteVocal   = useTap(toggleMuteVocal);
  const tapResetVocal  = useTap(useCallback(() => onVocalGainChange(1.0), [onVocalGainChange]));
  const tapMuteMusic   = useTap(toggleMuteMusic);
  const tapResetMusic  = useTap(useCallback(() => onMusicGainChange(1.0), [onMusicGainChange]));
  const tapMuteMaster  = useTap(toggleMuteMaster);
  const tapResetMaster = useTap(useCallback(() => onMasterGainChange(1.0), [onMasterGainChange]));



  /**
   * Hardware Console Studio Fader Strip (Identical architecture to playback slider)
   */
  const StudioFaderStrip = ({
    title,
    subtitle,
    value,
    min = 0,
    max = 2.0,
    step = 0.01,
    onChange,
    onMute,
    themeColor,
    accentGlow,
    unityPoint = 1.0,
    tapMute,
    tapReset,
  }: {
    title: string;
    subtitle: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
    onChange: (v: number) => void;
    onMute?: () => void;
    themeColor: string;
    accentGlow: string;
    unityPoint?: number;
    tapMute?: ReturnType<typeof useTap>;
    tapReset?: ReturnType<typeof useTap>;
  }) => {
    const isMuted = value <= 0.001;
    const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

    return (
      <div className="flex-1 min-w-[110px] bg-[#0c0e17] border border-slate-700/70 rounded-xl p-3 flex flex-col justify-between shadow-md relative overflow-hidden group">
        {/* Top Header: Channel Name & Percent / Decibel Readout */}
        <div className="flex items-center justify-between gap-1 mb-2">
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-black uppercase tracking-wider text-white truncate flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: themeColor, boxShadow: `0 0 8px ${themeColor}` }}
              />
              {title}
            </span>
            <span className="text-[9px] font-mono text-slate-400 truncate leading-none mt-0.5">
              {subtitle}
            </span>
          </div>

          <div
            className={`px-2 py-0.5 rounded-lg font-mono text-xs font-bold border transition-colors shrink-0 ${
              isMuted
                ? 'bg-rose-950/60 border-rose-700/60 text-rose-400'
                : 'bg-slate-900 border-slate-700'
            }`}
            style={{ color: isMuted ? undefined : themeColor }}
          >
            {isMuted ? 'MUTE' : `${Math.round(value * 100)}%`}
          </div>
        </div>

        {/* ── Exact Same Architecture as Playback Slider ── */}
        <div className="relative py-1.5 flex flex-col justify-center select-none my-1">
          {/* Reference Ticks */}
          <div className="flex justify-between text-[8px] font-mono text-slate-500 mb-1 px-0.5">
            <span>0%</span>
            <span>50%</span>
            <span className="text-slate-200 font-bold">100% (0dB)</span>
            <span>{max >= 2.0 ? '200%' : '150%'}</span>
          </div>

          {/* Interactive Range Track (Exact same structure as playback slider) */}
          <div className="relative h-6 flex items-center">
            {/* Background Rail */}
            <div className="w-full h-2.5 bg-slate-950 border border-slate-700/80 rounded-full overflow-hidden relative shadow-inner">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background: isMuted
                    ? '#334155'
                    : `linear-gradient(to right, ${themeColor}66, ${themeColor})`,
                  boxShadow: isMuted ? 'none' : `0 0 10px ${accentGlow}`,
                }}
              />
            </div>

            {/* Glowing Hardware Thumb Knob */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white border-2 border-slate-900 shadow-[0_0_8px_rgba(255,255,255,0.9)] pointer-events-none z-10"
              style={{ left: `${pct}%` }}
            />

            {/* Live Interactive Range Slider for Dragging & Clicking */}
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={(e) => onChange(parseFloat(e.target.value))}
              onTouchEnd={(e) => {
                // iOS: fire onChange immediately on touch lift so 1 tap sets value
                const input = e.currentTarget;
                onChange(parseFloat(input.value));
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
              style={{ touchAction: 'pan-x' }}
              data-touch-handled="true"
              title={`${title}: ${Math.round(value * 100)}% (${dbLabel(value)})`}
            />
          </div>
        </div>

        {/* Bottom Channel Controls: 0dB Reset & Mute & Decibel badge */}
        <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-slate-800/80 mt-1">
          {/* Quick Unity 0 dB / 100% Reset */}
          <button
            onClick={() => onChange(unityPoint)}
            {...(tapReset ?? {})}
            className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-[10px] font-mono font-bold text-slate-300 hover:text-white border border-slate-700/60 cursor-pointer transition-all active:scale-95 shadow-sm"
            title="Restablecer volumen original a 100% (0.0 dB)"
          >
            100% (0dB)
          </button>

          <span className="text-[10px] font-mono text-slate-400 font-bold tabular-nums">
            {dbLabel(value)}
          </span>

          {/* Mute Button */}
          {onMute && (
            <button
              onClick={onMute}
              {...(tapMute ?? {})}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold flex items-center gap-1 cursor-pointer transition-all active:scale-95 border ${
                isMuted
                  ? 'bg-rose-900/60 border-rose-500 text-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.4)]'
                  : 'bg-slate-900 hover:bg-slate-800 border-slate-700/60 text-slate-400 hover:text-slate-200'
              }`}
              title={isMuted ? 'Desactivar Mute' : 'Silenciar Canal'}
            >
              {isMuted ? <VolumeX className="w-3 h-3 text-rose-400" /> : <Volume2 className="w-3 h-3" />}
              {isMuted ? 'MUTED' : 'MUTE'}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-[#080911] border border-slate-700/80 rounded-2xl overflow-hidden shadow-xl flex flex-col">
      {/* ── Console Header ─────────────────────────────────── */}
      <div className="px-3.5 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-indigo-950 border border-indigo-700/50 text-[#00f0ff]">
            <Sliders className="w-3 h-3" />
          </div>
          <span className="text-[11px] font-black uppercase tracking-wider text-white font-mono">
            Mesa de Mezcla DSP
          </span>
        </div>

        {/* Hardware Status Badges */}
        <div className="flex items-center gap-2 text-[9px] font-mono text-slate-400">
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Phase-Preserved
          </span>
          <span className="hidden sm:inline bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 text-cyan-300">
            32-bit Float
          </span>
        </div>
      </div>

      {/* ── Studio Channel Faders Strips ────────────────── */}
      <div className="p-2.5 sm:p-3 flex flex-col gap-2.5">
        {/* Quick Vocal Presence & Ad-libs Presets Strip */}
        <div className="flex items-center justify-between gap-1.5 p-1.5 rounded-xl bg-slate-950/80 border border-slate-800">
          <span className="text-[10px] font-mono font-bold text-slate-400 pl-1 hidden sm:inline">Presencia Vocal:</span>
          <div className="grid grid-cols-4 gap-1 flex-1">
            <button
              type="button"
              onClick={() => onVocalGainChange(0.0)}
              className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer truncate ${
                vocalGain === 0
                  ? 'bg-slate-800 border border-cyan-500/50 text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                  : 'bg-slate-900/60 border border-slate-850 text-slate-400 hover:text-slate-200'
              }`}
              title="Voz 0%: Karaoke 100% limpio (Solo pista instrumental)"
            >
              🔇 Solo (0%)
            </button>

            <button
              type="button"
              onClick={() => onVocalGainChange(0.15)}
              className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer truncate ${
                Math.abs(vocalGain - 0.15) < 0.03
                  ? 'bg-gradient-to-r from-pink-500/20 to-purple-500/20 border border-pink-500/60 text-pink-300 shadow-[0_0_10px_rgba(236,72,153,0.4)] font-black'
                  : 'bg-slate-900/60 border border-slate-850 text-slate-400 hover:text-slate-200'
              }`}
              title="Voz 15%: Conserva los coros y ad-libs de fondo como acompañamiento mientras cantas"
            >
              ✨ Coros (15%)
            </button>

            <button
              type="button"
              onClick={() => onVocalGainChange(0.40)}
              className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer truncate ${
                Math.abs(vocalGain - 0.40) < 0.05
                  ? 'bg-indigo-500/20 border border-indigo-400 text-indigo-300 shadow-[0_0_8px_rgba(99,102,241,0.3)]'
                  : 'bg-slate-900/60 border border-slate-850 text-slate-400 hover:text-slate-200'
              }`}
              title="Voz 40%: Guía vocal de apoyo para ensayar"
            >
              👥 Guía (40%)
            </button>

            <button
              type="button"
              onClick={() => onVocalGainChange(1.0)}
              className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer truncate ${
                vocalGain >= 0.95
                  ? 'bg-slate-800 border border-slate-600 text-white font-bold'
                  : 'bg-slate-900/60 border border-slate-850 text-slate-400 hover:text-slate-200'
              }`}
              title="Voz 100%: Pista original completa con voz líder"
            >
              🎵 Voz (100%)
            </button>
          </div>
        </div>

        {/* Main Fader Channels Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-2.5">
          {/* Channel 1: VOZ (Vocal Lead) */}
          <StudioFaderStrip
            title="Voz"
            subtitle="Vocal Stem"
            value={vocalGain}
            onChange={onVocalGainChange}
            onMute={toggleMuteVocal}
            tapMute={tapMuteVocal}
            tapReset={tapResetVocal}
            themeColor="#ff007f"
            accentGlow="rgba(255,0,127,0.4)"
          />

          {/* Channel 2: MÚSICA (Instrumental Karaoke) */}
          <StudioFaderStrip
            title="Música"
            subtitle="Instrumental"
            value={musicGain}
            onChange={onMusicGainChange}
            onMute={toggleMuteMusic}
            tapMute={tapMuteMusic}
            tapReset={tapResetMusic}
            themeColor="#00f0ff"
            accentGlow="rgba(0,240,255,0.4)"
          />

          {/* Channel 3: MASTER (Salida Principal) */}
          <StudioFaderStrip
            title="Master"
            subtitle="Main Out"
            value={masterGain}
            min={0}
            max={1.5}
            unityPoint={1.0}
            onChange={onMasterGainChange}
            onMute={toggleMuteMaster}
            tapMute={tapMuteMaster}
            tapReset={tapResetMaster}
            themeColor="#ffffff"
            accentGlow="rgba(255,255,255,0.3)"
          />
        </div>

        {/* ── Console Utility Strip: Live Microphone Control ── */}
        <div className="pt-0.5 border-t border-slate-800/80">
          <div className="bg-[#0c0e17] border border-slate-700/70 rounded-xl p-2 flex items-center justify-between gap-3">
            <button
              onClick={onToggleMic}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-mono font-bold cursor-pointer transition-all active:scale-95 ${
                isMicActive
                  ? 'border-[#00ff9d] bg-[#00ff9d]/20 text-[#00ff9d] shadow-[0_0_10px_rgba(0,255,157,0.3)]'
                  : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {isMicActive ? <Mic className="w-3.5 h-3.5 text-[#00ff9d] animate-pulse" /> : <MicOff className="w-3.5 h-3.5" />}
              <span>{isMicActive ? 'MICRÓFONO EN VIVO: ACTIVO' : 'ACTIVAR MICRÓFONO'}</span>
            </button>

            {isMicActive ? (
              <div className="flex items-center gap-2 flex-1 max-w-sm">
                <span className="text-[9px] font-mono text-slate-400 shrink-0">Ganancia Mic:</span>
                <input
                  type="range"
                  min={0}
                  max={2.0}
                  step={0.01}
                  value={micGain}
                  onChange={(e) => onMicGainChange(parseFloat(e.target.value))}
                  className="w-full accent-[#00ff9d] cursor-pointer h-1.5"
                  title={`Ganancia de micrófono: ${dbLabel(micGain)}`}
                />
                <span className="text-[10px] font-mono font-bold text-[#00ff9d] shrink-0 min-w-[45px] text-right">
                  {dbLabel(micGain)}
                </span>
              </div>
            ) : (
              <span className="text-[9px] font-mono text-slate-500">
                Monitoreo y ecualización de voz en tiempo real
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
