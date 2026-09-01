import React, { useState } from 'react';
import { SongItem, LyricLine } from '../types';
import {
  buildWebPlayerPackage,
  downloadOrSaveKlabFile,
  generateStandaloneHTMLPlayer,
  WebPlayerPublishOptions,
} from '../services/webPlayerSyncService';
import { Globe, Package, Code, CheckCircle, Copy, X, Sparkles, Loader2, Music2, Mic2 } from 'lucide-react';

interface PublishWebPlayerModalProps {
  song: SongItem | null;
  lyrics: LyricLine[];
  onClose: () => void;
}

export function PublishWebPlayerModal({ song, lyrics, onClose }: PublishWebPlayerModalProps) {
  const [includeInstrumental, setIncludeInstrumental] = useState(true);
  const [includeVocals, setIncludeVocals] = useState(!!song?.stems?.vocalsBlob);
  const [includeWordSync, setIncludeWordSync] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressStep, setProgressStep] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  if (!song) return null;

  const hasVocals = !!song.stems?.vocalsBlob;
  const hasInstrumental = !!(song.stems?.instrumentalBlob || song.audioBlob);

  const handleExportPackage = async () => {
    setIsProcessing(true);
    setProgressStep('Empaquetando Pistas de Audio e IA Demucs...');
    try {
      const options: WebPlayerPublishOptions = {
        includeInstrumental,
        includeVocals,
        includeWordSync,
        audioQuality: 'wav',
      };

      const pkg = await buildWebPlayerPackage(song, lyrics, options);
      setProgressStep('Generando Archivo .klab para KaraokeLab Web Player...');

      const result = await downloadOrSaveKlabFile(pkg);
      if (result.success) {
        setSuccessMessage('¡Paquete Web Player exportado exitosamente!');
      }
    } catch (err: any) {
      console.error('Export Error:', err);
      alert('Error al exportar paquete: ' + err?.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportHTMLPlayer = async () => {
    setIsProcessing(true);
    setProgressStep('Empaquetando Reproductor HTML Autónomo...');
    try {
      const options: WebPlayerPublishOptions = {
        includeInstrumental,
        includeVocals,
        includeWordSync,
        audioQuality: 'wav',
      };

      const pkg = await buildWebPlayerPackage(song, lyrics, options);
      const htmlContent = generateStandaloneHTMLPlayer(pkg);

      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${song.title.replace(/\s+/g, '_')}_karaokelab_player.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccessMessage('¡Reproductor Web HTML descargado!');
    } catch (err: any) {
      console.error('HTML Export Error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyWebSyncLink = async () => {
    setIsProcessing(true);
    setProgressStep('Generando Enlace Sincronizado Web Player...');
    try {
      const summaryPayload = {
        title: song.title,
        artist: song.artist,
        bpm: song.bpm,
        key: song.key,
        lyricsCount: lyrics.length,
        syncedAt: new Date().toISOString(),
      };

      const encoded = encodeURIComponent(JSON.stringify(summaryPayload));
      const syncUrl = `${window.location.origin}/#webplayer?data=${encoded}`;
      await navigator.clipboard.writeText(syncUrl);

      setCopiedLink(true);
      setSuccessMessage('¡Enlace de Sincronización Web copiado al portapapeles!');
      setTimeout(() => setCopiedLink(false), 4000);
    } catch (err: any) {
      console.error('Sync link error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden text-zinc-100 flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800 bg-zinc-900/80">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Globe className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                Publicar en KaraokeLab Web Player
              </h2>
              <p className="text-xs text-zinc-400">Sincroniza y exporta canciones de estudio para el reproductor Web</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          {/* Song Information Summary Card */}
          <div className="p-4 rounded-2xl bg-zinc-800/60 border border-zinc-700/50 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                🎤
              </div>
              <div>
                <h3 className="font-bold text-white text-base">{song.title}</h3>
                <p className="text-xs text-zinc-400">{song.artist} • {song.key || 'C Major'} • {song.bpm || 120} BPM</p>
              </div>
            </div>
            <div className="text-right text-xs text-cyan-400 font-mono bg-cyan-950/60 px-3 py-1.5 rounded-lg border border-cyan-800/50">
              {lyrics.length} líneas LRC
            </div>
          </div>

          {/* Sync & Packaging Settings */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Opciones de Sincronización Web</h4>

            <label className={`flex items-center justify-between p-3.5 rounded-xl border transition cursor-pointer ${
              includeInstrumental ? 'bg-cyan-950/20 border-cyan-500/40 text-cyan-200' : 'bg-zinc-800/40 border-zinc-700/40 text-zinc-400'
            }`}>
              <div className="flex items-center space-x-3">
                <Music2 className="w-5 h-5 text-cyan-400" />
                <div>
                  <div className="text-sm font-medium">Pista Instrumental Studio (Sin Voz)</div>
                  <div className="text-xs text-zinc-400">Audio aislado de alta calidad por IA Demucs</div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={includeInstrumental}
                disabled={!hasInstrumental}
                onChange={(e) => setIncludeInstrumental(e.target.checked)}
                className="w-5 h-5 rounded accent-cyan-500"
              />
            </label>

            <label className={`flex items-center justify-between p-3.5 rounded-xl border transition cursor-pointer ${
              includeVocals ? 'bg-purple-950/20 border-purple-500/40 text-purple-200' : 'bg-zinc-800/40 border-zinc-700/40 text-zinc-400'
            }`}>
              <div className="flex items-center space-x-3">
                <Mic2 className="w-5 h-5 text-purple-400" />
                <div>
                  <div className="text-sm font-medium">Stem de Voz Aislada</div>
                  <div className="text-xs text-zinc-400">Permite ajustar o silenciar la voz en el Web Player</div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={includeVocals}
                disabled={!hasVocals}
                onChange={(e) => setIncludeVocals(e.target.checked)}
                className="w-5 h-5 rounded accent-purple-500"
              />
            </label>

            <label className={`flex items-center justify-between p-3.5 rounded-xl border transition cursor-pointer ${
              includeWordSync ? 'bg-cyan-950/20 border-cyan-500/40 text-cyan-200' : 'bg-zinc-800/40 border-zinc-700/40 text-zinc-400'
            }`}>
              <div className="flex items-center space-x-3">
                <Sparkles className="w-5 h-5 text-cyan-400" />
                <div>
                  <div className="text-sm font-medium">Sincronización Palabra por Palabra (AI Forced Alignment)</div>
                  <div className="text-xs text-zinc-400">Timestamps precisos por cada sílaba/palabra</div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={includeWordSync}
                onChange={(e) => setIncludeWordSync(e.target.checked)}
                className="w-5 h-5 rounded accent-cyan-500"
              />
            </label>
          </div>

          {/* Feedback & Progress Section */}
          {isProcessing && (
            <div className="p-4 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 flex items-center space-x-3 text-cyan-300">
              <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
              <span className="text-sm">{progressStep}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-4 rounded-2xl bg-emerald-950/50 border border-emerald-500/40 flex items-center space-x-3 text-emerald-200">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <span className="text-sm font-medium">{successMessage}</span>
            </div>
          )}

          {/* Export Actions Grid */}
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Publicar / Exportar</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={handleExportPackage}
                disabled={isProcessing}
                className="flex items-center justify-center space-x-2 p-3.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-sm transition shadow-lg shadow-cyan-500/20 disabled:opacity-50"
              >
                <Package className="w-4 h-4" />
                <span>Exportar Paquete .klab</span>
              </button>

              <button
                onClick={handleExportHTMLPlayer}
                disabled={isProcessing}
                className="flex items-center justify-center space-x-2 p-3.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-sm border border-zinc-700 transition disabled:opacity-50"
              >
                <Code className="w-4 h-4 text-purple-400" />
                <span>Reproductor HTML Web</span>
              </button>
            </div>

            <button
              onClick={handleCopyWebSyncLink}
              disabled={isProcessing}
              className="w-full flex items-center justify-center space-x-2 p-3.5 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-cyan-300 font-medium text-sm border border-cyan-500/30 transition disabled:opacity-50"
            >
              {copiedLink ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copiedLink ? '¡Enlace de Sincronización Copiado!' : 'Copiar Enlace de Sincronización Web'}</span>
            </button>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900/90 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
