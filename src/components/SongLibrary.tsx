import React, { useRef, useState, useMemo } from 'react';
import { SongItem, QueueItem, SingerProfile, YouTubeFavoriteTrack } from '../types';
import {
  UploadCloud, Database, Trash2, Music2, Loader2, ListPlus, Check,
  AlertTriangle, Search, Filter, X, Tag, User, Play, Maximize2, Minimize2,
  Download, Edit3, ArrowUpDown, Sparkles, Layers, FileText, Clock, List, LayoutGrid,
  Star, FolderDown, FolderUp, Youtube, Menu, ExternalLink, Share2
} from 'lucide-react';
import { formatLRC } from '../services/lrcParser';
import {
  exportLibraryBackup,
  exportFullLibraryWithAudioZip,
  exportSingleSongPackageZip,
  importUniversalBackup,
  getModifiedOrNewSongs,
  updateExistingZipWithSongs,
} from '../services/libraryBackup';
import { importSongsFromFolder, syncSongsToFolder } from '../services/folderSyncService';
import { extractYouTubeVideoId, fetchYouTubeVideoTitle } from '../services/videoBackgroundService';
import { searchYouTubeVideos, YouTubeSearchResult } from '../services/youtubeApi';

interface SongLibraryProps {
  savedSongs: SongItem[];
  currentSongId?: string;
  queue: QueueItem[];
  onFilesSelected: (files: FileList | File[]) => void;
  onSelectSong: (song: SongItem) => void;
  onDeleteSong: (id: string) => void;
  onAddToQueue: (song: SongItem) => void;
  onDownloadStem?: (song: SongItem, type: 'instrumental' | 'vocals') => void;
  onUpdateSong?: (updatedSong: SongItem) => void;
  onReanalyzeSong?: (song: SongItem) => Promise<void>;
  onRestoreLibrary?: (songs: SongItem[], profiles: SingerProfile[]) => void;
  onOpenYouTubeModal?: () => void;
  onOpenPublishModal?: (song: SongItem) => void;
  youtubeFavorites?: YouTubeFavoriteTrack[];
  onToggleYouTubeFavorite?: (track: { id: string; title: string; channel: string; duration: string; thumbnail: string; url: string }, singerProfileId?: string) => void;
  onOpenYouTubeEmbed?: (videoId: string) => void;
  isProcessingUpload?: boolean;
  uploadProgress?: number;
  uploadStep?: string;
  uploadFileName?: string;
  uploadCurrentIndex?: number;
  uploadTotalCount?: number;
  profiles?: SingerProfile[];
  activeProfileId?: string;
  onSelectProfile?: (profileId: string) => void;
  onCreateProfile?: (name: string, avatar: string, color: string) => void;
  onDeleteProfile?: (profileId: string) => void;
  onToggleFavoriteSong?: (profileId: string, songId: string) => void;
  /** When true: hides host-only controls (delete, import, etc.) — used in guest QR remote view */
  isGuestMode?: boolean;
}

