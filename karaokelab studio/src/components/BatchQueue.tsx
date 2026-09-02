import React, { useRef, useState } from 'react';
import { QueueItem, SongItem } from '../types';
import { UploadCloud, Play, Trash2, Loader2, CheckCircle2, AlertCircle, Music2, Database, Layers } from 'lucide-react';

interface BatchQueueProps {
  queue: QueueItem[];
  savedSongs: SongItem[];
  currentSongId?: string;
  onFilesSelected: (files: FileList | File[]) => void;
  onSelectSong: (song: SongItem) => void;
  onDeleteSong: (id: string) => void;
  onStartVideoExport: () => void;
  onStopVideoExport: () => void;
  onOpenVideoStudio?: () => void;
  onDownloadStem?: (song: SongItem, type: 'instrumental' | 'vocals') => void;
  isExportingVideo: boolean;
  exportProgress: number;
}

export const BatchQueue: React.FC<BatchQueueProps> = ({
  queue,
  savedSongs,
  currentSongId,
  onFilesSelected,
  onSelectSong,
  onDeleteSong,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeTab, setActiveTab] = useState<'queue' | 'library'>('queue');
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) onFilesSelected(e.dataTransfer.files);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  const processing = queue.filter((q) => q.status !== 'ready' && q.status !== 'error');
  const hasActive = processing.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Upload Hero ──────────────────────────────── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-300 overflow-hidden ${
          dragOver
            ? 'border-[#00f0ff] bg-[#00f0ff]/15 shadow-[0_0_30px_rgba(0,240,255,0.4)]'
            : hasActive
            ? 'border-[#00f0ff]/50 bg-[#00f0ff]/5 animate-pulse'
            : 'border-white/15 bg-white/3 hover:border-[#00f0ff]/50 hover:bg-[#00f0ff]/5'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.lrc"
          onChange={(e) => e.target.files?.length && onFilesSelected(e.target.files)}
          className="hidden"
        />
        <div className="flex flex-col items-center gap-2 py-5 px-4 text-center">
          {hasActive ? (
            <>
              <Loader2 className="w-6 h-6 text-[#00f0ff] animate-spin" />
              <span className="text-xs font-bold uppercase tracking-widest text-[#00f0ff]">
                Procesando {processing.length} pista{processing.length > 1 ? 's' : ''}...
              </span>
              <span className="text-[10px] font-mono-code text-[#00ff9d]">
                {processing[0]?.currentStep || 'Analizando audio...'}
              </span>
            </>
          ) : (
            <>
              <UploadCloud className={`w-7 h-7 transition-colors ${dragOver ? 'text-[#00f0ff]' : 'text-white/40'}`} />
              <span className="text-xs font-bold uppercase tracking-widest text-white">
                Subir Canción
              </span>
              <span className="text-[10px] font-mono-code text-white/40">
                MP3 · WAV · FLAC · M4A · LRC
              </span>
            </>
          )}
        </div>

        {/* Individual item progress bars when processing */}
        {hasActive && queue.slice(0, 3).map((item) => {
          if (item.status === 'ready' || item.status === 'error') return null;
          return (
            <div key={item.id} className="px-3 pb-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono-code text-white/60 truncate">{item.fileName}</span>
                <span className="text-[10px] font-mono-code text-[#00f0ff] shrink-0 ml-2">{item.progress}%</span>
              </div>
              <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#00f0ff] to-[#ff007f] rounded-full transition-all duration-300"
                  style={{ width: `${item.progress}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Tabs: Queue | Library ─────────────────── */}
      <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden flex flex-col">
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setActiveTab('queue')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-mono-code font-bold uppercase tracking-wider cursor-pointer transition-all ${
              activeTab === 'queue'
                ? 'text-[#00ff9d] border-b-2 border-[#00ff9d] bg-[#00ff9d]/5'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            <Layers className="w-3 h-3" />
            Cola
            {queue.length > 0 && (
              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${activeTab === 'queue' ? 'bg-[#00ff9d]/20 text-[#00ff9d]' : 'bg-white/10 text-white/40'}`}>
                {queue.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('library')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-mono-code font-bold uppercase tracking-wider cursor-pointer transition-all ${
              activeTab === 'library'
                ? 'text-[#ff007f] border-b-2 border-[#ff007f] bg-[#ff007f]/5'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            <Database className="w-3 h-3" />
            Biblioteca
            {savedSongs.length > 0 && (
              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${activeTab === 'library' ? 'bg-[#ff007f]/20 text-[#ff007f]' : 'bg-white/10 text-white/40'}`}>
                {savedSongs.length}
              </span>
            )}
          </button>
        </div>

        {/* Queue Tab */}
        {activeTab === 'queue' && (
          <div className="flex flex-col gap-0 max-h-72 overflow-y-auto">
            {queue.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-white/30 font-mono-code text-[11px] gap-1">
                <Music2 className="w-5 h-5 opacity-30" />
                <span>Sin pistas en cola</span>
              </div>
            ) : (
              queue.map((item, i) => {
                const isReady = item.status === 'ready';
                const isError = item.status === 'error';
                const isProcessing = !isReady && !isError;
                return (
                  <div key={item.id} className={`flex items-center gap-2.5 px-3 py-2.5 ${i < queue.length - 1 ? 'border-b border-white/5' : ''}`}>
                    <div className="shrink-0">
                      {isReady && <CheckCircle2 className="w-4 h-4 text-[#00ff9d]" />}
                      {isError && <AlertCircle className="w-4 h-4 text-[#ff007f]" />}
                      {isProcessing && <Loader2 className="w-4 h-4 text-[#00f0ff] animate-spin" />}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                      <span className="text-[11px] font-semibold text-white truncate">{item.fileName}</span>
                      {isProcessing && item.currentStep && (
                        <span className="text-[9px] font-mono-code text-[#00f0ff] truncate">{item.currentStep}</span>
                      )}
                      {isReady && item.songData && (
                        <span className="text-[9px] font-mono-code text-[#00ff9d]">
                          {fmt(item.songData.duration)} · {item.songData.bpm} BPM · {item.songData.key} · {item.songData.lyrics.length} letras
                        </span>
                      )}
                      {isError && (
                        <span className="text-[9px] font-mono-code text-[#ff007f]">{item.errorMsg || 'Error'}</span>
                      )}
                      {isProcessing && (
                        <div className="h-1 bg-white/10 rounded-full overflow-hidden mt-0.5">
                          <div className="h-full bg-gradient-to-r from-[#00f0ff] to-[#ff007f] transition-all" style={{ width: `${item.progress}%` }} />
                        </div>
                      )}
                    </div>
                    {isReady && item.songData && (
                      <button
                        onClick={() => onSelectSong(item.songData!)}
                        className="shrink-0 p-1.5 rounded-lg bg-[#00ff9d]/20 text-[#00ff9d] hover:bg-[#00ff9d]/30 cursor-pointer transition-all"
                        title="Cargar y reproducir"
                      >
                        <Play className="w-3 h-3 fill-current" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Library Tab */}
        {activeTab === 'library' && (
          <div className="flex flex-col max-h-72 overflow-y-auto">
            {savedSongs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-white/30 font-mono-code text-[11px] gap-1">
                <Database className="w-5 h-5 opacity-30" />
                <span>Biblioteca vacía</span>
              </div>
            ) : (
              savedSongs.map((song, i) => (
                <div
                  key={song.id}
                  className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-all group ${
                    currentSongId === song.id
                      ? 'bg-[#ff007f]/10 border-l-2 border-[#ff007f]'
                      : 'hover:bg-white/5 border-l-2 border-transparent'
                  } ${i < savedSongs.length - 1 ? 'border-b border-white/5' : ''}`}
                  onClick={() => onSelectSong(song)}
                  style={{ borderBottomColor: i < savedSongs.length - 1 ? 'rgba(255,255,255,0.05)' : undefined }}
                >
                  <div className="shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-[#ff007f]/20 to-[#00f0ff]/20 flex items-center justify-center border border-white/10">
                    <Music2 className="w-3.5 h-3.5 text-white/60" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className={`text-[11px] font-semibold truncate ${currentSongId === song.id ? 'text-white' : 'text-white/80'}`}>
                      {song.title}
                    </span>
                    <div className="flex items-center gap-1.5 text-[9px] font-mono-code text-white/35 truncate">
                      <span>{song.artist || 'Desconocido'}</span>
                      <span>·</span>
                      <span>{fmt(song.duration)}</span>
                      <span>·</span>
                      <span className="text-[#00f0ff]">{song.bpm} BPM</span>
                      {song.stems?.instrumentalBlob && <span className="text-[#00ff9d] ml-0.5">✓ Stems</span>}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteSong(song.id); }}
                    className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 text-white/40 hover:text-[#ff007f] cursor-pointer transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
