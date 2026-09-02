import React, { useState, useEffect } from 'react';
import { VideoBackgroundConfig, VideoBackgroundMode } from '../types';
import { VIDEO_BACKGROUND_PRESETS, extractYouTubeVideoId, searchOfficialVideo } from '../services/videoBackgroundService';
import { Film, Sparkles, Check, X, RefreshCw, Sliders, Youtube, Eye, EyeOff, Layers, ExternalLink, RotateCcw } from 'lucide-react';

interface VideoBackgroundSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: VideoBackgroundConfig;
  onChangeConfig: (newConfig: VideoBackgroundConfig) => void;
  songTitle?: string;
  songArtist?: string;
}

export const VideoBackgroundSelectorModal: React.FC<VideoBackgroundSelectorModalProps> = ({
  isOpen,
  onClose,
  config,
  onChangeConfig,
  songTitle = '',
  songArtist = '',
}) => {
  const [activeTab, setActiveTab] = useState<VideoBackgroundMode>(config.mode === 'off' ? 'auto' : config.mode);
  const [customInput, setCustomInput] = useState(config.customUrlOrId || '');
  const [customError, setCustomError] = useState<string | null>(null);
  const [isSearchingOfficial, setIsSearchingOfficial] = useState(false);
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(config.mode === 'off' ? 'auto' : config.mode);
      setCustomInput(config.customUrlOrId || (config.mode === 'custom' && config.videoId ? `https://www.youtube.com/watch?v=${config.videoId}` : ''));
      setCustomError(null);
    }
  }, [isOpen, config.mode, config.videoId, config.customUrlOrId]);

  if (!isOpen) return null;

  const handleToggleEnabled = () => {
    const nextEnabled = !config.enabled;
    onChangeConfig({
      ...config,
      enabled: nextEnabled,
      mode: nextEnabled ? (config.mode === 'off' ? 'auto' : config.mode) : 'off',
    });
  };

  const handleSelectPreset = (presetId: string, videoId: string, name: string) => {
    onChangeConfig({
      ...config,
      enabled: true,
      mode: 'preset',
      videoId,
      videoTitle: name,
      customUrlOrId: undefined,
    });
    setActiveTab('preset');
  };

  const handleApplyCustom = () => {
    setCustomError(null);
    const videoId = extractYouTubeVideoId(customInput);
    if (!videoId) {
      setCustomError('Enlace o ID de YouTube no válido. Pega un enlace tipo https://www.youtube.com/watch?v=... o youtu.be/...');
      return;
    }

    onChangeConfig({
      ...config,
      enabled: true,
      mode: 'custom',
      videoId,
      customUrlOrId: customInput.trim(),
      videoTitle: 'Video Personalizado de YouTube',
    });
    setActiveTab('custom');
    setSearchFeedback('✓ ¡Video personalizado aplicado a esta canción!');
    setTimeout(() => setSearchFeedback(null), 3000);
  };

  const handleResetToOfficial = async () => {
    setCustomInput('');
    setCustomError(null);
    if (!songTitle) {
      onChangeConfig({
        ...config,
        enabled: true,
        mode: 'auto',
        customUrlOrId: undefined,
      });
      return;
    }
    setIsSearchingOfficial(true);
    setSearchFeedback(`Restableciendo y buscando video oficial de "${songTitle}"...`);
    try {
      const res = await searchOfficialVideo(songTitle, songArtist);
      if (res && res.videoId) {
        onChangeConfig({
          ...config,
          enabled: true,
          mode: 'auto',
          videoId: res.videoId,
          videoTitle: res.title,
          customUrlOrId: undefined,
        });
        setActiveTab('auto');
        setSearchFeedback(`✓ Restablecido al video oficial de YouTube: "${res.title}"`);
      } else {
        onChangeConfig({
          ...config,
          enabled: true,
          mode: 'preset',
          videoId: 'qC0vDKVPCrw',
          videoTitle: 'Cyberpunk Neon City (Loop)',
          customUrlOrId: undefined,
        });
        setActiveTab('auto');
        setSearchFeedback('✓ Link personalizado reseteado para esta canción.');
      }
    } catch (_) {
      setSearchFeedback('Error al restablecer.');
    } finally {
      setIsSearchingOfficial(false);
      setTimeout(() => setSearchFeedback(null), 4000);
    }
  };

  const handleSearchAutoOfficial = async () => {
    if (!songTitle) {
      setSearchFeedback('No hay ninguna canción activa seleccionada.');
      return;
    }
    setIsSearchingOfficial(true);
    setSearchFeedback(`Buscando video oficial de "${songTitle}"...`);
    try {
      const res = await searchOfficialVideo(songTitle, songArtist);
      if (res && res.videoId) {
        onChangeConfig({
          ...config,
          enabled: true,
          mode: 'auto',
          videoId: res.videoId,
          videoTitle: res.title,
          customUrlOrId: undefined,
        });
        setActiveTab('auto');
        setSearchFeedback(`✓ Video oficial encontrado: "${res.title}"`);
      } else {
        setSearchFeedback('No se encontró video oficial. Usando fondo Cyberpunk de alta definición.');
      }
    } catch (_) {
      setSearchFeedback('Error al buscar en YouTube.');
    } finally {
      setIsSearchingOfficial(false);
      setTimeout(() => setSearchFeedback(null), 4000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-2xl bg-slate-950/95 border border-cyan-500/30 rounded-2xl shadow-[0_0_50px_rgba(0,240,255,0.15)] flex flex-col overflow-hidden text-white font-sans max-h-[90vh]">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800/80 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-fuchsia-500 flex items-center justify-center shadow-[0_0_15px_rgba(0,240,255,0.4)]">
              <Film className="w-5 h-5 text-slate-950 font-black" />
            </div>
            <div>
              <h2 className="text-base font-black tracking-wide bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-white to-fuchsia-400 uppercase">
                Modo Video de Fondo Dinámico
              </h2>
              <p className="text-[11px] font-mono text-slate-400">
                Videos oficiales de YouTube & fondos Cyberpunk sincronizados en bucle
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Main Toggle Button */}
            <button
              type="button"
              onClick={handleToggleEnabled}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                config.enabled && config.mode !== 'off'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {config.enabled && config.mode !== 'off' ? (
                <>
                  <Eye className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Activo</span>
                </>
              ) : (
                <>
                  <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                  <span>Desactivado</span>
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800/80 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        {searchFeedback && (
          <div className="px-5 py-2 bg-indigo-950/80 border-b border-indigo-800/60 text-indigo-200 text-xs font-mono flex items-center justify-between">
            <span>{searchFeedback}</span>
            <button onClick={() => setSearchFeedback(null)} className="text-slate-400 hover:text-white">✕</button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 px-5 pt-3 border-b border-slate-800/60 bg-slate-900/40 text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setActiveTab('auto');
              onChangeConfig({ ...config, enabled: true, mode: 'auto' });
            }}
            className={`pb-2.5 px-3 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'auto'
                ? 'border-cyan-400 text-cyan-300 shadow-sm'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>🤖 Automático (Video Oficial)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('preset')}
            className={`pb-2.5 px-3 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'preset'
                ? 'border-fuchsia-400 text-fuchsia-300 shadow-sm'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-fuchsia-400" />
            <span>🌆 Fondos Neón / Loop (6)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('custom')}
            className={`pb-2.5 px-3 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'custom'
                ? 'border-amber-400 text-amber-300 shadow-sm'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Youtube className="w-3.5 h-3.5 text-red-500" />
            <span>🔗 YouTube Personalizado</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          
          {/* TAB 1: AUTO (OFFICIAL MUSIC VIDEO) */}
          {activeTab === 'auto' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-950/40 via-slate-900 to-slate-950 border border-cyan-500/20 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>Video Musical Oficial Inteligente</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                        Auto-Sync
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Busca y reproduce en bucle y silenciado el videoclip oficial de YouTube para {songTitle ? `"${songTitle}"` : 'la canción actual'}.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleSearchAutoOfficial}
                    disabled={isSearchingOfficial || !songTitle}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer transition-all flex items-center gap-1.5 shadow-md active:scale-95 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSearchingOfficial ? 'animate-spin' : ''}`} />
                    <span>{isSearchingOfficial ? 'Buscando...' : 'Re-buscar Video'}</span>
                  </button>
                </div>

                {config.videoId && (
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-black/60 border border-slate-800">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="relative group shrink-0">
                        <img
                          src={`https://i.ytimg.com/vi/${config.videoId}/hqdefault.jpg`}
                          alt="Thumbnail"
                          className="w-24 h-14 object-cover rounded-lg border border-slate-700 shadow-md"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://i.ytimg.com/vi/${config.videoId}/mqdefault.jpg`;
                          }}
                        />
                      </div>
                      <div className="flex flex-col min-w-0 gap-0.5">
                        <span className="text-xs font-bold text-white truncate">
                          {config.videoTitle || (songArtist ? `${songArtist} - ${songTitle}` : songTitle)}
                        </span>
                        <a
                          href={`https://www.youtube.com/watch?v=${config.videoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1 hover:underline truncate"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          <span className="truncate">https://www.youtube.com/watch?v={config.videoId}</span>
                        </a>
                        <span className="text-[10px] font-mono text-slate-400">
                          Reproductor Mute & Loop Activo
                        </span>
                      </div>
                    </div>

                    <span className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                      <span>💾</span>
                      <span>Guardado</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: PRESET LOOPS */}
          {activeTab === 'preset' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400 font-mono">
                Selecciona una atmósfera animada en bucle continuo de alta definición:
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {VIDEO_BACKGROUND_PRESETS.map((preset) => {
                  const isSelected = config.mode === 'preset' && config.videoId === preset.videoId;
                  return (
                    <div
                      key={preset.id}
                      onClick={() => handleSelectPreset(preset.id, preset.videoId, preset.name)}
                      className={`group relative rounded-xl border p-2 flex flex-col gap-1.5 cursor-pointer transition-all overflow-hidden ${
                        isSelected
                          ? 'border-fuchsia-400 bg-fuchsia-950/30 shadow-[0_0_20px_rgba(217,70,239,0.3)] scale-[1.02]'
                          : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
                      }`}
                    >
                      <div className="relative aspect-video rounded-lg overflow-hidden border border-slate-800">
                        <img
                          src={`https://i.ytimg.com/vi/${preset.videoId}/hqdefault.jpg`}
                          alt={preset.name}
                          className="w-full h-full object-cover transition-transform group-hover:scale-110"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = preset.thumbnail;
                          }}
                        />
                        {isSelected && (
                          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-fuchsia-500 text-white flex items-center justify-center shadow-md">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        )}
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-black/70 text-fuchsia-300">
                          {preset.category}
                        </span>
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold text-white truncate">{preset.name}</span>
                        <span className="text-[10px] text-slate-400 truncate">{preset.tag}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: CUSTOM YOUTUBE URL */}
          {activeTab === 'custom' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <label className="block text-xs font-bold text-slate-300">
                  Pega cualquier enlace o ID de Video de YouTube:
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Youtube className="w-4 h-4 text-red-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={customInput}
                      onChange={(e) => {
                        setCustomInput(e.target.value);
                        setCustomError(null);
                      }}
                      placeholder="https://www.youtube.com/watch?v=... o ID (ej: dQw4w9WgXcQ)"
                      className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-400 font-mono"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleApplyCustom}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg cursor-pointer transition-all shadow-md active:scale-95 shrink-0"
                  >
                    Aplicar
                  </button>
                </div>

                {customError && (
                  <p className="text-xs text-red-400 font-medium">{customError}</p>
                )}

                {config.mode === 'custom' && config.videoId && (
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-black/60 border border-slate-800 mt-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={`https://i.ytimg.com/vi/${config.videoId}/hqdefault.jpg`}
                        alt="Thumbnail"
                        className="w-20 h-12 object-cover rounded-md border border-slate-700 shrink-0"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold text-white">Video Personalizado Asignado</span>
                        <a
                          href={`https://www.youtube.com/watch?v=${config.videoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-cyan-400 hover:underline font-mono truncate"
                        >
                          https://www.youtube.com/watch?v={config.videoId}
                        </a>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleResetToOfficial}
                      disabled={isSearchingOfficial}
                      className="px-3 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-800/60 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all shrink-0 disabled:opacity-50"
                      title="Quitar video personalizado y buscar video oficial"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${isSearchingOfficial ? 'animate-spin' : ''}`} />
                      <span>Restablecer Oficial</span>
                    </button>
                  </div>
                )}

                {/* Reset button to clear custom link and restore official video */}
                <div className="pt-2 flex items-center justify-between border-t border-slate-800/80">
                  <span className="text-[11px] text-slate-400">
                    ¿Deseas quitar el enlace personalizado de esta canción?
                  </span>
                  <button
                    type="button"
                    onClick={handleResetToOfficial}
                    disabled={isSearchingOfficial}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all disabled:opacity-50"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${isSearchingOfficial ? 'animate-spin' : ''}`} />
                    <span>Restablecer Video Oficial</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* CONTRAST & OVERLAY SLIDERS (Essential for 100% Lyrics Readability) */}
          <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>Ajustes de Contraste y Legibilidad de Letra</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Opacity slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400 font-medium">Filtro Oscuro de Contraste</span>
                  <span className="font-mono font-bold text-cyan-300">
                    {Math.round((config.overlayOpacity ?? 0.70) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.20"
                  max="0.95"
                  step="0.05"
                  value={config.overlayOpacity ?? 0.70}
                  onChange={(e) => onChangeConfig({ ...config, overlayOpacity: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
                <span className="text-[10px] text-slate-500 block">
                  Mayor porcentaje = letras más nítidas y legibles.
                </span>
              </div>

              {/* Blur slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400 font-medium">Desenfoque Suave (Blur)</span>
                  <span className="font-mono font-bold text-fuchsia-300">
                    {config.blurAmount ?? 1}px
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="6"
                  step="1"
                  value={config.blurAmount ?? 1}
                  onChange={(e) => onChangeConfig({ ...config, blurAmount: parseInt(e.target.value, 10) })}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-fuchsia-400"
                />
                <span className="text-[10px] text-slate-500 block">
                  Añade profundidad cinematográfica al fondo.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800/80 bg-slate-900/60 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <div className={`w-2 h-2 rounded-full ${config.enabled && config.mode !== 'off' ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}`} />
            <span>{config.enabled && config.mode !== 'off' ? `Video Activo (${config.mode.toUpperCase()})` : 'Fondo Clásico (Sin video)'}</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer transition-all shadow-md active:scale-95"
          >
            Listo / Aplicar
          </button>
        </div>

      </div>
    </div>
  );
};
