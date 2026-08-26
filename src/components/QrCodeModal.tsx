import React, { useState } from 'react';
import { QrCode, Smartphone, X, Copy, Check } from 'lucide-react';

interface QrCodeModalProps {
  isOpen: boolean;
  hostPeerId?: string | null;
  onClose: () => void;
}

export const QrCodeModal: React.FC<QrCodeModalProps> = ({ isOpen, hostPeerId, onClose }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  // Clean, lightweight WebRTC URL for guest mobile phones
  const guestUrl = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.host}?mode=guest${hostPeerId ? `&host=${hostPeerId}` : ''}`
    : 'http://localhost:3005/?mode=guest';

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(guestUrl)}&color=00f0ff&bgcolor=080811`;

  const handleCopyLink = () => {
    try {
      navigator.clipboard.writeText(guestUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (_) {}
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-sm bg-[#0b0d17] border border-cyan-500/40 rounded-2xl shadow-[0_0_50px_rgba(0,240,255,0.25)] overflow-hidden flex flex-col text-center relative z-50">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-cyan-300 font-bold text-xs">
            <QrCode className="w-4 h-4 text-[#00f0ff]" />
            <span className="uppercase tracking-wider">QR Pedir Canciones en Vivo</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* QR Code Container */}
        <div className="p-6 flex flex-col items-center gap-4">
          <div className="p-3 bg-[#080811] border-2 border-cyan-500/50 rounded-2xl shadow-[0_0_30px_rgba(0,240,255,0.3)] min-h-[240px] min-w-[240px] flex items-center justify-center">
            <img
              src={qrImageUrl}
              alt="Código QR para pedir canción"
              className="w-56 h-56 rounded-xl object-contain bg-slate-950"
              loading="eager"
            />
          </div>

          <div>
            <h4 className="text-sm font-bold text-white flex items-center justify-center gap-1.5">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              <span>Escanea desde tu Celular</span>
            </h4>
            <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
              Los invitados pueden buscar en el catálogo y ponerse en la cola sin tocar el equipo principal.
            </p>
          </div>

          {/* Copy Link Input */}
          <div className="w-full flex items-center gap-2 p-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs">
            <input
              type="text"
              readOnly
              value={guestUrl}
              className="w-full bg-transparent px-2 text-[11px] font-mono text-cyan-300 focus:outline-none truncate"
            />
            <button
              type="button"
              onClick={handleCopyLink}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] shrink-0 flex items-center gap-1 cursor-pointer transition-all"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copiado' : 'Copiar Link'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
