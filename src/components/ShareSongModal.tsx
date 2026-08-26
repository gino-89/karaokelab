import React, { useState, useMemo, useEffect } from 'react';
import { SongItem, LyricLine, SingerProfile } from '../types';
import {
  buildWebPlayerPackage,
  downloadOrSaveKlabFile,
  generateStandaloneHTMLPlayer,
  WebPlayerPublishOptions,
} from '../services/webPlayerSyncService';
import { syncSongsToFolder, chooseSyncFolder, getSavedSyncFolderPath } from '../services/folderSyncService';
import {
  Share2,
  Package,
  Code,
  CheckCircle,
  Copy,
  X,
  Loader2,
  Cloud,
  Check,
  Search,
  ExternalLink,
  MessageCircle,
} from 'lucide-react';

interface ShareSongModalProps {
  isOpen: boolean;
  onClose: () => void;
  savedSongs?: SongItem[];
  currentSong?: SongItem | null;
  currentLyrics?: LyricLine[];
  profiles?: SingerProfile[];
  syncTargetFolder?: string;
}

type ShareScope = 'current' | 'selected' | 'all';
type ShareTab = 'drive' | 'html' | 'klab' | 'link';

export function ShareSongModal({
  isOpen,
  onClose,
  savedSongs = [],
  currentSong = null,
  currentLyrics = [],
  profiles = [],
  syncTargetFolder = '',
}: ShareSongModalProps) {
  const [scope, setScope] = useState<ShareScope>(currentSong ? 'current' : 'all');
  const [activeTab, setActiveTab] = useState<ShareTab>('drive');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    return currentSong ? new Set([currentSong.id]) : new Set((savedSongs || []).map((s) => s.id));
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [driveFolder, setDriveFolder] = useState<string>(() => syncTargetFolder || getSavedSyncFolderPath());

  const [includeInstrumental, setIncludeInstrumental] = useState(true);
  const [includeVocals, setIncludeVocals] = useState(true);
  const [includeWordSync, setIncludeWordSync] = useState(true);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progressStep, setProgressStep] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Sync state whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setScope(currentSong ? 'current' : 'all');
      setSelectedIds(currentSong ? new Set([currentSong.id]) : new Set((savedSongs || []).map((s) => s.id)));
      setSuccessMessage(null);
      setProgressStep('');
      setDriveFolder(syncTargetFolder || getSavedSyncFolderPath());
    }
  }, [isOpen, currentSong, savedSongs, syncTargetFolder]);

  // Target songs calculation with complete null safety
  const targetSongs: SongItem[] = useMemo(() => {
    const list = savedSongs || [];
    if (scope === 'current') {
      return currentSong ? [currentSong] : (list.length > 0 ? [list[0]] : []);
    }
    if (scope === 'all') {
      return list;
    }
    return list.filter((s) => s && selectedIds.has(s.id));
  }, [scope, currentSong, savedSongs, selectedIds]);

  const filteredLibrary = useMemo(() => {
    const list = savedSongs || [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(
      (s) => (s?.title || '').toLowerCase().includes(q) || (s?.artist || '').toLowerCase().includes(q)
    );
  }, [savedSongs, searchQuery]);

  const toggleSelectSong = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filteredLibrary.map((s) => s.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // 1. Google Drive / Cloud Folder Sync
  const handleSyncToDrive = async () => {
    if (targetSongs.length === 0) {
      alert('Selecciona al menos una canción para compartir.');
      return;
    }

    let folder = driveFolder;
    if (!folder) {
      folder = (await chooseSyncFolder()) || '';
      if (!folder) return;
      setDriveFolder(folder);
    }

    setIsProcessing(true);
    setProgressStep(`Sincronizando ${targetSongs.length} canciones con Google Drive / Nube...`);
    try {
      const res = await syncSongsToFolder(targetSongs, profiles || [], (_p, msg) => {
        setProgressStep(msg);
      }, folder);

      setSuccessMessage(
        `✓ ¡Compartido en Drive! ${res.syncedCount > 0 ? res.syncedCount + ' canciones sincronizadas' : 'Canciones ya al día'} en: ${folder.split(/[/\\]/).pop() || folder}`
      );
    } catch (err: any) {
      alert(`Error al compartir con Drive: ${err?.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenInFinder = async () => {
    if (!driveFolder) return;
    try {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__?.invoke) {
        await (window as any).__TAURI_INTERNALS__.invoke('open_folder_in_finder', { folderPath: driveFolder });
      } else {
        alert(`Carpeta ubicada en: ${driveFolder}`);
      }
    } catch {
      alert(`Carpeta ubicada en: ${driveFolder}`);
    }
  };

  const handleChangeDriveFolder = async () => {
    const selected = await chooseSyncFolder();
    if (selected) {
      setDriveFolder(selected);
      setSuccessMessage(`✓ Carpeta de destino asignada a: ${selected.split(/[/\\]/).pop() || selected}`);
    }
  };

  // 2. Export Standalone HTML Player
  const handleExportHTML = async () => {
    if (targetSongs.length === 0) {
      alert('Selecciona al menos una canción.');
      return;
    }

    setIsProcessing(true);
    setProgressStep('Generando Reproductor Web HTML Autónomo...');
    try {
      const primarySong = targetSongs[0];
      const songLyrics = primarySong.id === currentSong?.id && (currentLyrics || []).length > 0
        ? currentLyrics
        : (primarySong.lyrics || []);

      const options: WebPlayerPublishOptions = {
        includeInstrumental,
        includeVocals,
        includeWordSync,
        audioQuality: 'wav',
      };

      const pkg = await buildWebPlayerPackage(primarySong, songLyrics, options);
      const htmlContent = generateStandaloneHTMLPlayer(pkg);

      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (primarySong.title || 'KaraokeLab').replace(/[/\\?%*:|"<>]/g, '_').trim();
      a.download = targetSongs.length === 1
        ? `${safeName}_KaraokePlayer.html`
        : `KaraokeLab_Collection_${targetSongs.length}_songs.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccessMessage(`✓ ¡Reproductor HTML generado! Listo para enviar por WhatsApp o correo.`);
    } catch (err: any) {
      alert(`Error al generar HTML: ${err?.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 3. Export .klab Package
  const handleExportKlab = async () => {
    if (targetSongs.length === 0) {
      alert('Selecciona al menos una canción.');
      return;
    }

    setIsProcessing(true);
    setProgressStep('Empaquetando archivo .klab portable...');
    try {
      const primarySong = targetSongs[0];
      const songLyrics = primarySong.id === currentSong?.id && (currentLyrics || []).length > 0
        ? currentLyrics
        : (primarySong.lyrics || []);

      const options: WebPlayerPublishOptions = {
        includeInstrumental,
        includeVocals,
        includeWordSync,
        audioQuality: 'wav',
      };

      const pkg = await buildWebPlayerPackage(primarySong, songLyrics, options);
      const result = await downloadOrSaveKlabFile(pkg);
      if (result.success) {
        setSuccessMessage('✓ ¡Paquete .klab descargado! Listo para abrir en el Web Player.');
      }
    } catch (err: any) {
      alert(`Error al exportar .klab: ${err?.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 4. Copy Web Link / WhatsApp Message
  const handleCopyLink = async () => {
    if (targetSongs.length === 0) return;
    const songListText = targetSongs.slice(0, 5).map((s) => `• ${s.title || 'Canción'}${s.artist ? ' - ' + s.artist : ''}`).join('\n');
    const extraCount = targetSongs.length > 5 ? `\n... y ${targetSongs.length - 5} canciones más` : '';
    const shareText = `🎤 ¡Canta en KaraokeLab!\nCanciones disponibles:\n${songListText}${extraCount}\n\n🌐 Abre tu reproductor aquí: ${window.location.origin}`;

    await navigator.clipboard.writeText(shareText);
    setCopiedLink(true);
    setSuccessMessage('✓ ¡Mensaje y enlace copiado al portapapeles!');
    setTimeout(() => setCopiedLink(false), 4000);
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200 pointer-events-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="bg-[#0c0d19] border border-cyan-500/40 rounded-3xl w-full max-w-2xl shadow-[0_0_60px_rgba(0,240,255,0.25)] overflow-hidden text-slate-100 flex flex-col max-h-[90vh] relative z-10"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-900/90 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 shadow-[0_0_15px_rgba(0,240,255,0.3)]">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white flex items-center gap-2">
                COMPARTIR CANCIONES
              </h2>
              <p className="text-xs text-slate-400">
                Comparte a Google Drive, WhatsApp, celulares o al Web Player
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 custom-scrollbar">

          {/* ── 1. SELECTOR DE ALCANCE (¿Qué compartir?) ── */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
              1. Selecciona qué canciones compartir
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setScope('current')}
                disabled={!currentSong}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex flex-col items-center gap-1 ${
                  scope === 'current'
                    ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_rgba(0,240,255,0.3)]'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-white hover:border-slate-700 disabled:opacity-40'
                }`}
              >
                <span>🎵 Canción Actual</span>
                <span className="text-[10px] font-normal truncate max-w-[120px]">
                  {currentSong ? currentSong.title : 'Ninguna'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setScope('selected')}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex flex-col items-center gap-1 ${
                  scope === 'selected'
                    ? 'border-purple-400 bg-purple-500/20 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.3)]'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <span>☑️ Selección Personalizada</span>
                <span className="text-[10px] font-normal">
                  {selectedIds.size} seleccionadas
                </span>
              </button>

              <button
                type="button"
                onClick={() => setScope('all')}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex flex-col items-center gap-1 ${
                  scope === 'all'
                    ? 'border-amber-400 bg-amber-500/20 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <span>📚 Toda la Biblioteca</span>
                <span className="text-[10px] font-normal">
                  {(savedSongs || []).length} canciones
                </span>
              </button>
            </div>
          </div>

          {/* ── LISTA DE SELECCIÓN CON CHECKBOXES (Si scope === 'selected') ── */}
          {scope === 'selected' && (
            <div className="p-3 bg-slate-900/80 border border-purple-500/30 rounded-2xl space-y-2 animate-in fade-in">
              <div className="flex items-center justify-between gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filtrar por título o artista..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-400"
                  />
                </div>
                <div className="flex items-center gap-1 text-[10px] font-bold">
                  <button
                    onClick={selectAllFiltered}
                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-purple-300 cursor-pointer"
                  >
                    Marcar Todo
                  </button>
                  <button
                    onClick={clearSelection}
                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-400 cursor-pointer"
                  >
                    Limpiar
                  </button>
                </div>
              </div>

              <div className="max-h-40 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                {filteredLibrary.length === 0 ? (
                  <div className="py-4 text-center text-xs text-slate-500">
                    No se encontraron canciones en la biblioteca.
                  </div>
                ) : (
                  filteredLibrary.map((s) => {
                    const isChecked = selectedIds.has(s.id);
                    return (
                      <label
                        key={s.id}
                        className={`flex items-center justify-between px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                          isChecked
                            ? 'bg-purple-950/30 border-purple-500/40 text-purple-200'
                            : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                        }`}
                      >
                        <span className="font-medium truncate max-w-[340px]">
                          {s.title || 'Sin Título'} {s.artist ? `• ${s.artist}` : ''}
                        </span>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectSong(s.id)}
                          className="w-4 h-4 rounded accent-purple-500 cursor-pointer"
                        />
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* ── 2. PESTAÑAS DE VÍAS DE COMPARTIR ── */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
              2. Elige el método de compartir
            </label>
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800">
              <button
                onClick={() => setActiveTab('drive')}
                className={`py-2 px-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  activeTab === 'drive'
                    ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-lg'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Cloud className="w-3.5 h-3.5" />
                <span className="truncate">Google Drive</span>
              </button>

              <button
                onClick={() => setActiveTab('html')}
                className={`py-2 px-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  activeTab === 'html'
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Code className="w-3.5 h-3.5" />
                <span className="truncate">Web HTML</span>
              </button>

              <button
                onClick={() => setActiveTab('klab')}
                className={`py-2 px-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  activeTab === 'klab'
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                <span className="truncate">Paquete .klab</span>
              </button>

              <button
                onClick={() => setActiveTab('link')}
                className={`py-2 px-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  activeTab === 'link'
                    ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-lg'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span className="truncate">Enlace / Chat</span>
              </button>
            </div>
          </div>

          {/* ── 3. CONTENIDO SEGÚN LA PESTAÑA ACTIVA ── */}
          {activeTab === 'drive' && (
            <div className="p-4 rounded-2xl bg-blue-950/20 border border-blue-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cloud className="w-5 h-5 text-blue-400" />
                  <div>
                    <h4 className="text-sm font-bold text-white">Google Drive / Nube Sincronizada</h4>
                    <p className="text-xs text-blue-300/80">
                      Copia las canciones a tu carpeta en la nube para compartir enlaces
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleChangeDriveFolder}
                  className="px-2.5 py-1 text-[11px] font-bold bg-blue-900/40 hover:bg-blue-800/60 border border-blue-500/40 text-blue-300 rounded-lg cursor-pointer"
                >
                  Cambiar Carpeta ⚙️
                </button>
              </div>

              <div className="p-2.5 bg-slate-950/80 rounded-xl border border-slate-800 text-xs text-slate-300 flex items-center justify-between">
                <span className="truncate max-w-[380px]">
                  📁 {driveFolder || 'No hay carpeta asignada. Haz clic en sincronizar para elegirla.'}
                </span>
                {driveFolder && (
                  <button
                    onClick={handleOpenInFinder}
                    className="text-blue-400 hover:text-blue-200 font-bold ml-2 shrink-0 cursor-pointer flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Abrir Finder
                  </button>
                )}
              </div>

              <button
                onClick={handleSyncToDrive}
                disabled={isProcessing || targetSongs.length === 0}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:brightness-110 text-white font-bold text-xs uppercase tracking-widest shadow-[0_0_25px_rgba(37,99,235,0.4)] transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Cloud className="w-4 h-4" />
                <span>Sincronizar {targetSongs.length} Canciones a Google Drive</span>
              </button>
            </div>
          )}

          {activeTab === 'html' && (
            <div className="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-500/30 space-y-3">
              <div className="flex items-center gap-2">
                <Code className="w-5 h-5 text-emerald-400" />
                <div>
                  <h4 className="text-sm font-bold text-white">Reproductor Web HTML Autónomo</h4>
                  <p className="text-xs text-emerald-300/80">
                    Genera un archivo .html con el reproductor y las pistas dentro. Se puede abrir en cualquier celular o PC sin internet.
                  </p>
                </div>
              </div>

              <button
                onClick={handleExportHTML}
                disabled={isProcessing || targetSongs.length === 0}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:brightness-110 text-white font-bold text-xs uppercase tracking-widest shadow-[0_0_25px_rgba(16,185,129,0.4)] transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Code className="w-4 h-4" />
                <span>Descargar Reproductor HTML ({targetSongs.length} Canciones)</span>
              </button>
            </div>
          )}

          {activeTab === 'klab' && (
            <div className="p-4 rounded-2xl bg-purple-950/20 border border-purple-500/30 space-y-3">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-purple-400" />
                <div>
                  <h4 className="text-sm font-bold text-white">Paquete Portable .klab</h4>
                  <p className="text-xs text-purple-300/80">
                    Archivo de karaoke listo para arrastrar y cantar en el KaraokeLab Web Player.
                  </p>
                </div>
              </div>

              <button
                onClick={handleExportKlab}
                disabled={isProcessing || targetSongs.length === 0}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:brightness-110 text-white font-bold text-xs uppercase tracking-widest shadow-[0_0_25px_rgba(168,85,247,0.4)] transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Package className="w-4 h-4" />
                <span>Exportar Paquete .klab ({targetSongs.length} Canciones)</span>
              </button>
            </div>
          )}

          {activeTab === 'link' && (
            <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-500/30 space-y-3">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-amber-400" />
                <div>
                  <h4 className="text-sm font-bold text-white">Copiar Enlace / Mensaje de WhatsApp</h4>
                  <p className="text-xs text-amber-300/80">
                    Copia el listado formateado de las canciones seleccionadas para enviarlo por chat.
                  </p>
                </div>
              </div>

              <button
                onClick={handleCopyLink}
                disabled={isProcessing || targetSongs.length === 0}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:brightness-110 text-white font-bold text-xs uppercase tracking-widest shadow-[0_0_25px_rgba(245,158,11,0.4)] transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedLink ? '¡Copiado al Portapapeles!' : 'Copiar Texto y Enlace para WhatsApp'}</span>
              </button>
            </div>
          )}

          {/* Feedback & Progress Section */}
          {isProcessing && (
            <div className="p-3.5 rounded-xl bg-cyan-950/60 border border-cyan-500/40 flex items-center gap-3 text-cyan-200 text-xs font-bold animate-in fade-in">
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
              <span>{progressStep}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3.5 rounded-xl bg-emerald-950/70 border border-emerald-500/50 flex items-center gap-3 text-emerald-200 text-xs font-bold animate-in fade-in">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-900/90 flex justify-between items-center shrink-0">
          <span className="text-[11px] text-slate-400">
            {targetSongs.length} {targetSongs.length === 1 ? 'canción lista' : 'canciones listas'} para compartir
          </span>
          <button
            onClick={onClose}
            className="px-5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer"
          >
            Cerrar
          </button>
        </div>

      </div>
    </div>
  );
}
