import React, { useState, useEffect, useRef } from 'react';
import { LyricLine, AudioStems, ArtistRole, VideoBackgroundConfig } from '../types';
import { Search, Edit3, Sparkles, Play, Pause, Square, RotateCcw, SkipForward, Mic, ChevronDown, ChevronUp, Users, Clock, Wand2, RefreshCw, Globe, Music2, Plus, Film, Sliders } from 'lucide-react';
import { parseLRC, formatLRC, generateGenericLyrics, cleanLyricText, isGeniusFormat, parseGeniusLyrics, extractAllArtistsFromMetadata, titleCaseArtist, FEMALE_PALETTE, MALE_PALETTE, mergeGeniusRolesWithSyncedLrc, cleanSectionHeader, updateSectionHeaderSinger, resolveArtistInfo } from '../services/lrcParser';
import { searchLrclib, searchLrclibSuggestions, LrcSuggestion } from '../services/lrcApi';
import { searchGeniusSuggestions, fetchGeniusLyricsByUrl, searchGeniusLyricsOnline, GeniusHitSuggestion } from '../services/geniusLyricsApi';
import { transcribeVocalsWithWhisper } from '../services/whisperApi';
import { detectFirstVocalOnset, transposeKey } from '../services/dspAnalysis';
import { calibrateLyricsWithVocalStem } from '../services/vocalSyncCalibrator';
import { classifyVocalGenderForLine, classifyAllLyricsVocalGender, analyzeSongVocalProfile, invalidateVocalProfileCache } from '../services/vocalGenderClassifier';
import { audioEngine, audioBufferToWavBlob } from '../services/audioEngine';
import { computeIntelligentWordFills } from '../services/smartCueAnalyzer';
import { DynamicVideoBackground } from './DynamicVideoBackground';
import { VideoBackgroundSelectorModal } from './VideoBackgroundSelectorModal';
import { loadVideoBackgroundConfig, saveVideoBackgroundConfig, searchOfficialVideo } from '../services/videoBackgroundService';

export interface StanzaGroup {
  startIndex: number;
  endIndex: number;
  singer: string;
  sectionHeader?: string;
  lines: Array<{ line: LyricLine; globalIndex: number }>;
}

export function groupLinesIntoStanzas(lines: LyricLine[]): StanzaGroup[] {
  const stanzas: StanzaGroup[] = [];
  if (!lines || lines.length === 0) return stanzas;

  let currentStanza: StanzaGroup = {
    startIndex: 0,
    endIndex: 0,
    singer: lines[0].singer || 'artist-0',
    sectionHeader: lines[0].sectionHeader,
    lines: [{ line: lines[0], globalIndex: 0 }],
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const prevLine = lines[i - 1];
    const singer = line.singer || 'artist-0';
    const timeGap = line.time - (prevLine.time + (prevLine.duration || 2.5));

    const headerChanged = Boolean(line.sectionHeader && line.sectionHeader !== currentStanza.sectionHeader);
    const singerChanged = singer !== currentStanza.singer;

    // Stanza boundary if section header changes, singer changes, or time gap > 3.5s
    if (headerChanged || singerChanged || timeGap > 3.5) {
      currentStanza.endIndex = i - 1;
      stanzas.push(currentStanza);
      currentStanza = {
        startIndex: i,
        endIndex: i,
        singer: singer,
        sectionHeader: line.sectionHeader,
        lines: [{ line, globalIndex: i }],
      };
    } else {
      currentStanza.lines.push({ line, globalIndex: i });
      currentStanza.endIndex = i;
    }
  }

  stanzas.push(currentStanza);
  return stanzas;
}

export function getDuetSinger(
  lineOrText: LyricLine | string,
  index: number,
  _vocalsBuffer?: AudioBuffer | null,
  artistName = ''
): string {
  if (typeof lineOrText === 'object' && lineOrText !== null) {
    // Fast path: use the pre-classified singer from Python PYIN diarization
    if (lineOrText.singer) return lineOrText.singer;
    // Fallback: LRC tags or knowledge base (no audio DSP here)
    return classifyVocalGenderForLine(lineOrText, null, index, artistName);
  }
  const dummyLine: LyricLine = { time: 0, text: (lineOrText as string) || '' };
  return classifyVocalGenderForLine(dummyLine, null, index, artistName);
}


interface KaraokeDisplayProps {
  lyrics: LyricLine[];
  currentLyric: LyricLine | null;
  currentIndex: number;
  currentTime: number;
  duration: number;
  songTitle: string;
  songArtist?: string;
  isPlaying: boolean;
  bpm?: number;
  detectedKey?: string;
  stems?: AudioStems;
  audioBlob?: Blob;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (time: number) => void;
  onNextInQueue?: () => void;
  hasNextInQueue?: boolean;
  onToggleLoop?: () => void;
  isLooping?: boolean;
  onToggleMic: () => void;
  isMicActive: boolean;
  isDuetMode?: boolean;
  onToggleDuetMode?: () => void;
  vocalGain?: number;
  onToggleVocalGuide?: () => void;
  isSmartVocalCue?: boolean;
  activeCueType?: 'intro' | 'chorus' | 'outro' | null;
  onToggleSmartVocalCue?: () => void;
  pitchShift?: number;
  onPitchShiftChange?: (val: number) => void;
  onUpdateLyrics: (newLyrics: LyricLine[], artists?: ArtistRole[]) => void;
  onOpenVideoStudio?: () => void;
  onDownloadStem?: (type: 'instrumental' | 'vocals') => void;
  onOpenPartyMode: () => void;
  onReanalyzeDSP?: () => void;
  onUpdateBpm?: (bpm: number) => void;
  syncDelay?: number;
  onUpdateSyncDelay?: (newDelay: number) => void;
  artists?: ArtistRole[];
  onUpdateArtists?: (artists: ArtistRole[]) => void;
  videoBgConfig?: VideoBackgroundConfig;
  onUpdateVideoBgConfig?: (newConfig: VideoBackgroundConfig) => void;
  onOpenVocalAutomation?: () => void;
  youTubeEmbedId?: string | null;
  onTimeUpdate?: (time: number, duration?: number) => void;
}

