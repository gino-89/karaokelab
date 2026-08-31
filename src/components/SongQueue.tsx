import React from 'react';
import { QueueItem, SongItem } from '../types';
import { Layers, Play, Pause, Loader2, CheckCircle2, AlertCircle, Music2, X, Volume2, Square, Trash2 } from 'lucide-react';

interface SongQueueProps {
  queue: QueueItem[];
  currentSong?: SongItem | null;
  currentSongId?: string;
  isPlaying?: boolean;
  onSelectSong: (song: SongItem) => void;
  onTogglePlay?: () => void;
  onStop?: () => void;
  onRemoveFromQueue?: (id: string) => void;
}

export const SongQueue: React.FC<SongQueueProps> = React.memo(({
  queue,
  currentSong,
  currentSongId,
  isPlaying,
  onSelectSong,
  onTogglePlay,
  onStop,
  onRemoveFromQueue,
}) => {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const activeCount = queue.filter((q) => q.status !== 'ready' && q.status !== 'error').length;
  const activeSongId = currentSong?.id || currentSongId;

  return (
    <div className="bg-[#0c0e17] border border-slate-700/70 rounded-2xl overflow-hidden flex flex-col shadow-lg">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#00ff9d]" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-white">
            Cola de Reproducción
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          {activeCount > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/40 animate-pulse">
              <Loader2 className="w-3 h-3 animate-spin" />
              Procesando {activeCount}
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-800 text-slate-400 border border-slate-700">
            {queue.length} {queue.length === 1 ? 'en espera' : 'en espera'}
          </span>
        </div>
      </div>

      {/* ── Active Now Playing Card (● SONANDO) ── */}
      {currentSong && (
        <div className="bg-gradient-to-r from-emerald-950/60 via-slate-900/80 to-[#0c0e17] border-b border-[#00ff9d]/30 p-3 flex items-center justify-between gap-2.5 shadow-inner">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => onTogglePlay && onTogglePlay()}
              style={{ touchAction: 'manipulation' }}
              className="w-8 h-8 rounded-full bg-[#00ff9d]/20 border border-[#00ff9d] flex items-center justify-center text-[#00ff9d] cursor-pointer hover:scale-105 transition-transform shrink-0 shadow-[0_0_10px_rgba(0,255,157,0.3)] active:scale-90"
              title={isPlaying ? 'Pausar canción' : 'Reanudar canción'}
            >
              {isPlaying ? (
                <Volume2 className="w-4 h-4 animate-pulse" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>

            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-bold text-white truncate max-w-full">
                  {currentSong.title}
                </span>
                <span className="flex items-center gap-1 text-[8px] font-mono font-black text-[#00ff9d] bg-[#00ff9d]/20 px-1.5 py-0.5 rounded border border-[#00ff9d]/40 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00ff9d] animate-ping" />
                  {isPlaying ? '● SONANDO' : 'EN PAUSA'}
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-300 truncate">
                {currentSong.artist || 'KaraokeLab'} · <span className="text-slate-400">{fmt(currentSong.duration)}</span> · <span className="text-[#00f0ff] font-bold">{currentSong.bpm} BPM</span> · <span className="text-amber-300 font-bold">{currentSong.key}</span>
              </span>
            </div>
          </div>

          {/* Quick Play/Pause and Stop Controls */}
          <div className="flex items-center gap-1 shrink-0">
            {onTogglePlay && (
              <button
                type="button"
                onClick={onTogglePlay}
                style={{ touchAction: 'manipulation' }}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[#00ff9d] border border-slate-700 cursor-pointer transition-colors active:scale-90"
                title={isPlaying ? 'Pausar' : 'Reproducir'}
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              </button>
            )}
            {onStop && (
              <button
                type="button"
                onClick={onStop}
                style={{ touchAction: 'manipulation' }}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-800/60 cursor-pointer transition-colors active:scale-90"
                title="Detener y quitar del player"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Queue Items List (Upcoming Tracks) */}
      <div className="flex flex-col max-h-72 overflow-y-auto divide-y divide-slate-850">
        {(() => {
          const upcomingQueue = queue.filter(
            (item) =>
              !currentSong ||
              (item.songData?.id !== currentSong.id &&
                item.id !== currentSong.id &&
                (!currentSong.id.startsWith('yt_') || item.songData?.id !== `yt_${currentSong.id.replace('yt_', '')}`))
          );

          if (upcomingQueue.length === 0) {
            return (
              <div className="flex flex-col items-center justify-center py-6 text-slate-500 font-mono text-[11px] gap-1 px-4 text-center">
                <Music2 className="w-4 h-4 opacity-40" />
                <span className="font-semibold text-slate-400">
                  {currentSong ? 'Sin más canciones en espera' : 'Sin pistas en la cola'}
                </span>
                <span className="text-[10px] text-slate-600">
                  Usa el botón "+ Cola" en cualquier canción para agregarla a la lista de espera
                </span>
              </div>
            );
          }

          return upcomingQueue.map((item) => {
            const isReady = item.status === 'ready';
            const isError = item.status === 'error';
            const isProcessing = !isReady && !isError;

            return (
              <div
                key={item.id}
                onClick={() => {
                  if (item.songData && isReady) {
                    onSelectSong(item.songData);
                  }
                }}
                className="flex items-center gap-2 px-3 py-2.5 transition-colors group cursor-pointer hover:bg-slate-800/40"
              >
                <div className="shrink-0">
                  {isReady ? (
                    <CheckCircle2 className="w-4 h-4 text-[#00ff9d]" />
                  ) : isError ? (
                    <AlertCircle className="w-4 h-4 text-[#ff007f]" />
                  ) : (
                    <Loader2 className="w-4 h-4 text-[#00f0ff] animate-spin" />
                  )}
                </div>

                <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-semibold truncate text-white">
                      {item.fileName}
                    </span>
                    {item.requestedBy && (
                      <span
                        className="inline-flex items-center gap-1 text-[9px] font-bold text-cyan-300 bg-cyan-950/80 px-1.5 py-0.5 rounded-full border border-cyan-500/40 shrink-0 shadow-sm"
                        title={`Canción pedida por ${item.requestedBy}`}
                      >
                        <span className="text-[10px]">🎤</span>
                        <span>{item.requestedBy}</span>
                      </span>
                    )}
                  </div>

                  {isProcessing && item.currentStep && (
                    <span className="text-[9px] font-mono text-[#00f0ff] truncate">{item.currentStep}</span>
                  )}
                  {isReady && item.songData && (
                    <span className="text-[9px] font-mono text-slate-400 flex items-center gap-1 flex-wrap">
                      <span>{fmt(item.songData.duration)} · <span className="text-[#00f0ff]">{item.songData.bpm} BPM</span> · {item.songData.key}</span>
                      {item.requestedBy && (
                        <span className="text-cyan-400 font-bold">· Pedido por: {item.requestedBy}</span>
                      )}
                    </span>
                  )}
                  {isError && (
                    <span className="text-[9px] font-mono text-[#ff007f]">{item.errorMsg || 'Error al procesar'}</span>
                  )}
                  {isProcessing && (
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                      <div
                        className="h-full bg-gradient-to-r from-[#00f0ff] to-[#ff007f] transition-all duration-300"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {isReady && item.songData ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSong(item.songData!);
                      }}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-[#00ff9d]/20 text-slate-400 hover:text-[#00ff9d] border border-slate-700 hover:border-[#00ff9d]/40 cursor-pointer transition-all"
                      title="Reproducir ahora"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </button>
                  ) : null}

                  {onRemoveFromQueue && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveFromQueue(item.id);
                      }}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-500 hover:text-rose-400 border border-slate-700 hover:border-rose-800/40 cursor-pointer transition-colors"
                      title="Quitar de la cola"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
});