export const SongLibrary: React.FC<SongLibraryProps> = React.memo(({
  savedSongs,
  currentSongId,
  queue,
  onFilesSelected,
  onSelectSong,
  onDeleteSong,
  onAddToQueue,
  onDownloadStem,
  onUpdateSong,
  onReanalyzeSong,
  onRestoreLibrary,
  onOpenYouTubeModal,
  onOpenPublishModal,
  youtubeFavorites = [],
  onToggleYouTubeFavorite,
  onOpenYouTubeEmbed,
  isProcessingUpload = false,
  uploadProgress = 0,
  uploadStep = '',
  uploadFileName = '',
  uploadCurrentIndex = 1,
  uploadTotalCount = 1,
  profiles = [{ id: 'profile_all', name: 'Todos', avatar: '👥', color: '#00f0ff', favoriteSongIds: [], createdAt: 0 }],
  activeProfileId = 'profile_all',
  onSelectProfile,
  onCreateProfile,
  onDeleteProfile,
  onToggleFavoriteSong,
  isGuestMode = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const expandedFileInputRef = useRef<HTMLInputElement | null>(null);
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);
  const updateExistingZipFileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Modals state
  const [isExpanded, setIsExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [songToDelete, setSongToDelete] = useState<SongItem | null>(null);
  const [songActionTarget, setSongActionTarget] = useState<SongItem | null>(null);
  const [songToEdit, setSongToEdit] = useState<SongItem | null>(null);
  const [reanalyzingSongId, setReanalyzingSongId] = useState<string | null>(null);

  // Backup & Export states
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExportingAudioZip, setIsExportingAudioZip] = useState(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportStep, setExportStep] = useState<string>('');
  const [backupFeedback, setBackupFeedback] = useState<string | null>(null);
  const [isImportingBackup, setIsImportingBackup] = useState(false);

  // Incremental songs detected since last backup
  const modifiedOrNewSongs = useMemo(() => {
    return getModifiedOrNewSongs(savedSongs);
  }, [savedSongs, isExportModalOpen]);

  // Edit form state
  const [editTitle, setEditTitle] = useState('');
  const [editArtist, setEditArtist] = useState('');
  const [editAlbum, setEditAlbum] = useState('');
  const [editGenre, setEditGenre] = useState('');
  const [editKey, setEditKey] = useState('');
  const [editBpm, setEditBpm] = useState<number>(120);
  const [editVideoBgUrl, setEditVideoBgUrl] = useState('');
  const [editVideoBgTitle, setEditVideoBgTitle] = useState('');
  const [isFetchingVideoTitle, setIsFetchingVideoTitle] = useState(false);

  // Search, Filter and Sorting states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArtist, setSelectedArtist] = useState<string>('ALL');
  const [selectedGenre, setSelectedGenre] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'artist' | 'bpm' | 'duration'>('recent');
  const [showFilters, setShowFilters] = useState(true);
  const [libraryTab, setLibraryTab] = useState<'local' | 'youtube'>('local');
  const [showLibraryMenu, setShowLibraryMenu] = useState(false);

  // YouTube Karaoke Live Search State
  const [ytQuery, setYtQuery] = useState('');
  const [ytResults, setYtResults] = useState<YouTubeSearchResult[]>([]);
  const [ytSearching, setYtSearching] = useState(false);
  const [ytActiveEmbedId, setYtActiveEmbedId] = useState<string | null>(null);

  const handleYouTubeSearch = async (searchTerm?: string) => {
    const q = searchTerm !== undefined ? searchTerm : ytQuery;
    if (!q || !q.trim()) return;
    setYtSearching(true);
    setYtActiveEmbedId(null);
    try {
      const res = await searchYouTubeVideos(q);
      setYtResults(res);
    } catch (err) {
      console.error('YouTube search error in library:', err);
    } finally {
      setYtSearching(false);
    }
  };

  // 1. Export Metadata JSON (Lightweight)
  const handleExportMetadataJson = () => {
    if (savedSongs.length === 0) {
      setBackupFeedback('No hay canciones en la biblioteca para exportar.');
      setTimeout(() => setBackupFeedback(null), 3000);
      return;
    }
    exportLibraryBackup(savedSongs, profiles);
    setIsExportModalOpen(false);
    setBackupFeedback(`✓ ¡Respaldo de letras descargado! (${savedSongs.length} canciones con configuración de voces)`);
    setTimeout(() => setBackupFeedback(null), 4000);
  };

  // 2. Export INCREMENTAL ZIP (Only new or modified songs)
  const handleExportIncrementalZip = async () => {
    const list = modifiedOrNewSongs.length > 0 ? modifiedOrNewSongs : savedSongs;
    if (list.length === 0) return;
    setIsExportingAudioZip(true);
    setExportProgress(5);
    setExportStep(`Empaquetando ${list.length} canciones nuevas/modificadas...`);
    try {
      await exportFullLibraryWithAudioZip(list, profiles, (p, msg) => {
        setExportProgress(p);
        setExportStep(msg);
      }, true);
      setIsExportModalOpen(false);
      setBackupFeedback(`✓ ¡Respaldo incremental descargado! (${list.length} canciones nuevas listas)`);
    } catch (err: any) {
      setBackupFeedback(`Error: ${err?.message || 'Fallo al exportar'}`);
    } finally {
      setIsExportingAudioZip(false);
      setTimeout(() => setBackupFeedback(null), 5000);
    }
  };

  // 3. Export FULL ZIP with All Audio Stems
  const handleExportFullZip = async () => {
    if (savedSongs.length === 0) return;
    setIsExportingAudioZip(true);
    setExportProgress(5);
    setExportStep('Preparando todas las pistas de audio y stems...');
    try {
      await exportFullLibraryWithAudioZip(savedSongs, profiles, (p, msg) => {
        setExportProgress(p);
        setExportStep(msg);
      }, false);
      setIsExportModalOpen(false);
      setBackupFeedback(`✓ ¡Paquete completo descargado con éxito! (${savedSongs.length} canciones con sus audios y stems)`);
    } finally {
      setIsExportingAudioZip(false);
      setTimeout(() => setBackupFeedback(null), 5000);
    }
  };

  // 3.5 Export Folder Structure ("Karaokelab Library")
  const handleExportFolderStructure = async () => {
    if (savedSongs.length === 0) return;
    setIsExportingAudioZip(true);
    setExportProgress(5);
    setExportStep('Exportando estructura a carpeta Karaokelab Library...');
    try {
      await syncSongsToFolder(savedSongs, profiles, (p, msg) => {
        setExportProgress(p);
        setExportStep(msg);
      }, 'Karaokelab Library');
      setIsExportModalOpen(false);
      setBackupFeedback(`✓ ¡Biblioteca exportada a la carpeta Karaokelab Library!`);
    } catch (err: any) {
      setBackupFeedback(`Error al exportar carpeta: ${err?.message || 'Fallo'}`);
    } finally {
      setIsExportingAudioZip(false);
      setTimeout(() => setBackupFeedback(null), 5000);
    }
  };

  // 4. Update Existing ZIP file in 1-2 seconds
  const handleUpdateExistingZipFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsExportingAudioZip(true);
    setExportProgress(10);
    setExportStep('Inyectando canciones en el archivo ZIP existente...');
    try {
      const songsToInject = modifiedOrNewSongs.length > 0 ? modifiedOrNewSongs : savedSongs;
      await updateExistingZipWithSongs(file, songsToInject, profiles, (p, msg) => {
        setExportProgress(p);
        setExportStep(msg);
      });
      setIsExportModalOpen(false);
      setBackupFeedback(`✓ ¡Archivo ZIP actualizado con éxito! (${songsToInject.length} canciones inyectadas)`);
    } catch (err: any) {
      setBackupFeedback(`Error al actualizar ZIP: ${err?.message || 'Archivo no válido'}`);
    } finally {
      setIsExportingAudioZip(false);
      if (updateExistingZipFileInputRef.current) updateExistingZipFileInputRef.current.value = '';
      setTimeout(() => setBackupFeedback(null), 5000);
    }
  };

  // 5. Export Single Song Package
  const handleExportSingleSong = async (song: SongItem) => {
    try {
      setBackupFeedback(`Empaquetando ${song.title}...`);
      await exportSingleSongPackageZip(song);
      setBackupFeedback(`✓ ¡Paquete de "${song.title}" descargado con audios y letra!`);
    } catch (err: any) {
      setBackupFeedback(`Error al exportar: ${err?.message || 'Fallo'}`);
    } finally {
      setTimeout(() => setBackupFeedback(null), 4000);
    }
  };

  // 6. Universal Import (Accepts .zip or .json)
  const handleImportBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImportingBackup(true);
    setBackupFeedback('Analizando y restaurando archivo...');
    try {
      const result = await importUniversalBackup(file, (_p, msg) => {
        setBackupFeedback(msg);
      });
      onRestoreLibrary?.(result.allSongs, result.allProfiles);
      setBackupFeedback(`✓ ¡Biblioteca restaurada con éxito! (${result.importedSongsCount} canciones con audios y configuraciones)`);
    } catch (err: any) {
      setBackupFeedback(`Error al importar: ${err?.message || 'Archivo no válido'}`);
    } finally {
      setIsImportingBackup(false);
      if (backupFileInputRef.current) backupFileInputRef.current.value = '';
      setTimeout(() => setBackupFeedback(null), 5000);
    }
  };

  // 7. Direct Synced Folder / USB Import (Instant DB Hydration)
  const handleImportFromFolder = async () => {
    setIsImportingBackup(true);
    setBackupFeedback('Leyendo canciones desde carpeta o memoria USB...');
    try {
      const result = await importSongsFromFolder((_p, msg) => {
        setBackupFeedback(msg);
      });
      onRestoreLibrary?.(result.allSongs, result.allProfiles);
      setBackupFeedback(`✓ ¡${result.importedCount} canciones cargadas desde la carpeta!`);
    } catch (err: any) {
      setBackupFeedback(`Error: ${err?.message || 'Fallo al leer la carpeta'}`);
    } finally {
      setIsImportingBackup(false);
      setTimeout(() => setBackupFeedback(null), 5000);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) onFilesSelected(e.dataTransfer.files);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const activeProcessing = queue.filter((q) => q.status !== 'ready' && q.status !== 'error');
  const hasActive = activeProcessing.length > 0;

  const isSongInQueue = (songId: string) => {
    return queue.some((q) => q.songData?.id === songId);
  };

  // Reanalyze single song handler
  const handleReanalyze = async (song: SongItem) => {
    if (!onReanalyzeSong || reanalyzingSongId) return;
    setReanalyzingSongId(song.id);
    try {
      await onReanalyzeSong(song);
    } finally {
      setReanalyzingSongId(null);
    }
  };

  // Collect unique artists
  const uniqueArtists = useMemo(() => {
    const set = new Set<string>();
    savedSongs.forEach((s) => {
      const art = s.artist?.trim();
      if (art && art.toLowerCase() !== 'desconocido') set.add(art);
    });
    return Array.from(set).sort();
  }, [savedSongs]);

  // Collect unique genres
  const uniqueGenres = useMemo(() => {
    const set = new Set<string>();
    savedSongs.forEach((s) => {
      const g = s.genre?.trim();
      if (g) set.add(g);
    });
    return Array.from(set).sort();
  }, [savedSongs]);

  // Profile creation & assignment modal states
  const [isCreateProfileOpen, setIsCreateProfileOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileAvatar, setNewProfileAvatar] = useState('🎤');
  const [newProfileColor, setNewProfileColor] = useState('#00f0ff');
  const [songForProfileAssign, setSongForProfileAssign] = useState<SongItem | null>(null);
  const [ytTrackForProfileAssign, setYtTrackForProfileAssign] = useState<{
    id: string;
    title: string;
    channel: string;
    duration: string;
    thumbnail: string;
    url: string;
  } | null>(null);

  const activeProfile = useMemo(() => {
    return profiles.find((p) => p.id === activeProfileId) || profiles[0];
  }, [profiles, activeProfileId]);

  const handleAddProfileFavoritesToQueue = () => {
    if (!activeProfile || activeProfile.id === 'profile_all') return;
    const favoriteSongs = savedSongs.filter((s) => activeProfile.favoriteSongIds.includes(s.id));
    favoriteSongs.forEach((s) => {
      if (!isSongInQueue(s.id)) {
        onAddToQueue(s);
      }
    });
  };

  const handleSaveNewProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim() || !onCreateProfile) return;
    onCreateProfile(newProfileName.trim(), newProfileAvatar, newProfileColor);
    setNewProfileName('');
    setNewProfileAvatar('🎤');
    setNewProfileColor('#00f0ff');
    setIsCreateProfileOpen(false);
  };

  // Filtered and Sorted song list
  const filteredSongs = useMemo(() => {
    let result = savedSongs.filter((song) => {
      // 1. Text Search Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTitle = song.title.toLowerCase().includes(q);
        const matchArtist = song.artist?.toLowerCase().includes(q);
        const matchAlbum = song.album?.toLowerCase().includes(q);
        const matchGenre = song.genre?.toLowerCase().includes(q);
        if (!matchTitle && !matchArtist && !matchAlbum && !matchGenre) {
          return false;
        }
      }

      // 2. Artist Filter
      if (selectedArtist !== 'ALL') {
        if (song.artist?.trim() !== selectedArtist) return false;
      }

      // 3. Genre Filter
      if (selectedGenre !== 'ALL') {
        if ((song.genre?.trim() || 'General') !== selectedGenre) return false;
      }

      // 4. Singer Profile Favorite Filter
      if (activeProfile && activeProfile.id !== 'profile_all') {
        if (!activeProfile.favoriteSongIds.includes(song.id)) {
          return false;
        }
      }

      return true;
    });

    // Sort result
    if (sortBy === 'title') {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'artist') {
      result.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
    } else if (sortBy === 'bpm') {
      result.sort((a, b) => b.bpm - a.bpm);
    } else if (sortBy === 'duration') {
      result.sort((a, b) => b.duration - a.duration);
    } else {
      result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    return result;
  }, [savedSongs, searchQuery, selectedArtist, selectedGenre, sortBy, activeProfile]);

  // Filtered YouTube Favorites
  const filteredYouTubeFavorites = useMemo(() => {
    if (!youtubeFavorites || youtubeFavorites.length === 0) return [];
    return youtubeFavorites.filter((yt) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTitle = yt.title.toLowerCase().includes(q);
        const matchChannel = yt.channel.toLowerCase().includes(q);
        if (!matchTitle && !matchChannel) return false;
      }
      if (activeProfile && activeProfile.id !== 'profile_all') {
        if (yt.singerProfileId && yt.singerProfileId !== activeProfile.id) {
          return false;
        }
      }
      return true;
    });
  }, [youtubeFavorites, searchQuery, activeProfile]);

  const hasActiveFilters = searchQuery.trim() !== '' || selectedArtist !== 'ALL' || selectedGenre !== 'ALL' || sortBy !== 'recent' || (activeProfile && activeProfile.id !== 'profile_all');

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedArtist('ALL');
    setSelectedGenre('ALL');
    setSortBy('recent');
    onSelectProfile?.('profile_all');
  };

  // Download LRC Lyrics file directly
  const handleDownloadLrc = (song: SongItem) => {
    const lrcContent = song.rawLrc || formatLRC(song.lyrics);
    const blob = new Blob([lrcContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${song.title || 'karaoke'}_letras.lrc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Open Edit Metadata Modal
  const handleOpenEdit = (song: SongItem) => {
    setSongToEdit(song);
    setEditTitle(song.title || '');
    setEditArtist(song.artist || '');
    setEditAlbum(song.album || '');
    setEditGenre(song.genre || 'General');
    setEditKey(song.key || 'C');
    setEditBpm(song.bpm || 120);
    setEditVideoBgUrl(song.videoBgCustomUrl || (song.videoBgId ? `https://www.youtube.com/watch?v=${song.videoBgId}` : ''));
    setEditVideoBgTitle(song.videoBgTitle || '');
  };

  // Auto-fetch YouTube title when a video URL or ID is entered in the edit modal
  React.useEffect(() => {
    if (!songToEdit) return;
    const trimmed = editVideoBgUrl.trim();
    const videoId = trimmed ? extractYouTubeVideoId(trimmed) || trimmed : null;
    if (!videoId || videoId.length < 5) {
      setEditVideoBgTitle('');
      return;
    }
    if (songToEdit.videoBgId === videoId && songToEdit.videoBgTitle) {
      setEditVideoBgTitle(songToEdit.videoBgTitle);
      return;
    }
    let isMounted = true;
    setIsFetchingVideoTitle(true);
    fetchYouTubeVideoTitle(videoId).then((title) => {
      if (isMounted) {
        if (title) setEditVideoBgTitle(title);
        setIsFetchingVideoTitle(false);
      }
    }).catch(() => {
      if (isMounted) setIsFetchingVideoTitle(false);
    });
    return () => { isMounted = false; };
  }, [editVideoBgUrl, songToEdit]);

  // Save Edit Metadata
  const handleSaveEdit = () => {
    if (!songToEdit) return;
    const newArtistName = editArtist.trim() || songToEdit.artist;
    let updatedArtistsList = songToEdit.artistsList;
    if (updatedArtistsList && updatedArtistsList.length === 1) {
      updatedArtistsList = [{ ...updatedArtistsList[0], name: newArtistName }];
    } else if (!updatedArtistsList) {
      updatedArtistsList = [{ id: 'artist-0', name: newArtistName, color: '#00f0ff' }];
    }

    const trimmedVideo = editVideoBgUrl.trim();
    const videoId = trimmedVideo ? extractYouTubeVideoId(trimmedVideo) || trimmedVideo : undefined;

    const updated: SongItem = {
      ...songToEdit,
      title: editTitle.trim() || songToEdit.title,
      artist: newArtistName,
      artistsList: updatedArtistsList,
      album: editAlbum.trim() || songToEdit.album,
      genre: editGenre.trim() || songToEdit.genre,
      key: editKey.trim() || songToEdit.key,
      bpm: editBpm || songToEdit.bpm,
      videoBgId: videoId,
      videoBgTitle: videoId ? (editVideoBgTitle.trim() || songToEdit.videoBgTitle || undefined) : undefined,
      videoBgCustomUrl: trimmedVideo || undefined,
      videoBgMode: videoId ? (songToEdit.videoBgMode === 'auto' && !trimmedVideo.includes('/') ? 'auto' : 'custom') : undefined,
      updatedAt: Date.now(),
    };
    if (onUpdateSong) {
      onUpdateSong(updated);
    }
    setSongToEdit(null);
  };

  // Add all currently filtered songs to queue
  const handleAddAllFilteredToQueue = () => {
    filteredSongs.forEach((s) => {
      if (!isSongInQueue(s.id)) {
        onAddToQueue(s);
      }
    });
  };

  // Total library duration in minutes
  const totalDurationMinutes = Math.round(savedSongs.reduce((acc, s) => acc + (s.duration || 0), 0) / 60);

  return (
    <div className="flex flex-col gap-3 relative">
      {/* Hidden file input preserved for programmatic imports */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.lrc"
        onChange={(e) => e.target.files?.length && onFilesSelected(e.target.files)}
        className="hidden"
      />


      {/* ── Library Card (Fixed Stable 800px Height) ─────────────────────────────── */}
      <div
        style={{ height: '945px', minHeight: '800px' }}
        className="bg-[#0c0e17] border border-slate-700/70 rounded-2xl flex flex-col shadow-lg relative overflow-hidden"
      >
        {/* Header with Expand Button - Fixed boundary layout */}
        <div className="px-3 py-2 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between gap-2 relative z-30 rounded-t-2xl">
          <div className="flex items-center gap-1.5 min-w-0 shrink">
            <Database className="w-4 h-4 text-[#ff007f] shrink-0" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-white truncate">
              Biblioteca
            </h3>
            {onOpenYouTubeModal && (
              <button
                type="button"
                onClick={onOpenYouTubeModal}
                className="ml-0.5 px-2 py-0.5 rounded-full bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 text-red-400 text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer shrink-0"
                title="Abrir buscador de YouTube Karaoke"
              >
                <Youtube className="w-3 h-3 text-red-500 fill-current" />
                <span className="hidden sm:inline">YouTube</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {hasActiveFilters && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/40">
                {filteredSongs.length}/{savedSongs.length}
              </span>
            )}
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#ff007f]/20 text-[#ff007f] border border-[#ff007f]/30">
              {savedSongs.length}
            </span>

            {/* SANDWICH MENU DROPDOWN */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowLibraryMenu(!showLibraryMenu)}
                className="p-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white cursor-pointer transition-all flex items-center gap-1.5 text-[11px] font-bold shadow-sm"
                title="Menú de opciones de biblioteca"
              >
                <Menu className="w-3.5 h-3.5 text-[#00f0ff]" />
                <span className="hidden sm:inline text-[10px]">Opciones</span>
              </button>

              {showLibraryMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowLibraryMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1.5 z-50 w-56 bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-xl shadow-2xl p-1.5 flex flex-col gap-1 text-xs font-semibold animate-in fade-in zoom-in-95 duration-100">
                    <button
                      type="button"
                      onClick={() => {
                        setShowLibraryMenu(false);
                        setIsExportModalOpen(true);
                      }}
                      disabled={savedSongs.length === 0}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800 text-emerald-300 flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <FolderDown className="w-4 h-4 text-emerald-400" />
                      <span>Exportar Respaldo (.zip / .json)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowLibraryMenu(false);
                        handleImportFromFolder();
                      }}
                      disabled={isImportingBackup}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800 text-yellow-300 flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <span className="text-sm">⚡</span>
                      <span>Cargar Carpeta / USB Sincronizada</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowLibraryMenu(false);
                        backupFileInputRef.current?.click();
                      }}
                      disabled={isImportingBackup}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800 text-amber-300 flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <FolderUp className="w-4 h-4 text-amber-400" />
                      <span>Importar Archivo (.zip / .klab)</span>
                    </button>

                    <div className="h-px bg-slate-800 my-0.5" />

                    <button
                      type="button"
                      onClick={() => {
                        setShowLibraryMenu(false);
                        setIsExpanded(true);
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800 text-cyan-300 flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <Maximize2 className="w-4 h-4 text-[#00f0ff]" />
                      <span>Gestor Completo (Estudio)</span>
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* 1-CLICK AGRANDAR PANTALLA BOTÓN (Icono Estudio Profesional a la Derecha de Opciones) */}
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="p-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-cyan-400/70 text-cyan-300 hover:text-white cursor-pointer transition-all shadow-sm hover:shadow-[0_0_12px_rgba(0,240,255,0.35)] shrink-0 active:scale-95"
              title="Agrandar biblioteca a pantalla completa"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Hidden Backup File Input */}
        <input
          ref={backupFileInputRef}
          type="file"
          accept=".klab,.zip,.karaokelab,.json,application/json,application/zip,application/x-zip-compressed"
          onChange={handleImportBackupFile}
          className="hidden"
        />

        {/* Backup Feedback Toast */}
        {backupFeedback && (
          <div className="px-3.5 py-1.5 bg-indigo-950 text-indigo-200 text-xs font-semibold border-b border-indigo-800 flex items-center justify-between animate-in fade-in">
            <span>{backupFeedback}</span>
            <button onClick={() => setBackupFeedback(null)} className="text-indigo-400 hover:text-white ml-2">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ── Ultra-Compact Search & Filter Toolbar ─────────────────── */}
        <div className="p-2.5 bg-slate-950/90 border-b border-slate-800 flex flex-col gap-2">
          {/* Main Library Tabs: Locales vs YouTube */}
          <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs font-bold">
            <button
              type="button"
              onClick={() => setLibraryTab('local')}
              className={`flex-1 py-1.5 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${libraryTab === 'local'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
                }`}
            >
              <Music2 className="w-3.5 h-3.5" />
              <span>Locales</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full font-bold ${libraryTab === 'local' ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
                }`}>
                {filteredSongs.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setLibraryTab('youtube')}
              className={`flex-1 py-1.5 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${libraryTab === 'youtube'
                ? 'bg-red-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
                }`}
            >
              <Youtube className="w-3.5 h-3.5 fill-current" />
              <span>YouTube</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full font-bold ${libraryTab === 'youtube' ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
                }`}>
                {filteredYouTubeFavorites.length}
              </span>
            </button>
          </div>

          {/* Local Search & Filter Toolbar - Shown only in Locales tab */}
          {libraryTab === 'local' && (
            <>
              {/* Row 1: Search Input + Filter Toggle Button */}
              <div className="flex items-center gap-1.5">
                <div className="relative flex items-center flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                  <input
                    type="search"
                    enterKeyHint="search"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="Buscar canción, artista o género..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={(e) => {
                      setTimeout(() => {
                        e.target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }, 300);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#00f0ff] transition-colors"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 text-slate-400 hover:text-white cursor-pointer"
                      title="Limpiar búsqueda"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Filter Toggle Button */}
                {(() => {
                  const activeCount = (selectedArtist !== 'ALL' ? 1 : 0) + (selectedGenre !== 'ALL' ? 1 : 0) + (activeProfileId !== 'profile_all' ? 1 : 0);
                  return (
                    <button
                      onClick={() => setShowFilters((prev) => !prev)}
                      className={`p-1.5 px-2 rounded-lg border text-xs font-semibold flex items-center gap-1 cursor-pointer transition-all shrink-0 ${showFilters || activeCount > 0
                        ? 'bg-slate-800 border-cyan-500/50 text-cyan-300'
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      title={showFilters ? 'Ocultar filtros' : 'Mostrar filtros'}
                    >
                      <Filter className="w-3.5 h-3.5" />
                      <span className="text-[10px] hidden sm:inline">Filtros</span>
                      {activeCount > 0 && (
                        <span className="w-4 h-4 rounded-full bg-[#00f0ff] text-slate-950 font-bold text-[9px] flex items-center justify-center font-mono">
                          {activeCount}
                        </span>
                      )}
                    </button>
                  );
                })()}
              </div>

          {/* Row 1.5: Organizador de Ordenamiento Rápido */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-1 px-1.5 bg-slate-900/90 rounded-xl border border-slate-800 scrollbar-none">
            <span className="text-[10px] font-mono text-cyan-400 font-extrabold uppercase tracking-wider shrink-0 flex items-center gap-1 mr-0.5">
              <ArrowUpDown className="w-3 h-3 text-[#00f0ff]" />
              <span>Ordenar:</span>
            </span>

            {/* Abecedario Título A-Z */}
            <button
              type="button"
              onClick={() => setSortBy('title')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold tracking-wide transition-all cursor-pointer flex items-center gap-1 shrink-0 ${sortBy === 'title'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_10px_rgba(0,240,255,0.4)] border border-cyan-400/60 scale-105'
                : 'bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
              title="Ordenar por Abecedario (Título A-Z)"
            >
              <span>🔤 Abecedario</span>
            </button>

            {/* Artista A-Z */}
            <button
              type="button"
              onClick={() => setSortBy('artist')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold tracking-wide transition-all cursor-pointer flex items-center gap-1 shrink-0 ${sortBy === 'artist'
                ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-[0_0_10px_rgba(168,85,247,0.4)] border border-purple-400/60 scale-105'
                : 'bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
              title="Ordenar por Artista (A-Z)"
            >
              <User className="w-3 h-3 text-purple-300" />
              <span>Artista</span>
            </button>

            {/* Añadidos Recientes */}
            <button
              type="button"
              onClick={() => setSortBy('recent')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold tracking-wide transition-all cursor-pointer flex items-center gap-1 shrink-0 ${sortBy === 'recent'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-[0_0_10px_rgba(16,185,129,0.4)] border border-emerald-400/60 scale-105'
                : 'bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
              title="Ordenar por Añadidos Recientemente"
            >
              <Clock className="w-3 h-3 text-emerald-300" />
              <span>Recientes</span>
            </button>

            {/* Duración */}
            <button
              type="button"
              onClick={() => setSortBy('duration')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold tracking-wide transition-all cursor-pointer flex items-center gap-1 shrink-0 ${sortBy === 'duration'
                ? 'bg-gradient-to-r from-pink-500 to-rose-600 text-white shadow-[0_0_10px_rgba(244,63,94,0.4)] border border-pink-400/60 scale-105'
                : 'bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
              title="Ordenar por Duración"
            >
              <span>⏱️ Duración</span>
            </button>
          </div>

          {/* Row 2: Slim Inline Filter Pills (When open) */}
          {showFilters && (
            <div className="flex flex-wrap items-center gap-1.5 animate-in fade-in duration-100">
              {/* 1. Singer Profile Pill */}
              <div className={`flex items-center bg-slate-900 border rounded-lg px-2 py-1 flex-1 min-w-[130px] transition-colors ${activeProfileId !== 'profile_all' ? 'border-cyan-400/60 bg-indigo-950/40 text-cyan-300' : 'border-slate-700/80 text-slate-300'
                }`}>
                <span className="text-xs shrink-0 mr-1">{activeProfile?.avatar || '🎤'}</span>
                <select
                  value={activeProfileId}
                  onChange={(e) => {
                    if (e.target.value === '__new_profile__') {
                      setIsCreateProfileOpen(true);
                    } else {
                      onSelectProfile?.(e.target.value);
                    }
                  }}
                  className="bg-transparent text-xs font-semibold w-full focus:outline-none cursor-pointer truncate"
                >
                  <option value="profile_all" className="bg-slate-900 text-slate-300 font-medium">
                    Cantante: Todos ({savedSongs.length})
                  </option>
                  {profiles
                    .filter((p) => p.id !== 'profile_all')
                    .map((p) => (
                      <option key={p.id} value={p.id} className="bg-slate-900 text-white font-semibold">
                        {p.avatar} {p.name} ({p.favoriteSongIds.length} favs)
                      </option>
                    ))}
                  <option value="__new_profile__" className="bg-slate-900 text-amber-400 font-bold">
                    ➕ + Crear Perfil...
                  </option>
                </select>
              </div>

              {/* 2. Artist Pill */}
              <div className={`flex items-center bg-slate-900 border rounded-lg px-2 py-1 flex-1 min-w-[110px] transition-colors ${selectedArtist !== 'ALL' ? 'border-cyan-400/60 bg-cyan-950/30 text-cyan-300' : 'border-slate-700/80 text-slate-300'
                }`}>
                <User className="w-3 h-3 text-[#00f0ff] shrink-0 mr-1" />
                <select
                  value={selectedArtist}
                  onChange={(e) => setSelectedArtist(e.target.value)}
                  className="bg-transparent text-xs font-medium w-full focus:outline-none cursor-pointer truncate text-slate-300"
                >
                  <option value="ALL" className="bg-slate-900 text-slate-300">Artista: Todos</option>
                  {uniqueArtists.map((art) => (
                    <option key={art} value={art} className="bg-slate-900 text-white">
                      {art}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Genre Pill */}
              <div className={`flex items-center bg-slate-900 border rounded-lg px-2 py-1 flex-1 min-w-[100px] transition-colors ${selectedGenre !== 'ALL' ? 'border-[#ff007f]/60 bg-pink-950/30 text-pink-300' : 'border-slate-700/80 text-slate-300'
                }`}>
                <Tag className="w-3 h-3 text-[#ff007f] shrink-0 mr-1" />
                <select
                  value={selectedGenre}
                  onChange={(e) => setSelectedGenre(e.target.value)}
                  className="bg-transparent text-xs font-medium w-full focus:outline-none cursor-pointer truncate text-slate-300"
                >
                  <option value="ALL" className="bg-slate-900 text-slate-300">Género: Todos</option>
                  {uniqueGenres.map((g) => (
                    <option key={g} value={g} className="bg-slate-900 text-white">
                      {g}
                    </option>
                  ))}
                  <option value="Cyberpunk" className="bg-slate-900 text-white">Cyberpunk</option>
                  <option value="Pop" className="bg-slate-900 text-white">Pop</option>
                  <option value="Rock" className="bg-slate-900 text-white">Rock</option>
                  <option value="Urbano / Reggaeton" className="bg-slate-900 text-white">Urbano / Reggaeton</option>
                  <option value="Electrónica" className="bg-slate-900 text-white">Electrónica</option>
                  <option value="Balada" className="bg-slate-900 text-white">Balada</option>
                  <option value="General" className="bg-slate-900 text-white">General</option>
                </select>
              </div>

              {/* Reset Filters shortcut if active */}
              {hasActiveFilters && (
                <button
                  onClick={handleResetFilters}
                  className="p-1 px-1.5 rounded-lg text-[10px] text-slate-400 hover:text-white bg-slate-800/80 border border-slate-700 cursor-pointer flex items-center gap-0.5 shrink-0 font-medium"
                  title="Limpiar filtros"
                >
                  <X className="w-2.5 h-2.5" />
                  <span>Limpiar</span>
                </button>
              )}
            </div>
          )}

          {/* Active Singer Action Pill (when a singer like John is selected) */}
          {activeProfile && activeProfile.id !== 'profile_all' && (
            <div className="px-2.5 py-1 bg-indigo-950/60 border border-indigo-500/40 rounded-lg flex items-center justify-between text-xs animate-in fade-in duration-100">
              <div className="flex items-center gap-1.5 text-indigo-200">
                <span className="text-sm">{activeProfile.avatar}</span>
                <span className="font-bold text-white text-[11px] truncate">{activeProfile.name}</span>
                <span className="text-[10px] font-mono text-cyan-400">({activeProfile.favoriteSongIds.length} favs)</span>
              </div>
              <div className="flex items-center gap-1">
                {activeProfile.favoriteSongIds.length > 0 && (
                  <button
                    onClick={handleAddProfileFavoritesToQueue}
                    className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold cursor-pointer transition-colors shadow-sm"
                    title={`Encolar repertorio completo de ${activeProfile.name}`}
                  >
                    ⚡ Encolar
                  </button>
                )}
                <button
                  onClick={() => onDeleteProfile?.(activeProfile.id)}
                  className="p-0.5 text-slate-400 hover:text-rose-400 cursor-pointer transition-colors"
                  title={`Eliminar perfil de ${activeProfile.name}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
          </>
        )}
        </div>

        {/* Songs List */}
        <div className="flex flex-col flex-1 overflow-y-auto divide-y divide-slate-850 h-full">
          {/* SEARCH ACTIVE: SHOW UNIFIED LIST (YOUTUBE + LOCAL) */}
          {searchQuery.trim().length > 0 ? (
            <>
              {filteredYouTubeFavorites.length === 0 && filteredSongs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-500 font-mono text-[11px] gap-2 px-4 text-center">
                  <Filter className="w-6 h-6 opacity-30 text-[#00f0ff]" />
                  <span>No hay canciones locales ni videos de YouTube que coincidan con la búsqueda</span>
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="mt-1 px-3 py-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-[10px] font-bold border border-slate-700 cursor-pointer"
                  >
                    Restablecer Filtros
                  </button>
                </div>
              ) : (
                <>
                  {/* YouTube Favorites Section in Unified Search */}
                  {filteredYouTubeFavorites.length > 0 && (
                    <div className="p-3 bg-red-950/20 border-b border-red-500/25 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-red-400 font-mono uppercase tracking-wider flex items-center gap-1.5">
                          <Youtube className="w-3.5 h-3.5 fill-current text-red-500" />
                          <span>YouTube Karaoke ({filteredYouTubeFavorites.length})</span>
                        </span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {filteredYouTubeFavorites.map((yt) => {
                          const prof = profiles.find((p) => p.id === yt.singerProfileId);
                          return (
                            <div
                              key={yt.id}
                              className="flex items-center justify-between p-2 rounded-xl bg-slate-900/90 border border-red-500/30 hover:border-red-500/60 transition-all gap-3 shadow-md"
                            >
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <img
                                  src={yt.thumbnail}
                                  alt={yt.title}
                                  className="w-12 h-9 rounded object-cover shrink-0 bg-slate-950"
                                />
                                <div className="flex flex-col min-w-0">
                                  <span className="text-xs font-bold text-white truncate">
                                    {yt.title}
                                  </span>
                                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400 truncate">
                                    <span>{yt.channel}</span>
                                    <span>·</span>
                                    <span className="font-mono">{yt.duration}</span>
                                    {prof && prof.id !== 'profile_all' && (
                                      <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">
                                        {prof.avatar} {prof.name}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => onOpenYouTubeEmbed ? onOpenYouTubeEmbed(yt.id) : onOpenYouTubeModal?.()}
                                  className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                                >
                                  <Play className="w-3 h-3 fill-current" />
                                  <span>Ver Video</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onToggleYouTubeFavorite?.(yt, yt.singerProfileId)}
                                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 cursor-pointer"
                                  title="Quitar de favoritos"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Local Songs Section in Unified Search */}
                  {filteredSongs.map((song) => {
                    const isSelected = currentSongId === song.id;
                    const inQueue = isSongInQueue(song.id);
                    return (
                      <div
                        key={song.id}
                        onClick={() => setSongActionTarget(song)}
                        className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-all group hover:bg-slate-800/50 rounded-xl select-none"
                      >
                        <div className="shrink-0 w-8 h-8 rounded-lg bg-slate-800/80 border border-slate-700/60 flex items-center justify-center group-hover:border-cyan-500/50 group-hover:bg-cyan-500/10 transition-colors">
                          <Music2 className="w-4 h-4 text-slate-400 group-hover:text-cyan-400 transition-colors" />
                        </div>

                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-xs font-semibold truncate text-slate-200 group-hover:text-white">
                            {song.title}
                          </span>
                          <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400 truncate mt-0.5">
                            <span>{song.artist || 'Desconocido'}</span>
                            <span>·</span>
                            <span>{fmt(song.duration)}</span>
                            <span>·</span>
                            <span className="text-[#00f0ff]">{song.bpm} BPM</span>
                            {song.genre && (
                              <span className="text-amber-300 bg-amber-400/10 px-1 rounded text-[9px]">
                                {song.genre}
                              </span>
                            )}
                            {song.stems?.instrumentalBlob && (
                              <span className="text-[#00ff9d] bg-[#00ff9d]/15 px-1 rounded text-[9px]">
                                ✓ Stems
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {(() => {
                            const isFav = activeProfile && activeProfile.id !== 'profile_all'
                              ? activeProfile.favoriteSongIds.includes(song.id)
                              : profiles.some((p) => p.id !== 'profile_all' && p.favoriteSongIds.includes(song.id));
                            return (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (activeProfile && activeProfile.id !== 'profile_all') {
                                    onToggleFavoriteSong?.(activeProfile.id, song.id);
                                  } else {
                                    setSongForProfileAssign(song);
                                  }
                                }}
                                className={`p-1.5 rounded-lg border text-xs font-semibold flex items-center justify-center cursor-pointer transition-all ${isFav
                                  ? 'border-amber-500/60 bg-amber-500/20 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                                  : 'border-slate-700/80 bg-slate-800/60 text-slate-400 hover:text-amber-300 hover:border-amber-500/40'
                                  }`}
                                title={
                                  activeProfile && activeProfile.id !== 'profile_all'
                                    ? isFav
                                      ? `Quitar de favoritas de ${activeProfile.name}`
                                      : `Añadir a favoritas de ${activeProfile.name}`
                                    : 'Asignar canción a perfil de cantante'
                                }
                              >
                                <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-amber-400 text-amber-400' : ''}`} />
                              </button>
                            );
                          })()}

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddToQueue(song);
                            }}
                            className={`p-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 cursor-pointer transition-all ${inQueue
                              ? 'border-[#00ff9d]/40 bg-[#00ff9d]/10 text-[#00ff9d]'
                              : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white hover:border-[#00f0ff]/60 hover:bg-[#00f0ff]/15'
                              }`}
                            title={inQueue ? 'Ya está en la cola' : 'Agregar a la cola de reproducción'}
                          >
                            {inQueue ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span className="text-[10px] font-bold text-[#00ff9d]">En cola</span>
                              </>
                            ) : (
                              <>
                                <ListPlus className="w-3.5 h-3.5 text-[#00f0ff]" />
                                <span className="text-[10px] font-bold text-[#00f0ff]">Encolar</span>
                              </>
                            )}
                          </button>

                          {(!activeProfile || activeProfile.id === 'profile_all') && !isGuestMode && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSongToDelete(song);
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-[#ff007f] hover:bg-[#ff007f]/10 cursor-pointer transition-all"
                              title="Eliminar de la biblioteca"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          ) : (
            <>
              {/* TAB 1: LOCAL SONGS ONLY */}
              {libraryTab === 'local' && (
                <>
                  {filteredSongs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-slate-500 font-mono text-[11px] gap-2 px-4 text-center">
                      <Filter className="w-6 h-6 opacity-30 text-[#00f0ff]" />
                      <span>No hay canciones locales que coincidan con la búsqueda</span>
                      {filteredYouTubeFavorites.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setLibraryTab('youtube')}
                          className="mt-1 px-3 py-1.5 rounded-lg bg-red-600/30 text-red-300 hover:bg-red-600/50 border border-red-500/40 text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5"
                        >
                          <Youtube className="w-3.5 h-3.5 fill-current" />
                          <span>Ver {filteredYouTubeFavorites.length} en YouTube →</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    filteredSongs.map((song) => {
                      const isSelected = currentSongId === song.id;
                      const inQueue = isSongInQueue(song.id);
                      return (
                      <div
                        key={song.id}
                        onClick={() => setSongActionTarget(song)}
                        className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-all group hover:bg-slate-800/50 rounded-xl select-none"
                      >
                        <div className="shrink-0 w-8 h-8 rounded-lg bg-slate-800/80 border border-slate-700/60 flex items-center justify-center group-hover:border-cyan-500/50 group-hover:bg-cyan-500/10 transition-colors">
                          <Music2 className="w-4 h-4 text-slate-400 group-hover:text-cyan-400 transition-colors" />
                        </div>

                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-xs font-semibold truncate text-slate-200 group-hover:text-white">
                            {song.title}
                          </span>
                          <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400 truncate mt-0.5">
                            <span>{song.artist || 'Desconocido'}</span>
                            <span>·</span>
                            <span>{fmt(song.duration)}</span>
                            <span>·</span>
                            <span className="text-[#00f0ff]">{song.bpm} BPM</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                            {/* Favorite Star Button */}
                            {(() => {
                              const isFav = activeProfile && activeProfile.id !== 'profile_all'
                                ? activeProfile.favoriteSongIds.includes(song.id)
                                : profiles.some((p) => p.id !== 'profile_all' && p.favoriteSongIds.includes(song.id));
                              return (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (activeProfile && activeProfile.id !== 'profile_all') {
                                      onToggleFavoriteSong?.(activeProfile.id, song.id);
                                    } else {
                                      setSongForProfileAssign(song);
                                    }
                                  }}
                                  className={`p-1.5 rounded-lg border text-xs font-semibold flex items-center justify-center cursor-pointer transition-all ${isFav
                                    ? 'border-amber-500/60 bg-amber-500/20 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                                    : 'border-slate-700/80 bg-slate-800/60 text-slate-400 hover:text-amber-300 hover:border-amber-500/40'
                                    }`}
                                  title={
                                    activeProfile && activeProfile.id !== 'profile_all'
                                      ? isFav
                                        ? `Quitar de favoritas de ${activeProfile.name}`
                                        : `Añadir a favoritas de ${activeProfile.name}`
                                      : 'Asignar canción a perfil de cantante'
                                  }
                                >
                                  <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-amber-400 text-amber-400' : ''}`} />
                                </button>
                              );
                            })()}

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onAddToQueue(song);
                              }}
                              className={`p-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 cursor-pointer transition-all ${inQueue
                                ? 'border-[#00ff9d]/40 bg-[#00ff9d]/10 text-[#00ff9d]'
                                : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white hover:border-[#00f0ff]/60 hover:bg-[#00f0ff]/15'
                                }`}
                              title={inQueue ? 'Ya está en la cola' : 'Agregar a la cola de reproducción'}
                            >
                              {inQueue ? (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  <span className="text-[10px] font-bold text-[#00ff9d]">En cola</span>
                                </>
                              ) : (
                                <>
                                  <ListPlus className="w-3.5 h-3.5 text-[#00f0ff]" />
                                  <span className="text-[10px] font-bold text-[#00f0ff]">Encolar</span>
                                </>
                              )}
                            </button>

                            {/* Delete button only appears in Todos and is hidden in guest mode */}
                            {(!activeProfile || activeProfile.id === 'profile_all') && !isGuestMode && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSongToDelete(song);
                                }}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-[#ff007f] hover:bg-[#ff007f]/10 cursor-pointer transition-all"
                                title="Eliminar de la biblioteca"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </>
              )}

              {/* TAB 3: YOUTUBE KARAOKE SEARCH & FAVORITES HUB */}
              {libraryTab === 'youtube' && (
                <div className="p-3 flex flex-col gap-3 animate-in fade-in duration-200">
                  {/* YouTube Search Bar */}
                  <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-red-500/40 flex flex-col gap-2.5 shadow-xl">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-red-300 flex items-center gap-1.5 font-mono uppercase tracking-wider">
                        <Youtube className="w-3.5 h-3.5 text-red-500 fill-current" />
                        <span>Buscador YouTube en Vivo</span>
                      </span>
                      <span className="text-[10px] text-slate-400">Karaoke / Videos oficiales</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type="search"
                          enterKeyHint="search"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          placeholder="Busca por canción o artista (ej. Luis Miguel, Bad Bunny)..."
                          value={ytQuery}
                          onChange={(e) => setYtQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              (e.target as HTMLInputElement).blur();
                              handleYouTubeSearch();
                            }
                          }}
                          className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-red-500 focus:shadow-[0_0_15px_rgba(239,68,68,0.2)] transition-all"
                        />
                        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        {ytQuery && (
                          <button
                            type="button"
                            onClick={() => { setYtQuery(''); setYtResults([]); }}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleYouTubeSearch()}
                        disabled={ytSearching || !ytQuery.trim()}
                        className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-50 text-white font-black text-xs shrink-0 cursor-pointer shadow-md hover:scale-105 active:scale-95 transition-all flex items-center gap-1.5"
                      >
                        {ytSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                        <span>Buscar</span>
                      </button>
                    </div>

                    {/* Popular Suggestions */}
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
                      <span className="text-slate-500 font-mono font-bold shrink-0">Popular:</span>
                      {['Luis Miguel', 'Bad Bunny', 'Karol G', 'Queen', 'Rocío Dúrcal', 'RBD', 'Salsa', 'Cumbia'].map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => {
                            setYtQuery(tag);
                            handleYouTubeSearch(tag);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition-colors cursor-pointer shrink-0"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>

                    {/* Singer Profile Active Indicator */}
                    {profiles && profiles.length > 1 && (
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 text-xs border-t border-slate-800/80">
                        <span className="text-[10px] text-slate-400 font-mono shrink-0">Cantante activo:</span>
                        {profiles.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => onSelectProfile?.(p.id)}
                            className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all flex items-center gap-1 shrink-0 cursor-pointer ${
                              activeProfileId === p.id
                                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-black shadow-md'
                                : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60'
                            }`}
                          >
                            <span>{p.avatar}</span>
                            <span>{p.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Active Preview Embed Player */}
                  {ytActiveEmbedId && (
                    <div className="rounded-2xl overflow-hidden border border-red-500/40 bg-black shadow-[0_0_30px_rgba(239,68,68,0.2)]">
                      <div className="p-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                        <span className="text-xs font-bold text-red-400 font-mono flex items-center gap-1.5">
                          <Play className="w-3.5 h-3.5 fill-current" />
                          PREVIEW DE VIDEO
                        </span>
                        <button
                          type="button"
                          onClick={() => setYtActiveEmbedId(null)}
                          className="text-xs text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800 cursor-pointer"
                        >
                          Cerrar Preview
                        </button>
                      </div>
                      <div className="relative aspect-video w-full">
                        <iframe
                          src={`https://www.youtube.com/embed/${ytActiveEmbedId}?autoplay=1`}
                          title="YouTube Player Preview"
                          className="w-full h-full border-0"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    </div>
                  )}

                  {/* YouTube Results List */}
                  {ytSearching ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400 bg-slate-900/40 rounded-2xl border border-slate-800">
                      <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
                      <p className="text-xs font-medium">Buscando pistas de Karaoke en YouTube...</p>
                    </div>
                  ) : ytResults.length > 0 ? (
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                          <Youtube className="w-4 h-4 text-red-500" />
                          Resultados de YouTube ({ytResults.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => setYtResults([])}
                          className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
                        >
                          Limpiar resultados
                        </button>
                      </div>

                      <div className="flex flex-col gap-2.5">
                        {ytResults.map((item) => {
                          const isFav = youtubeFavorites.some(
                            (fav) => fav.id === item.id && (fav.singerProfileId === activeProfileId || activeProfileId === 'profile_all')
                          );
                          const isInQueue = queue.some(
                            (q) => q.songData?.id === `yt_${item.id}` || q.songData?.videoBgId === item.id || q.id.includes(item.id)
                          );

                          const ytSongItem: SongItem = {
                            id: `yt_${item.id}`,
                            title: item.title,
                            artist: item.channel,
                            duration: 240,
                            bpm: 120,
                            key: 'C',
                            lyrics: [],
                            originalFileName: `${item.title}.mp4`,
                            videoBgId: item.id,
                            videoBgMode: 'custom',
                            videoBgCustomUrl: `https://www.youtube.com/watch?v=${item.id}`,
                            createdAt: Date.now(),
                          };

                          return (
                            <div
                              key={item.id}
                              className="flex flex-col p-3 rounded-2xl bg-slate-900/95 border border-slate-800 hover:border-red-500/50 transition-all shadow-lg gap-2.5 group"
                            >
                              {/* Top row: HD Thumbnail + Info */}
                              <div className="flex items-center gap-3">
                                <div
                                  onClick={() => setYtActiveEmbedId(ytActiveEmbedId === item.id ? null : item.id)}
                                  className="relative w-28 h-18 sm:w-32 sm:h-20 rounded-xl overflow-hidden shrink-0 bg-slate-950 border border-slate-800 cursor-pointer group-hover:border-red-500/40 transition-all"
                                  title="Ver preview del video"
                                >
                                  <img
                                    src={item.thumbnail}
                                    alt={item.title}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                    onError={(e) => {
                                      (e.target as any).src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80';
                                    }}
                                  />
                                  <div className="absolute inset-0 bg-black/40 group-hover:bg-black/10 flex items-center justify-center transition-colors">
                                    <Play className="w-6 h-6 text-white/90 group-hover:text-white drop-shadow-md" />
                                  </div>
                                  <span className="absolute bottom-1 right-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/85 text-white font-bold border border-white/10">
                                    {item.duration}
                                  </span>
                                </div>

                                <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                                  <h3 className="text-xs sm:text-sm font-bold text-white line-clamp-2 leading-snug group-hover:text-red-300 transition-colors">
                                    {item.title}
                                  </h3>
                                  <div className="flex items-center gap-2 text-[11px] text-slate-400 truncate">
                                    <span className="truncate">{item.channel}</span>
                                    <span>•</span>
                                    <span className="font-mono text-[10px] text-red-400 font-semibold">{item.duration}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Bottom row: Action Buttons */}
                              <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                                <button
                                  type="button"
                                  onClick={() => onAddToQueue(ytSongItem)}
                                  disabled={isInQueue}
                                  className={`flex-1 py-2.5 px-4 rounded-xl border text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md active:scale-95 ${
                                    isInQueue
                                      ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300 cursor-default shadow-none'
                                      : 'bg-gradient-to-r from-cyan-500/20 via-blue-600/20 to-cyan-500/20 hover:from-cyan-500/30 hover:to-blue-600/30 text-cyan-300 border-cyan-500/50 hover:border-cyan-400 shadow-[0_0_15px_rgba(0,240,255,0.15)]'
                                  }`}
                                  title={isInQueue ? 'Ya está en la cola de reproducción' : 'Agregar a la cola de reproducción'}
                                >
                                  {isInQueue ? (
                                    <>
                                      <Check className="w-4 h-4 text-emerald-400" />
                                      <span>Ya en Cola</span>
                                    </>
                                  ) : (
                                    <>
                                      <ListPlus className="w-4 h-4 text-cyan-400" />
                                      <span>+ Agregar a la Cola</span>
                                    </>
                                  )}
                                </button>

                                {onToggleYouTubeFavorite && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setYtTrackForProfileAssign({
                                        id: item.id,
                                        title: item.title,
                                        channel: item.channel,
                                        duration: item.duration,
                                        thumbnail: item.thumbnail,
                                        url: item.url,
                                      })
                                    }
                                    className={`p-2.5 px-3 rounded-xl border transition-all cursor-pointer shrink-0 ${
                                      isFav
                                        ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-amber-300 hover:border-slate-600'
                                    }`}
                                    title="Asignar video a perfil de cantante"
                                  >
                                    <Star className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {/* Saved YouTube Favorites Section */}
                  {filteredYouTubeFavorites.length > 0 && (
                    <div className="flex flex-col gap-2 pt-2 border-t border-slate-800">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                          <Star className="w-3.5 h-3.5 fill-current text-amber-400" />
                          Videos Guardados en Favoritos ({filteredYouTubeFavorites.length})
                        </span>
                      </div>

                      <div className="flex flex-col gap-2">
                        {filteredYouTubeFavorites.map((yt) => {
                          const prof = profiles.find((p) => p.id === yt.singerProfileId);
                          const isInQueue = queue.some(
                            (q) => q.songData?.id === `yt_${yt.id}` || q.songData?.videoBgId === yt.id || q.id.includes(yt.id)
                          );

                          const ytSongItem: SongItem = {
                            id: `yt_${yt.id}`,
                            title: yt.title,
                            artist: yt.channel,
                            duration: 240,
                            bpm: 120,
                            key: 'C',
                            lyrics: [],
                            originalFileName: `${yt.title}.mp4`,
                            videoBgId: yt.id,
                            videoBgMode: 'custom',
                            videoBgCustomUrl: `https://www.youtube.com/watch?v=${yt.id}`,
                            createdAt: Date.now(),
                          };

                          return (
                            <div
                              key={yt.id}
                              className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/90 border border-red-500/30 hover:border-red-500/60 transition-all gap-3 shadow-md"
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <img
                                  src={yt.thumbnail}
                                  alt={yt.title}
                                  className="w-16 h-11 rounded-xl object-cover shrink-0 bg-slate-900 border border-slate-800"
                                />
                                <div className="flex flex-col min-w-0">
                                  <span className="text-xs sm:text-sm font-bold text-white truncate">
                                    {yt.title}
                                  </span>
                                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400 truncate mt-0.5">
                                    <span>{yt.channel}</span>
                                    <span>·</span>
                                    <span className="font-mono text-red-400">{yt.duration}</span>
                                    {prof && prof.id !== 'profile_all' && (
                                      <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">
                                        {prof.avatar} {prof.name}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => onAddToQueue(ytSongItem)}
                                  disabled={isInQueue}
                                  className={`py-1.5 px-3 rounded-xl border text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                                    isInQueue
                                      ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300 cursor-default'
                                      : 'bg-slate-800 hover:bg-slate-700 text-cyan-300 border-cyan-500/40'
                                  }`}
                                  title={isInQueue ? 'Ya está en la cola' : 'Agregar a la cola'}
                                >
                                  {isInQueue ? <Check className="w-3.5 h-3.5" /> : <ListPlus className="w-3.5 h-3.5 text-cyan-400" />}
                                  <span>{isInQueue ? 'En Cola' : 'Encolar'}</span>
                                </button>

                                {onToggleYouTubeFavorite && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setYtTrackForProfileAssign({
                                        id: yt.id,
                                        title: yt.title,
                                        channel: yt.channel,
                                        duration: yt.duration,
                                        thumbnail: yt.thumbnail,
                                        url: yt.url,
                                      })
                                    }
                                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 cursor-pointer"
                                    title="Asignar a cantantes"
                                  >
                                    <Star className="w-3.5 h-3.5 fill-current" />
                                  </button>
                                )}

                                {onToggleYouTubeFavorite && (
                                  <button
                                    type="button"
                                    onClick={() => onToggleYouTubeFavorite(yt, yt.singerProfileId)}
                                    className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 cursor-pointer"
                                    title="Quitar de favoritos"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {!ytSearching && ytResults.length === 0 && filteredYouTubeFavorites.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-500 text-center">
                      <Youtube className="w-12 h-12 text-red-500/40 animate-pulse" />
                      <p className="text-xs font-bold text-slate-300">Buscador de Karaoke YouTube</p>
                      <p className="text-[11px] text-slate-500 max-w-xs">
                        Escribe el nombre de tu canción favorita o artista en el buscador de arriba para encontrar pistas de karaoke en YouTube al instante.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── EXPANDED FULL LIBRARY STUDIO MODAL (100% PANTALLA COMPLETA REAL) ─────────────────── */}
      {isExpanded && (
        <div className="fixed inset-0 z-50 bg-[#080811] flex flex-col w-screen h-screen overflow-hidden animate-in fade-in duration-200">
          <div className="w-full h-full bg-[#0b0d14] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-3.5 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#ff007f]/25 to-[#00f0ff]/25 border border-slate-700 flex items-center justify-center text-[#00f0ff]">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white uppercase tracking-tight flex items-center gap-2">
                    Gestor de Biblioteca
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono font-normal">
                      {savedSongs.length} temas · {totalDurationMinutes} min
                    </span>
                  </h2>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* View Mode Toggle */}
                <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-1.5 rounded-md transition-all cursor-pointer ${viewMode === 'list' ? 'bg-slate-800 text-[#00f0ff] shadow-sm' : 'text-slate-500 hover:text-slate-300'
                      }`}
                    title="Vista Lista Compacta"
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-1.5 rounded-md transition-all cursor-pointer ${viewMode === 'grid' ? 'bg-slate-800 text-[#00f0ff] shadow-sm' : 'text-slate-500 hover:text-slate-300'
                      }`}
                    title="Vista Cuadrícula Sutil"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Backup & Restore Action Buttons */}
                <button
                  onClick={() => setIsExportModalOpen(true)}
                  disabled={savedSongs.length === 0}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all"
                  title="Exportar respaldo de la biblioteca (Audio completo .ZIP o solo letras .JSON)"
                >
                  <FolderDown className="w-3.5 h-3.5" />
                  <span>Exportar Respaldo</span>
                </button>

                <button
                  onClick={() => backupFileInputRef.current?.click()}
                  disabled={isImportingBackup}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all"
                  title="Importar y restaurar archivo de respaldo (.zip o .json)"
                >
                  <FolderUp className="w-3.5 h-3.5" />
                  <span>Importar Respaldo</span>
                </button>

                <button
                  onClick={() => expandedFileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  Subir
                </button>
                <input
                  ref={expandedFileInputRef}
                  type="file"
                  multiple
                  accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.lrc"
                  onChange={(e) => e.target.files?.length && onFilesSelected(e.target.files)}
                  className="hidden"
                />

                <button
                  onClick={() => setIsExpanded(false)}
                  className="p-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                  title="Salir de pantalla completa"
                >
                  <Minimize2 className="w-4 h-4 text-cyan-400" />
                  <span className="hidden sm:inline">Reducir</span>
                </button>
              </div>
            </div>

            {/* Subtle Controls Bar */}
            <div className="px-4 py-2.5 bg-slate-950/80 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
                {/* Search */}
                <div className="relative flex items-center min-w-[180px] flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                  <input
                    type="search"
                    enterKeyHint="search"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="Buscar título, artista, género..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#00f0ff]"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="absolute right-2 text-slate-400 hover:text-white cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Singer Profile Filter Dropdown */}
                <select
                  value={activeProfileId}
                  onChange={(e) => {
                    if (e.target.value === '__new_profile__') {
                      setIsCreateProfileOpen(true);
                    } else {
                      onSelectProfile?.(e.target.value);
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-xs text-cyan-300 font-bold focus:outline-none cursor-pointer"
                >
                  <option value="profile_all" className="bg-slate-900 text-cyan-400 font-bold">
                    👥 Perfil: Todos ({savedSongs.length})
                  </option>
                  {profiles
                    .filter((p) => p.id !== 'profile_all')
                    .map((p) => (
                      <option key={p.id} value={p.id} className="bg-slate-900 text-white font-medium">
                        {p.avatar} Cantante: {p.name} ({p.favoriteSongIds.length})
                      </option>
                    ))}
                  <option value="__new_profile__" className="bg-slate-900 text-amber-400 font-bold">
                    ➕ + Nuevo Perfil...
                  </option>
                </select>

                {/* Artist Filter */}
                <select
                  value={selectedArtist}
                  onChange={(e) => setSelectedArtist(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-xs text-white font-medium focus:outline-none cursor-pointer"
                >
                  <option value="ALL">👤 Artista: Todos ({uniqueArtists.length})</option>
                  {uniqueArtists.map((art) => (
                    <option key={art} value={art}>👤 {art}</option>
                  ))}
                </select>

                {/* Genre Filter */}
                <select
                  value={selectedGenre}
                  onChange={(e) => setSelectedGenre(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-xs text-white font-medium focus:outline-none cursor-pointer"
                >
                  <option value="ALL">🏷️ Género: Todos</option>
                  {uniqueGenres.map((g) => (
                    <option key={g} value={g}>🏷️ {g}</option>
                  ))}
                  <option value="Cyberpunk">🏷️ Cyberpunk</option>
                  <option value="Pop">🏷️ Pop</option>
                  <option value="Rock">🏷️ Rock</option>
                  <option value="Urbano / Reggaeton">🏷️ Urbano / Reggaeton</option>
                  <option value="Electrónica">🏷️ Electrónica</option>
                  <option value="Balada">🏷️ Balada</option>
                  <option value="General">🏷️ General</option>
                </select>

                {/* Sort By */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-xs text-white font-medium focus:outline-none cursor-pointer"
                >
                  <option value="recent">⇅ Orden: Más recientes</option>
                  <option value="title">⇅ Orden: Título (A-Z)</option>
                  <option value="artist">⇅ Orden: Artista (A-Z)</option>
                  <option value="bpm">⇅ Orden: BPM (Mayor a Menor)</option>
                  <option value="duration">⇅ Orden: Duración</option>
                </select>
              </div>

              {/* Batch & Reset Actions */}
              <div className="flex items-center gap-1.5">
                {activeProfile && activeProfile.id !== 'profile_all' && activeProfile.favoriteSongIds.length > 0 && (
                  <button
                    onClick={handleAddProfileFavoritesToQueue}
                    className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-sm"
                  >
                    <span>⚡ Encolar Repertorio ({activeProfile.favoriteSongIds.length})</span>
                  </button>
                )}

                <button
                  onClick={handleAddAllFilteredToQueue}
                  disabled={filteredSongs.length === 0}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[#00ff9d] text-[11px] font-bold flex items-center gap-1 border border-slate-700/80 cursor-pointer disabled:opacity-40 transition-all"
                  title="Añadir canciones visibles a la cola"
                >
                  <Layers className="w-3 h-3" />
                  + Cola ({filteredSongs.length})
                </button>

                {hasActiveFilters && (
                  <button
                    onClick={handleResetFilters}
                    className="px-2 py-1.5 rounded-lg text-slate-400 hover:text-white text-[11px] font-medium cursor-pointer"
                  >
                    Limpiar
                  </button>
                )}
              </div>
            </div>

            {/* Subtle Songs Content */}
            <div className="flex-1 overflow-y-auto p-3">
              {filteredSongs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500 font-mono text-xs gap-2">
                  <Database className="w-8 h-8 opacity-30 text-[#00f0ff]" />
                  <span>Sin resultados para la búsqueda</span>
                  <button
                    onClick={handleResetFilters}
                    className="mt-1 px-3 py-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-xs font-bold border border-slate-700 cursor-pointer"
                  >
                    Restablecer
                  </button>
                </div>
              ) : viewMode === 'list' ? (
                /* ── COMPACT SUBTLE LIST VIEW (Clean Single-Row Layout) ── */
                <div className="flex flex-col divide-y divide-slate-850/80 border border-slate-800/80 rounded-xl overflow-hidden bg-slate-950/40">
                  {filteredSongs.map((song, idx) => {
                    const isSelected = currentSongId === song.id;
                    const inQueue = isSongInQueue(song.id);
                    const isReanalyzing = reanalyzingSongId === song.id;
                    return (
                      <div
                        key={song.id}
                        className={`flex items-center justify-between gap-3 px-3.5 py-2 hover:bg-slate-800/40 transition-colors group ${isSelected ? 'bg-indigo-950/30 border-l-2 border-[#00f0ff]' : ''
                          }`}
                      >
                        {/* Left: Index + Title + Artist (Click to Open Metadata & Actions Menu) */}
                        <div
                          onClick={() => setSongActionTarget(song)}
                          className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer select-none"
                          title="Ver metadatos y opciones"
                        >
                          <span className="text-[10px] font-mono text-slate-500 w-5 text-right shrink-0">
                            {idx + 1}
                          </span>

                          <div className="w-7 h-7 rounded-md bg-slate-800/80 border border-slate-700 flex items-center justify-center shrink-0">
                            <Music2 className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#00f0ff] transition-colors" />
                          </div>

                          <div className="flex flex-col min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-bold truncate ${isSelected ? 'text-[#00f0ff]' : 'text-slate-200'}`}>
                                {song.title}
                              </span>
                              {song.genre && (
                                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-amber-300 border border-slate-700 shrink-0">
                                  {song.genre}
                                </span>
                              )}
                              {song.stems?.instrumentalBlob && (
                                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 shrink-0">
                                  ✓ Karaoke
                                </span>
                              )}
                              {song.videoBgId && (
                                <span
                                  className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-red-950/80 text-red-300 border border-red-800/60 shrink-0 flex items-center gap-1 cursor-help"
                                  title={`Video vinculado: ${song.videoBgTitle || song.videoBgId}`}
                                >
                                  <Youtube className="w-2.5 h-2.5 text-red-400" />
                                  <span>Video</span>
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400 truncate">
                              {song.artist || 'Artista Desconocido'}
                            </span>
                          </div>
                        </div>

                        {/* Center: Metadata Badges */}
                        <div className="hidden md:flex items-center gap-2 text-[10px] font-mono text-slate-400 shrink-0">
                          <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-[#00f0ff]">
                            {song.bpm} BPM
                          </span>
                          {song.key && (
                            <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-emerald-300">
                              {song.key}
                            </span>
                          )}
                          <span className="text-slate-400 w-11 text-right">
                            {fmt(song.duration)}
                          </span>
                        </div>

                        {/* Right: Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          {/* Favorite Star Button */}
                          {(() => {
                            const isFav = activeProfile && activeProfile.id !== 'profile_all'
                              ? activeProfile.favoriteSongIds.includes(song.id)
                              : profiles.some((p) => p.id !== 'profile_all' && p.favoriteSongIds.includes(song.id));
                            return (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (activeProfile && activeProfile.id !== 'profile_all') {
                                    onToggleFavoriteSong?.(activeProfile.id, song.id);
                                  } else {
                                    setSongForProfileAssign(song);
                                  }
                                }}
                                className={`p-1.5 rounded-lg border text-[11px] font-semibold flex items-center justify-center cursor-pointer transition-all ${isFav
                                  ? 'border-amber-500/60 bg-amber-500/20 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                                  : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-amber-300 hover:border-amber-500/40'
                                  }`}
                                title={
                                  activeProfile && activeProfile.id !== 'profile_all'
                                    ? isFav
                                      ? `Quitar de favoritas de ${activeProfile.name}`
                                      : `Añadir a favoritas de ${activeProfile.name}`
                                    : 'Asignar a perfil de cantante'
                                }
                              >
                                <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-amber-400 text-amber-400' : ''}`} />
                              </button>
                            );
                          })()}

                          <button
                            onClick={() => {
                              onSelectSong(song);
                              setIsExpanded(false);
                            }}
                            className="p-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                            title="Reproducir ahora"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span className="hidden sm:inline">Play</span>
                          </button>

                          <button
                            onClick={() => onAddToQueue(song)}
                            className={`p-1.5 rounded-lg border text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all ${inQueue
                              ? 'border-[#00ff9d]/40 bg-[#00ff9d]/10 text-[#00ff9d]'
                              : 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white'
                              }`}
                            title="Agregar a la cola"
                          >
                            {inQueue ? <Check className="w-3 h-3" /> : <ListPlus className="w-3 h-3 text-[#00f0ff]" />}
                            <span className="hidden sm:inline">{inQueue ? 'En cola' : 'Cola'}</span>
                          </button>

                          {/* RE-ANALYZE BPM & KEY (DSP) BUTTON */}
                          <button
                            onClick={() => handleReanalyze(song)}
                            disabled={isReanalyzing}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-[#00f0ff] hover:bg-slate-800 disabled:opacity-50 cursor-pointer transition-colors"
                            title="Re-analizar BPM y Tono exactos con DSP"
                          >
                            {isReanalyzing ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00f0ff]" />
                            ) : (
                              <Sparkles className="w-3.5 h-3.5" />
                            )}
                          </button>

                          <button
                            onClick={() => onDownloadStem && onDownloadStem(song, 'instrumental')}
                            disabled={!song.stems?.instrumentalBlob}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-800 disabled:opacity-30 cursor-pointer transition-colors"
                            title="Descargar Pista Karaoke WAV"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => onOpenPublishModal && onOpenPublishModal(song)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-cyan-950/40 cursor-pointer transition-colors"
                            title="Compartir Canción (Google Drive, HTML, Web)"
                          >
                            <Share2 className="w-3.5 h-3.5 text-cyan-400" />
                          </button>

                          <button
                            onClick={() => handleDownloadLrc(song)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800 cursor-pointer transition-colors"
                            title="Descargar Archivo LRC"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleOpenEdit(song)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 cursor-pointer transition-colors"
                            title="Editar Metadatos"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          {(!activeProfile || activeProfile.id === 'profile_all') && !isGuestMode && (
                            <button
                              onClick={() => setSongToDelete(song)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-[#ff007f] hover:bg-[#ff007f]/10 cursor-pointer transition-colors"
                              title="Eliminar de la biblioteca"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* ── COMPACT SUBTLE GRID VIEW ── */
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {filteredSongs.map((song) => {
                    const isSelected = currentSongId === song.id;
                    const inQueue = isSongInQueue(song.id);
                    const isReanalyzing = reanalyzingSongId === song.id;
                    const isFav = activeProfile && activeProfile.id !== 'profile_all'
                      ? activeProfile.favoriteSongIds.includes(song.id)
                      : profiles.some((p) => p.id !== 'profile_all' && p.favoriteSongIds.includes(song.id));
                    return (
                      <div
                        key={song.id}
                        className={`p-3 rounded-xl border transition-all flex flex-col justify-between gap-2.5 ${isSelected
                          ? 'bg-slate-900 border-[#00f0ff]/60 shadow-sm'
                          : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800/80 hover:border-slate-700'
                          }`}
                      >
                        <div
                          onClick={() => setSongActionTarget(song)}
                          className="flex items-start gap-2.5 cursor-pointer select-none"
                          title="Ver metadatos y opciones"
                        >
                          <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                            <Music2 className="w-4 h-4 text-slate-400" />
                          </div>
                          <div className="flex flex-col min-w-0 flex-1">
                            <h4 className="text-xs font-bold text-white truncate">
                              {song.title}
                            </h4>
                            <span className="text-[11px] text-slate-400 truncate">
                              {song.artist || 'Desconocido'}
                            </span>
                            <div className="flex items-center gap-1.5 mt-1 text-[9px] font-mono text-slate-400">
                              <span>{fmt(song.duration)}</span>
                              <span>·</span>
                              <span className="text-[#00f0ff]">{song.bpm} BPM</span>
                              {song.genre && (
                                <span className="text-amber-300 bg-amber-400/10 px-1 rounded">
                                  {song.genre}
                                </span>
                              )}
                              {song.videoBgId && (
                                <span className="text-red-300 bg-red-950/80 border border-red-800/60 px-1 rounded flex items-center gap-0.5" title={`Video vinculado: ${song.videoBgTitle || song.videoBgId}`}>
                                  <Youtube className="w-2.5 h-2.5 text-red-400" />
                                  <span>Video</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-1 pt-2 border-t border-slate-800/80">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                onSelectSong(song);
                                setIsExpanded(false);
                              }}
                              className="px-2 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[10px] flex items-center gap-1 cursor-pointer transition-all"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              Play
                            </button>
                            <button
                              onClick={() => onAddToQueue(song)}
                              className={`px-2 py-1 rounded border text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all ${inQueue
                                ? 'border-[#00ff9d]/40 bg-[#00ff9d]/10 text-[#00ff9d]'
                                : 'border-slate-700 bg-slate-800 text-slate-300'
                                }`}
                            >
                              {inQueue ? <Check className="w-3 h-3" /> : <ListPlus className="w-3 h-3 text-[#00f0ff]" />}
                              {inQueue ? 'En cola' : 'Cola'}
                            </button>
                          </div>

                          <div className="flex items-center gap-0.5 text-slate-400">
                            {/* Favorite Star Button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (activeProfile && activeProfile.id !== 'profile_all') {
                                  onToggleFavoriteSong?.(activeProfile.id, song.id);
                                } else {
                                  setSongForProfileAssign(song);
                                }
                              }}
                              className={`p-1 rounded cursor-pointer transition-colors ${isFav ? 'text-amber-400' : 'text-slate-500 hover:text-amber-300'
                                }`}
                              title={
                                activeProfile && activeProfile.id !== 'profile_all'
                                  ? isFav
                                    ? `Quitar de favoritas de ${activeProfile.name}`
                                    : `Añadir a favoritas de ${activeProfile.name}`
                                  : 'Asignar a perfil de cantante'
                              }
                            >
                              <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-amber-400' : ''}`} />
                            </button>

                            {/* Reanalyze DSP Button */}
                            <button
                              onClick={() => handleReanalyze(song)}
                              disabled={isReanalyzing}
                              className="p-1 rounded hover:text-[#00f0ff] hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                              title="Re-analizar BPM y Tono con DSP"
                            >
                              {isReanalyzing ? (
                                <Loader2 className="w-3 h-3 animate-spin text-[#00f0ff]" />
                              ) : (
                                <Sparkles className="w-3 h-3" />
                              )}
                            </button>

                            <button
                              onClick={() => handleOpenEdit(song)}
                              className="p-1 rounded hover:text-amber-400 hover:bg-slate-800 cursor-pointer"
                              title="Editar"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                            {(!activeProfile || activeProfile.id === 'profile_all') && !isGuestMode && (
                              <button
                                onClick={() => setSongToDelete(song)}
                                className="p-1 rounded hover:text-[#ff007f] hover:bg-slate-800 cursor-pointer"
                                title="Eliminar"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Metadata Modal ─────────────────── */}
      {songToEdit && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white">Editar Información de Canción</h3>
              </div>
              <button onClick={() => setSongToEdit(null)} className="text-slate-400 hover:text-white cursor-pointer">✕</button>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">Título de la Canción:</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-[#00f0ff]"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">Artista:</label>
                <input
                  type="text"
                  value={editArtist}
                  onChange={(e) => setEditArtist(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-[#00f0ff]"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">Álbum / Disco:</label>
                <input
                  type="text"
                  value={editAlbum}
                  onChange={(e) => setEditAlbum(e.target.value)}
                  placeholder="Nombre del álbum..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-[#00f0ff]"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Género:</label>
                  <input
                    type="text"
                    value={editGenre}
                    onChange={(e) => setEditGenre(e.target.value)}
                    placeholder="Pop, Latin..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-[#00f0ff]"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">BPM (Tempo):</label>
                  <input
                    type="number"
                    value={editBpm}
                    onChange={(e) => setEditBpm(parseInt(e.target.value, 10) || 120)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-[#00f0ff]"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Tono (Key):</label>
                  <input
                    type="text"
                    value={editKey}
                    onChange={(e) => setEditKey(e.target.value)}
                    placeholder="C, Am, F#..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-[#00f0ff]"
                  />
                </div>
              </div>

              {/* Video de Fondo (YouTube Link / ID con Carátula) */}
              <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2.5 shadow-inner">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-200 flex items-center gap-1.5">
                    <Youtube className="w-4 h-4 text-red-500" />
                    <span>Video de Fondo de YouTube:</span>
                  </label>
                  {editVideoBgUrl && (
                    <button
                      type="button"
                      onClick={() => setEditVideoBgUrl('')}
                      className="text-[10px] text-red-400 hover:text-red-300 cursor-pointer transition-colors font-medium px-2 py-0.5 rounded bg-red-950/40 border border-red-800/40"
                    >
                      Quitar Video
                    </button>
                  )}
                </div>

                <input
                  type="text"
                  value={editVideoBgUrl}
                  onChange={(e) => setEditVideoBgUrl(e.target.value)}
                  placeholder="Pega el link: https://www.youtube.com/watch?v=... o ID"
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-red-500 font-mono"
                />

                {(() => {
                  const extractedId = editVideoBgUrl.trim() ? extractYouTubeVideoId(editVideoBgUrl) || editVideoBgUrl.trim() : null;
                  if (!extractedId || extractedId.length < 5) return null;
                  const fullYoutubeUrl = `https://www.youtube.com/watch?v=${extractedId}`;
                  return (
                    <div className="p-2.5 rounded-xl bg-black/70 border border-slate-800 flex flex-col gap-2 animate-in fade-in">
                      <div className="flex items-center gap-3">
                        {/* Carátula / Thumbnail */}
                        <div className="relative group shrink-0">
                          <img
                            src={`https://i.ytimg.com/vi/${extractedId}/hqdefault.jpg`}
                            alt="Carátula de YouTube"
                            className="w-24 h-14 object-cover rounded-lg border border-slate-700 shadow-md"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = `https://i.ytimg.com/vi/${extractedId}/mqdefault.jpg`;
                            }}
                          />
                          <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Youtube className="w-6 h-6 text-red-500" />
                          </div>
                        </div>

                        {/* Info & Link */}
                        <div className="flex flex-col min-w-0 flex-1 gap-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30 font-bold">
                              ID: {extractedId}
                            </span>
                            <span className="text-[10px] font-bold text-emerald-400 font-mono">
                              ✓ Asignado
                            </span>
                          </div>

                          {/* Video Title */}
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Youtube className="w-3.5 h-3.5 text-red-500 shrink-0" />
                            <span className="text-xs font-bold text-white truncate" title={editVideoBgTitle || `Video ID: ${extractedId}`}>
                              {editVideoBgTitle || (isFetchingVideoTitle ? 'Obteniendo título de YouTube...' : `Video: ${extractedId}`)}
                            </span>
                          </div>

                          <a
                            href={fullYoutubeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-cyan-400 hover:text-cyan-300 truncate hover:underline flex items-center gap-1 font-mono"
                            title="Abrir video en YouTube"
                          >
                            <ExternalLink className="w-3 h-3 shrink-0" />
                            <span className="truncate">{fullYoutubeUrl}</span>
                          </a>

                          <span className="text-[9px] text-slate-400">
                            Carátula y video sincronizados en mute & loop al reproducir.
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Re-analyze DSP button inside editor */}
              {onReanalyzeSong && (
                <button
                  type="button"
                  onClick={async () => {
                    if (songToEdit) {
                      setReanalyzingSongId(songToEdit.id);
                      await onReanalyzeSong(songToEdit);
                      const fresh = savedSongs.find((s) => s.id === songToEdit.id);
                      if (fresh) {
                        setEditBpm(fresh.bpm);
                      }
                      setReanalyzingSongId(null);
                    }
                  }}
                  disabled={reanalyzingSongId === songToEdit.id}
                  className="px-3 py-1.5 rounded-xl bg-cyan-950/70 border border-cyan-700/60 text-[#00f0ff] text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-cyan-900 cursor-pointer disabled:opacity-50 transition-all"
                >
                  {reanalyzingSongId === songToEdit.id ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Re-calculando BPM y Tono con DSP...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      Re-calcular BPM y Tono exactos con DSP
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                onClick={() => setSongToEdit(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-4 py-2 rounded-xl bg-[#00f0ff] hover:bg-[#00f0ff]/80 text-slate-950 text-xs font-bold cursor-pointer transition-all shadow-md shadow-[#00f0ff]/20"
              >
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Song Click Action Prompt Modal (Reproducir vs Agregar a Cola) ─────────────────── */}
      {songActionTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#ff007f]/30 to-[#00f0ff]/30 border border-slate-700 flex items-center justify-center shrink-0">
                <Music2 className="w-5 h-5 text-white" />
              </div>
              <div className="flex flex-col min-w-0">
                <h3 className="text-sm font-bold text-white truncate">
                  {songActionTarget.title}
                </h3>
                <span className="text-xs text-slate-400 truncate">
                  {songActionTarget.artist || 'Desconocido'} · {fmt(songActionTarget.duration)} · {songActionTarget.bpm} BPM
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-300 font-medium">
              ¿Qué deseas hacer con esta pista?
            </p>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  onSelectSong(songActionTarget);
                  setSongActionTarget(null);
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all shadow-md active:scale-98"
              >
                <Play className="w-4 h-4 fill-current" />
                Reproducir Ahora
              </button>

              <button
                onClick={() => {
                  onAddToQueue(songActionTarget);
                  setSongActionTarget(null);
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs border border-slate-700 hover:border-[#00f0ff]/50 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98"
              >
                <ListPlus className="w-4 h-4 text-[#00f0ff]" />
                Agregar a la Cola
              </button>

              <button
                onClick={() => {
                  handleOpenEdit(songActionTarget);
                  setSongActionTarget(null);
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs border border-amber-500/30 hover:border-amber-400 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98"
                title="Modificar título, artista, álbum, género, BPM y tonalidad"
              >
                <Edit3 className="w-4 h-4 text-amber-400" />
                Editar Metadatos
              </button>

              <button
                onClick={() => {
                  handleExportSingleSong(songActionTarget);
                  setSongActionTarget(null);
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 font-bold text-xs border border-emerald-500/30 hover:border-emerald-400 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98"
                title="Descargar esta canción con sus pistas de audio, letra .LRC y ajustes"
              >
                <FolderDown className="w-4 h-4 text-emerald-400" />
                Exportar Canción (.ZIP con Audio)
              </button>

              <button
                onClick={() => setSongActionTarget(null)}
                className="w-full py-2 text-slate-400 hover:text-white text-xs font-semibold cursor-pointer transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Warning Modal ─────────────────── */}
      {songToDelete && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#ff007f]/20 border border-[#ff007f]/40 flex items-center justify-center shrink-0 text-[#ff007f]">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-bold text-white">
                  ¿Eliminar canción de la biblioteca?
                </h3>
                <p className="text-xs text-slate-300">
                  Estás a punto de eliminar <span className="text-[#00f0ff] font-semibold">"{songToDelete.title}"</span>. Se borrarán permanentemente sus pistas de audio aisladas y su configuración de sincronización.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                onClick={() => setSongToDelete(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  onDeleteSong(songToDelete.id);
                  setSongToDelete(null);
                }}
                className="px-4 py-2 rounded-xl bg-[#ff007f] hover:bg-[#ff007f]/80 text-white text-xs font-bold cursor-pointer transition-all shadow-md shadow-[#ff007f]/20"
              >
                Sí, Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CREATE SINGER PROFILE MODAL ─────────────────── */}
      {isCreateProfileOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">🎤</span>
                <h3 className="text-sm font-bold text-white">Nuevo Perfil de Cantante</h3>
              </div>
              <button
                onClick={() => setIsCreateProfileOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveNewProfile} className="flex flex-col gap-3.5">
              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Nombre del Cantante / Persona:
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: John, María, Carlos..."
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#00f0ff]"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1.5">
                  Elige un Avatar / Emoji:
                </label>
                <div className="grid grid-cols-6 gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  {['🎤', '🌟', '👑', '🎸', '🕶️', '💃', '🦁', '🔥', '⚡', '🎧', '🚀', '💎'].map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setNewProfileAvatar(emoji)}
                      className={`h-9 rounded-lg flex items-center justify-center text-lg transition-all cursor-pointer ${newProfileAvatar === emoji
                        ? 'bg-indigo-600 border border-cyan-400 scale-110 shadow-[0_0_10px_rgba(0,240,255,0.4)]'
                        : 'hover:bg-slate-800'
                        }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1.5">
                  Color Temático:
                </label>
                <div className="flex items-center gap-2">
                  {['#00f0ff', '#ff007f', '#00ff9d', '#f59e0b', '#a855f7', '#ec4899', '#3b82f6'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewProfileColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-all cursor-pointer ${newProfileColor === c ? 'border-white scale-125 shadow-md' : 'border-transparent opacity-60 hover:opacity-100'
                        }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800 mt-1">
                <button
                  type="button"
                  onClick={() => setIsCreateProfileOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-500 hover:opacity-90 text-white text-xs font-bold cursor-pointer transition-all shadow-md"
                >
                  Crear Perfil
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── ASSIGN SONG TO SINGER PROFILES MODAL ─────────────────── */}
      {songForProfileAssign && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                <h3 className="text-sm font-bold text-white">Favoritos por Cantante</h3>
              </div>
              <button
                onClick={() => setSongForProfileAssign(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div>
              <p className="text-xs text-slate-300 font-semibold truncate mb-1">
                "{songForProfileAssign.title}"
              </p>
              <p className="text-[11px] text-slate-400">
                Selecciona qué perfiles tienen esta canción en su repertorio favorito:
              </p>
            </div>

            <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
              {profiles.filter((p) => p.id !== 'profile_all').length === 0 ? (
                <div className="py-6 text-center text-slate-500 text-xs">
                  <p className="mb-2">Aún no has creado ningún perfil de persona.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSongForProfileAssign(null);
                      setIsCreateProfileOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500 cursor-pointer"
                  >
                    + Crear Perfil (Ej: John)
                  </button>
                </div>
              ) : (
                profiles
                  .filter((p) => p.id !== 'profile_all')
                  .map((p) => {
                    const isFav = p.favoriteSongIds.includes(songForProfileAssign.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onToggleFavoriteSong?.(p.id, songForProfileAssign.id)}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${isFav
                          ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                          }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-base">{p.avatar}</span>
                          <span>{p.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Star className={`w-4 h-4 ${isFav ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`} />
                          <span className="text-[10px] font-mono">{isFav ? 'Favorita' : 'No asignada'}</span>
                        </div>
                      </button>
                    );
                  })
              )}
            </div>

            <div className="flex items-center justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setSongForProfileAssign(null)}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer transition-colors"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ASSIGN YOUTUBE TRACK TO SINGER PROFILES MODAL ─────────────────── */}
      {ytTrackForProfileAssign && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                <h3 className="text-sm font-bold text-white">Favoritos de YouTube por Cantante</h3>
              </div>
              <button
                onClick={() => setYtTrackForProfileAssign(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800">
              <img
                src={ytTrackForProfileAssign.thumbnail}
                alt={ytTrackForProfileAssign.title}
                className="w-16 h-11 rounded-lg object-cover shrink-0 bg-slate-900"
              />
              <div className="flex flex-col min-w-0">
                <p className="text-xs text-white font-bold line-clamp-2 leading-snug">
                  {ytTrackForProfileAssign.title}
                </p>
                <p className="text-[10px] text-slate-400 truncate mt-0.5">
                  {ytTrackForProfileAssign.channel} • {ytTrackForProfileAssign.duration}
                </p>
              </div>
            </div>

            <p className="text-[11px] text-slate-400">
              Selecciona qué cantantes tienen este video en su repertorio favorito:
            </p>

            <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
              {profiles.filter((p) => p.id !== 'profile_all').length === 0 ? (
                <div className="py-6 text-center text-slate-500 text-xs">
                  <p className="mb-2">Aún no has creado ningún perfil de persona.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setYtTrackForProfileAssign(null);
                      setIsCreateProfileOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500 cursor-pointer"
                  >
                    + Crear Perfil (Ej: John)
                  </button>
                </div>
              ) : (
                profiles
                  .filter((p) => p.id !== 'profile_all')
                  .map((p) => {
                    const isFav = youtubeFavorites.some(
                      (fav) => fav.id === ytTrackForProfileAssign.id && fav.singerProfileId === p.id
                    );
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onToggleYouTubeFavorite?.(ytTrackForProfileAssign, p.id)}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${isFav
                          ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                          }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-base">{p.avatar}</span>
                          <span>{p.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Star className={`w-4 h-4 ${isFav ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`} />
                          <span className="text-[10px] font-mono">{isFav ? 'Favorita' : 'No asignada'}</span>
                        </div>
                      </button>
                    );
                  })
              )}
            </div>

            <div className="flex items-center justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setYtTrackForProfileAssign(null)}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer transition-colors"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Export Options Modal (Full Audio ZIP vs Metadata JSON) ─────────────────── */}
      {isExportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#0c0e17] border border-slate-700/80 rounded-2xl p-6 flex flex-col gap-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/25 to-[#00f0ff]/25 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <FolderDown className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-tight">
                    Exportar Copia de Seguridad
                  </h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    {savedSongs.length} canciones listas para respaldar
                  </p>
                </div>
              </div>
              <button
                onClick={() => !isExportingAudioZip && setIsExportModalOpen(false)}
                disabled={isExportingAudioZip}
                className="p-1 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Progress Bar (if active) */}
            {isExportingAudioZip && (
              <div className="p-4 rounded-xl bg-slate-900 border border-emerald-500/50 flex flex-col gap-2 shadow-[0_0_15px_rgba(16,185,129,0.2)] animate-pulse">
                <div className="flex items-center justify-between text-xs font-bold text-emerald-400">
                  <span>{exportStep || 'Comprimiendo pistas de audio...'}</span>
                  <span className="font-mono">{exportProgress}%</span>
                </div>
                <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 via-[#00f0ff] to-cyan-400 transition-all duration-200 shadow-[0_0_10px_#10b981]"
                    style={{ width: `${exportProgress}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-400 font-mono">
                  Por favor espera, empaquetando audios y stems...
                </span>
              </div>
            )}

            {/* Options List */}
            {!isExportingAudioZip && (
              <div className="flex flex-col gap-3">
                {/* Option 1: MODO RÁPIDO (Incrementales / Nuevas y Cambios) */}
                <div
                  onClick={handleExportIncrementalZip}
                  className="p-3.5 rounded-xl border border-amber-500/50 bg-amber-950/20 hover:bg-amber-900/35 cursor-pointer transition-all flex flex-col gap-1.5 hover:scale-[1.01] active:scale-[0.99] group shadow-md hover:shadow-[0_0_15px_rgba(245,158,11,0.25)]"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-base">⚡</span>
                      <span className="text-xs font-black text-amber-300 uppercase tracking-wider">
                        1. Modo Rápido (Solo Nuevas y Cambios)
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-black bg-amber-500/25 text-amber-300 border border-amber-500/40">
                      ⚡ SÚPER RÁPIDO
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Sincroniza y guarda <strong>únicamente las canciones nuevas y modificaciones ({modifiedOrNewSongs.length} temas)</strong> sin procesar los audios existentes.
                  </p>
                </div>

                {/* Option 2: EXPORTAR CARPETA (Karaokelab Library) */}
                <div
                  onClick={handleExportFolderStructure}
                  className="p-3.5 rounded-xl border border-[#00f0ff]/50 bg-cyan-950/20 hover:bg-cyan-900/35 cursor-pointer transition-all flex flex-col gap-1.5 hover:scale-[1.01] active:scale-[0.99] group shadow-md hover:shadow-[0_0_15px_rgba(0,240,255,0.25)]"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-base">📁</span>
                      <span className="text-xs font-black text-cyan-300 uppercase tracking-wider">
                        2. Exportar Carpeta ("Karaokelab Library")
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-black bg-cyan-500/25 text-cyan-300 border border-cyan-500/40">
                      DESCOMPRIMIDO
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Crea la carpeta <strong>Karaokelab Library</strong> y exporta dentro todas las canciones en subcarpetas con audios, letras <code className="text-cyan-300 font-mono">.LRC</code> y <code className="text-cyan-300 font-mono">manifest.json</code>.
                  </p>
                </div>

                {/* Option 3: EXPORTAR TODO EN .ZIP / .KLAB */}
                <div
                  onClick={handleExportFullZip}
                  className="p-3.5 rounded-xl border border-emerald-500/50 bg-emerald-950/20 hover:bg-emerald-900/35 cursor-pointer transition-all flex flex-col gap-1.5 hover:scale-[1.01] active:scale-[0.99] group shadow-md hover:shadow-[0_0_15px_rgba(16,185,129,0.25)]"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-base">📦</span>
                      <span className="text-xs font-black text-emerald-300 uppercase tracking-wider">
                        3. Exportar Todo en .ZIP / .klab ({savedSongs.length} temas)
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-black bg-emerald-500/25 text-emerald-300 border border-emerald-500/40">
                      COMPACTO (.ZIP)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Igual que la carpeta completa, pero empaquetado en un único archivo comprimido <strong>.klab / .zip</strong> descargable para compartir.
                  </p>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setIsExportModalOpen(false)}
                disabled={isExportingAudioZip}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer transition-colors disabled:opacity-40"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
