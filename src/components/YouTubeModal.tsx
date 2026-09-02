import React, { useState, useEffect } from 'react';
import { Search, X, Play, Youtube, Loader2, Star, ExternalLink, Trash2, User } from 'lucide-react';
import { searchYouTubeVideos, YouTubeSearchResult } from '../services/youtubeApi';
import { YouTubeFavoriteTrack, SingerProfile } from '../types';

interface YouTubeModalProps {
  isOpen: boolean;
  onClose: () => void;
  youtubeFavorites: YouTubeFavoriteTrack[];
  onToggleYouTubeFavorite: (track: YouTubeSearchResult, singerProfileId?: string) => void;
  profiles?: SingerProfile[];
  activeProfileId?: string;
  initialEmbedId?: string | null;
}

export const YouTubeModal: React.FC<YouTubeModalProps> = ({
  isOpen,
  onClose,
  youtubeFavorites,
  onToggleYouTubeFavorite,
  profiles = [],
  activeProfileId = 'profile_all',
  initialEmbedId = null,
}) => {
  const [activeTab, setActiveTab] = useState<'search' | 'favorites'>('search');
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [activeEmbedId, setActiveEmbedId] = useState<string | null>(initialEmbedId);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(activeProfileId);

  useEffect(() => {
    if (initialEmbedId) {
      setActiveEmbedId(initialEmbedId);
    }
  }, [initialEmbedId]);

  if (!isOpen) return null;

  const handleSearch = async (searchTerm?: string) => {
    const q = searchTerm !== undefined ? searchTerm : query;
    if (!q || q.trim().length === 0) return;

    setIsSearching(true);
    setActiveEmbedId(null);
    try {
      const res = await searchYouTubeVideos(q);
      setResults(res);
    } catch (err) {
      console.error('YouTube search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const isFavorite = (videoId: string) => {
    return youtubeFavorites.some((fav) => fav.id === videoId);
  };

  const filteredFavorites = selectedProfileId === 'profile_all'
    ? youtubeFavorites
    : youtubeFavorites.filter((f) => f.singerProfileId === selectedProfileId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/90 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-600/20 border border-red-500/40 flex items-center justify-center text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)]">
              <Youtube className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                YouTube Karaoke Hub
                <span className="text-[10px] px-2.5 py-0.5 rounded-full font-mono bg-red-500/20 text-red-300 border border-red-500/30 font-bold">
                  REPRODUCIR + FAVORITOS
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Busca y guarda tus videos karaoke favoritos de YouTube por cantante
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tabs Selector */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setActiveTab('search')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'search'
                    ? 'bg-red-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                <span>Buscar</span>
              </button>
              <button
                onClick={() => setActiveTab('favorites')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'favorites'
                    ? 'bg-amber-500 text-slate-950 shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Star className="w-3.5 h-3.5 fill-current" />
                <span>Favoritos ({youtubeFavorites.length})</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Singer Profile Selector Bar */}
        {profiles.length > 0 && (
          <div className="px-4 py-2 bg-slate-950/70 border-b border-slate-800/80 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 overflow-x-auto py-0.5">
              <span className="text-slate-400 font-mono text-[11px] font-bold flex items-center gap-1 shrink-0">
                <User className="w-3.5 h-3.5 text-cyan-400" />
                Cantante Asignado:
              </span>
              {profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProfileId(p.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5 ${
                    selectedProfileId === p.id
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-sm'
                      : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300'
                  }`}
                >
                  <span>{p.avatar}</span>
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* TAB 1: SEARCH BAR */}
        {activeTab === 'search' && (
          <div className="p-4 bg-slate-950/40 border-b border-slate-800 flex flex-col gap-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSearch();
              }}
              className="flex items-center gap-2"
            >
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Escribe título o artista de YouTube (ej: Luis Miguel Ahora Te Puedes Marchar)..."
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500 transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={isSearching || !query.trim()}
                className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm cursor-pointer disabled:opacity-50 transition-all flex items-center gap-2 shadow-lg shadow-red-600/30"
              >
                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>{isSearching ? 'Buscando...' : 'Buscar'}</span>
              </button>
            </form>

            {/* Quick Presets */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
              <span className="text-slate-500 font-mono font-bold shrink-0">Popular:</span>
              {['Luis Miguel', 'Bad Bunny', 'Karol G', 'RBD', 'Queen', 'Rocío Dúrcal'].map((tag) => (
                <button
                  key={tag}
                  onClick={() => {
                    setQuery(tag);
                    handleSearch(tag);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition-colors cursor-pointer shrink-0"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {/* Active Embed Player */}
          {activeEmbedId && (
            <div className="mb-6 rounded-2xl overflow-hidden border border-red-500/40 bg-black shadow-[0_0_30px_rgba(239,68,68,0.2)]">
              <div className="p-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs font-bold text-red-400 font-mono flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5 fill-current" />
                  REPRODUCIENDO VIDEO DE YOUTUBE EN VIVO
                </span>
                <button
                  onClick={() => setActiveEmbedId(null)}
                  className="text-xs text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800 cursor-pointer"
                >
                  Cerrar Reproductor
                </button>
              </div>
              <div className="relative aspect-video w-full">
                <iframe
                  src={`https://www.youtube.com/embed/${activeEmbedId}?autoplay=1&rel=0&iv_load_policy=3`}
                  title="YouTube Player"
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          )}

          {/* VIEW TAB 1: SEARCH RESULTS */}
          {activeTab === 'search' && (
            <>
              {isSearching ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                  <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
                  <p className="text-sm font-medium">Buscando pistas de Karaoke en YouTube...</p>
                </div>
              ) : results.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {results.map((item) => {
                    const isFav = isFavorite(item.id);
                    return (
                      <div
                        key={item.id}
                        className="group flex flex-col justify-between p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/60 border border-slate-800 hover:border-slate-700 transition-all shadow-md"
                      >
                        <div className="flex gap-3">
                          {/* Thumbnail */}
                          <div className="relative w-28 h-20 rounded-lg overflow-hidden shrink-0 bg-slate-900">
                            <img
                              src={item.thumbnail}
                              alt={item.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              onError={(e) => {
                                (e.target as any).src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80';
                              }}
                            />
                            <span className="absolute bottom-1 right-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/80 text-white font-bold">
                              {item.duration}
                            </span>
                          </div>

                          {/* Metadata */}
                          <div className="flex-1 min-w-0">
                            <h3 className="text-xs sm:text-sm font-bold text-white line-clamp-2 leading-snug group-hover:text-red-400 transition-colors">
                              {item.title}
                            </h3>
                            <p className="text-[11px] text-slate-400 mt-1 truncate">{item.channel}</p>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-800/80">
                          <button
                            onClick={() => setActiveEmbedId(item.id)}
                            className="flex-1 py-1.5 px-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Ver Video</span>
                          </button>

                          <button
                            onClick={() => onToggleYouTubeFavorite(item, selectedProfileId)}
                            className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                              isFav
                                ? 'bg-amber-500 text-slate-950 font-black shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                                : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700'
                            }`}
                          >
                            <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-slate-950' : 'fill-amber-300'}`} />
                            <span>{isFav ? 'En Favoritos' : 'Guardar Favorito'}</span>
                          </button>

                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer"
                            title="Abrir en YouTube.com"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
                  <Youtube className="w-12 h-12 text-slate-600" />
                  <p className="text-base font-bold text-slate-300">Explora millones de canciones Karaoke en YouTube</p>
                  <p className="text-xs text-slate-500 max-w-md text-center">
                    Escribe cualquier artista o canción en la barra superior para buscar videos y guardarlos en tus favoritos.
                  </p>
                </div>
              )}
            </>
          )}

          {/* VIEW TAB 2: FAVORITES LIST */}
          {activeTab === 'favorites' && (
            <div>
              {filteredFavorites.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {filteredFavorites.map((item) => {
                    const prof = profiles.find((p) => p.id === item.singerProfileId);
                    return (
                      <div
                        key={item.id}
                        className="group flex flex-col justify-between p-3 rounded-xl bg-slate-950/80 border border-amber-500/30 hover:border-amber-400 transition-all shadow-md"
                      >
                        <div className="flex gap-3">
                          {/* Thumbnail */}
                          <div className="relative w-28 h-20 rounded-lg overflow-hidden shrink-0 bg-slate-900">
                            <img
                              src={item.thumbnail}
                              alt={item.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                            <span className="absolute bottom-1 right-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/80 text-white font-bold">
                              {item.duration}
                            </span>
                          </div>

                          {/* Metadata */}
                          <div className="flex-1 min-w-0">
                            <h3 className="text-xs sm:text-sm font-bold text-white line-clamp-2 leading-snug">
                              {item.title}
                            </h3>
                            <p className="text-[11px] text-slate-400 mt-1 truncate">{item.channel}</p>

                            {prof && prof.id !== 'profile_all' && (
                              <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                                <span>{prof.avatar}</span>
                                <span>{prof.name}</span>
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-800/80">
                          <button
                            onClick={() => setActiveEmbedId(item.id)}
                            className="flex-1 py-1.5 px-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Ver Video</span>
                          </button>

                          <button
                            onClick={() =>
                              onToggleYouTubeFavorite(
                                {
                                  id: item.id,
                                  title: item.title,
                                  channel: item.channel,
                                  duration: item.duration,
                                  thumbnail: item.thumbnail,
                                  url: item.url,
                                },
                                item.singerProfileId
                              )
                            }
                            className="py-1.5 px-3 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
                            title="Eliminar de favoritos"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Quitar</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
                  <Star className="w-12 h-12 text-amber-500/40" />
                  <p className="text-base font-bold text-slate-300">No hay videos de YouTube en favoritos aún</p>
                  <p className="text-xs text-slate-500 max-w-md text-center">
                    Busca tus canciones karaoke favoritas en YouTube y presiona el botón ⭐ Guardar Favorito para organizarlas por cantante.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
