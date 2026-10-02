import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Smartphone,
  X,
  Copy,
  Check,
  Radio,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Power,
  Zap,
} from 'lucide-react';
import { peerSync } from '../services/peerSyncService';

interface DjControlModalProps {
  isOpen: boolean;
  onClose: () => void;
  hostPeerId?: string | null;
  isDjServiceEnabled: boolean;
  onToggleDjService: (enabled: boolean) => void;
  connectedDjCount: number;
}

export const DjControlModal: React.FC<DjControlModalProps> = ({
  isOpen,
  onClose,
  hostPeerId,
  isDjServiceEnabled,
  onToggleDjService,
  connectedDjCount,
}) => {
  const [copied, setCopied] = useState(false);
  const [currentHostId, setCurrentHostId] = useState<string>(hostPeerId || peerSync.getHostId());

  useEffect(() => {
    if (isOpen) {
      setCurrentHostId(hostPeerId || peerSync.getHostId());
    }
  }, [isOpen, hostPeerId]);

  if (!isOpen) return null;

  const effectiveHostId = currentHostId || hostPeerId || peerSync.getHostId();
  const roomCode = effectiveHostId.replace('klab_host_', '');

  // Complete URL for DJ Mobile Remote
  const djUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/dj?room=${roomCode || effectiveHostId}`
    : `http://localhost:3000/dj?room=${roomCode || effectiveHostId}`;

  // QR code image URL (Cyberpunk cyan accent with dark background)
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(djUrl)}&color=00f0ff&bgcolor=06070e`;

  const handleCopy = () => {
    try {
      navigator.clipboard.writeText(djUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (_) {}
  };

  const handleRegenerateHostCode = () => {
    peerSync.regenerateHost((newId) => {
      setCurrentHostId(newId);
    });
  };

  const handleOpenWindow = () => {
    window.open(djUrl, '_blank', 'width=420,height=880');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#06070e] border border-cyan-500/40 rounded-3xl shadow-[0_0_60px_rgba(0,240,255,0.3)] overflow-hidden flex flex-col text-center relative z-50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 bg-[#0c0e1a] border-b border-cyan-500/20 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-pink-500 flex items-center justify-center shadow-[0_0_12px_rgba(0,240,255,0.5)]">
              <Sliders className="w-4 h-4 text-black" />
            </div>
            <div className="text-left">
              <h2 className="text-sm font-black tracking-wider uppercase bg-gradient-to-r from-cyan-300 via-white to-pink-400 bg-clip-text text-transparent">
                Control DJ Remoto
              </h2>
              <p className="text-[10px] text-cyan-400/80 font-mono">
                Sincronización P2P en Vivo • Celular a PC
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full bg-cyan-950/80 border border-cyan-500/40 text-[10.5px] font-mono font-bold text-cyan-300">
              SALA: <span className="text-white">{roomCode.toUpperCase() || 'HOST'}</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Status Bar */}
        <div className="px-6 py-2.5 bg-black/60 border-b border-white/5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isDjServiceEnabled
                  ? 'bg-emerald-400 shadow-[0_0_10px_#10b981] animate-pulse'
                  : 'bg-rose-500 shadow-[0_0_10px_#f43f5e]'
              }`}
            />
            <span className="font-semibold text-slate-200 text-[11px]">
              {isDjServiceEnabled ? '🟢 Servicio DJ Activo' : '🔴 Servicio Desconectado / Bloqueado'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-cyan-400 font-mono text-[11px]">
            <Smartphone className="w-3.5 h-3.5" />
            <span>
              {connectedDjCount} {connectedDjCount === 1 ? 'DJ Conectado' : 'DJs Conectados'}
            </span>
          </div>
        </div>

        {/* Modal Content */}
        <div className="p-6 flex flex-col items-center gap-4">
          {isDjServiceEnabled ? (
            <>
              {/* QR Section */}
              <div className="relative group p-4 rounded-3xl bg-[#0b0d18] border border-cyan-500/30 shadow-[0_0_35px_rgba(0,240,255,0.15)] flex flex-col items-center">
                <div className="relative rounded-2xl overflow-hidden p-2 bg-[#06070e] border border-cyan-400/50">
                  <img
                    src={qrImageUrl}
                    alt="DJ Remote QR Code"
                    className="w-56 h-56 object-contain rounded-xl"
                  />
                  <div className="absolute inset-0 pointer-events-none rounded-xl border-2 border-cyan-400/20" />
                </div>
                <p className="mt-3 text-[11.5px] font-medium text-slate-300">
                  Escanea con la cámara de tu iPhone o Android
                </p>
                <p className="text-[10px] text-cyan-400/70 font-mono mt-0.5">
                  Acceso exclusivo para el DJ / Operador de Sonido
                </p>
              </div>

              {/* Direct Link Box */}
              <div className="w-full flex items-center gap-2 bg-[#0a0c16] border border-cyan-500/30 rounded-2xl p-2.5 text-left">
                <input
                  type="text"
                  readOnly
                  value={djUrl}
                  className="w-full bg-transparent font-mono text-xs text-cyan-300 select-all outline-none px-2"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-300 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shrink-0 active:scale-95"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? '¡Copiado!' : 'Copiar'}</span>
                </button>
              </div>

              {/* Quick Action Buttons */}
              <div className="w-full grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={handleOpenWindow}
                  className="w-full py-2 px-3 rounded-xl bg-slate-900/80 hover:bg-cyan-950/50 border border-cyan-500/30 hover:border-cyan-400 text-cyan-300 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Probar en Ventana</span>
                </button>
                <button
                  type="button"
                  onClick={handleRegenerateHostCode}
                  className="w-full py-2 px-3 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-300 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Regenerar Sala</span>
                </button>
              </div>

              {/* Master Disable Button */}
              <button
                type="button"
                onClick={() => onToggleDjService(false)}
                className="w-full py-2.5 px-4 rounded-2xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/50 hover:border-rose-400 text-rose-300 hover:text-rose-100 text-xs font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(244,63,94,0.15)] active:scale-95"
              >
                <Power className="w-4 h-4 text-rose-400" />
                <span>🔌 Desconectar y Bloquear Acceso DJ</span>
              </button>
            </>
          ) : (
            /* Blocked/Disabled State */
            <div className="w-full py-8 px-4 flex flex-col items-center gap-4 bg-rose-950/20 border border-rose-500/30 rounded-3xl">
              <div className="w-16 h-16 rounded-full bg-rose-500/20 border border-rose-500 flex items-center justify-center shadow-[0_0_30px_rgba(244,63,94,0.4)]">
                <ShieldAlert className="w-8 h-8 text-rose-400" />
              </div>
              <div className="text-center">
                <h3 className="text-base font-black text-rose-300 uppercase tracking-wide">
                  Servicio DJ Bloqueado
                </h3>
                <p className="text-xs text-slate-400 max-w-sm mt-1.5 leading-relaxed">
                  El control remoto está pausado. Los celulares conectados actualmente han sido bloqueados y no pueden enviar comandos a la pantalla.
                </p>
              </div>

              <button
                type="button"
                onClick={() => onToggleDjService(true)}
                className="mt-2 py-3 px-6 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-black font-black text-sm uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 shadow-[0_0_25px_rgba(16,185,129,0.5)] active:scale-95"
              >
                <Zap className="w-4 h-4 fill-black" />
                <span>⚡ Activar y Mostrar QR</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
