import React, { useState, useEffect } from 'react';
import { audioEngine } from '../services/audioEngine';
import { Cpu, Zap, Volume2, Sliders, X, Check, RefreshCw, Radio, Sparkles, ShieldCheck } from 'lucide-react';

interface DspSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  syncDelay: number;
  onUpdateSyncDelay: (newDelay: number) => void;
  scoringMode?: 'fiesta' | 'real' | 'off';
  onUpdateScoringMode?: (mode: 'fiesta' | 'real' | 'off') => void;
}

export const DspSettingsModal: React.FC<DspSettingsModalProps> = ({
  isOpen,
  onClose,
  syncDelay,
  onUpdateSyncDelay,
  scoringMode = 'fiesta',
  onUpdateScoringMode,
}) => {
  const [latencyMode, setLatencyMode] = useState<'interactive' | 'balanced' | 'playback'>('interactive');
  const [telemetry, setTelemetry] = useState({
    state: 'running',
    sampleRate: 48000,
    outputLatencyMs: 10.4,
    baseLatencyMs: 5.3,
    bufferSize: 256,
  });
  const [testToneActive, setTestToneActive] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const ctx = audioEngine.getAudioContext();
      if (ctx) {
        const outLat = (ctx as any).outputLatency ? (ctx as any).outputLatency * 1000 : 8.5;
        const baseLat = (ctx as any).baseLatency ? (ctx as any).baseLatency * 1000 : 4.2;
        setTelemetry({
          state: ctx.state,
          sampleRate: ctx.sampleRate,
          outputLatencyMs: +outLat.toFixed(1),
          baseLatencyMs: +baseLat.toFixed(1),
          bufferSize: baseLat > 8 ? 512 : 256,
        });
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleApplyLatencyMode = (mode: 'interactive' | 'balanced' | 'playback') => {
    setLatencyMode(mode);
    audioEngine.setLatencyMode(mode);
  };

  const handlePlayTestBeep = () => {
    setTestToneActive(true);
    const ctx = audioEngine.getAudioContext();
    if (ctx) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    }
    setTimeout(() => setTestToneActive(false), 300);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md select-none animate-in fade-in duration-200" onClick={onClose}>
      <div className="relative w-full max-w-md bg-slate-950 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-[0_0_50px_rgba(0,240,255,0.15)] flex flex-col gap-4 text-slate-100" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-white tracking-wide">
                Ajustes DSP & Audio
              </h3>
              <p className="text-[11px] text-slate-400 font-medium">
                Calibración de latencia y puntuación
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scoring Mode Selector */}
        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col gap-2.5">
          <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Modo de Puntuación (Score Engine)</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => onUpdateScoringMode?.('fiesta')}
              className={`p-2 rounded-xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                scoringMode === 'fiesta'
                  ? 'border-amber-400 bg-amber-500/20 text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                  : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
              }`}
            >
              <span className="text-base mb-0.5">🎲</span>
              <span className="text-xs font-bold">Modo Fiesta</span>
              <span className="text-[8px] text-amber-300 font-mono">Jurado Show</span>
            </button>

            <button
              type="button"
              onClick={() => onUpdateScoringMode?.('real')}
              className={`p-2 rounded-xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                scoringMode === 'real'
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200 shadow-[0_0_15px_rgba(0,240,255,0.3)]'
                  : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
              }`}
            >
              <span className="text-base mb-0.5">🎤</span>
              <span className="text-xs font-bold">Pitch Real</span>
              <span className="text-[8px] text-cyan-300 font-mono">Mic / Interface</span>
            </button>

            <button
              type="button"
              onClick={() => onUpdateScoringMode?.('off')}
              className={`p-2 rounded-xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                scoringMode === 'off'
                  ? 'border-rose-400 bg-rose-500/20 text-rose-200 shadow-[0_0_15px_rgba(244,63,94,0.3)]'
                  : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
              }`}
            >
              <span className="text-base mb-0.5">🔕</span>
              <span className="text-xs font-bold">Desactivado</span>
              <span className="text-[8px] text-rose-300 font-mono">Sin Modal</span>
            </button>
          </div>
        </div>

        {/* Live Audio Telemetry Panel */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Sample Rate</span>
            <span className="text-sm font-black text-cyan-400 font-mono mt-0.5">
              {telemetry.sampleRate} Hz
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Latencia Estimada</span>
            <span className="text-sm font-black text-emerald-400 font-mono mt-0.5">
              ~{telemetry.outputLatencyMs} ms
            </span>
          </div>
        </div>

        {/* Latency Presets */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            <span>Perfil de Latencia del Motor</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => handleApplyLatencyMode('interactive')}
              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                latencyMode === 'interactive'
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200 shadow-[0_0_15px_rgba(0,240,255,0.3)]'
                  : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
              }`}
            >
              <Zap className="w-4 h-4 text-cyan-400 mb-1" />
              <span className="text-xs font-bold">Ultra Baja</span>
              <span className="text-[9px] text-cyan-300 font-mono mt-0.5">&lt; 10ms (Recomendado)</span>
            </button>

            <button
              type="button"
              onClick={() => handleApplyLatencyMode('balanced')}
              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                latencyMode === 'balanced'
                  ? 'border-amber-400 bg-amber-500/20 text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                  : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
              }`}
            >
              <Sliders className="w-4 h-4 text-amber-400 mb-1" />
              <span className="text-xs font-bold">Balanceado</span>
              <span className="text-[9px] text-amber-300 font-mono mt-0.5">~18ms (Estable)</span>
            </button>

            <button
              type="button"
              onClick={() => handleApplyLatencyMode('playback')}
              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                latencyMode === 'playback'
                  ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200 shadow-[0_0_15px_rgba(99,102,241,0.3)]'
                  : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-indigo-400 mb-1" />
              <span className="text-xs font-bold">Reproducción</span>
              <span className="text-[9px] text-indigo-300 font-mono mt-0.5">Sin cortes</span>
            </button>
          </div>
        </div>

        {/* Sync Offset Calibration Slider */}
        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>Desfase de Sincronización Manual</span>
            </label>
            <span className="font-mono font-bold text-xs text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/30">
              {syncDelay > 0 ? `+${syncDelay.toFixed(1)}s` : `${syncDelay.toFixed(1)}s`}
            </span>
          </div>

          <input
            type="range"
            min="-2.0"
            max="2.0"
            step="0.1"
            value={syncDelay}
            onChange={(e) => onUpdateSyncDelay(+e.target.value)}
            className="w-full accent-cyan-400 cursor-pointer h-2 bg-slate-950 rounded-lg border border-slate-800"
          />

          {/* Presets */}
          <div className="flex items-center justify-between pt-1 gap-1">
            <button
              type="button"
              onClick={() => onUpdateSyncDelay(0.0)}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-300 cursor-pointer"
            >
              🔊 Cable (0.0s)
            </button>
            <button
              type="button"
              onClick={() => onUpdateSyncDelay(0.15)}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-300 cursor-pointer"
            >
              📺 TV HDMI (+0.15s)
            </button>
            <button
              type="button"
              onClick={() => onUpdateSyncDelay(0.35)}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-300 cursor-pointer"
            >
              📶 Bluetooth (+0.35s)
            </button>
          </div>
        </div>

        {/* Test Tone Beep */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <span className="text-xs text-slate-400">Probar respuesta del audio:</span>
          <button
            type="button"
            onClick={handlePlayTestBeep}
            className={`px-3 py-1.5 rounded-xl border font-bold text-xs cursor-pointer transition-all flex items-center gap-1.5 ${
              testToneActive
                ? 'border-emerald-400 bg-emerald-500/30 text-emerald-200 shadow-[0_0_15px_rgba(16,185,129,0.5)]'
                : 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20'
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>{testToneActive ? '¡BEEP!' : 'Probar Beep De Latencia'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
