import React, { useState, useEffect } from 'react';
import { QrCode, Smartphone, X, Copy, Check, Users, Wifi, UserX, RefreshCw, ShieldAlert, ShieldCheck, Ban } from 'lucide-react';
import { peerSync, ConnectedGuest, BlockedGuestDevice } from '../services/peerSyncService';

interface QrCodeModalProps {
  isOpen: boolean;
  hostPeerId?: string | null;
  onClose: () => void;
}

export const QrCodeModal: React.FC<QrCodeModalProps> = ({ isOpen, hostPeerId, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [connectedGuests, setConnectedGuests] = useState<ConnectedGuest[]>([]);
  const [blockedDevices, setBlockedDevices] = useState<BlockedGuestDevice[]>([]);
  const [qrKey, setQrKey] = useState<string>(peerSync.getQrKey());
  const [currentHostId, setCurrentHostId] = useState<string>(hostPeerId || peerSync.getHostId());
  const [modalTab, setModalTab] = useState<'qr' | 'connected' | 'blocked'>('qr');

  // Subscribe to guest connection changes & refresh QR key and host ID
  useEffect(() => {
    if (!isOpen) return;

    setCurrentHostId(hostPeerId || peerSync.getHostId());
    setQrKey(peerSync.getQrKey());
    setConnectedGuests(peerSync.getConnectedGuests());
    setBlockedDevices(peerSync.getBlockedDevices());

    const unsub = peerSync.onGuestsChanged((guests) => {
      setConnectedGuests([...guests]);
      setBlockedDevices(peerSync.getBlockedDevices());
      setQrKey(peerSync.getQrKey());
      setCurrentHostId(peerSync.getHostId());
    });

    return () => unsub();
  }, [isOpen, hostPeerId]);

  if (!isOpen) return null;

  const effectiveHostId = currentHostId || hostPeerId || peerSync.getHostId();

  // WebRTC QR URL with dynamic session key &k=
  const guestUrl = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.host}?mode=guest${effectiveHostId ? `&host=${effectiveHostId}` : ''}&k=${qrKey}`
    : 'http://localhost:3005/?mode=guest';

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(guestUrl)}&color=00f0ff&bgcolor=080811`;

  const handleCopyLink = () => {
    try {
      navigator.clipboard.writeText(guestUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (_) {}
  };

  const handleRegenerateQr = () => {
    peerSync.regenerateHost((newId) => {
      setCurrentHostId(newId);
    });
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
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-[#0b0d17] border border-cyan-500/40 rounded-3xl shadow-[0_0_60px_rgba(0,240,255,0.3)] overflow-hidden flex flex-col text-center relative z-50">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-cyan-300 font-bold text-sm">
            <QrCode className="w-5 h-5 text-[#00f0ff]" />
            <span className="uppercase tracking-wider">Control de Invitados</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRegenerateQr}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-200 cursor-pointer transition-colors flex items-center gap-1.5 text-xs font-semibold"
              title="Renovar y Regenerar Código QR nuevo (Expulsa a todos)"
            >
              <RefreshCw className="w-4 h-4" />
              <span className="text-[11px] hidden sm:inline">Renovar QR</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="flex items-center border-b border-slate-800 bg-slate-950/70 p-1.5 gap-1.5">
          <button
            type="button"
            onClick={() => setModalTab('qr')}
            className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              modalTab === 'qr'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
            }`}
          >
            <QrCode className="w-4 h-4" />
            <span>Código QR</span>
          </button>

          <button
            type="button"
            onClick={() => setModalTab('connected')}
            className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              modalTab === 'connected'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>En Vivo ({connectedGuests.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setModalTab('blocked')}
            className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              modalTab === 'blocked'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
            }`}
          >
            <Ban className="w-4 h-4" />
            <span>Bloqueados ({blockedDevices.length})</span>
          </button>
        </div>

        {/* Tab 1: QR Code */}
        {modalTab === 'qr' && (
          <div className="p-6 flex flex-col items-center gap-4">
            <div className="p-4 bg-[#080811] border-2 border-cyan-500/50 rounded-2xl shadow-[0_0_40px_rgba(0,240,255,0.35)] min-h-[290px] min-w-[290px] flex items-center justify-center">
              {!effectiveHostId ? (
                <div className="flex flex-col items-center justify-center text-cyan-400">
                  <RefreshCw className="w-10 h-10 animate-spin mb-3" />
                  <span className="text-sm font-bold uppercase tracking-wider">Iniciando...</span>
                </div>
              ) : (
                <img
                  key={qrImageUrl}
                  src={qrImageUrl}
                  alt="Código QR para pedir canción"
                  className="w-72 h-72 sm:w-76 sm:h-76 rounded-xl object-contain bg-slate-950 shadow-inner"
                  loading="eager"
                />
              )}
            </div>

            <div>
              <h4 className="text-base font-bold text-white flex items-center justify-center gap-2">
                <Smartphone className="w-5 h-5 text-emerald-400" />
                <span>Escanea desde tu Celular</span>
              </h4>
              <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
                Los invitados pueden buscar canciones del catálogo y agregarlas a la cola en tiempo real.
              </p>
            </div>

            {/* Copy Link Input */}
            <div className="w-full flex items-center gap-2 p-2 rounded-xl bg-slate-900/90 border border-slate-800 text-xs">
              <input
                type="text"
                readOnly
                value={guestUrl}
                className="w-full bg-transparent px-2.5 text-xs font-mono text-cyan-300 focus:outline-none truncate"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shrink-0 flex items-center gap-1.5 cursor-pointer transition-all shadow-md active:scale-95"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Copiado' : 'Copiar'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Connected Guests */}
        {modalTab === 'connected' && (
          <div className="p-4 flex flex-col gap-3 min-h-[280px]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Invitados Conectados ({connectedGuests.length})
              </span>
              {connectedGuests.length > 0 && (
                <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-semibold">
                  <Wifi className="w-3 h-3 animate-pulse" />
                  Sincronizado
                </span>
              )}
            </div>

            {connectedGuests.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 gap-2">
                <Users className="w-8 h-8 text-slate-600" />
                <span className="text-xs font-bold text-slate-400">No hay invitados conectados</span>
                <p className="text-[10px] text-slate-500 max-w-[200px]">
                  Muestra el código QR para que los invitados se conecten con su celular.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                {connectedGuests.map((guest) => (
                  <div
                    key={guest.peerId}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-emerald-500/40 transition-all shadow-sm"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center text-xs font-black text-slate-950 shrink-0">
                        {guest.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex flex-col items-start text-left">
                        <span className="text-xs font-bold text-white leading-tight">{guest.name}</span>
                        <span className="text-[9px] text-slate-400 font-mono">
                          {formatTime(guest.connectedAt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {/* Desconectar (Kick temporal) */}
                      <button
                        type="button"
                        onClick={() => {
                          peerSync.kickGuest(guest.peerId);
                        }}
                        className="px-2 py-1 rounded-lg bg-amber-950/50 hover:bg-amber-800/60 text-amber-300 text-[10px] font-bold cursor-pointer transition-all border border-amber-500/30 flex items-center gap-1"
                        title={`Desconectar a ${guest.name}`}
                      >
                        <UserX className="w-3 h-3" />
                        <span>Desconectar</span>
                      </button>

                      {/* Bloquear Permanente (Blacklist Ban) */}
                      <button
                        type="button"
                        onClick={() => {
                          peerSync.blockGuest(guest.peerId);
                        }}
                        className="px-2 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-800/80 text-rose-300 text-[10px] font-black cursor-pointer transition-all border border-rose-500/40 flex items-center gap-1 shadow-[0_0_10px_rgba(244,63,94,0.2)]"
                        title={`Bloquear dispositivo de ${guest.name} permanentemente`}
                      >
                        <Ban className="w-3 h-3 text-rose-400" />
                        <span>Bloquear</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Blocked Devices */}
        {modalTab === 'blocked' && (
          <div className="p-4 flex flex-col gap-3 min-h-[280px]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                Lista Negra ({blockedDevices.length})
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Hardware Ban</span>
            </div>

            {blockedDevices.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 gap-2">
                <ShieldCheck className="w-8 h-8 text-emerald-500/50" />
                <span className="text-xs font-bold text-slate-400">No hay dispositivos bloqueados</span>
                <p className="text-[10px] text-slate-500 max-w-[210px]">
                  Los dispositivos que bloquees aparecerán aquí y no podrán volver a entrar aunque borren cookies o escaneen el QR.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                {blockedDevices.map((blocked) => (
                  <div
                    key={blocked.fingerprint}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-rose-950/20 border border-rose-500/30 transition-all shadow-sm"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-rose-900/50 border border-rose-500/50 flex items-center justify-center text-xs text-rose-300 shrink-0">
                        🚫
                      </div>
                      <div className="flex flex-col items-start text-left">
                        <span className="text-xs font-bold text-rose-200 leading-tight">
                          {blocked.name || 'Dispositivo'}
                        </span>
                        <span className="text-[9px] text-slate-400 font-mono">
                          Bloqueado {formatTime(blocked.blockedAt)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        peerSync.unblockDevice(blocked.fingerprint);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-800/70 text-emerald-300 text-[10px] font-bold cursor-pointer transition-all border border-emerald-500/40 flex items-center gap-1 shadow-sm"
                      title="Desbloquear este dispositivo"
                    >
                      <ShieldCheck className="w-3 h-3 text-emerald-400" />
                      <span>Desbloquear</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};
