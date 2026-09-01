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
  const [modalTab, setModalTab] = useState<'qr' | 'tables' | 'connected' | 'blocked'>('qr');
  const [selectedTable, setSelectedTable] = useState<number>(1);
  const [tableCopyStatus, setTableCopyStatus] = useState<boolean>(false);

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
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div className="w-full max-w-md bg-[#0b0d17] border border-cyan-500/40 rounded-3xl shadow-[0_0_60px_rgba(0,240,255,0.3)] overflow-hidden flex flex-col text-center relative z-50" onClick={(e) => e.stopPropagation()}>
        
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
        <div className="flex items-center border-b border-slate-800 bg-slate-950/70 p-1.5 gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setModalTab('qr')}
            className={`flex-1 py-2 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer shrink-0 ${
              modalTab === 'qr'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>QR General</span>
          </button>

          <button
            type="button"
            onClick={() => setModalTab('tables')}
            className={`flex-1 py-2 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer shrink-0 ${
              modalTab === 'tables'
                ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
            }`}
          >
            <span>🪑</span>
            <span>QRs por Mesa</span>
          </button>

          <button
            type="button"
            onClick={() => setModalTab('connected')}
            className={`flex-1 py-2 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer shrink-0 ${
              modalTab === 'connected'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>En Vivo ({connectedGuests.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setModalTab('blocked')}
            className={`flex-1 py-2 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer shrink-0 ${
              modalTab === 'blocked'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
            }`}
          >
            <Ban className="w-3.5 h-3.5" />
            <span>Bloqueados</span>
          </button>
        </div>

        {/* Tab 1: QR Code */}
        {modalTab === 'qr' && (
          <div className="h-[520px] p-6 flex flex-col items-center justify-between animate-in fade-in duration-150">
            <div className="p-3.5 bg-[#080811] border-2 border-cyan-500/50 rounded-2xl shadow-[0_0_40px_rgba(0,240,255,0.35)] flex items-center justify-center">
              {!effectiveHostId ? (
                <div className="flex flex-col items-center justify-center text-cyan-400 w-64 h-64">
                  <RefreshCw className="w-10 h-10 animate-spin mb-3" />
                  <span className="text-sm font-bold uppercase tracking-wider">Iniciando...</span>
                </div>
              ) : (
                <img
                  key={qrImageUrl}
                  src={qrImageUrl}
                  alt="Código QR para pedir canción"
                  className="w-64 h-64 sm:w-72 sm:h-72 rounded-xl object-contain bg-slate-950 shadow-inner"
                  loading="eager"
                />
              )}
            </div>

            <div className="flex-1 flex flex-col justify-center gap-2">
              <h4 className="text-base font-bold text-white flex items-center justify-center gap-2">
                <Smartphone className="w-5 h-5 text-emerald-400" />
                <span>Escanea desde tu Celular</span>
              </h4>
              <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
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

        {/* Tab 2: QRs por Mesa (Bar / Pub) */}
        {modalTab === 'tables' && (
          <div className="h-[520px] p-5 flex flex-col items-center justify-between animate-in fade-in duration-150">
            <div className="w-full flex items-center justify-between bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
              <span className="text-xs font-bold text-pink-300 flex items-center gap-1.5">
                <span>🪑</span>
                <span>Selecciona Nº de Mesa:</span>
              </span>
              <select
                value={selectedTable}
                onChange={(e) => setSelectedTable(Number(e.target.value))}
                className="bg-slate-950 border border-pink-500/50 text-white font-bold font-mono text-xs px-3 py-1.5 rounded-lg focus:outline-none focus:border-pink-400 cursor-pointer"
              >
                {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    Mesa {n}
                  </option>
                ))}
              </select>
            </div>

            {/* Table QR Image */}
            {(() => {
              const tableGuestUrl = `${guestUrl}&table=Mesa%20${selectedTable}`;
              const tableQrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(tableGuestUrl)}&color=ff007f&bgcolor=080811`;
              return (
                <>
                  <div className="p-3.5 bg-[#080811] border-2 border-pink-500/50 rounded-2xl shadow-[0_0_40px_rgba(255,0,127,0.35)] flex items-center justify-center">
                    <img
                      key={tableQrImgUrl}
                      src={tableQrImgUrl}
                      alt={`QR para Mesa ${selectedTable}`}
                      className="w-56 h-56 sm:w-64 sm:h-64 rounded-xl object-contain bg-slate-950 shadow-inner"
                    />
                  </div>

                  <div className="flex flex-col gap-1 text-center">
                    <h4 className="text-sm font-black text-white">
                      Código QR para <span className="text-pink-400">Mesa {selectedTable}</span>
                    </h4>
                    <p className="text-[11px] text-slate-400 max-w-xs leading-tight">
                      Al escanear este QR, el celular del cliente ingresa pre-configurado para la <strong>Mesa {selectedTable}</strong>.
                    </p>
                  </div>

                  <div className="w-full flex items-center gap-2 p-2 rounded-xl bg-slate-900/90 border border-slate-800 text-xs">
                    <input
                      type="text"
                      readOnly
                      value={tableGuestUrl}
                      className="w-full bg-transparent px-2 text-[11px] font-mono text-pink-300 focus:outline-none truncate"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          navigator.clipboard.writeText(tableGuestUrl);
                          setTableCopyStatus(true);
                          setTimeout(() => setTableCopyStatus(false), 2500);
                        } catch (_) {}
                      }}
                      className="px-3 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-white font-bold text-xs shrink-0 flex items-center gap-1.5 cursor-pointer transition-all shadow-md active:scale-95"
                    >
                      {tableCopyStatus ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      <span>{tableCopyStatus ? 'Copiado' : 'Copiar'}</span>
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Tab 2: Connected Guests */}
        {modalTab === 'connected' && (
          <div className="h-[520px] p-5 flex flex-col justify-between animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-4 h-4 text-emerald-400" />
                <span>Invitados Conectados ({connectedGuests.length})</span>
              </span>
              {connectedGuests.length > 0 && (
                <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-semibold">
                  <Wifi className="w-3 h-3 animate-pulse" />
                  Sincronizado
                </span>
              )}
            </div>

            {connectedGuests.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 gap-3 my-2">
                <div className="w-14 h-14 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center text-slate-500">
                  <Users className="w-7 h-7" />
                </div>
                <span className="text-sm font-bold text-slate-300">No hay invitados conectados</span>
                <p className="text-xs text-slate-500 max-w-[240px] leading-relaxed">
                  Muestra la pestaña del Código QR para que las personas en la sala puedan escanearlo y conectarse desde su celular.
                </p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col gap-2 overflow-y-auto pr-1 my-2">
                {connectedGuests.map((guest) => (
                  <div
                    key={guest.peerId}
                    className="flex items-center justify-between p-3 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-emerald-500/40 transition-all shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center text-xs font-black text-slate-950 shrink-0 shadow-sm">
                        {guest.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex flex-col items-start text-left">
                        <span className="text-xs font-bold text-white leading-tight">{guest.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          Conectado {formatTime(guest.connectedAt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* Desconectar (Kick temporal) */}
                      <button
                        type="button"
                        onClick={() => {
                          peerSync.kickGuest(guest.peerId);
                        }}
                        className="px-2.5 py-1.5 rounded-xl bg-amber-950/50 hover:bg-amber-800/60 text-amber-300 text-[11px] font-bold cursor-pointer transition-all border border-amber-500/30 flex items-center gap-1"
                        title={`Desconectar a ${guest.name}`}
                      >
                        <UserX className="w-3.5 h-3.5" />
                        <span>Desconectar</span>
                      </button>

                      {/* Bloquear Permanente (Blacklist Ban) */}
                      <button
                        type="button"
                        onClick={() => {
                          peerSync.blockGuest(guest.peerId);
                        }}
                        className="px-2.5 py-1.5 rounded-xl bg-rose-950/60 hover:bg-rose-800/80 text-rose-300 text-[11px] font-black cursor-pointer transition-all border border-rose-500/40 flex items-center gap-1 shadow-[0_0_10px_rgba(244,63,94,0.2)]"
                        title={`Bloquear dispositivo de ${guest.name} permanentemente`}
                      >
                        <Ban className="w-3.5 h-3.5 text-rose-400" />
                        <span>Bloquear</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-center gap-2 text-[11px] text-slate-500 font-mono">
              <span>Consejo: Usa "Bloquear" si alguien sabotea la lista</span>
            </div>
          </div>
        )}

        {/* Tab 3: Blocked Devices */}
        {modalTab === 'blocked' && (
          <div className="h-[520px] p-5 flex flex-col justify-between animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
              <span className="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4" />
                <span>Lista Negra de Dispositivos ({blockedDevices.length})</span>
              </span>
              <span className="text-[10px] text-rose-400/80 font-mono font-bold bg-rose-950/60 px-2 py-0.5 rounded-md border border-rose-500/30">
                Hardware Ban
              </span>
            </div>

            {blockedDevices.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 gap-3 my-2">
                <div className="w-14 h-14 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.15)]">
                  <ShieldCheck className="w-7 h-7" />
                </div>
                <span className="text-sm font-bold text-slate-300">No hay dispositivos bloqueados</span>
                <p className="text-xs text-slate-500 max-w-[240px] leading-relaxed">
                  Los dispositivos que bloquees aparecerán aquí. No podrán pedir canciones ni reconectarse aunque borren cookies.
                </p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col gap-2 overflow-y-auto pr-1 my-2">
                {blockedDevices.map((blocked) => (
                  <div
                    key={blocked.fingerprint}
                    className="flex items-center justify-between p-3 rounded-2xl bg-rose-950/25 border border-rose-500/30 transition-all shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-rose-900/50 border border-rose-500/50 flex items-center justify-center text-sm text-rose-300 shrink-0">
                        🚫
                      </div>
                      <div className="flex flex-col items-start text-left">
                        <span className="text-xs font-bold text-rose-200 leading-tight">
                          {blocked.name || 'Dispositivo'}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          Bloqueado {formatTime(blocked.blockedAt)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        peerSync.unblockDevice(blocked.fingerprint);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-emerald-950/60 hover:bg-emerald-800/70 text-emerald-300 text-[11px] font-bold cursor-pointer transition-all border border-emerald-500/40 flex items-center gap-1.5 shadow-sm"
                      title="Desbloquear este dispositivo"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Desbloquear</span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-center gap-2 text-[11px] text-slate-500 font-mono">
              <span>Los bloqueos se conservan permanentemente</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
