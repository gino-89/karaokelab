import React from 'react';
import { Sparkles, X, Award, Cpu, ShieldCheck, Zap, Disc, Music, Tv, CheckCircle2, Heart } from 'lucide-react';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200 pointer-events-auto select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg bg-[#0a0b16] border border-cyan-500/40 rounded-3xl shadow-[0_0_70px_rgba(0,240,255,0.25)] overflow-hidden flex flex-col relative z-10 text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Background Ambient Glows */}
        <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-br from-[#ff007f]/20 to-cyan-500/20 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-cyan-500/20 to-purple-600/20 blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900/90 border-b border-slate-800/80 flex items-center justify-between relative z-10 shrink-0">
          <div className="flex items-center gap-2 text-cyan-300 font-bold text-xs font-mono tracking-widest uppercase">
            <Sparkles className="w-4 h-4 text-[#00f0ff] animate-pulse" />
            <span>Información del Sistema</span>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 sm:p-8 flex flex-col items-center text-center gap-5 relative z-10">
          
          {/* Glowing Animated Logo */}
          <div className="relative group flex flex-col items-center">
            <div className="absolute -inset-3 bg-gradient-to-r from-[#ff007f] via-purple-600 to-[#00f0ff] rounded-3xl blur-2xl opacity-60 group-hover:opacity-100 animate-pulse transition duration-1000" />
            <div className="relative w-32 h-32 rounded-3xl overflow-hidden border-2 border-cyan-400/60 shadow-[0_0_30px_rgba(0,240,255,0.6)] group-hover:scale-105 transition-all duration-300">
              <img
                src="/logo-highres.jpg"
                alt="KaraokeLab Official Emblem"
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          {/* Title & Version */}
          <div className="space-y-1.5">
            <h2 className="text-2xl sm:text-3xl font-black italic tracking-tight uppercase font-mono flex items-center justify-center gap-1.5">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-300">
                KARAOKE
              </span>
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400 pr-2 inline-block">
                LAB
              </span>
            </h2>
            <div className="text-xs font-mono font-black text-cyan-300/90 tracking-widest uppercase">
              EXPERIMENTA TU VOZ
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 font-mono text-xs font-bold shadow-[0_0_15px_rgba(0,240,255,0.25)] mt-1">
              <span>Versión 1.0.0</span>
              <span className="text-slate-500">•</span>
              <span className="text-emerald-400">Release Edition</span>
            </div>
          </div>

          {/* Author / Architect Badge */}
          <div className="w-full p-4 rounded-2xl bg-gradient-to-r from-purple-950/40 via-slate-900/80 to-cyan-950/40 border border-cyan-500/30 shadow-lg flex flex-col items-center gap-1.5">
            <span className="text-[11px] uppercase font-mono font-bold tracking-widest text-slate-400">
              Arquitectura, Concepto & Creación
            </span>
            <div className="flex items-center gap-2 text-base sm:text-lg font-black tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-white to-pink-400">
              <Award className="w-5 h-5 text-amber-400 shrink-0" />
              <span>Gino El Arquitecto</span>
            </div>
            <p className="text-[11.5px] text-slate-300/90 font-medium max-w-sm mt-0.5">
              Desarrollado como una suite profesional de producción y reproducción de karaoke en tiempo real.
            </p>
          </div>

          {/* Core Feature Capabilities Grid */}
          <div className="grid grid-cols-2 gap-2.5 w-full text-left font-mono text-[11px]">
            <div className="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800/80 flex items-center gap-2.5">
              <Cpu className="w-4 h-4 text-cyan-400 shrink-0" />
              <div>
                <div className="font-bold text-white">Motor IA DSP</div>
                <div className="text-[10px] text-slate-400">Separación On-Device</div>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800/80 flex items-center gap-2.5">
              <Zap className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <div className="font-bold text-white">1-Click Sync</div>
                <div className="text-[10px] text-slate-400">Smart Cache 0.005s</div>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800/80 flex items-center gap-2.5">
              <Tv className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <div className="font-bold text-white">Modo TV 60 FPS</div>
                <div className="text-[10px] text-slate-400">Escenario Standalone</div>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800/80 flex items-center gap-2.5">
              <Disc className="w-4 h-4 text-pink-400 shrink-0" />
              <div>
                <div className="font-bold text-white">Visual LRC DAW</div>
                <div className="text-[10px] text-slate-400">Timeline & Dúos</div>
              </div>
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-900/90 flex items-center justify-between text-[11px] text-slate-400 font-mono relative z-10 shrink-0">
          <div className="flex items-center gap-1.5 text-slate-300">
            <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
            <span>Gino El Arquitecto © 2026</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:brightness-110 text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};
