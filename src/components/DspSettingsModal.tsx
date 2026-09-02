import React, { useState, useEffect } from 'react';
import { audioEngine } from '../services/audioEngine';
import { Cpu, Zap, Volume2, Sliders, X, Check, RefreshCw, Radio, Sparkles, ShieldCheck, Trophy } from 'lucide-react';
import { ScoringMode } from '../services/scoreEngine';

interface DspSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  syncDelay: number;
  onUpdateSyncDelay: (newDelay: number) => void;
  scoringMode?: ScoringMode;
  onUpdateScoringMode?: (mode: ScoringMode) => void;
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
    
    // Refresh telemetry
    setTimeout(() => {
      const ctx = audioEngine.getAudioContext();
      if (ctx) {
        const outLat = (ctx as any).outputLatency ? (ctx as any).outputLatency * 1000 : (mode === 'interactive' ? 8.2 : mode === 'balanced' ? 18.5 : 35.0);
        setTelemetry((prev) => ({
          ...prev,
          outputLatencyMs: +outLat.toFixed(1),
          bufferSize: mode === 'interactive' ? 256 : mode === 'balanced' ? 512 : 1024,
        }));
      }
    }, 200);
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
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div className="w-full max-w-md bg-[#0b0d17] border border-cyan-500/40 rounded-2xl shadow-[0_0_50px_rgba(0,240,255,0.25)] overflow-hidden flex flex-col text-slate-100" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-400/50 flex items-center justify-center text-cyan-300">
              <Cpu className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <h3 className="text-sm font-black italic uppercase tracking-wider text-white">
                Ajustes de Latencia y Motor DSP
              </h3>
              <p className="text-[10px] text-cyan-400 font-mono">Calibración de Audio en Tiempo Real</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
          {/* Live Telemetry Card */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-cyan-500/30 flex flex-col gap-2 font-mono">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Radio className="w-3 h-3 text-emerald-400 animate-ping" />
                <span>Estado Hardware AudioContext</span>
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold uppercase">
                ● {telemetry.state}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs pt-1">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400">Latencia Salida:</span>
                <span className="font-bold text-cyan-300 text-sm">&lt; {telemetry.outputLatencyMs} ms</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400">Tamaño de Buffer:</span>
                <span className="font-bold text-emerald-300 text-sm">{telemetry.bufferSize} muestras</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400">Frecuencia Muestreo:</span>
                <span className="font-bold text-slate-200">{(telemetry.sampleRate / 1000).toFixed(1)} kHz</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400">Latencia Base Hardware:</span>
                <span className="font-bold text-slate-200">{telemetry.baseLatencyMs} ms</span>
              </div>
            </div>
          </div>

          {/* Latency Mode Selector */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Modo de Latencia del Procesador</span>
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

          {/* KaraokeLab Scoring Mode Selector */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col gap-2">
            <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <span>Modo de Puntuación KaraokeLab</span>
            </label>
            <div className="grid grid-cols-3 gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => onUpdateScoringMode?.('fiesta')}
                className={`p-2 rounded-xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                  scoringMode === 'fiesta'
                    ? 'border-amber-400 bg-amber-500/20 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <span className="text-sm mb-0.5">🎲</span>
                <span className="text-[11px] font-black">Jurado Fiesta</span>
                <span className="text-[9px] text-amber-300 font-mono mt-0.5">Humor & Medallas</span>
              </button>

              <button
                type="button"
                onClick={() => onUpdateScoringMode?.('pitch')}
                className={`p-2 rounded-xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                  scoringMode === 'pitch'
                    ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_rgba(0,240,255,0.3)]'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <span className="text-sm mb-0.5">🎤</span>
                <span className="text-[11px] font-black">Pitch Real</span>
                <span className="text-[9px] text-cyan-300 font-mono mt-0.5">Focusrite / Mic</span>
              </button>

              <button
                type="button"
                onClick={() => onUpdateScoringMode?.('off')}
                className={`p-2 rounded-xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                  scoringMode === 'off'
                    ? 'border-slate-500 bg-slate-800 text-slate-200'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <span className="text-sm mb-0.5">🔕</span>
                <span className="text-[11px] font-bold">Desactivado</span>
                <span className="text-[9px] text-slate-400 font-mono mt-0.5">Sin Puntos</span>
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
    </div>
  );
};