export const KaraokeDisplay: React.FC<KaraokeDisplayProps> = ({
  lyrics,
  currentLyric,
  currentIndex,
  currentTime,
  duration,
  songTitle,
  songArtist,
  isPlaying,
  bpm,
  detectedKey,
  stems,
  audioBlob,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onTimeUpdate,
  onNextInQueue,
  hasNextInQueue = false,
  onToggleLoop,
  isLooping = false,
  onToggleMic,
  isMicActive,
  isDuetMode = false,
  onToggleDuetMode,
  vocalGain = 0.0,
  onToggleVocalGuide,
  isSmartVocalCue = false,
  activeCueType = null,
  onToggleSmartVocalCue,
  pitchShift = 0,
  onPitchShiftChange,
  onUpdateLyrics,
  onDownloadStem,
  onOpenPartyMode,
  onReanalyzeDSP,
  onUpdateBpm,
  syncDelay = 0.0,
  onUpdateSyncDelay,
  artists,
  onUpdateArtists,
  videoBgConfig: externalVideoBgConfig,
  onUpdateVideoBgConfig: externalOnUpdateVideoBgConfig,
  onOpenVocalAutomation,
  youTubeEmbedId = null,
}) => {
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<LrcSuggestion[]>([]);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorText, setEditorText] = useState('');
  const [editorStartSecond, setEditorStartSecond] = useState<number>(8.0);
  const [editorFeedback, setEditorFeedback] = useState<string | null>(null);
  const [isDetectingVocalStart, setIsDetectingVocalStart] = useState<boolean>(false);
  const [isSearchingLrc, setIsSearchingLrc] = useState(false);
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);
  const [showLyricTools, setShowLyricTools] = useState(false);

  // ── Dynamic Video Background state ───────────────────────────────────
  const [localVideoBgConfig, setLocalVideoBgConfig] = useState<VideoBackgroundConfig>(() => loadVideoBackgroundConfig());
  const [isVideoBgModalOpen, setIsVideoBgModalOpen] = useState(false);

  const videoBgConfig = externalVideoBgConfig || localVideoBgConfig;

  const handleUpdateVideoBgConfig = (newConfig: VideoBackgroundConfig) => {
    if (externalOnUpdateVideoBgConfig) {
      externalOnUpdateVideoBgConfig(newConfig);
    } else {
      setLocalVideoBgConfig(newConfig);
      saveVideoBackgroundConfig(newConfig);
    }
  };

  // Auto-search official music video on YouTube when song changes if mode is 'auto' and not externally managed
  useEffect(() => {
    if (externalVideoBgConfig) return;
    if (!songTitle || !videoBgConfig.enabled || videoBgConfig.mode !== 'auto') return;

    let isMounted = true;
    searchOfficialVideo(songTitle, songArtist).then((res) => {
      if (isMounted && res && res.videoId) {
        setLocalVideoBgConfig((prev) => {
          if (prev.mode !== 'auto') return prev;
          const next = { ...prev, videoId: res.videoId, videoTitle: res.title };
          saveVideoBackgroundConfig(next);
          return next;
        });
      }
    }).catch(() => {});

    return () => { isMounted = false; };
  }, [songTitle, songArtist, videoBgConfig.enabled, videoBgConfig.mode, externalVideoBgConfig]);
  // ── Visual LRC Editor state ──────────────────────────────────────────
  const [editorTab, setEditorTab] = useState<'visual' | 'text'>('visual');
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set());
  const [activeColorPickerArtistId, setActiveColorPickerArtistId] = useState<string | null>(null);
  const [artistsList, setArtistsList] = useState<ArtistRole[]>(() => {
    if (artists && artists.length > 0) return artists;
    if (songArtist) {
      const meta = extractAllArtistsFromMetadata(songArtist, songTitle || '');
      if (meta.length > 0) return meta;
    }
    return [{ id: 'artist-0', name: songArtist ? titleCaseArtist(songArtist) : 'Artista', color: '#00f0ff' }];
  });

  const lastSongKeyRef = useRef<string>('');
  const currentSongKey = `${songTitle}___${songArtist || ''}`;

  useEffect(() => {
    // If the visual editor is open, never allow background prop sync to disrupt active typing
    if (isEditorOpen) return;

    // 1. If explicit artists prop is passed from saved song, sync it!
    if (artists && artists.length > 0) {
      setArtistsList(artists);
      if (artists.length >= 2 && onToggleDuetMode && !isDuetMode) {
        onToggleDuetMode();
      }
      lastSongKeyRef.current = currentSongKey;
      return;
    }

    // 2. Only if a new song is loaded and no saved artists exist, extract default metadata:
    if (lastSongKeyRef.current !== currentSongKey) {
      lastSongKeyRef.current = currentSongKey;
      if (songArtist) {
        const meta = extractAllArtistsFromMetadata(songArtist, songTitle || '');
        if (meta.length > 0) {
          setArtistsList(meta);
          if (meta.length >= 2 && onToggleDuetMode && !isDuetMode) {
            onToggleDuetMode();
          }
        } else {
          setArtistsList([{ id: 'artist-0', name: titleCaseArtist(songArtist), color: '#00f0ff' }]);
        }
      }
    }
  }, [songTitle, songArtist, artists, currentSongKey, isDuetMode, onToggleDuetMode, isEditorOpen]);

  // ── YouTube Embedded Playback Handler (Auto-Advance on Video End & Full Play/Pause Synchronization) ──
  const ytIframeRef = useRef<HTMLIFrameElement>(null);
  const onNextInQueueRef = useRef(onNextInQueue);
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onTimeUpdateRef = useRef(onTimeUpdate);

  useEffect(() => {
    onNextInQueueRef.current = onNextInQueue;
    onPlayRef.current = onPlay;
    onPauseRef.current = onPause;
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onNextInQueue, onPlay, onPause, onTimeUpdate]);

  // Synchronize Host isPlaying state directly to YouTube iframe
  useEffect(() => {
    if (!youTubeEmbedId) return;
    try {
      const win = ytIframeRef.current?.contentWindow;
      if (win) {
        if (isPlaying) {
          win.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: '' }), '*');
        } else {
          win.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' }), '*');
        }
      }
    } catch (_) {}
  }, [isPlaying, youTubeEmbedId]);

  useEffect(() => {
    if (!youTubeEmbedId) return;

    let hasHandledEnd = false;

    // Send playVideo immediately upon switching from MP3 or queue item if isPlaying
    const playTimer = setTimeout(() => {
      try {
        const win = ytIframeRef.current?.contentWindow;
        if (win && isPlaying) {
          win.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: '' }), '*');
        }
      } catch (_) {}
    }, 400);

    // Poll current time from YouTube iframe to keep root state and second screen in lockstep
    const timePoll = setInterval(() => {
      try {
        const win = ytIframeRef.current?.contentWindow;
        if (win && isPlaying) {
          win.postMessage(JSON.stringify({ event: 'command', func: 'getCurrentTime', args: '' }), '*');
          win.postMessage(JSON.stringify({ event: 'command', func: 'getDuration', args: '' }), '*');
        }
      } catch (_) {}
    }, 500);

    const handleMessage = (event: MessageEvent) => {
      try {
        let data = event.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (_) {
            return;
          }
        }

        // Live currentTime & duration delivery from YouTube
        if (data?.info?.currentTime !== undefined && typeof data.info.currentTime === 'number') {
          onTimeUpdateRef.current?.(data.info.currentTime, data.info.duration);
        } else if (data?.infoDelivery?.currentTime !== undefined && typeof data.infoDelivery.currentTime === 'number') {
          onTimeUpdateRef.current?.(data.infoDelivery.currentTime, data.infoDelivery.duration);
        }

        // YouTube PlayerState: 0 = ended, 1 = playing, 2 = paused
        const state =
          data?.info?.playerState !== undefined
            ? data.info.playerState
            : data?.event === 'onStateChange'
              ? data.info
              : data?.infoDelivery?.playerState;

        if (state === 0 || state === '0') {
          if (!hasHandledEnd) {
            hasHandledEnd = true;
            console.log('✓ YouTube video ended, auto-advancing to next song in queue...');
            if (onNextInQueueRef.current) {
              onNextInQueueRef.current();
            }
          }
        } else if ((state === 1 || state === '1') && !isPlaying) {
          // Video was played inside YouTube player
          onPlayRef.current?.();
        } else if ((state === 2 || state === '2') && isPlaying) {
          // Video was paused inside YouTube player
          onPauseRef.current?.();
        }
      } catch (_) {}
    };

    window.addEventListener('message', handleMessage);

    return () => {
      clearTimeout(playTimer);
      clearInterval(timePoll);
      window.removeEventListener('message', handleMessage);
    };
  }, [youTubeEmbedId, isPlaying]);
  const [visualLines, setVisualLines] = useState<LyricLine[]>([]);
  const [isLiveTapSync, setIsLiveTapSync] = useState(false);
  const [liveTapIdx, setLiveTapIdx] = useState(0);

  // Resolve artist color & name for any line.singer value
  const getArtistInfo = (singerVal?: string) => {
    return resolveArtistInfo(singerVal, artistsList, songArtist, songTitle);
  };

  const handleAddArtist = () => {
    const nextIdx = artistsList.length;
    const defaultName = `Artista ${nextIdx + 1}`;
    // Rotate through high-contrast distinct hues (Cyan, Pink, Purple, Lime, Orange, Blue...)
    const distinctColors = ['#00f0ff', '#ff007f', '#a855f7', '#84cc16', '#f97316', '#3b82f6', '#14b8a6', '#eab308'];
    const newColor = distinctColors[nextIdx % distinctColors.length];
    const newArtist: ArtistRole = {
      id: `artist-${nextIdx}`,
      name: defaultName,
      color: newColor,
    };
    setArtistsList(prev => [...prev, newArtist]);
    if (!isDuetMode && onToggleDuetMode) onToggleDuetMode();
  };

  const handleUpdateArtist = (id: string, updates: Partial<ArtistRole>) => {
    setArtistsList(prev => prev.map(a => (a.id === id ? { ...a, ...updates } : a)));
  };

  const handleRemoveArtist = (id: string) => {
    if (artistsList.length <= 1) return;
    const fallbackId = artistsList.find(a => a.id !== id)?.id || 'artist-0';
    setArtistsList(prev => prev.filter(a => a.id !== id));
    setVisualLines(prev => prev.map(l => l.singer === id ? { ...l, singer: fallbackId } : l));
  };

  // ── Editor Online Search state (Genius / Web) ────────────────────────
  const [showEditorSearchDrawer, setShowEditorSearchDrawer] = useState(false);
  const [editorSearchQuery, setEditorSearchQuery] = useState('');
  const [isEditorSearching, setIsEditorSearching] = useState(false);
  const [geniusSuggestions, setGeniusSuggestions] = useState<GeniusHitSuggestion[]>([]);

  const handleOpenEditorSearch = () => {
    const initialQuery = `${songArtist ? songArtist + ' ' : ''}${songTitle || ''}`.trim();
    setEditorSearchQuery(initialQuery);
    setShowEditorSearchDrawer((prev) => !prev);
    if (!showEditorSearchDrawer && initialQuery) {
      handleSearchGeniusInEditor(initialQuery);
    }
  };

  const handleSearchGeniusInEditor = async (query: string) => {
    if (!query || !query.trim()) return;
    setIsEditorSearching(true);
    setGeniusSuggestions([]);
    try {
      const results = await searchGeniusSuggestions(query);
      setGeniusSuggestions(results);
      if (results.length === 0) {
        setEditorFeedback('No se encontraron resultados en Genius. Prueba con otro término de búsqueda.');
      }
    } catch (err: any) {
      console.warn('Genius search error:', err);
      setEditorFeedback('Error al consultar Genius.');
    } finally {
      setIsEditorSearching(false);
    }
  };

  const handleSelectGeniusHit = async (hit: GeniusHitSuggestion) => {
    setIsEditorSearching(true);
    setEditorFeedback(`Descargando y estructurando letra de "${hit.title}"...`);
    try {
      const res = await fetchGeniusLyricsByUrl(hit.url, duration || 180);
      if (res && res.lyrics.length > 0) {
        if (res.allArtists && res.allArtists.length > 0) {
          setArtistsList(res.allArtists);
        } else if (res.singer1Artists.length > 0 || res.singer2Artists.length > 0) {
          const list: ArtistRole[] = [];
          if (res.singer1Artists.length > 0) {
            list.push({ id: 'artist-0', name: res.singer1Artists[0], color: '#00f0ff' });
          }
          if (res.singer2Artists.length > 0) {
            list.push({ id: 'artist-1', name: res.singer2Artists[0], color: '#ff007f' });
          }
          setArtistsList(list);
        }

        let finalLyrics = res.lyrics;
        try {
          // Check if there is synchronized LRC available from LRCLIB or existing song
          let syncedLrcLines: LyricLine[] = [];
          if (lyrics && lyrics.length > 0 && lyrics.some(l => l.time > 0)) {
            syncedLrcLines = lyrics;
          } else {
            const lrclibRes = await searchLrclib(`${songArtist ? songArtist + ' ' : ''}${songTitle || hit.title}`, duration);
            if (lrclibRes && lrclibRes.lyrics && lrclibRes.lyrics.length > 0) {
              syncedLrcLines = lrclibRes.lyrics;
            }
          }

          if (syncedLrcLines.length > 0) {
            // MERGE Genius artist roles onto synced timestamps!
            finalLyrics = mergeGeniusRolesWithSyncedLrc(res.lyrics, syncedLrcLines);
          } else {
            let vocBuf = audioEngine.getVocalsBuffer();
            if (!vocBuf && stems?.vocalsBlob) {
              const arr = await stems.vocalsBlob.arrayBuffer();
              vocBuf = await audioEngine.decodeAudio(arr);
            }
            if (vocBuf) {
              const { calibratedLyrics } = calibrateLyricsWithVocalStem(res.lyrics, vocBuf);
              if (calibratedLyrics.length > 0) {
                finalLyrics = calibratedLyrics;
              }
            }
          }
        } catch {
          // Fallback to res.lyrics
        }

        setVisualLines(finalLyrics);
        setEditorText(formatLRC(finalLyrics, res.allArtists));
        setShowEditorSearchDrawer(false);
        const artistNames = res.allArtists ? res.allArtists.map(a => a.name).join(', ') : (res.singer1Artists[0] || '');
        setEditorFeedback(`✓ ¡Letra de Genius cargada en el editor! (${finalLyrics.length} versos). Puedes personalizar los cantantes y pulsar "Guardar y Aplicar".`);
        setEditorTab('visual');
        setTimeout(() => setEditorFeedback(null), 5000);
      } else {
        setEditorFeedback('No se pudo extraer la letra de esta canción.');
      }
    } catch (err: any) {
      setEditorFeedback(`Error al descargar letra: ${err?.message}`);
    } finally {
      setIsEditorSearching(false);
    }
  };

  const handleMoveStanza = (stanzaIndex: number, direction: 'up' | 'down') => {
    const stanzas = groupLinesIntoStanzas(visualLines);
    const targetIdx = direction === 'up' ? stanzaIndex - 1 : stanzaIndex + 1;
    if (targetIdx < 0 || targetIdx >= stanzas.length) return;

    // Swap stanzas[stanzaIndex] with stanzas[targetIdx]
    const newStanzas = [...stanzas];
    const temp = newStanzas[stanzaIndex];
    newStanzas[stanzaIndex] = newStanzas[targetIdx];
    newStanzas[targetIdx] = temp;

    // Reconstruct flat visualLines with smooth chronological time distribution
    const totalLines = visualLines.length;
    const durationEst = duration || 180;
    const intro = visualLines.length > 0 ? visualLines[0].time : 8.0;
    const available = Math.max(10, durationEst - intro - 4);
    const step = Math.max(1.8, available / Math.max(1, totalLines));

    let lineCounter = 0;
    const reorderedLines: LyricLine[] = [];

    newStanzas.forEach((st) => {
      st.lines.forEach(({ line }) => {
        reorderedLines.push({
          ...line,
          time: +(intro + lineCounter * step).toFixed(2),
          duration: +(Math.min(step * 0.92, 5.0)).toFixed(2),
        });
        lineCounter++;
      });
    });

    setVisualLines(reorderedLines);
    onUpdateLyrics(reorderedLines);
    setEditorText(formatLRC(reorderedLines));
    setEditorFeedback(`✓ Estrofa ${direction === 'up' ? 'subida ▲' : 'bajada ▼'} con éxito.`);
    setTimeout(() => setEditorFeedback(null), 2500);
  };


  // Live Suggestion Query Fetcher
  useEffect(() => {
    if (!isSearching || !searchQuery.trim()) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsFetchingSuggestions(true);
      try {
        const results = await searchLrclibSuggestions(searchQuery);
        setSuggestions(results);
      } catch (err) {
        console.warn('Suggestions fetch error:', err);
      } finally {
        setIsFetchingSuggestions(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery, isSearching]);

  const handleSelectSuggestion = async (s: LrcSuggestion) => {
    if (s.syncedLyrics) {
      let parsed = parseLRC(s.syncedLyrics);
      if (parsed.length > 0) {
        // If we currently have Genius lyrics or artist roles, PRESERVE AND MERGE THEM!
        const existingGenius = visualLines.length > 0 ? visualLines : lyrics;
        if (existingGenius.length > 0 && existingGenius.some(l => l.singer || l.sectionHeader)) {
          parsed = mergeGeniusRolesWithSyncedLrc(existingGenius, parsed);
        } else {
          try {
            const geniusRes = await searchGeniusLyricsOnline(s.trackName, s.artistName, duration || s.duration || 180);
            if (geniusRes && geniusRes.lyrics.length > 0) {
              if (geniusRes.allArtists && geniusRes.allArtists.length > 0) {
                setArtistsList(geniusRes.allArtists);
              }
              parsed = mergeGeniusRolesWithSyncedLrc(geniusRes.lyrics, parsed);
            }
          } catch (_) {}
        }

        onUpdateLyrics(parsed);
        setVisualLines(parsed);
        setEditorText(formatLRC(parsed));
        setSearchFeedback(`✓ ¡Letra sincronizada de "${s.trackName}" acoplada con roles de artistas! (${parsed.length} líneas)`);
        setIsSearching(false);
        setSuggestions([]);
        setTimeout(() => setSearchFeedback(null), 3000);
        return;
      }
    }
    if (s.plainLyrics) {
      const estDur = duration || s.duration || 180;
      if (isGeniusFormat(s.plainLyrics)) {
        const res = parseGeniusLyrics(s.plainLyrics, estDur);
        if (res.lyrics.length > 0) {
          if (res.allArtists && res.allArtists.length > 0) {
            setArtistsList(res.allArtists);
          }
          onUpdateLyrics(res.lyrics);
          setVisualLines(res.lyrics);
          setEditorText(formatLRC(res.lyrics));
          const artistNames = res.allArtists ? res.allArtists.map(a => a.name).join(', ') : (res.singer1Artists[0] || '');
          setSearchFeedback(`✓ ¡Letra de "${s.trackName}" importada! (${res.lyrics.length} líneas · Artistas: ${artistNames})`);
          setIsSearching(false);
          setSuggestions([]);
          setTimeout(() => setSearchFeedback(null), 3500);
          return;
        }
      }
      const lines = s.plainLyrics
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('[') && !l.endsWith(']'));
      const intro = Math.min(8, estDur * 0.08);
      const step = Math.max(2.5, (estDur - intro - 4) / lines.length);
      const generated = lines.map((text, i) => ({
        time: +(intro + i * step).toFixed(2),
        text,
        duration: +(step * 0.9).toFixed(2),
      }));
      onUpdateLyrics(generated);
      setVisualLines(generated);
      setEditorText(formatLRC(generated));
      setSearchFeedback(`✓ ¡Letra de "${s.trackName}" sincronizada inteligentemente! (${lines.length} líneas)`);
      setIsSearching(false);
      setSuggestions([]);
      setTimeout(() => setSearchFeedback(null), 3000);
    }
  };

  const effectiveTime = Math.max(0, currentTime - syncDelay);

  // Compute progress of current active lyric line
  let lineProgress = 0;
  let words: string[] = [];
  let activeWordIndex = -1;

  if (currentLyric) {
    const elapsed = Math.max(0, effectiveTime - currentLyric.time);
    const dur = Math.max(0.5, currentLyric.duration || 4.0);
    lineProgress = Math.max(0, Math.min(100, (elapsed / dur) * 100));

    if (currentLyric.words && currentLyric.words.length > 0) {
      words = currentLyric.words.map((w) => w.word);
      for (let i = 0; i < currentLyric.words.length; i++) {
        const w = currentLyric.words[i];
        if (effectiveTime >= w.start && effectiveTime <= w.end) {
          activeWordIndex = i;
          break;
        } else if (effectiveTime > w.end) {
          activeWordIndex = i;
        }
      }
    } else {
      words = currentLyric.text.split(/\s+/).filter(Boolean);
      if (words.length > 0) {
        const wordStep = 100 / words.length;
        activeWordIndex = Math.min(words.length - 1, Math.floor(lineProgress / wordStep));
      }
    }
  }

  const fmt = (s: number) => {
    if (isNaN(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const seekProgress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleOnlineSearch = async () => {
    if (!songTitle) return;
    setIsSearchingLrc(true);
    setSearchFeedback('Buscando letra sincronizada y roles de artistas...');
    try {
      const res = await searchLrclib(`${songArtist ? songArtist + ' ' : ''}${songTitle}`, duration);
      if (res && res.lyrics && res.lyrics.length > 0) {
        let finalLyrics = res.lyrics;

        // Try to fetch Genius in background to preserve artist separations!
        try {
          const geniusRes = await searchGeniusLyricsOnline(songTitle, songArtist || '', duration);
          if (geniusRes && geniusRes.lyrics.length > 0) {
            if (geniusRes.allArtists && geniusRes.allArtists.length > 0) {
              setArtistsList(geniusRes.allArtists);
            }
            finalLyrics = mergeGeniusRolesWithSyncedLrc(geniusRes.lyrics, res.lyrics);
          }
        } catch (_) {}

        onUpdateLyrics(finalLyrics);
        setVisualLines(finalLyrics);
        setEditorText(formatLRC(finalLyrics));
        setSearchFeedback(`✓ ¡Letra sincronizada con separaciones de artistas encontrada! (${finalLyrics.length} líneas)`);
        setTimeout(() => setSearchFeedback(null), 3500);
        return;
      }
      setSearchFeedback('No se encontró letra oficial en internet.');
      setTimeout(() => setSearchFeedback(null), 3500);
    } catch (err: any) {
      setSearchFeedback('Error de conexión con el buscador.');
      setTimeout(() => setSearchFeedback(null), 3500);
    } finally {
      setIsSearchingLrc(false);
    }
  };

  const handleExportLRC = () => {
    if (!lyrics || lyrics.length === 0) return;
    const lrcContent = formatLRC(lyrics);
    const blob = new Blob([lrcContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${songTitle || 'karaoke'}.lrc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenEditor = () => {
    const currentArtists = (artists && artists.length > 0) ? artists : artistsList;
    setArtistsList(currentArtists);
    if (lyrics.length > 0) {
      setEditorText(formatLRC(lyrics, currentArtists));
      setEditorStartSecond(lyrics[0]?.time || 8.0);
      setVisualLines([...lyrics]);
    } else {
      const generic = generateGenericLyrics(songTitle, songArtist || 'Desconocido', duration);
      setEditorText(formatLRC(generic, currentArtists));
      setEditorStartSecond(8.0);
      setVisualLines([...generic]);
    }
    setSelectedLines(new Set());
    setEditorTab('visual');
    setIsEditorOpen(true);
  };

  const handleSaveEditor = () => {
    let finalToSave: LyricLine[] = [];
    let currentArtistsToSave = artistsList;

    if (editorTab === 'text') {
      if (isGeniusFormat(editorText)) {
        const result = parseGeniusLyrics(editorText, duration || 180, editorStartSecond || 8);
        if (result.lyrics.length > 0) {
          if (result.allArtists && result.allArtists.length > 0) {
            currentArtistsToSave = result.allArtists;
            setArtistsList(result.allArtists);
          }
          finalToSave = result.lyrics;
        }
      }
      if (finalToSave.length === 0) {
        finalToSave = parseLRC(editorText);
      }
      // If still empty (e.g. plain text lines pasted without timestamps), auto-distribute them!
      if (finalToSave.length === 0) {
        const plainLines = editorText
          .split('\n')
          .map((l) => l.replace(/\[\d+:\d+(\.\d+)?\]/g, '').trim())
          .filter((l) => l.length > 0 && !l.startsWith('[ti:') && !l.startsWith('[ar:') && !l.startsWith('[al:'));
        if (plainLines.length > 0) {
          const intro = Math.max(0, editorStartSecond || 8.0);
          const estDur = duration || 180;
          const step = Math.max(2.0, (estDur - intro - 4) / plainLines.length);
          finalToSave = plainLines.map((txt, i) => ({
            time: +(intro + i * step).toFixed(2),
            text: txt,
            duration: +step.toFixed(2),
          }));
        }
      }
    } else {
      finalToSave = visualLines.length > 0 ? visualLines : lyrics;
    }

    if (finalToSave.length > 0) {
      // Sort strictly by timestamp
      const sorted = [...finalToSave].sort((a, b) => a.time - b.time);
      setVisualLines(sorted);
      setEditorText(formatLRC(sorted, currentArtistsToSave));
      onUpdateLyrics(sorted, currentArtistsToSave);
      setIsEditorOpen(false);
      setSearchFeedback(`✓ ¡Letra y artistas guardados al 100%! (${sorted.length} versos · ${currentArtistsToSave.length} cantantes)`);
      setTimeout(() => setSearchFeedback(null), 3000);
    } else {
      if (onUpdateArtists) onUpdateArtists(currentArtistsToSave);
      setIsEditorOpen(false);
      setSearchFeedback('✓ ¡Artistas guardados con éxito!');
      setTimeout(() => setSearchFeedback(null), 3000);
    }
  };

  const handleAutoSyncEditor = () => {
    // 1. Determine active source lines
    let baseLines: LyricLine[] = [];
    if (editorTab === 'visual' && visualLines.length > 0) {
      baseLines = [...visualLines];
    } else if (editorText.trim()) {
      if (isGeniusFormat(editorText)) {
        baseLines = parseGeniusLyrics(editorText, duration || 180, editorStartSecond || 8).lyrics;
      } else {
        const parsed = parseLRC(editorText);
        if (parsed.length > 0) {
          baseLines = parsed;
        } else {
          const rawLines = editorText
            .split('\n')
            .map((l) => l.replace(/\[\d+:\d+(\.\d+)?\]/g, '').trim())
            .filter((l) => l.length > 0 && !l.startsWith('[ti:') && !l.startsWith('[ar:') && !l.startsWith('[al:'));
          baseLines = rawLines.map((text) => ({ time: 0, text, duration: 3.0 }));
        }
      }
    } else if (visualLines.length > 0) {
      baseLines = [...visualLines];
    } else {
      baseLines = [...lyrics];
    }

    if (baseLines.length === 0) return;

    const estDur = duration || 180;
    const intro = Math.max(0, editorStartSecond || 8.0);
    const availableTime = Math.max(10, estDur - intro - 4);
    const step = Math.max(1.8, availableTime / baseLines.length);

    // 2. Synchronize timestamps linearly preserving 100% of singers and structure
    const syncedLines: LyricLine[] = baseLines.map((line, i) => {
      const lineTime = +(intro + i * step).toFixed(2);
      return {
        ...line,
        time: lineTime,
        duration: +step.toFixed(2),
      };
    });

    // 3. Update both visualLines and editorText simultaneously
    setVisualLines(syncedLines);
    setEditorText(formatLRC(syncedLines));
    onUpdateLyrics(syncedLines);
    setEditorFeedback(`✓ ¡Sincronizado! ${syncedLines.length} versos distribuidos en orden desde ${intro}s.`);
  };

  const getAnyAvailableAudioBlob = async (): Promise<Blob | null> => {
    if (stems?.vocalsBlob && stems.vocalsBlob.size > 100) return stems.vocalsBlob;
    if (stems?.instrumentalBlob && stems.instrumentalBlob.size > 100) return stems.instrumentalBlob;
    if (audioBlob && audioBlob.size > 100) return audioBlob;
    const vocBuf = audioEngine.getVocalsBuffer();
    if (vocBuf) return audioBufferToWavBlob(vocBuf);
    const instBuf = audioEngine.getInstrumentalBuffer();
    if (instBuf) return audioBufferToWavBlob(instBuf);
    const mainBuf = audioEngine.getAudioBuffer();
    if (mainBuf) return audioBufferToWavBlob(mainBuf);
    return null;
  };

  const handleDetectVocalStart = async () => {
    setIsDetectingVocalStart(true);
    setEditorFeedback('Detectando primer ataque de voz con DSP...');
    try {
      let vocalsBuf = audioEngine.getVocalsBuffer() || audioEngine.getAudioBuffer() || audioEngine.getInstrumentalBuffer();
      if (!vocalsBuf) {
        const blob = await getAnyAvailableAudioBlob();
        if (blob) vocalsBuf = await audioEngine.decodeAudio(await blob.arrayBuffer());
      }

      if (vocalsBuf) {
        const onset = await detectFirstVocalOnset(vocalsBuf);
        setEditorStartSecond(onset);
        setEditorFeedback(`✓ Primer ataque vocal detectado en el segundo ${onset}s.`);
      } else {
        setEditorFeedback('No hay buffer vocal disponible.');
      }
    } catch (err) {
      setEditorFeedback('Error al analizar audio DSP.');
    } finally {
      setIsDetectingVocalStart(false);
    }
  };

  const handleTranscribeWithWhisper = async () => {
    setIsSearchingLrc(true);
    setSearchFeedback('🎙️ Transcribiendo voz real de la canción con OpenAI Whisper AI...');
    setEditorFeedback('Transcribiendo audio con OpenAI Whisper...');
    try {
      const blob = await getAnyAvailableAudioBlob();
      if (!blob) {
        setSearchFeedback('Carga o reproduce una canción para transcribir la voz.');
        setEditorFeedback('No hay archivo de audio cargado para transcribir.');
        setTimeout(() => setSearchFeedback(null), 3000);
        return;
      }
      const transcribed = await transcribeVocalsWithWhisper(blob);
      if (transcribed && transcribed.length > 0) {
        onUpdateLyrics(transcribed);
        setVisualLines(transcribed);
        setEditorText(formatLRC(transcribed));
        setSearchFeedback(`✓ ¡${transcribed.length} líneas de la canción transcritas con Whisper AI!`);
        setEditorFeedback(`✓ ¡Transcripción IA completada con éxito! (${transcribed.length} líneas)`);
      } else {
        setSearchFeedback('Whisper no detectó voz en el audio.');
        setEditorFeedback('Whisper no detectó voz en el audio.');
      }
    } catch (err: any) {
      setSearchFeedback('Error al transcribir con Whisper AI.');
      setEditorFeedback(`Error en Whisper: ${err?.message || 'Fallo al transcribir'}`);
    } finally {
      setIsSearchingLrc(false);
      setTimeout(() => setSearchFeedback(null), 3000);
    }
  };

  const handleShiftAllTimestamps = (delta: number) => {
    const updated = visualLines.map(l => ({
      ...l,
      time: Math.max(0, +(l.time + delta).toFixed(2)),
    }));
    setVisualLines(updated);
    setEditorText(formatLRC(updated));
    onUpdateLyrics(updated);
    setEditorFeedback(`✓ Letra desplazada ${delta > 0 ? '+' : ''}${delta}s.`);
  };

  const handleSurgicalVocalAlignment = async () => {
    const targetList = visualLines.length > 0 ? visualLines : (editorText ? parseLRC(editorText) : lyrics);
    if (targetList.length === 0) {
      setSearchFeedback('No hay letra cargada en la canción para alinear.');
      setTimeout(() => setSearchFeedback(null), 3000);
      return;
    }

    let activeBuf = audioEngine.getVocalsBuffer() || audioEngine.getAudioBuffer();
    if (!activeBuf && stems?.vocalsBlob) {
      try {
        const arr = await stems.vocalsBlob.arrayBuffer();
        activeBuf = await audioEngine.decodeAudio(arr);
      } catch (_) {}
    }

    if (!activeBuf) {
      setSearchFeedback('Carga o reproduce el audio de la canción para alinear con la voz.');
      setTimeout(() => setSearchFeedback(null), 3000);
      return;
    }

    // Surgical calibration: perfectly snaps defined lyric timestamps to real vocal energy attacks
    const { calibratedLyrics, matchedPhrasesCount, globalShift } = calibrateLyricsWithVocalStem(targetList, activeBuf);
    if (calibratedLyrics.length > 0) {
      setVisualLines(calibratedLyrics);
      setEditorText(formatLRC(calibratedLyrics));
      onUpdateLyrics(calibratedLyrics);
      setSearchFeedback(`🎯 ¡Alineación Quirúrgica completada! (${matchedPhrasesCount} versos acoplados a la voz · Ajuste: ${globalShift}s)`);
      setTimeout(() => setSearchFeedback(null), 3500);
    } else {
      setSearchFeedback('No se detectó suficiente energía vocal en la pista.');
      setTimeout(() => setSearchFeedback(null), 3000);
    }
  };

  const handleStartLiveTapSync = () => {
    setIsLiveTapSync(true);
    setLiveTapIdx(0);
    if (!isPlaying) onPlay();
    setEditorFeedback('🎙️ Modo Grabación Activo: presiona [ESPACIO] o haz clic en Marcar cuando comience cada verso.');
  };

  const handleStopLiveTapSync = () => {
    setIsLiveTapSync(false);
    if (isPlaying) onPause();
    setEditorFeedback('✓ Grabación de tiempos detenida.');
  };

  const handleTapCurrentLine = (currentTimeVal: number) => {
    if (!isLiveTapSync) return;
    const curIdx = liveTapIdx;
    if (curIdx >= visualLines.length) {
      handleStopLiveTapSync();
      return;
    }

    const t = Math.max(0, +currentTimeVal.toFixed(2));
    const updated = [...visualLines];

    // Set time on current line
    updated[curIdx] = {
      ...updated[curIdx],
      time: t,
    };

    // Calculate duration on previous line
    if (curIdx > 0 && updated[curIdx - 1]) {
      const prevTime = updated[curIdx - 1].time;
      updated[curIdx - 1] = {
        ...updated[curIdx - 1],
        duration: Math.max(1.0, +(t - prevTime).toFixed(2)),
      };
    }

    setVisualLines(updated);
    setEditorText(formatLRC(updated));
    onUpdateLyrics(updated);

    if (curIdx + 1 < visualLines.length) {
      setLiveTapIdx(curIdx + 1);
    } else {
      handleStopLiveTapSync();
      setEditorFeedback('🎉 ¡Todas las líneas han sido sincronizadas en vivo con éxito!');
    }
  };

  useEffect(() => {
    if (!isLiveTapSync || !isEditorOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (editorTab === 'text' || (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') {
        return;
      }
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        handleTapCurrentLine(currentTime);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLiveTapSync, isEditorOpen, editorTab, liveTapIdx, visualLines, currentTime]);

  const handleAutoDetectDuetAndVoices = async () => {
    setIsSearchingLrc(true);
    setSearchFeedback('👥 Analizando pista vocal aislada y detectando si hay dueto (Hombre / Mujer)...');
    setEditorFeedback('Analizando timbres vocales y división de dueto...');
    try {
      let vocBuf = audioEngine.getVocalsBuffer();
      if (!vocBuf && stems?.vocalsBlob) {
        const arr = await stems.vocalsBlob.arrayBuffer();
        vocBuf = await audioEngine.decodeAudio(arr);
      }

      // Force fresh analysis — ignore any cached profile
      invalidateVocalProfileCache();

      const profile = await analyzeSongVocalProfile(vocBuf, lyrics, songArtist);
      const classified = await classifyAllLyricsVocalGender(lyrics, vocBuf, songArtist, true);
      onUpdateLyrics(classified);
      setVisualLines(classified);
      setEditorText(formatLRC(classified));

      const maleCount   = classified.filter((l) => l.singer === 'singer1').length;
      const femaleCount = classified.filter((l) => l.singer === 'singer2').length;
      const bothCount   = classified.filter((l) => l.singer === 'both').length;

      const isDuetResult = maleCount > 0 && femaleCount > 0;

      if (isDuetResult || profile.isDuet) {
        setSearchFeedback(`✓ ¡Dúo detectado y dividido! (${maleCount} versos ♂️ Hombre, ${femaleCount} versos ♀️ Mujer${bothCount > 0 ? `, ${bothCount} 👥 Ambos` : ''})`);
        setEditorFeedback(`✓ ¡Dúo dividido al 100%! (${maleCount} ♂️, ${femaleCount} ♀️, ${bothCount} 👥)`);
      } else {
        const genderLabel = profile.primaryGender === 'singer2' ? '♀️ Voz Femenina (Mujer)' : '♂️ Voz Masculina (Hombre)';
        setSearchFeedback(`✓ ¡Análisis completado! Canción solista detectada: ${genderLabel}`);
        setEditorFeedback(`✓ Canción solista: ${genderLabel}`);
      }
    } catch (err: any) {
      setSearchFeedback('Error al analizar dueto.');
      setEditorFeedback(`Error: ${err?.message || 'Fallo de DSP'}`);
    } finally {
      setIsSearchingLrc(false);
      setTimeout(() => setSearchFeedback(null), 4000);
    }
  };

  const nextLyric = currentIndex >= 0 && currentIndex < lyrics.length - 1 ? lyrics[currentIndex + 1] : (currentIndex === -1 && lyrics.length > 0 ? lyrics[0] : null);
  const nextNextLyric = currentIndex >= 0 && currentIndex < lyrics.length - 2 ? lyrics[currentIndex + 2] : null;
  const hasSong = !!currentLyric || lyrics.length > 0;

  // Duet Singer Identification (Acoustically classified via DSP vocalsBuffer)
  const currentSinger = currentLyric ? getDuetSinger(currentLyric, currentIndex >= 0 ? currentIndex : 0, null, songArtist) : 'singer1';
  const nextSinger = nextLyric ? getDuetSinger(nextLyric, currentIndex >= 0 ? currentIndex + 1 : 0, null, songArtist) : 'singer1';

  const handleToggleActiveLineSinger = () => {
    if (!lyrics || currentIndex < 0 || currentIndex >= lyrics.length) return;
    if (artistsList.length <= 1) return; // Solo track: no duet cycling or 'both'
    const current = lyrics[currentIndex].singer || 'artist-0';
    const currentIdx = artistsList.findIndex(a => a.id === current || (current === 'singer1' && a.id === 'artist-0') || (current === 'singer2' && a.id === 'artist-1'));
    let next: string;
    if (currentIdx >= 0 && currentIdx < artistsList.length - 1) {
      next = artistsList[currentIdx + 1].id;
    } else if (currentIdx === artistsList.length - 1) {
      next = 'both';
    } else {
      next = artistsList[0]?.id || 'artist-0';
    }

    const updated = lyrics.map((l, i) =>
      i === currentIndex ? { ...l, singer: next } : l
    );
    onUpdateLyrics(updated);
    setVisualLines(updated);
  };

  const handleSetGlobalSinger = async (gender: 'singer1' | 'singer2' | 'both') => {
    if (gender === 'both') {
      if (!isDuetMode && onToggleDuetMode) onToggleDuetMode();
      let vocBuf = audioEngine.getVocalsBuffer();
      if (!vocBuf && stems?.vocalsBlob) {
        const arr = await stems.vocalsBlob.arrayBuffer();
        vocBuf = await audioEngine.decodeAudio(arr);
      }
      const updated = await classifyAllLyricsVocalGender(lyrics, vocBuf, songArtist);
      onUpdateLyrics(updated);
      setVisualLines(updated);
      setSearchFeedback('✓ ¡Voz configurada en Modo Dúo (Hombre / Mujer)!');
    } else {
      if (isDuetMode && onToggleDuetMode) onToggleDuetMode();
      const updated = lyrics.map((l) => ({ ...l, singer: gender }));
      onUpdateLyrics(updated);
      setVisualLines(updated);
      setSearchFeedback(`✓ ¡Voz configurada y guardada como ${gender === 'singer1' ? '♂️ Hombre' : '♀️ Mujer'} para toda la canción!`);
    }
    setTimeout(() => setSearchFeedback(null), 3000);
  };

  const handleInvertAllDuetSingers = () => {
    if (!lyrics || lyrics.length === 0) return;
    const updated = lyrics.map((l) => {
      const current = l.singer || 'singer1';
      if (current === 'singer1') return { ...l, singer: 'singer2' as const };
      if (current === 'singer2') return { ...l, singer: 'singer1' as const };
      return l;
    });
    onUpdateLyrics(updated);
    setEditorText(formatLRC(updated));
    setSearchFeedback('🔄 ¡Voces invertidas con éxito! (Hombre ⇄ Mujer)');
    setEditorFeedback('🔄 ¡Voces invertidas! (Hombre ⇄ Mujer)');
    setTimeout(() => setSearchFeedback(null), 3000);
  };

  const handleAlternateStanzasDuet = () => {
    if (!lyrics || lyrics.length === 0) return;
    let currentRole: 'singer1' | 'singer2' = 'singer2'; // Start with female (or alternates)
    const updated = lyrics.map((l, i) => {
      if (/\[(all|juntos|both|todos|ambos|dueto|coro|duo)\]/i.test(l.text || '')) {
        return { ...l, singer: 'both' as const };
      }
      if (i > 0 && i % 2 === 0) {
        currentRole = currentRole === 'singer1' ? 'singer2' : 'singer1';
      }
      return { ...l, singer: currentRole };
    });
    onUpdateLyrics(updated);
    setEditorText(formatLRC(updated));
    setSearchFeedback('🔀 ¡Dueto alternado aplicado a los versos!');
    setEditorFeedback('🔀 Dueto alternado aplicado (Mujer / Hombre)');
    setTimeout(() => setSearchFeedback(null), 3000);
  };

  // Countdown to next line if there is an intro gap before track start
  let secondsToNext = 0;
  if (currentIndex === -1 && lyrics.length > 0 && lyrics[0].time > currentTime) {
    secondsToNext = Math.max(0, lyrics[0].time - currentTime);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── PROFESSIONAL KARAOKE TELEPROMPTER STAGE ───── */}
      <div className="relative bg-[#0c0e17] border border-slate-700/70 rounded-2xl overflow-hidden flex flex-col shadow-2xl">
        {/* Top Title & Calibration Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between px-3 sm:px-4 py-2.5 bg-slate-900/95 border-b border-slate-800 gap-2.5">
          <div className="flex flex-col min-w-0 w-full md:w-auto">
            <div className="flex items-center gap-2">
              <span className="text-sm sm:text-base font-bold text-white tracking-tight truncate max-w-md">{songTitle || '— Selecciona una canción —'}</span>
              {isDuetMode && (
                <span className="px-2.5 py-0.5 rounded-full text-[9px] font-mono font-black bg-[#ff007f]/20 text-[#ff007f] border border-[#ff007f]/50 shadow-[0_0_8px_rgba(255,0,127,0.3)] shrink-0 animate-pulse">
                  👥 MODO DUETO
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 font-mono mt-1">
              {songArtist && <span className="truncate max-w-[130px] font-medium text-slate-300">{songArtist} ·</span>}
              <div className="flex items-center bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-700 shrink-0">
                <span className="text-amber-300 font-bold">{bpm || 120} BPM</span>
                {onUpdateBpm && (
                  <div className="flex items-center ml-1.5 pl-1 border-l border-slate-700 text-slate-400">
                    <button onClick={() => onUpdateBpm(Math.max(40, (bpm || 120) - 1))} className="hover:text-white px-1.5 py-0.5 font-bold cursor-pointer transition-colors active:scale-90">−</button>
                    <button onClick={() => onUpdateBpm(Math.min(240, (bpm || 120) + 1))} className="hover:text-white px-1.5 py-0.5 font-bold cursor-pointer transition-colors active:scale-90">+</button>
                  </div>
                )}
              </div>
              {/* Exact Pitch Shifter / Key Transpose Module from Console */}
              <div className="bg-[#0c0e17] border border-slate-700/80 rounded-xl px-2 py-0.5 flex items-center gap-1.5 shrink-0">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-300 font-mono leading-none">
                  Tono:
                </span>

                <div className="flex items-center gap-1 bg-slate-950 px-1 py-0.5 rounded-lg border border-slate-800">
                  <button
                    onClick={() => onPitchShiftChange && onPitchShiftChange(Math.max(-6, pitchShift - 1))}
                    className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-white font-mono font-bold text-xs flex items-center justify-center cursor-pointer transition-all active:scale-90"
                    title="Bajar 1 semitono"
                  >
                    −
                  </button>

                  <div className="min-w-[62px] text-center px-1">
                    <span className="text-[11px] font-bold text-amber-300 font-mono block leading-tight">
                      {detectedKey ? transposeKey(detectedKey, pitchShift) : 'Am'}
                    </span>
                    <span className="text-[8px] font-mono text-slate-400 block">
                      {pitchShift === 0 ? 'Original' : `${pitchShift > 0 ? '+' : ''}${pitchShift}st`}
                    </span>
                  </div>

                  <button
                    onClick={() => onPitchShiftChange && onPitchShiftChange(Math.min(6, pitchShift + 1))}
                    className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-white font-mono font-bold text-xs flex items-center justify-center cursor-pointer transition-all active:scale-90"
                    title="Subir 1 semitono"
                  >
                    +
                  </button>

                  {pitchShift !== 0 && (
                    <button
                      onClick={() => onPitchShiftChange && onPitchShiftChange(0)}
                      className="p-1 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800 cursor-pointer ml-0.5 active:scale-90"
                      title="Restablecer a tono original"
                    >
                      <RefreshCw className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0 self-end md:self-center">
            <button
              onClick={() => setIsVideoBgModalOpen(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-all shadow-sm ${
                videoBgConfig.enabled && videoBgConfig.mode !== 'off'
                  ? 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40 shadow-[0_0_12px_rgba(217,70,239,0.3)] font-bold'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
              }`}
              title="Configurar Video de Fondo Dinámico (YouTube / Cyberpunk / Loop)"
            >
              <Film className="w-3.5 h-3.5 text-fuchsia-400" />
              <span>Fondo</span>
            </button>

            {onOpenVocalAutomation && (
              <button
                onClick={onOpenVocalAutomation}
                disabled={!hasSong}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-xs font-semibold cursor-pointer disabled:opacity-40 transition-all shadow-sm"
                title="Editor de Automatización de Voz Guía (Timeline / Waveform)"
              >
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden sm:inline">Voz Guía</span>
              </button>
            )}

            <button
              onClick={() => setShowLyricTools(!showLyricTools)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer transition-all"
            >
              {showLyricTools ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              <span>Letras</span>
            </button>

            <button
              onClick={onOpenPartyMode}
              disabled={!hasSong}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold cursor-pointer disabled:opacity-40 transition-all shadow-md active:scale-95"
            >
              Modo TV
            </button>
          </div>
        </div>

        {/* Lyric Tools Drawer */}
        {showLyricTools && (
          <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-950/95 flex flex-wrap items-center justify-between gap-2 animate-in fade-in duration-150">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setIsSearching((prev) => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-all ${
                  isSearching
                    ? 'bg-indigo-600 text-white shadow-[0_0_12px_rgba(99,102,241,0.5)]'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                }`}
                title="Buscar letras en internet con autocompletado en vivo"
              >
                <Search className="w-3.5 h-3.5 text-indigo-400" />
                <span>Buscar Letra</span>
              </button>

              <button
                onClick={handleOnlineSearch}
                disabled={isSearchingLrc || !songTitle}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-700 hover:bg-blue-600 text-white cursor-pointer disabled:opacity-50 transition-colors shadow-sm"
                title="Búsqueda rápida automática por título en LRCLIB"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>{isSearchingLrc ? 'Buscando...' : 'Auto-Buscar'}</span>
              </button>


              <button
                onClick={handleOpenEditor}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 cursor-pointer transition-colors shadow-sm"
                title="Editar texto, tiempos y sincronización de las letras"
              >
                <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                <span>Editor LRC</span>
              </button>

            </div>

            {/* Lyrics info status badge */}
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
              <span className="text-slate-500">Total:</span>
              <span className="text-emerald-400 font-bold">{lyrics.length} líneas</span>
            </div>
          </div>
        )}

        {/* Live Search Drawer */}
        {isSearching && (
          <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Escribe título o artista (ej: Bohemian Rhapsody Queen)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={() => setIsSearching(false)}
                className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 cursor-pointer"
              >
                Cerrar
              </button>
            </div>

            {/* Suggestions list */}
            {suggestions.length > 0 && (
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded-lg bg-slate-950">
                {suggestions.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => handleSelectSuggestion(s)}
                    className="p-2 hover:bg-slate-900 cursor-pointer flex items-center justify-between transition-colors"
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className="text-xs font-bold text-white truncate">{s.trackName}</span>
                      <span className="text-[10px] text-slate-400 truncate">{s.artistName} {s.albumName ? `· ${s.albumName}` : ''}</span>
                    </div>
                    <div className="shrink-0">
                      {s.syncedLyrics ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          Sincronizada
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                          Texto Plano
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {searchFeedback && (
          <div className="px-4 py-1.5 bg-indigo-950 text-indigo-200 text-xs font-semibold border-b border-indigo-800">
            {searchFeedback}
          </div>
        )}

        {/* ── TELEPROMPTER LYRICS / YOUTUBE STAGE ── */}
        <div className="flex flex-col justify-between items-center text-center px-6 py-5 h-[280px] select-none relative bg-[#06070e] overflow-hidden">
          {youTubeEmbedId ? (
            <div className="absolute inset-0 w-full h-full bg-black flex items-center justify-center z-20">
              <iframe
                id="karaokelab-yt-stage-iframe"
                ref={ytIframeRef}
                key={`yt_stage_${youTubeEmbedId}`}
                src={`https://www.youtube.com/embed/${youTubeEmbedId}?autoplay=1&controls=1&modestbranding=1&rel=0&playsinline=1&enablejsapi=1&iv_load_policy=3&loop=1&playlist=${youTubeEmbedId}&origin=${encodeURIComponent(typeof window !== 'undefined' ? window.location.origin : '')}`}
                title={songTitle || 'YouTube Karaoke Player'}
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                onLoad={() => {
                  try {
                    const win = ytIframeRef.current?.contentWindow;
                    if (win) {
                      win.postMessage(
                        JSON.stringify({ event: 'listening', id: youTubeEmbedId }),
                        '*'
                      );
                      win.postMessage(
                        JSON.stringify({ event: 'command', func: 'playVideo', args: '' }),
                        '*'
                      );
                    }
                  } catch (_) {}
                }}
              />
            </div>
          ) : (
            <>
              {/* Dynamic Video Background Layer */}
              <DynamicVideoBackground
                config={videoBgConfig}
                isPlaying={isPlaying}
                songKey={`${songTitle}___${songArtist || ''}`}
                currentTime={currentTime}
                duration={duration}
              />

              {/* SLOT 1: SINGER NAME / DUET BADGE / COUNTDOWN CUE */}
              <div className="h-7 w-full flex items-center justify-center shrink-0 z-10">
                {isPlaying && (
                  secondsToNext > 0.5 && secondsToNext <= 5.0 ? (
                    <div className="inline-flex items-center gap-2 px-3.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold animate-pulse">
                      <span>● ● ● ¡Prepárate para cantar en {Math.ceil(secondsToNext)}s!</span>
                      {nextLyric && (
                        <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-black/60 text-amber-200">
                          {(() => {
                            const nextInfo = getArtistInfo(nextLyric.singer || nextSinger);
                            return `${nextInfo.isBoth ? '👥' : '🎤'} ${nextInfo.name}`;
                          })()}
                        </span>
                      )}
                    </div>
                  ) : isSmartVocalCue && activeCueType ? (
                    <div className="inline-flex items-center gap-2 animate-in fade-in">
                      {activeCueType === 'intro' && (
                        <span className="px-3.5 py-0.5 rounded-full text-[10px] font-mono font-black bg-indigo-500/30 text-indigo-300 shadow-[0_0_12px_rgba(99,102,241,0.5)] animate-pulse">
                          ✨ ENTRADA GUÍA VOCAL (VOZ ORIGINAL)
                        </span>
                      )}
                      {activeCueType === 'chorus' && (
                        <span className="px-3.5 py-0.5 rounded-full text-[10px] font-mono font-black bg-purple-500/30 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.5)] animate-pulse">
                          ✨ CORO GUÍA ACTIVO (ACOMPAÑAMIENTO)
                        </span>
                      )}
                      {activeCueType === 'outro' && (
                        <span className="px-3.5 py-0.5 rounded-full text-[10px] font-mono font-black bg-cyan-500/30 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.5)] animate-pulse">
                          ✨ REMATE / SEGUNDA VOZ
                        </span>
                      )}
                    </div>
                  ) : currentLyric ? (
                    (() => {
                      const info = getArtistInfo(currentLyric.singer || currentSinger);
                      return (
                        <div
                          onClick={handleToggleActiveLineSinger}
                          className="inline-flex items-center gap-1.5 cursor-pointer hover:scale-105 active:scale-95 transition-transform font-mono text-xs font-bold uppercase tracking-wider"
                          style={{ color: info.color }}
                          title="Haz clic para alternar de cantante / artista"
                        >
                          <span>{info.isBoth ? '👥' : '🎤'}</span>
                          <span>{info.isBoth ? `DÚO · ${info.name.toUpperCase()}` : `VOZ: ${info.name.toUpperCase()}`}</span>
                        </div>
                      );
                    })()
                  ) : null
                )}
              </div>

              {/* SLOT 2: ACTIVE LINE STAGE WITH CLEAN LUMINOUS TYPOGRAPHY */}
              <div className="h-[140px] w-full max-w-4xl mx-auto flex flex-col items-center justify-center shrink-0 px-4 overflow-hidden z-10">
                {!isPlaying ? (
                  <div className="flex flex-col items-center justify-center gap-2.5 text-center opacity-60">
                    <div className="w-12 h-12 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-center shadow-inner">
                      <Music2 className="w-6 h-6 text-cyan-400/60" />
                    </div>
                    <p className="text-xs font-mono font-bold tracking-widest text-slate-400 uppercase">
                      {songTitle && (audioBlob || stems?.instrumentalBlob)
                        ? `LISTO PARA REPRODUCIR · ${songTitle}`
                        : 'KARAOKELAB STUDIO'}
                    </p>
                    {!(audioBlob || stems?.instrumentalBlob) && (
                      <span className="text-[10px] text-slate-500 font-mono">
                        Selecciona una canción de la biblioteca o cola para comenzar
                      </span>
                    )}
                  </div>
                ) : currentLyric ? (
                  (() => {
                    const textClean = cleanLyricText(currentLyric.text);
                    const textLen = textClean.length;
                    const fontSizeClass = textLen <= 25
                      ? 'text-3xl sm:text-4xl lg:text-5xl'
                      : textLen <= 50
                        ? 'text-2xl sm:text-3xl lg:text-4xl'
                        : 'text-xl sm:text-2xl lg:text-3xl';

                    return (
                      <div className="flex flex-col items-center justify-center gap-2 w-full overflow-hidden">
                        <div className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-black ${fontSizeClass} leading-snug tracking-tight text-center max-w-full`}>
                          {computeIntelligentWordFills(
                            { ...currentLyric, text: textClean },
                            effectiveTime,
                            nextLyric?.time,
                            bpm
                          ).map((item, wIdx) => {
                            const info = getArtistInfo(currentLyric.singer || currentSinger);
                            return (
                              <span key={wIdx} className="relative inline-block select-none">
                                {/* Layer 1: Base Unsung Word (Clean, crisp dim text) */}
                                <span className="text-white/25 inline-block">
                                  {item.word}
                                </span>

                                {/* Layer 2: Active Sweeping Highlight Word (Strictly inside letter glyphs) */}
                                {item.fillPercentage > 0 && (
                                  <span
                                    className="absolute inset-0 inline-block pointer-events-none"
                                    style={{
                                      clipPath: `inset(0 ${Math.max(0, Math.min(100, 100 - item.fillPercentage))}% 0 0)`,
                                      color: info.color,
                                    }}
                                  >
                                    {item.word}
                                  </span>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div className="text-center">
                    <p className="text-xl sm:text-2xl font-bold text-slate-500 tracking-wider animate-pulse">
                      ♫ [SOLO INSTRUMENTAL] ♫
                    </p>
                  </div>
                )}
              </div>

              {/* SLOT 3: UPCOMING NEXT LINE PREVIEW */}
              <div className="h-16 w-full max-w-3xl flex flex-col items-center justify-center shrink-0 overflow-hidden z-10">
                {isPlaying && nextLyric ? (
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/70 font-mono">
                      {(() => {
                        const nextInfo = getArtistInfo(nextLyric.singer || nextSinger);
                        return `[PRÓXIMA: ${nextInfo.isBoth ? '👥 DÚO' : '🎤 ' + nextInfo.name.toUpperCase()}]`;
                      })()}
                    </span>
                    <p
                      onClick={() => onSeek(nextLyric.time)}
                      className={`text-sm sm:text-lg font-bold transition-colors cursor-pointer truncate max-w-2xl ${
                        !isDuetMode
                          ? 'text-emerald-400 hover:text-emerald-300'
                          : nextSinger === 'singer1'
                            ? 'text-[#00f0ff]/80 hover:text-[#00f0ff]'
                            : nextSinger === 'singer2'
                              ? 'text-[#ff007f]/80 hover:text-[#ff007f]'
                              : 'text-[#ffe600]/80 hover:text-[#ffe600]'
                      }`}
                    >
                      {cleanLyricText(nextLyric.text)}
                    </p>
                    {nextNextLyric && (
                      <p className="text-[11px] text-slate-500 font-medium truncate max-w-xl">
                        {cleanLyricText(nextNextLyric.text)}
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>

        {/* ── Seek Bar with Live Scrubbing & Always-Visible Knob ── */}
        <div className="px-4 pt-3 pb-2 flex items-center gap-3 bg-slate-900/90 border-t border-slate-800">
          <span className="text-xs font-mono text-slate-400 tabular-nums w-10">{fmt(currentTime)}</span>
          <div className="flex-1 relative h-6 flex items-center">
            {/* Background Track */}
            <div className="w-full h-2.5 bg-slate-950 border border-slate-700/80 rounded-full overflow-hidden relative shadow-inner">
              <div
                className={`h-full rounded-full ${
                  !isDuetMode
                    ? 'bg-gradient-to-r from-amber-400 to-emerald-400'
                    : 'bg-gradient-to-r from-[#00f0ff] via-[#ff007f] to-[#ffe600]'
                }`}
                style={{ width: `${Math.max(0, Math.min(100, seekProgress))}%` }}
              />
            </div>

            {/* Glowing Hardware Thumb Knob (Always visible and synced live) */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white border-2 border-slate-900 shadow-[0_0_8px_rgba(255,255,255,0.9)] pointer-events-none z-10"
              style={{ left: `${Math.max(0, Math.min(100, seekProgress))}%` }}
            />

            {/* Live Interactive Range Slider for Dragging & Clicking */}
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 100}
              step={0.1}
              value={currentTime}
              onChange={(e) => onSeek(parseFloat(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
              title={`Posición: ${fmt(currentTime)} / ${fmt(duration)}`}
            />
          </div>
          <span className="text-xs font-mono text-slate-400 tabular-nums w-10 text-right">{fmt(duration)}</span>
        </div>

        {/* ── Transport Controls ── */}
        <div className="px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5 sm:gap-4 bg-slate-900/95 border-t border-slate-800/80">
          {/* Left: Dueto (40% de voz) & Guía Coros */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleVocalGuide}
              style={{ touchAction: 'manipulation' }}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all active:scale-95 ${
                vocalGain > 0.05
                  ? 'border-cyan-400 bg-cyan-500/25 text-cyan-300 shadow-[0_0_14px_rgba(6,182,212,0.45)] font-black'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'
              }`}
              title="Voz Guía: Activa la voz original del artista al 40% de volumen para acompañar tu canto"
            >
              <Mic className="w-4 h-4 text-cyan-300" />
              <span className="hidden sm:inline">
                {vocalGain > 0.05 ? 'Voz Guía (40%) ON' : 'Voz Guía'}
              </span>
            </button>
            <button
              type="button"
              onClick={onToggleSmartVocalCue}
              style={{ touchAction: 'manipulation' }}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all active:scale-95 ${
                isSmartVocalCue
                  ? 'border-indigo-400 bg-indigo-600/30 text-indigo-200 shadow-[0_0_14px_rgba(99,102,241,0.5)] font-black'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'
              }`}
              title="Guía Coros: Activa la voz original automáticamente solo en entradas de versos y coros"
            >
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span className="hidden sm:inline">
                {isSmartVocalCue ? 'Coros ON' : 'Guía Coros'}
              </span>
            </button>
          </div>

          {/* Center: Play / Pause / Stop / Next */}
          <div className="flex items-center justify-center gap-2 sm:gap-3 mx-auto order-first sm:order-none w-full sm:w-auto py-0.5">
            <button
              type="button"
              onClick={onStop}
              style={{ touchAction: 'manipulation' }}
              className="w-10 h-10 rounded-full border border-slate-700 bg-slate-800 hover:bg-slate-700 flex items-center justify-center cursor-pointer transition-all active:scale-90"
              title="Detener"
            >
              <Square className="w-4 h-4 text-slate-300 fill-current" />
            </button>
            <button
              type="button"
              onClick={isPlaying ? onPause : onPlay}
              style={{ touchAction: 'manipulation' }}
              className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center justify-center cursor-pointer shadow-lg hover:scale-105 transition-all active:scale-95"
              title={isPlaying ? 'Pausar' : 'Reproducir'}
            >
              {isPlaying
                ? <Pause className="w-6 h-6 fill-current" />
                : <Play className="w-6 h-6 fill-current ml-0.5" />
              }
            </button>
            <button
              type="button"
              onClick={() => onSeek(0)}
              style={{ touchAction: 'manipulation' }}
              className="w-10 h-10 rounded-full border border-slate-700 bg-slate-800 hover:bg-slate-700 flex items-center justify-center cursor-pointer transition-all active:scale-90"
              title="Reiniciar"
            >
              <RotateCcw className="w-4 h-4 text-slate-300" />
            </button>
            <button
              type="button"
              onClick={onNextInQueue}
              style={{ touchAction: 'manipulation' }}
              disabled={!hasNextInQueue || !onNextInQueue}
              className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all ${
                hasNextInQueue && onNextInQueue
                  ? 'border-cyan-400/70 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-500 hover:text-slate-950 hover:border-cyan-300 shadow-[0_0_12px_rgba(0,240,255,0.4)] cursor-pointer active:scale-90'
                  : 'border-slate-800 bg-slate-900/60 text-slate-600 cursor-not-allowed opacity-40'
              }`}
              title={hasNextInQueue ? 'Siguiente canción en cola' : 'No hay más canciones en la cola'}
            >
              <SkipForward className="w-4 h-4 fill-current" />
            </button>
          </div>

          {/* Right: Quick Offset adjustment */}
          <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400 shrink-0 ml-auto sm:ml-0">
            <span className="hidden md:inline font-semibold">Calibrar:</span>
            <button
              type="button"
              onClick={() => onUpdateSyncDelay && onUpdateSyncDelay(syncDelay - 0.2)}
              style={{ touchAction: 'manipulation' }}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold cursor-pointer active:scale-95"
              title="Adelantar Letra -0.2s"
            >
              -0.2s
            </button>
            <span className="text-amber-300 font-bold px-1">{syncDelay > 0 ? `+${syncDelay.toFixed(1)}s` : `${syncDelay.toFixed(1)}s`}</span>
            <button
              type="button"
              onClick={() => onUpdateSyncDelay && onUpdateSyncDelay(syncDelay + 0.2)}
              style={{ touchAction: 'manipulation' }}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold cursor-pointer active:scale-95"
              title="Atrasar Letra +0.2s"
            >
              +0.2s
            </button>
          </div>
        </div>
      </div>

      {/* ── LRC Editor Modal ── */}
      {isEditorOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0c0e17] border border-slate-700 rounded-2xl w-full max-w-4xl flex flex-col max-h-[92vh] shadow-2xl overflow-hidden">

            {/* ── Header ── */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 shrink-0">
              <div className="flex items-center gap-3">
                <Edit3 className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-sm text-white">Editor de Letras Sincronizadas</h3>
                {/* Tab switcher */}
                <div className="flex bg-slate-800 rounded-lg p-0.5 gap-0.5">
                  <button
                    onClick={() => {
                      if (editorTab === 'text') {
                        let parsed = parseLRC(editorText);
                        if (parsed.length === 0 && isGeniusFormat(editorText)) {
                          parsed = parseGeniusLyrics(editorText, duration || 180, editorStartSecond || 8).lyrics;
                        }
                        if (parsed.length > 0) {
                          setVisualLines(parsed);
                        }
                      }
                      setEditorTab('visual');
                    }}
                    className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                      editorTab === 'visual'
                        ? 'bg-amber-500 text-slate-950 shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    🎨 Visual
                  </button>
                  <button
                    onClick={() => {
                      setEditorText(formatLRC(visualLines));
                      setEditorTab('text');
                    }}
                    className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                      editorTab === 'text'
                        ? 'bg-amber-500 text-slate-950 shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    📝 LRC
                  </button>
                </div>
              </div>
              <button
                onClick={() => setIsEditorOpen(false)}
                className="text-slate-400 hover:text-white text-xs font-bold px-2 py-1 rounded bg-slate-800 cursor-pointer"
              >
                ✕ Cerrar
              </button>
            </div>

            {/* ── AI & Sync Toolbar ── */}
            <div className="px-4 py-2 bg-slate-950 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 text-xs shrink-0">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-slate-300 font-semibold">Inicio:</span>
                <input
                  type="number" step="0.5" value={editorStartSecond}
                  onChange={(e) => setEditorStartSecond(parseFloat(e.target.value) || 0)}
                  className="w-14 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-amber-300 font-mono font-bold"
                />
                <span className="text-slate-500 font-mono">s</span>
                <button onClick={handleDetectVocalStart} disabled={isDetectingVocalStart}
                  className="px-2.5 py-1 rounded bg-cyan-900 hover:bg-cyan-800 text-cyan-200 border border-cyan-700/50 font-semibold cursor-pointer">
                  {isDetectingVocalStart ? 'Detectando...' : 'Auto DSP'}
                </button>

                {/* Global time shift offset */}
                <div className="flex items-center gap-1 ml-2 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                  <span className="text-slate-500 text-[10px] uppercase font-bold">Mover Todo:</span>
                  <button onClick={() => handleShiftAllTimestamps(-0.5)} className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px] font-bold cursor-pointer">-0.5s</button>
                  <button onClick={() => handleShiftAllTimestamps(-0.2)} className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px] font-bold cursor-pointer">-0.2s</button>
                  <button onClick={() => handleShiftAllTimestamps(0.2)} className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px] font-bold cursor-pointer">+0.2s</button>
                  <button onClick={() => handleShiftAllTimestamps(0.5)} className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px] font-bold cursor-pointer">+0.5s</button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* 🔴 Live Tap-to-Sync Button */}
                <button
                  onClick={isLiveTapSync ? handleStopLiveTapSync : handleStartLiveTapSync}
                  className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer flex items-center gap-1.5 transition-all shadow-md ${
                    isLiveTapSync
                      ? 'bg-rose-600 text-white animate-pulse ring-2 ring-rose-400'
                      : 'bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white'
                  }`}
                  title="Grabar tiempos en tiempo real al compás de la música usando la barra espaciadora"
                >
                  <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
                  <span>{isLiveTapSync ? '⏹️ Detener Grabación' : '🔴 Grabar Tiempos [Espacio]'}</span>
                </button>


                {/* 🌐 Online Genius Search button */}
                <button
                  onClick={handleOpenEditorSearch}
                  className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer flex items-center gap-1.5 transition-all shadow-sm ${
                    showEditorSearchDrawer
                      ? 'bg-amber-500 text-slate-950 ring-2 ring-amber-400/50'
                      : 'bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white'
                  }`}
                  title="Buscar letra estructurada con artistas en Genius / Web"
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Buscar en Genius</span>
                </button>

                <button onClick={handleAutoDetectDuetAndVoices}
                  className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:brightness-110 text-white font-bold cursor-pointer flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /><span>Auto-Dúo DSP</span>
                </button>
              </div>
            </div>

            {/* ── ONLINE GENIUS SEARCH DRAWER (Integrated inside modal) ── */}
            {showEditorSearchDrawer && (
              <div className="p-3 bg-gradient-to-b from-slate-900 to-slate-950 border-b border-amber-500/30 shrink-0 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-bold text-amber-300">
                      Buscador de Letras Genius (con roles por artista [Daddy Yankee:], [Ozuna:], [Ambos])
                    </span>
                  </div>
                  <button
                    onClick={() => setShowEditorSearchDrawer(false)}
                    className="text-slate-400 hover:text-white text-xs font-bold px-1.5 py-0.5 rounded bg-slate-800"
                  >
                    ✕
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={editorSearchQuery}
                      onChange={(e) => setEditorSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearchGeniusInEditor(editorSearchQuery)}
                      placeholder="Ej: Daddy Yankee Ozuna La Rompe Corazones..."
                      className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <button
                    onClick={() => handleSearchGeniusInEditor(editorSearchQuery)}
                    disabled={isEditorSearching}
                    className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1 shrink-0"
                  >
                    {isEditorSearching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                    <span>Buscar</span>
                  </button>
                </div>

                {/* Suggestions / Results list */}
                {geniusSuggestions.length > 0 && (
                  <div className="mt-2.5 max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {geniusSuggestions.map((hit) => (
                      <div
                        key={hit.id}
                        onClick={() => handleSelectGeniusHit(hit)}
                        className="flex items-center justify-between p-2 rounded-lg bg-slate-800/80 hover:bg-amber-500/15 border border-slate-700/60 hover:border-amber-400/50 cursor-pointer transition-all group"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {hit.image ? (
                            <img src={hit.image} alt="" className="w-8 h-8 rounded object-cover shrink-0 border border-slate-700" />
                          ) : (
                            <div className="w-8 h-8 rounded bg-amber-500/20 text-amber-300 flex items-center justify-center shrink-0 font-bold text-xs">
                              ♫
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white group-hover:text-amber-300 truncate">{hit.title}</p>
                            <p className="text-[10px] text-slate-400 truncate">{hit.artist}</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-400/40 group-hover:bg-amber-500 group-hover:text-slate-950 shrink-0 ml-2 transition-all">
                          📥 Importar Letra + Roles
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {editorFeedback && (
              <div className="px-4 py-1.5 bg-indigo-950 text-indigo-200 text-xs font-semibold border-b border-indigo-800 shrink-0 flex items-center justify-between">
                <span>{editorFeedback}</span>
                <button onClick={() => setEditorFeedback(null)} className="text-slate-400 hover:text-white font-bold ml-2">✕</button>
              </div>
            )}

            {/* ── VISUAL EDITOR TAB (Separación de Estrofas / Versos por Cantante) ── */}
            {editorTab === 'visual' && (
              <>
                {/* Multi-Artist Manager Bar */}
                <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-col gap-2 shrink-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-slate-300 font-bold">
                      <Users className="w-3.5 h-3.5 text-amber-400" />
                      <span>Cantantes / Artistas ({artistsList.length}):</span>
                    </div>
                    <button
                      onClick={handleAddArtist}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold cursor-pointer transition-all flex items-center gap-1 shadow-sm active:scale-95"
                      title="Agregar un nuevo cantante a la canción"
                    >
                      <Plus className="w-3 h-3" />
                      <span>+ Agregar Cantante</span>
                    </button>
                  </div>

                  {/* Artist chips list */}
                  <div className="flex flex-wrap items-center gap-2">
                    {artistsList.map((artist, aIdx) => (
                      <div
                        key={artist.id}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-950/80 border transition-all shadow-sm"
                        style={{ borderColor: `${artist.color}66` }}
                      >
                        {/* Color Picker Swatch Dropdown */}
                        <div className="relative">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveColorPickerArtistId(prev => prev === artist.id ? null : artist.id);
                            }}
                            className={`w-5 h-5 rounded-full border-2 cursor-pointer shadow-sm transition-all hover:scale-110 active:scale-95 block ${
                              activeColorPickerArtistId === artist.id ? 'ring-2 ring-amber-400 border-white scale-110' : 'border-white/40'
                            }`}
                            style={{ backgroundColor: artist.color }}
                            title="Haz clic para abrir la paleta de colores"
                          />

                          {/* Color palette popover on click */}
                          {activeColorPickerArtistId === artist.id && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="flex flex-col absolute left-0 top-7 z-50 p-2.5 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl gap-2.5 w-52 animate-in fade-in"
                            >
                              <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                                <span className="text-[10px] font-bold text-slate-300">
                                  Color de {artist.name || `#${aIdx + 1}`}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setActiveColorPickerArtistId(null)}
                                  className="text-slate-400 hover:text-white text-xs px-1 cursor-pointer font-bold"
                                >
                                  ✕
                                </button>
                              </div>

                              <div>
                                <span className="text-[9px] font-bold text-rose-400 uppercase tracking-wider block mb-1">
                                  ♀️ Femeninos (Rosa, Morado, Naranja, Turquesa...)
                                </span>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {FEMALE_PALETTE.map((palColor) => (
                                    <button
                                      key={palColor}
                                      type="button"
                                      onClick={() => {
                                        handleUpdateArtist(artist.id, { color: palColor });
                                        setActiveColorPickerArtistId(null);
                                      }}
                                      className={`w-5 h-5 rounded-full border transition-transform hover:scale-125 cursor-pointer ${
                                        artist.color === palColor ? 'ring-2 ring-white scale-110 border-white shadow-md' : 'border-white/20'
                                      }`}
                                      style={{ backgroundColor: palColor }}
                                      title={palColor}
                                    />
                                  ))}
                                </div>
                              </div>

                              <div>
                                <span className="text-[9px] font-bold text-cyan-400 uppercase tracking-wider block mb-1">
                                  ♂️ Masculinos (Cyan, Lima, Azul, Dorado...)
                                </span>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {MALE_PALETTE.map((palColor) => (
                                    <button
                                      key={palColor}
                                      type="button"
                                      onClick={() => {
                                        handleUpdateArtist(artist.id, { color: palColor });
                                        setActiveColorPickerArtistId(null);
                                      }}
                                      className={`w-5 h-5 rounded-full border transition-transform hover:scale-125 cursor-pointer ${
                                        artist.color === palColor ? 'ring-2 ring-white scale-110 border-white shadow-md' : 'border-white/20'
                                      }`}
                                      style={{ backgroundColor: palColor }}
                                      title={palColor}
                                    />
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <span className="text-[10px] font-mono font-black" style={{ color: artist.color }}>
                          #{aIdx + 1}
                        </span>

                        <input
                          value={artist.name}
                          onChange={(e) => handleUpdateArtist(artist.id, { name: e.target.value })}
                          className="w-24 px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded text-[11px] font-bold text-white focus:outline-none focus:border-amber-400"
                          placeholder="Nombre..."
                        />

                        {artistsList.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveArtist(artist.id)}
                            className="p-0.5 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors text-xs"
                            title="Eliminar este cantante"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Bulk assign buttons */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-slate-800/60">
                    <span className="text-[10px] text-slate-400 font-mono">
                      {selectedLines.size > 0 ? `${selectedLines.size} seleccionadas:` : 'Asignar selección a:'}
                    </span>
                    {artistsList.map((artist) => (
                      <button
                        key={artist.id}
                        type="button"
                        onClick={() => {
                          const targets = selectedLines.size > 0 ? Array.from(selectedLines) : visualLines.map((_, i) => i);
                          setVisualLines(prev => prev.map((l, i) => {
                            if (targets.includes(i)) {
                              return {
                                ...l,
                                singer: artist.id,
                                sectionHeader: l.sectionHeader ? updateSectionHeaderSinger(l.sectionHeader, artist.name) : l.sectionHeader,
                              };
                            }
                            return l;
                          }));
                          setSelectedLines(new Set());
                        }}
                        className="px-2 py-0.5 rounded-md text-[10px] font-bold border cursor-pointer transition-all hover:scale-105 active:scale-95 flex items-center gap-1"
                        style={{
                          backgroundColor: `${artist.color}18`,
                          color: artist.color,
                          borderColor: `${artist.color}55`,
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: artist.color }} />
                        <span>{artist.name}</span>
                      </button>
                    ))}

                    {/* Only show Ambos / Todos if there are 2 or more artists! */}
                    {artistsList.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const targets = selectedLines.size > 0 ? Array.from(selectedLines) : visualLines.map((_, i) => i);
                          const bothLabel = artistsList.length > 2 ? 'Todos' : 'Ambos';
                          setVisualLines(prev => prev.map((l, i) => {
                            if (targets.includes(i)) {
                              return {
                                ...l,
                                singer: 'both',
                                sectionHeader: l.sectionHeader ? updateSectionHeaderSinger(l.sectionHeader, bothLabel) : l.sectionHeader,
                              };
                            }
                            return l;
                          }));
                          setSelectedLines(new Set());
                        }}
                        className="px-2 py-0.5 rounded-md text-[10px] font-bold border border-amber-400/50 bg-amber-500/15 text-amber-300 cursor-pointer transition-all hover:scale-105 active:scale-95 flex items-center gap-1"
                      >
                        <span>👥</span>
                        <span>{artistsList.length > 2 ? 'Todos' : 'Ambos'}</span>
                      </button>
                    )}

                    {selectedLines.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedLines(new Set())}
                        className="text-[10px] text-slate-500 hover:text-slate-300 ml-auto cursor-pointer"
                      >
                        Deseleccionar
                      </button>
                    )}
                  </div>
                </div>

                {/* 🔴 Live Tap Recording Floating Banner */}
                {isLiveTapSync && (
                  <div className="p-3 bg-gradient-to-r from-rose-950 via-slate-900 to-rose-950 border-y border-rose-500/50 flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-xl animate-in fade-in">
                    <div className="flex items-center gap-3">
                      <div className="w-3.5 h-3.5 rounded-full bg-rose-500 animate-ping" />
                      <div>
                        <div className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                          <span>🎙️ MODO GRABACIÓN DE TIEMPOS ACTIVO</span>
                          <span className="text-slate-400 font-mono">({liveTapIdx + 1} de {visualLines.length})</span>
                        </div>
                        <div className="text-sm font-black text-white truncate max-w-md">
                          Verso a Marcar: <span className="text-amber-300">"{visualLines[liveTapIdx]?.text || 'Fin de la canción'}"</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleTapCurrentLine(currentTime)}
                        className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-400 hover:to-amber-400 text-slate-950 font-black text-xs cursor-pointer shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center gap-2 ring-2 ring-white/50"
                      >
                        <span className="bg-slate-950 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">[ESPACIO]</span>
                        <span>MARCAR VERSO ({currentTime.toFixed(1)}s)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setLiveTapIdx(Math.max(0, liveTapIdx - 1));
                        }}
                        className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer"
                        title="Retroceder al verso anterior"
                      >
                        ⏮️ Verso Anterior
                      </button>
                      <button
                        type="button"
                        onClick={handleStopLiveTapSync}
                        className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-rose-300 hover:text-rose-200 text-xs font-bold cursor-pointer"
                      >
                        ⏹️ Detener
                      </button>
                    </div>
                  </div>
                )}

                {/* Visual lines list grouped into Stanzas (Estrofas) */}
                <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-3 bg-[#080911]">
                  {visualLines.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-slate-500 text-sm gap-2">
                      <Music2 className="w-8 h-8 text-slate-600" />
                      <span>No hay letras cargadas actualmente.</span>
                      <span className="text-xs text-slate-400">
                        Usa el botón <strong>"🌐 Buscar en Genius"</strong> arriba o pega tu letra en la pestaña <strong>"📝 LRC"</strong>.
                      </span>
                    </div>
                  ) : (
                    (() => {
                      const stanzas = groupLinesIntoStanzas(visualLines);
                      return stanzas.map((stanza, sIdx) => {
                        const artistInfo = getArtistInfo(stanza.singer);
                        const singerColor = artistInfo.color;

                        return (
                          <div
                            key={sIdx}
                            className="rounded-xl border transition-all overflow-hidden"
                            style={{
                              borderColor: `${singerColor}33`,
                              background: `linear-gradient(180deg, ${singerColor}0a 0%, rgba(12, 14, 23, 0.95) 100%)`,
                              boxShadow: `0 2px 12px ${singerColor}0a`,
                            }}
                          >
                            {/* Stanza Header / Section Tag */}
                            <div
                              className="px-3.5 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-xs bg-slate-900/60"
                              style={{ borderColor: `${singerColor}22` }}
                            >
                              <div className="flex items-center gap-2 flex-wrap">
                                {stanza.sectionHeader ? (
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className="px-2.5 py-0.5 rounded-lg text-xs font-black tracking-wide border flex items-center gap-1.5 shadow-sm font-mono"
                                      style={{
                                        backgroundColor: `${singerColor}20`,
                                        color: '#ffffff',
                                        borderColor: `${singerColor}77`,
                                      }}
                                    >
                                      <span className="text-amber-400">🏷️</span>
                                      <span className="text-amber-200 font-bold">{cleanSectionHeader(stanza.sectionHeader)}</span>
                                    </span>
                                    {artistsList.length > 1 && (
                                      <span
                                        className="px-2 py-0.5 rounded-full text-[9px] font-black tracking-wider uppercase border"
                                        style={{
                                          backgroundColor: `${singerColor}15`,
                                          color: singerColor,
                                          borderColor: `${singerColor}40`,
                                        }}
                                      >
                                        {artistInfo.isBoth ? '👥 Todos' : `🎤 ${artistInfo.name}`}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span
                                    className="px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wider uppercase border flex items-center gap-1 shadow-sm"
                                    style={{
                                      backgroundColor: `${singerColor}1a`,
                                      color: singerColor,
                                      borderColor: `${singerColor}55`,
                                    }}
                                  >
                                    <span>{artistsList.length > 1 && artistInfo.isBoth ? '👥' : '🎤'}</span>
                                    <span>Estrofa {sIdx + 1} · {artistInfo.name}</span>
                                  </span>
                                )}
                                <span className="text-[10px] font-mono text-slate-500">
                                  ({stanza.lines.length} {stanza.lines.length === 1 ? 'verso' : 'versos'})
                                </span>
                              </div>

                              {/* Quick Stanza Actions: Move Up/Down + Reassign */}
                              <div className="flex items-center gap-2 text-[10px]">
                                {/* Reorder buttons */}
                                <div className="flex items-center gap-1 bg-slate-950/80 p-0.5 rounded-lg border border-slate-800">
                                  <button
                                    onClick={() => handleMoveStanza(sIdx, 'up')}
                                    disabled={sIdx === 0}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${
                                      sIdx === 0
                                        ? 'opacity-25 cursor-not-allowed text-slate-600'
                                        : 'bg-slate-800 hover:bg-amber-500/20 text-slate-300 hover:text-amber-300 cursor-pointer active:scale-95'
                                    }`}
                                    title="Mover este bloque arriba en la canción"
                                  >
                                    ▲ Subir
                                  </button>
                                  <button
                                    onClick={() => handleMoveStanza(sIdx, 'down')}
                                    disabled={sIdx === stanzas.length - 1}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${
                                      sIdx === stanzas.length - 1
                                        ? 'opacity-25 cursor-not-allowed text-slate-600'
                                        : 'bg-slate-800 hover:bg-amber-500/20 text-slate-300 hover:text-amber-300 cursor-pointer active:scale-95'
                                    }`}
                                    title="Mover este bloque abajo en la canción"
                                  >
                                    ▼ Bajar
                                  </button>
                                </div>

                                {artistsList.length > 1 && (
                                  <>
                                    <span className="text-slate-500 font-mono">Asignar:</span>
                                    {artistsList.map((art) => (
                                      <button
                                        key={art.id}
                                        onClick={() => {
                                          const indices = stanza.lines.map(l => l.globalIndex);
                                          setVisualLines(prev => prev.map((l, i) => {
                                            if (indices.includes(i)) {
                                              return {
                                                ...l,
                                                singer: art.id,
                                                sectionHeader: l.sectionHeader ? updateSectionHeaderSinger(l.sectionHeader, art.name) : l.sectionHeader,
                                              };
                                            }
                                            return l;
                                          }));
                                        }}
                                        className="px-2 py-0.5 rounded font-bold cursor-pointer transition-all border"
                                        style={{
                                          backgroundColor: `${art.color}15`,
                                          color: art.color,
                                          borderColor: `${art.color}40`,
                                        }}
                                        title={`Asignar todo este bloque a ${art.name}`}
                                      >
                                        🎤 {art.name}
                                      </button>
                                    ))}
                                    <button
                                      onClick={() => {
                                        const indices = stanza.lines.map(l => l.globalIndex);
                                        const bothLabel = artistsList.length > 2 ? 'Todos' : 'Ambos';
                                        setVisualLines(prev => prev.map((l, i) => {
                                          if (indices.includes(i)) {
                                            return {
                                              ...l,
                                              singer: 'both',
                                              sectionHeader: l.sectionHeader ? updateSectionHeaderSinger(l.sectionHeader, bothLabel) : l.sectionHeader,
                                            };
                                          }
                                          return l;
                                        }));
                                      }}
                                      className="px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-400/40 font-bold cursor-pointer transition-all"
                                      title="Asignar todo este bloque a 👥 Ambos / Todos"
                                    >
                                      👥 {artistsList.length > 2 ? 'Todos' : 'Ambos'}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Stanza Lines */}
                            <div className="divide-y divide-slate-800/40">
                              {stanza.lines.map(({ line, globalIndex }) => {
                                const isSelected = selectedLines.has(globalIndex);
                                const isCurrent = globalIndex === currentIndex;
                                const lineArtist = getArtistInfo(line.singer);
                                const mm = Math.floor(line.time / 60);
                                const ss = Math.floor(line.time % 60);
                                const ms = Math.round((line.time % 1) * 100);
                                const timeStr = `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}.${String(ms).padStart(2,'0')}`;

                                return (
                                  <div
                                    key={globalIndex}
                                    onClick={() => {
                                      setSelectedLines(prev => {
                                        const next = new Set(prev);
                                        if (next.has(globalIndex)) next.delete(globalIndex);
                                        else next.add(globalIndex);
                                        return next;
                                      });
                                    }}
                                    className={`flex items-center gap-3 px-3.5 py-1.5 cursor-pointer transition-all select-none ${
                                      isLiveTapSync && globalIndex === liveTapIdx ? 'bg-rose-500/30 border-l-4 border-rose-400 ring-2 ring-rose-400 shadow-md' :
                                      isCurrent ? 'bg-amber-500/15 border-l-2 border-amber-400' :
                                      isSelected ? 'bg-indigo-500/20 border-l-2 border-indigo-400' :
                                      'hover:bg-slate-800/40 border-l-2 border-transparent'
                                    }`}
                                  >
                                    {/* Checkbox */}
                                    <div className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-all ${
                                      isSelected ? 'bg-indigo-500 border-indigo-400' : 'border-slate-700 bg-slate-900'
                                    }`}>
                                      {isSelected && <span className="text-[7px] text-white font-black">✓</span>}
                                    </div>

                                    {/* Time and Fine Nudge */}
                                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                      <span className={`text-[10px] font-mono w-16 ${isLiveTapSync && globalIndex === liveTapIdx ? 'text-rose-300 font-bold' : 'text-slate-500'}`}>
                                        [{timeStr}]
                                      </span>
                                      <div className="flex items-center gap-0.5">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setVisualLines(prev => prev.map((l, i) => i === globalIndex ? { ...l, time: Math.max(0, +(l.time - 0.1).toFixed(2)) } : l));
                                          }}
                                          className="px-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-[9px] font-mono cursor-pointer"
                                          title="Adelantar este verso -0.1s"
                                        >
                                          -
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setVisualLines(prev => prev.map((l, i) => i === globalIndex ? { ...l, time: +(l.time + 0.1).toFixed(2) } : l));
                                          }}
                                          className="px-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-[9px] font-mono cursor-pointer"
                                          title="Atrasar este verso +0.1s"
                                        >
                                          +
                                        </button>
                                      </div>
                                    </div>

                                    {/* Individual Singer Cycle pill */}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (artistsList.length <= 1) return; // Solo track: no cycling
                                        const cur = line.singer;
                                        const curIdx = artistsList.findIndex(a => a.id === cur || (cur === 'singer1' && a.id === 'artist-0') || (cur === 'singer2' && a.id === 'artist-1'));
                                        let nextSingerId: string;
                                        if (curIdx >= 0 && curIdx < artistsList.length - 1) {
                                          nextSingerId = artistsList[curIdx + 1].id;
                                        } else if (curIdx === artistsList.length - 1) {
                                          nextSingerId = 'both';
                                        } else {
                                          nextSingerId = artistsList[0]?.id || 'artist-0';
                                        }
                                        setVisualLines(prev => prev.map((l, i) => i === globalIndex ? { ...l, singer: nextSingerId } : l));
                                      }}
                                      className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-black border transition-all ${
                                        artistsList.length > 1 ? 'cursor-pointer hover:scale-105 active:scale-95' : 'cursor-default'
                                      }`}
                                      style={{
                                        backgroundColor: `${lineArtist.color}18`,
                                        color: lineArtist.color,
                                        borderColor: `${lineArtist.color}55`,
                                      }}
                                      title={artistsList.length > 1 ? 'Clic para alternar cantante' : 'Voz de la canción'}
                                    >
                                      {artistsList.length > 1 && lineArtist.isBoth ? '👥 Ambos' : `🎤 ${lineArtist.name}`}
                                    </button>

                                    {/* Lyric text */}
                                    <span
                                      className={`flex-1 text-xs font-semibold truncate ${isCurrent || (isLiveTapSync && globalIndex === liveTapIdx) ? 'font-bold' : ''}`}
                                      style={{ color: (isLiveTapSync && globalIndex === liveTapIdx) ? '#fda4af' : isCurrent ? '#fef08a' : lineArtist.color }}
                                    >
                                      {line.text}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      });
                    })()
                  )}
                </div>

                {/* Footer */}
                <div className="p-3 border-t border-slate-800 bg-slate-900/90 flex flex-wrap items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono">
                    <span className="text-slate-400 font-bold">{visualLines.length} versos:</span>
                    {artistsList.map(a => {
                      const count = visualLines.filter(l => l.singer === a.id || (a.id === 'artist-0' && (l.singer === 'singer1' || !l.singer)) || (a.id === 'artist-1' && l.singer === 'singer2')).length;
                      return (
                        <span key={a.id} className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800" style={{ color: a.color }}>
                          {a.name}: <strong>{count}</strong>
                        </span>
                      );
                    })}
                    {artistsList.length > 1 && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-amber-300">
                        Ambos: <strong>{visualLines.filter(l => l.singer === 'both').length}</strong>
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setIsEditorOpen(false)}
                      className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer">
                      Cancelar
                    </button>
                    <button
                      onClick={handleSaveEditor}
                      className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer shadow-md transition-all hover:scale-105 active:scale-95">
                      💾 Guardar y Aplicar
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* ── LRC TEXT EDITOR TAB ── */}
            {editorTab === 'text' && (
              <>
                {/* Singer tag toolbar */}
                <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center gap-2 text-xs shrink-0">
                  <span className="text-[11px] font-bold text-slate-400 font-mono">Etiquetas:</span>
                  <button type="button" onClick={() => setEditorText((prev) => prev + '\n[Hombre] ')}
                    className="px-2.5 py-1 rounded-lg bg-[#00f0ff]/15 hover:bg-[#00f0ff]/25 text-[#00f0ff] border border-[#00f0ff]/40 text-[11px] font-bold cursor-pointer flex items-center gap-1">
                    ♂️ +[Hombre]
                  </button>
                  <button type="button" onClick={() => setEditorText((prev) => prev + '\n[Mujer] ')}
                    className="px-2.5 py-1 rounded-lg bg-[#ff007f]/15 hover:bg-[#ff007f]/25 text-[#ff007f] border border-[#ff007f]/40 text-[11px] font-bold cursor-pointer flex items-center gap-1">
                    ♀️ +[Mujer]
                  </button>
                  <button type="button" onClick={() => setEditorText((prev) => prev + '\n[Ambos] ')}
                    className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-400/40 text-[11px] font-bold cursor-pointer flex items-center gap-1">
                    👥 +[Ambos]
                  </button>
                  <button type="button" onClick={handleInvertAllDuetSingers}
                    className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-400/40 text-[11px] font-bold cursor-pointer flex items-center gap-1">
                    🔄 Invertir
                  </button>
                  <button onClick={handleAutoSyncEditor}
                    className="ml-auto px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold cursor-pointer">
                    Sincronizar Todo
                  </button>
                </div>

                <div className="p-4 flex-1 flex flex-col min-h-0">
                  <textarea
                    value={editorText}
                    onChange={(e) => setEditorText(e.target.value)}
                    className="w-full flex-1 p-3 bg-slate-900 border border-slate-800 rounded-xl font-mono text-xs text-slate-200 focus:outline-none focus:border-amber-400 resize-none leading-relaxed"
                    placeholder="Pega aquí tu letra o edita marcas de tiempo [mm:ss.xx]..."
                    rows={16}
                  />
                </div>

                <div className="p-3 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between shrink-0">
                  <span className="text-[11px] text-slate-500 font-mono">
                    {editorText.split('\n').filter((l) => l.trim()).length} versos
                  </span>
                  <div className="flex gap-2.5">
                    <button onClick={() => setIsEditorOpen(false)}
                      className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer">
                      Cancelar
                    </button>
                    <button
                      onClick={handleSaveEditor}
                      className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer shadow-md hover:scale-105 active:scale-95">
                      💾 Guardar y Aplicar
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Dynamic Video Background Selector Modal */}
      <VideoBackgroundSelectorModal
        isOpen={isVideoBgModalOpen}
        onClose={() => setIsVideoBgModalOpen(false)}
        config={videoBgConfig}
        onChangeConfig={handleUpdateVideoBgConfig}
        songTitle={songTitle}
        songArtist={songArtist}
      />
    </div>
  );
};
