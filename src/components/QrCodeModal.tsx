import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { QrCode, Smartphone, X, Copy, Check, Users, Wifi, UserX, RefreshCw } from 'lucide-react';
import { peerSync, ConnectedGuest } from '../services/peerSyncService';

interface QrCodeModalProps {
  isOpen: boolean;
  hostPeerId?: string | null;
  onClose: () => void;
}

export const QrCodeModal: React.FC<QrCodeModalProps> = ({ isOpen, hostPeerId, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [connectedGuests, setConnectedGuests] = useState<ConnectedGuest[]>([]);
  const [qrKey, setQrKey] = useState<string>(() => peerSync.getQrKey());
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  const effectiveHostId = hostPeerId || peerSync.getHostId() || peerSync.getOrCreateHostId();

  const guestUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/?mode=guest&host=${effectiveHostId}&k=${qrKey}`
    : `https://karaokelab.vercel.app/?mode=guest&host=${effectiveHostId}&k=${qrKey}`;

  // Generate local high-contrast QR code Data URL
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    QRCode.toDataURL(guestUrl, {
      width: 300,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (isMounted) setQrDataUrl(url);
      })
      .catch((err) => {
        console.error('QR creation error:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, guestUrl]);

  // Guest list subscriptions
  useEffect(() => {
    if (!isOpen) return;
    setConnectedGuests(peerSync.getConnectedGuests());

    const unsub = peerSync.onGuestsChanged((guests) => {
      setConnectedGuests([...guests]);
    });

    return () => unsub();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyLink = () => {
    try {
      navigator.clipboard.writeText(guestUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  const handleRegenerateQr = () => {
    const newKey = peerSync.rotateQrKey();
    setQrKey(newKey);
  };

  const formatTime = (timestamp: number) => {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60) return 'ahora';
    if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
    return `hace ${Math.floor(diff / 3600)}h`;
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-slate-900 border border-cyan-500/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
            <QrCode className="w-4 h-4 text-cyan-400" />
            <span className="uppercase tracking-wider">QR Biblioteca</span>
            {connectedGuests.length > 0 && (
              <span className="ml-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold font-mono">
                {connectedGuests.length} online
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleRegenerateQr}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-200 cursor-pointer transition-colors"
              title="Regenerar Código QR"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Connected Guests List */}
        {connectedGuests.length > 0 && (
          <div className="px-5 py-3 bg-emerald-950/30 border-b border-emerald-500/20">
            <div className="flex items-center gap-1.5 mb-2">
              <Users className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider">
                Dispositivos Conectados ({connectedGuests.length})
              </span>
            </div>
            <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
              {connectedGuests.map((guest) => (
                <div
                  key={guest.peerId}
                  className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-900/80 border border-emerald-500/25"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center text-[10px] font-black text-slate-950 shrink-0">
                      {guest.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="text-xs font-bold text-white">{guest.name}</span>
                      <span className="text-[9px] text-slate-500 font-mono">
                        Conectado {formatTime(guest.connectedAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Wifi className="w-3 h-3 text-emerald-400 animate-pulse" />
                    <span className="text-[9px] font-bold text-emerald-400">En Vivo</span>
                    <button
                      type="button"
                      onClick={() => {
                        peerSync.kickGuest(guest.peerId);
                        setQrKey(peerSync.getQrKey());
                      }}
                      className="ml-1 p-1.5 rounded-lg bg-rose-900/40 hover:bg-rose-700/60 text-rose-400 hover:text-rose-200 cursor-pointer transition-all border border-rose-500/30"
                      title={`Expulsar a ${guest.name}`}
                    >
                      <UserX className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* QR Code Container */}
        <div className="p-6 flex flex-col items-center gap-4 bg-slate-900">
          <div className="p-3 bg-white rounded-2xl shadow-xl w-60 h-60 flex items-center justify-center">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Código QR Biblioteca"
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-slate-600 gap-2">
                <RefreshCw className="w-8 h-8 animate-spin text-cyan-600" />
                <span className="text-xs font-bold text-slate-700">Generando QR...</span>
              </div>
            )}
          </div>

          <div>
            <h4 className="text-sm font-bold text-white flex items-center justify-center gap-1.5">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              <span>Escanea desde tu Celular</span>
            </h4>
            <p className="text-xs text-slate-400 mt-1 max-w-xs">
              Tus invitados pueden explorar la biblioteca y pedir canciones a la cola desde su móvil.
            </p>
          </div>

          {/* Copy Link Input */}
          <div className="w-full flex items-center gap-2 p-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
            <input
              type="text"
              readOnly
              value={guestUrl}
              className="w-full bg-transparent px-2 text-[11px] font-mono text-cyan-300 focus:outline-none truncate"
            />
            <button
              type="button"
              onClick={handleCopyLink}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] shrink-0 flex items-center gap-1 cursor-pointer transition-all"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copiado' : 'Copiar'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
