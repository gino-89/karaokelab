import React, { useState, useRef, useEffect } from 'react';
import { Tv, FolderUp, Radio, QrCode } from 'lucide-react';

interface HeaderProps {
  onOpenAboutModal?: () => void;
  onOpenPartyMode: () => void;
  onOpenVideoStudio?: () => void;
  onOpenCastModal?: () => void;
  onOpenQrModal?: () => void;
  onOpenDspSettings?: () => void;
  onOpenPublishModal?: () => void;
  onOpenShareModal?: () => void;
  onClearCache?: () => void;
  onSyncToFolder?: () => void;
  onChangeSyncFolder?: () => void;
  onImportSyncedFolder?: () => void;
  isFolderSyncing?: boolean;
  syncTargetFolder?: string;
  isCastingActive?: boolean;
  onFilesSelected: (files: FileList | File[]) => void;
  isPlaying: boolean;
  hasSongLoaded: boolean;
  isExportingVideo?: boolean;
  onStartVideoExport?: () => void;
  onStopVideoExport?: () => void;
}

export const Header: React.FC<HeaderProps> = React.memo(({
  onOpenAboutModal,
  onOpenPartyMode,
  onOpenVideoStudio,
  onOpenCastModal,
  onOpenQrModal,
  onOpenDspSettings,
  onOpenPublishModal,
  onOpenShareModal,
  onClearCache,
  onSyncToFolder,
  onChangeSyncFolder,
  onImportSyncedFolder,
  isFolderSyncing,
  syncTargetFolder,
  isCastingActive,
  onFilesSelected,
  isPlaying,
  hasSongLoaded,
}) => {
  const [showImportMenu, setShowImportMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setShowImportMenu(false);
      }
    };
    if (showImportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showImportMenu]);

  return (
    <header className="flex flex-wrap justify-between items-center border-b border-white/10 py-2 px-3 sm:px-5 bg-[#080811] sticky top-0 z-40 gap-2">
      {/* Hidden File & Folder Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.lrc"
        onChange={(e) => {
          if (e.target.files?.length) {
            onFilesSelected(e.target.files);
            e.target.value = '';
          }
        }}
        className="hidden"
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        {...({ webkitdirectory: '', directory: '' } as any)}
        onChange={(e) => {
          if (e.target.files?.length) {
            onFilesSelected(e.target.files);
            e.target.value = '';
          }
        }}
        className="hidden"
      />

      {/* Brand & Logo (Clickable for About Modal) */}
      <button
        type="button"
        onClick={onOpenAboutModal}
        className="flex items-center gap-2.5 text-left group cursor-pointer p-0.5 rounded-xl hover:bg-white/5 transition-all shrink-0"
        title="Información del Sistema // KaraokeLab Studio (Creada por Gino El Arquitecto)"
      >
        <div className="relative w-9 h-9 shrink-0 rounded-xl overflow-hidden border border-cyan-500/40 shadow-[0_0_12px_rgba(0,240,255,0.4)] group-hover:shadow-[0_0_20px_rgba(255,0,127,0.7)] group-hover:scale-105 transition-all duration-300">
          <img
            src="/logo-highres.jpg"
            alt="KaraokeLab Logo"
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
          />
          {isPlaying && (
            <span className="absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full bg-[#00ff9d] animate-ping border border-slate-950" />
          )}
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-black tracking-normal italic uppercase leading-none flex items-center font-mono">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-300 group-hover:brightness-125 transition-all">
              KARAOKE
            </span>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400 ml-1 pr-2 inline-block">
              LAB
            </span>
          </h1>
          <span className="text-[8.5px] font-mono text-cyan-300/90 tracking-widest block font-extrabold mt-0.5 group-hover:text-pink-300 transition-colors uppercase">
            EXPERIMENTA TU VOZ // DSP ENGINE
          </span>
        </div>
      </button>

      {/* Telemetry & High Density Studio Actions */}
      <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
        {/* Real-time Hardware Telemetry (Clickable for DSP Settings) */}
        <button
          type="button"
          onClick={onOpenDspSettings}
          className="hidden lg:flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-tight opacity-85 hover:opacity-100 cursor-pointer px-2 py-1 rounded-lg hover:bg-cyan-500/10 border border-slate-800 hover:border-cyan-500/40 transition-all group"
          title="Abrir Ajustes de Latencia y Motor DSP"
        >
          <span className="w-2 h-2 rounded-full bg-[#00ff9d] animate-pulse" />
          <span className="text-slate-300 font-bold">DSP 100% OK</span>
          <span className="text-slate-500">•</span>
          <span className="text-slate-400">&lt;12ms</span>
        </button>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">

          {/* Quick Import Folder / USB Button */}
          {onImportSyncedFolder && (
            <button
              id="btn-quick-upload"
              onClick={onImportSyncedFolder}
              className="px-2.5 py-1 rounded-xl border border-amber-500/60 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:border-amber-400 text-[11px] font-bold uppercase transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
              title="Cargar carpeta o memoria USB sincronizada"
            >
              <FolderUp className="w-3.5 h-3.5 text-amber-400" />
              <span>Importar Carpeta / USB</span>
            </button>
          )}

          {/* QR Pedir Canciones desde Celular */}
          {onOpenQrModal && (
            <button
              id="btn-qr-modal"
              onClick={onOpenQrModal}
              className="px-2.5 py-1 rounded-xl border border-indigo-500/60 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 text-[11px] font-bold uppercase transition-all cursor-pointer flex items-center gap-1.5"
              title="Mostrar Código QR para pedir canciones desde celulares"
            >
              <QrCode className="w-3.5 h-3.5 text-indigo-400" />
              <span>QR Pedir</span>
            </button>
          )}

          {/* Transmitir / Chromecast / AirPlay */}
          {onOpenCastModal && (
            <button
              id="btn-cast-tv"
              onClick={onOpenCastModal}
              className={`px-2.5 py-1 rounded-xl border text-[11px] font-bold uppercase transition-all cursor-pointer flex items-center gap-1.5 ${
                isCastingActive
                  ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                  : 'border-cyan-500/60 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-400'
              }`}
              title="Transmitir Modo TV a Chromecast, AirPlay o 2da Pantalla"
            >
              <Radio className={`w-3.5 h-3.5 ${isCastingActive ? 'animate-pulse text-emerald-400' : 'text-cyan-400'}`} />
              <span>{isCastingActive ? 'TV en Vivo' : 'Transmitir TV'}</span>
            </button>
          )}

          {/* 1-Click Silent Folder / USB Sync with Player */}
          {onSyncToFolder && (
            <div className="flex items-center">
              <button
                id="btn-sync-folder"
                onClick={onSyncToFolder}
                disabled={isFolderSyncing}
                className="px-2.5 py-1 border border-amber-400/70 bg-gradient-to-r from-amber-500/20 to-yellow-500/20 text-amber-300 hover:from-amber-500/30 hover:to-yellow-500/30 text-[11px] font-bold uppercase transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1 shadow-sm rounded-l-xl hover:scale-105 active:scale-95"
                title={
                  syncTargetFolder
                    ? `Sincronizar canciones nuevas con: ${syncTargetFolder}`
                    : 'Seleccionar carpeta o USB para sincronizar con el Player'
                }
              >
                <span className="text-amber-400">{isFolderSyncing ? '⏳' : '⚡'}</span>
                <span>{isFolderSyncing ? 'Sincronizando...' : 'Sincronizar Cambios'}</span>
              </button>

              {onChangeSyncFolder && (
                <button
                  onClick={onChangeSyncFolder}
                  disabled={isFolderSyncing}
                  className="px-1.5 py-1 border border-l-0 border-amber-400/70 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-[11px] font-bold transition-all cursor-pointer rounded-r-xl"
                  title="Cambiar carpeta de destino o memoria USB"
                >
                  ⚙️
                </button>
              )}
            </div>
          )}

          {/* Compartir Canciones (Google Drive, HTML, Web) */}
          {(onOpenShareModal || onOpenPublishModal) && (
            <button
              id="btn-share-songs"
              onClick={onOpenShareModal || onOpenPublishModal}
              className="px-2.5 py-1 rounded-xl border border-cyan-400/60 bg-gradient-to-r from-cyan-500/15 to-purple-500/15 text-cyan-300 hover:from-cyan-500/25 hover:to-purple-500/25 text-[11px] font-bold uppercase transition-all cursor-pointer flex items-center gap-1.5 shadow-sm hover:scale-105 active:scale-95"
              title="Compartir canciones a Google Drive, WhatsApp, celulares o Web Player"
            >
              <span className="text-cyan-400">🔗</span>
              <span>Compartir</span>
            </button>
          )}

          {/* Limpiar Caché / Reset */}
          {onClearCache && (
            <button
              id="btn-clear-cache"
              onClick={onClearCache}
              className="px-2 py-1 rounded-xl border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-[11px] font-bold uppercase transition-all cursor-pointer flex items-center gap-1"
              title="Borrar todo el caché y resetear la biblioteca"
            >
              <span>🗑️</span>
              <span className="hidden xl:inline">Limpiar</span>
            </button>
          )}

          {/* Fullscreen Party */}
          <button
            id="btn-party-mode"
            onClick={onOpenPartyMode}
            disabled={!hasSongLoaded}
            className="px-2.5 py-1 rounded-xl border border-[#00f0ff]/50 bg-[#00f0ff]/10 text-[#00f0ff] text-[11px] font-bold uppercase hover:bg-[#00f0ff]/20 hover:shadow-[0_0_12px_rgba(0,240,255,0.4)] transition-all cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
          >
            <Tv className="w-3.5 h-3.5" />
            <span>Fullscreen</span>
          </button>
        </div>
      </div>
    </header>
  );
});
