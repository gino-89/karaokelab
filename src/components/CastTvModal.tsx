import React, { useState, useEffect, useRef } from 'react';
import {
  Tv,
  Cast,
  Monitor,
  Smartphone,
  Check,
  ExternalLink,
  X,
  Radio,
  Sparkles,
  Copy,
  QrCode,
  Laptop,
  Wifi,
  Search,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface CastTvModalProps {
  isOpen: boolean;
  onClose: () => void;
  songTitle: string;
  songArtist?: string;
  isPlaying: boolean;
  isCastingActive: boolean;
  onToggleCasting: (active: boolean) => void;
}

export const CastTvModal: React.FC<CastTvModalProps> = ({
  isOpen,
  onClose,
  songTitle,
  songArtist,
  isPlaying,
  isCastingActive,
  onToggleCasting,
}) => {
  const [activeTab, setActiveTab] = useState<'screen' | 'chromecast' | 'airplay' | 'smarttv'>('chromecast');
  const [copiedLink, setCopiedLink] = useState(false);
  const [supportAirPlay, setSupportAirPlay] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [castStatus, setCastStatus] = useState<string | null>(null);
  const airplayAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const audio = airplayAudioRef.current || document.createElement('audio');
      if ((window as any).WebKitPlaybackTargetAvailabilityEvent || (audio as any).webkitShowPlaybackTargetPicker) {
        setSupportAirPlay(true);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const tvUrl = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.host}?mode=tv_display`
    : 'http://localhost:3000/?mode=tv_display';

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(tvUrl)}&color=00f0ff&bgcolor=080811`;

  const handleOpenTvWindow = async () => {
    try {
      const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__?.invoke;
      if (isTauri) {
        await (window as any).__TAURI_INTERNALS__.invoke('open_native_tv_window');
        onToggleCasting(true);
        setCastStatus('✓ Pantalla TV abierta en ventana independiente');
        return;
      }
    } catch (e) {
      console.warn('Native window open error, falling back to window.open', e);
    }

    // Fallback: Web browser window
    const width = 1280;
    const height = 720;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;

    const tvWin = window.open(
      tvUrl,
      'KaraokeLab_TV_Display',
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`
    );

    if (tvWin) {
      tvWin.focus();
      onToggleCasting(true);
      setCastStatus('✓ Pantalla TV abierta en ventana independiente');
    } else {
      alert('Por favor permite abrir ventanas emergentes para mostrar la Pantalla TV.');
    }
  };

  // Trigger Google Cast via Chrome / Web
  const handleChromecast = async () => {
    setIsScanning(true);
    setCastStatus('Abriendo Modo TV en Google Chrome para transmitir a Chromecast...');

    try {
      const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__?.invoke;
      if (isTauri) {
        await (window as any).__TAURI_INTERNALS__.invoke('open_in_chrome_cast', { url: tvUrl });
        onToggleCasting(true);
        setCastStatus('✓ Modo TV abierto en Google Chrome. Haz clic en Transmitir para seleccionar tu TV.');
        setIsScanning(false);
        return;
      }
    } catch (e) {
      console.warn('Chrome launcher error, falling back', e);
    }

    // Web fallback: Presentation API or window
    if (typeof window !== 'undefined' && 'PresentationRequest' in window) {
      try {
        const request = new (window as any).PresentationRequest([tvUrl]);
        await request.start();
        onToggleCasting(true);
        setCastStatus('✓ Transmitiendo pantalla a dispositivo seleccionado');
        setIsScanning(false);
        return;
      } catch (err: any) {
        console.log('PresentationRequest error:', err);
      }
    }

    handleOpenTvWindow();
    setIsScanning(false);
  };

  // Trigger AirPlay / External Screen
  const handleNativeAirPlay = async () => {
    setIsScanning(true);
    setCastStatus('Enviando Modo TV a tu televisor / pantalla externa...');
    await handleOpenTvWindow();
    setIsScanning(false);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(tvUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  return (
    <div 
      className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200 pointer-events-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Hidden audio element with x-webkit-airplay for native AirPlay picker invocation */}
      <audio
        ref={airplayAudioRef}
        x-webkit-airplay="allow"
        className="hidden"
        preload="none"
      />

      <div 
        className="w-full max-w-xl bg-[#0c0d19] border border-cyan-500/40 rounded-3xl shadow-[0_0_60px_rgba(0,240,255,0.25)] overflow-hidden flex flex-col relative z-10"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#00f0ff]/20 to-[#ff007f]/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300 shadow-[0_0_15px_rgba(0,240,255,0.3)]">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                TRANSMITIR MODO TV
              </h3>
              <p className="text-[11px] text-slate-400 font-mono">
                Solo transmite el escenario y las letras, sin controles del estudio
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col gap-4 text-xs">
          
          {/* Status Pill */}
          <div className={`p-3.5 rounded-2xl border flex items-center justify-between ${
            isCastingActive
              ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
              : 'bg-slate-900/80 border-slate-800 text-slate-300'
          }`}>
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${isCastingActive ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'}`} />
              <div>
                <span className="font-bold block text-sm">
                  {isCastingActive ? '📡 Transmisión Modo TV Activa' : 'Sin Transmisión Externa'}
                </span>
                <span className="text-[11px] opacity-80 block">
                  {isCastingActive 
                    ? `Transmitiendo: ${songTitle || 'Escenario listo'} en tiempo real` 
                    : 'Selecciona una opción abajo para buscar dispositivos en tu red Wi-Fi'}
                </span>
              </div>
            </div>

            {isCastingActive && (
              <button
                onClick={() => onToggleCasting(false)}
                className="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold cursor-pointer transition-all"
              >
                Detener
              </button>
            )}
          </div>

          {/* Navigation Tabs */}
          <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('chromecast')}
              className={`py-2 px-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'chromecast'
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Cast className="w-3.5 h-3.5" />
              <span className="truncate">Chromecast</span>
            </button>

            <button
              onClick={() => setActiveTab('airplay')}
              className={`py-2 px-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'airplay'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Laptop className="w-3.5 h-3.5" />
              <span className="truncate">AirPlay</span>
            </button>

            <button
              onClick={() => setActiveTab('screen')}
              className={`py-2 px-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'screen'
                  ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span className="truncate">2da Pantalla / HDMI</span>
            </button>

            <button
              onClick={() => setActiveTab('smarttv')}
              className={`py-2 px-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'smarttv'
                  ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-lg'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span className="truncate">Smart TV QR</span>
            </button>
          </div>

          {/* TAB 1: CHROMECAST */}
          {activeTab === 'chromecast' && (
            <div className="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-500/30 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-white font-bold text-sm">
                  <Cast className="w-4 h-4 text-emerald-400" />
                  <span>Transmitir a Chromecast / Google TV</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold">
                  Búsqueda Wi-Fi
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Al hacer clic, se abrirá la lista de dispositivos **Chromecast, Google TV y Smart TVs** disponibles en tu red Wi-Fi para transmitir solo el Modo TV.
              </p>

              <button
                onClick={handleChromecast}
                disabled={isScanning}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:brightness-110 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all shadow-lg shadow-emerald-500/30 disabled:opacity-50"
              >
                {isScanning ? <Search className="w-4 h-4 animate-spin" /> : <Cast className="w-4 h-4" />}
                <span>Buscar y Conectar Dispositivos Chromecast</span>
              </button>
            </div>
          )}

          {/* TAB 2: AIRPLAY */}
          {activeTab === 'airplay' && (
            <div className="p-4 rounded-2xl bg-purple-950/20 border border-purple-500/30 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-white font-bold text-sm">
                  <Laptop className="w-4 h-4 text-purple-400" />
                  <span>AirPlay (Apple TV & Smart TVs con AirPlay 2)</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono font-bold">
                  Apple AirPlay
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Abre la pantalla de Modo TV y activa el menú nativo de **AirPlay** para seleccionar tu **Apple TV, Roku, Samsung o LG con AirPlay 2**.
              </p>

              <button
                onClick={handleNativeAirPlay}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:brightness-110 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all shadow-lg shadow-purple-500/30"
              >
                <Cast className="w-4 h-4" />
                <span>Abrir Selector de Dispositivos AirPlay</span>
              </button>

              <div className="p-3 bg-purple-950/40 rounded-xl border border-purple-500/20 text-[11px] text-purple-200 flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Tip de Mac:</strong> También puedes usar el icono de duplicación en la barra superior de tu Mac (<strong>Centro de Control → Duplicar Pantalla</strong>) para enviar la ventana a tu Apple TV.
                </span>
              </div>
            </div>
          )}

          {/* TAB 3: 2ND SCREEN / HDMI / PROJECTOR */}
          {activeTab === 'screen' && (
            <div className="p-4 rounded-2xl bg-cyan-950/20 border border-cyan-500/30 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-white font-bold text-sm">
                  <Monitor className="w-4 h-4 text-[#00f0ff]" />
                  <span>Pantalla TV Dedicada (HDMI / 2do Monitor)</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono font-bold">
                  Sin Latencia
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Abre una ventana independiente y limpia con el **Modo TV a pantalla completa**. Arrástrala a tu Smart TV, segundo monitor o proyector.
              </p>
              <button
                onClick={handleOpenTvWindow}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#00f0ff] to-cyan-600 hover:brightness-110 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all shadow-lg shadow-cyan-500/30"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Abrir Pantalla TV en Ventana Independiente</span>
              </button>
            </div>
          )}

          {/* TAB 4: SMART TV DIRECT QR */}
          {activeTab === 'smarttv' && (
            <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-500/30 space-y-3 flex flex-col items-center text-center animate-in fade-in">
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <QrCode className="w-4 h-4 text-amber-400" />
                <span>Abrir en el Navegador de tu Smart TV</span>
              </div>
              <p className="text-xs text-slate-300 max-w-sm">
                Escanea este código con la cámara de tu teléfono o ingresa la dirección en el navegador web de tu televisión:
              </p>

              <div className="p-2.5 bg-[#080811] border border-amber-500/40 rounded-2xl shadow-[0_0_25px_rgba(245,158,11,0.25)]">
                <img
                  src={qrImageUrl}
                  alt="Código QR para Smart TV"
                  className="w-36 h-36 rounded-xl object-contain"
                />
              </div>

              <div className="flex items-center gap-2 w-full max-w-md">
                <input
                  type="text"
                  readOnly
                  value={tvUrl}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-cyan-300 font-mono text-center focus:outline-none"
                />
                <button
                  onClick={handleCopyLink}
                  className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1 shrink-0"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedLink ? '¡Copiado!' : 'Copiar'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Feedback status message */}
          {castStatus && (
            <div className="p-3 rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-cyan-200 text-xs font-bold flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>{castStatus}</span>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
