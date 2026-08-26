import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { SongItem, VocalAutomationConfig, VocalAutomationPoint, LyricLine } from '../types';
import { audioEngine } from '../services/audioEngine';
import {
  X,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
  Plus,
  Trash2,
  Check,
  Activity,
  ZoomIn,
  ZoomOut,
  Mic,
  HelpCircle,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Square,
  Magnet,
  AlignJustify,
  Zap,
  Undo2,
  Redo2,
  Radio,
  FileText,
  Maximize2,
  Minimize2,
} from 'lucide-react';

interface VocalAutomationModalProps {
  isOpen: boolean;
  onClose: () => void;
  song: SongItem;
  currentTime: number;
  duration: number;
  lyrics: LyricLine[];
  onSaveAutomation: (updatedSong: SongItem, config: VocalAutomationConfig) => void;
  onSeek: (seconds: number) => void;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
}

const GAIN_PRESETS = [
  { label: '0% Mute', value: 0.0, color: '#ef4444', icon: VolumeX, desc: 'Silencio total' },
  { label: '30% Suave', value: 0.3, color: '#38bdf8', icon: Volume2, desc: 'Apoyo sutil' },
  { label: '50% Guía', value: 0.5, color: '#10b981', icon: Mic, desc: 'Voz guía ideal' },
  { label: '100% Full', value: 1.0, color: '#a855f7', icon: Volume2, desc: 'Voz original completa' },
];

function normalizePhrase(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/\[.*?\]|\(.*?\)/g, '')
    .replace(/[^\w\s]/g, '')
    .trim();
}

export const VocalAutomationModal: React.FC<VocalAutomationModalProps> = ({
  isOpen,
  onClose,
  song,
  currentTime,
  duration,
  lyrics,
  onSaveAutomation,
  onSeek,
  isPlaying,
  onPlay,
  onPause,
}) => {
  const effectiveDuration = duration > 0 ? duration : (song.duration || 180);

  // Initialize config with points (or baseline if empty)
  const initialBaseConfig = useMemo<VocalAutomationConfig>(() => {
    if (song.vocalAutomation && song.vocalAutomation.points && song.vocalAutomation.points.length > 0) {
      return song.vocalAutomation;
    }
    return {
      enabled: true,
      defaultGain: 0.0,
      backgroundVocalEnabled: false,
      backgroundVocalGain: 0.20,
      points: [
        { id: 'pt_start', time: 0, gain: 0.0, label: 'Inicio' },
        { id: 'pt_end', time: effectiveDuration, gain: 0.0, label: 'Fin' },
      ],
    };
  }, [song, effectiveDuration]);

  const [config, setConfig] = useState<VocalAutomationConfig>(initialBaseConfig);

  // ── HISTORY STACK (UNDO / REDO) ──
  const [history, setHistory] = useState<VocalAutomationConfig[]>([initialBaseConfig]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const dragStartConfigRef = useRef<VocalAutomationConfig | null>(null);

  // Multiple selection & snap states (Horizontal + Vertical)
  const [selectedPointIds, setSelectedPointIds] = useState<Set<string>>(new Set());
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const [isHoveringRuler, setIsHoveringRuler] = useState<boolean>(false);
  const [isSnapEnabled, setIsSnapEnabled] = useState<boolean>(true);
  const [activeHorizontalSnap, setActiveHorizontalSnap] = useState<{ gain: number; y: number; label: string } | null>(null);
  const [activeVerticalSnap, setActiveVerticalSnap] = useState<{ time: number; x: number; label: string } | null>(null);

  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [scrollLeftRatio, setScrollLeftRatio] = useState<number>(0.0);
  const [waveformPeaks, setWaveformPeaks] = useState<Float32Array | null>(null);
  const [isDraggingPoint, setIsDraggingPoint] = useState<boolean>(false);
  const [draggedAnchorPointId, setDraggedAnchorPointId] = useState<string | null>(null);
  const [isScrubbingRuler, setIsScrubbingRuler] = useState<boolean>(false);
  const [isDraggingScrollThumb, setIsDraggingScrollThumb] = useState<boolean>(false);
  const [marqueeBox, setMarqueeBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [burstDurationSeconds, setBurstDurationSeconds] = useState<number>(3.0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollbarTrackRef = useRef<HTMLDivElement | null>(null);

  // Helper to commit state with Undo History
  const commitConfig = useCallback((newConfig: VocalAutomationConfig, toast?: string) => {
    setHistory((prev) => {
      const truncated = prev.slice(0, historyIndex + 1);
      const nextHist = [...truncated, newConfig];
      if (nextHist.length > 50) nextHist.shift();
      return nextHist;
    });
    setHistoryIndex((prev) => Math.min(prev + 1, 49));
    setConfig(newConfig);
    audioEngine.setVocalAutomationConfig(newConfig);
    if (toast) setToastMessage(toast);
  }, [historyIndex]);

  // Mac Native Undo Handler (⌘Z)
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prevIdx = historyIndex - 1;
      const prevConf = history[prevIdx];
      setHistoryIndex(prevIdx);
      setConfig(prevConf);
      audioEngine.setVocalAutomationConfig(prevConf);
      setSelectedPointIds(new Set());
      setToastMessage('↩️ Deshecho (⌘Z)');
    }
  }, [history, historyIndex]);

  // Mac Native Redo Handler (⇧⌘Z)
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1;
      const nextConf = history[nextIdx];
      setHistoryIndex(nextIdx);
      setConfig(nextConf);
      audioEngine.setVocalAutomationConfig(nextConf);
      setSelectedPointIds(new Set());
      setToastMessage('↪️ Rehecho (⇧⌘Z)');
    }
  }, [history, historyIndex]);

  // Sync state when modal opens or song changes
  useEffect(() => {
    if (isOpen && song) {
      let initialConfig: VocalAutomationConfig;
      if (song.vocalAutomation && song.vocalAutomation.points && song.vocalAutomation.points.length > 0) {
        initialConfig = {
          backgroundVocalEnabled: false,
          backgroundVocalGain: 0.20,
          ...song.vocalAutomation,
        };
      } else {
        const dur = duration > 0 ? duration : (song.duration || 180);
        initialConfig = {
          enabled: true,
          defaultGain: 0.0,
          backgroundVocalEnabled: false,
          backgroundVocalGain: 0.20,
          points: [
            { id: 'pt_start', time: 0, gain: 0.0, label: 'Inicio' },
            { id: 'pt_end', time: dur, gain: 0.0, label: 'Fin' },
          ],
        };
      }
      setConfig(initialConfig);
      setHistory([initialConfig]);
      setHistoryIndex(0);
      setSelectedPointIds(new Set());
      setActiveHorizontalSnap(null);
      setActiveVerticalSnap(null);
      audioEngine.setVocalAutomationConfig(initialConfig);
    }
  }, [isOpen, song, duration]);

  // Extract waveform peaks from vocal audio buffer
  useEffect(() => {
    if (!isOpen) return;

    const vocalsBuf = audioEngine.getVocalsBuffer() || audioEngine.getAudioBuffer();
    if (!vocalsBuf) {
      setWaveformPeaks(null);
      return;
    }

    const channelData = vocalsBuf.getChannelData(0);
    const numSamples = 1600;
    const blockSize = Math.floor(channelData.length / numSamples);
    const peaks = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      let maxVal = 0;
      const start = i * blockSize;
      const end = Math.min(start + blockSize, channelData.length);
      for (let j = start; j < end; j += 4) {
        const val = Math.abs(channelData[j]);
        if (val > maxVal) maxVal = val;
      }
      peaks[i] = maxVal;
    }

    setWaveformPeaks(peaks);
  }, [isOpen, song]);

  // Clear toast after 3.5 seconds
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Mac Native Keyboard shortcuts: ⌘Z (Undo), ⇧⌘Z / ⌘Y (Redo), ⌘A (Select All), Backspace / Delete
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      // ⌘Z (Undo)
      if (isCmdOrCtrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // ⇧⌘Z or ⌘Y (Redo on Mac)
      if ((isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'z') || (isCmdOrCtrl && e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // ⌫ Delete / Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedPointIds.size > 0) {
          const deletable = Array.from(selectedPointIds).filter((id) => id !== 'pt_start' && id !== 'pt_end');
          if (deletable.length > 0) {
            const updated = {
              ...config,
              points: config.points.filter((p) => !deletable.includes(p.id)),
            };
            commitConfig(updated, `✓ ${deletable.length} punto(s) eliminado(s)`);
            setSelectedPointIds(new Set());
          }
        }
      } else if (isCmdOrCtrl && e.key.toLowerCase() === 'a') {
        // ⌘A (Select All)
        e.preventDefault();
        const allIds = new Set(config.points.map((p) => p.id));
        setSelectedPointIds(allIds);
      } else if (e.key === 'Escape') {
        setSelectedPointIds(new Set());
      } else if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        if (isPlaying) onPause();
        else onPlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedPointIds, config, isPlaying, onPause, onPlay, handleUndo, handleRedo, commitConfig]);

  // Visible timeline window calculation
  const visibleDuration = effectiveDuration / zoomLevel;
  const maxScrollTime = Math.max(0, effectiveDuration - visibleDuration);
  const visibleStartTime = maxScrollTime > 0 ? scrollLeftRatio * maxScrollTime : 0;
  const visibleEndTime = visibleStartTime + visibleDuration;

  // Auto-pan viewport during playback when zoomed in
  useEffect(() => {
    if (isPlaying && zoomLevel > 1.0 && maxScrollTime > 0) {
      if (currentTime > visibleEndTime - 2 || currentTime < visibleStartTime) {
        const targetRatio = Math.max(0, Math.min(1, (currentTime - visibleDuration * 0.2) / maxScrollTime));
        setScrollLeftRatio(targetRatio);
      }
    }
  }, [currentTime, isPlaying, zoomLevel, maxScrollTime, visibleDuration, visibleStartTime, visibleEndTime]);

  // Coordinate transforms
  const TOP_RULER_HEIGHT = 36;
  const BOTTOM_PADDING = 30;

  const secToCanvasX = useCallback(
    (sec: number, width: number) => {
      if (visibleDuration <= 0) return 0;
      const ratio = (sec - visibleStartTime) / visibleDuration;
      return ratio * width;
    },
    [visibleStartTime, visibleDuration]
  );

  const gainToCanvasY = useCallback((gain: number, height: number) => {
    const usableHeight = height - TOP_RULER_HEIGHT - BOTTOM_PADDING;
    const clamped = Math.max(0, Math.min(1.0, gain));
    return TOP_RULER_HEIGHT + (1.0 - clamped) * usableHeight;
  }, []);

  const canvasXToSec = useCallback(
    (clientX: number, rect: DOMRect) => {
      const offsetX = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, offsetX / rect.width));
      return visibleStartTime + ratio * visibleDuration;
    },
    [visibleStartTime, visibleDuration]
  );

  const canvasYToGain = useCallback((clientY: number, rect: DOMRect) => {
    const offsetY = clientY - rect.top;
    const usableHeight = rect.height - TOP_RULER_HEIGHT - BOTTOM_PADDING;
    const normalizedY = (offsetY - TOP_RULER_HEIGHT) / usableHeight;
    const gain = 1.0 - normalizedY;
    return Math.max(0, Math.min(1.0, Math.round(gain * 100) / 100));
  }, []);

  const sortedPoints = useMemo(() => {
    return [...config.points].sort((a, b) => a.time - b.time);
  }, [config.points]);

  // Draw Canvas with Divided Header Ruler & Automation Studio (High-DPI Retina Ready)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 1200;
    const height = rect.height || 360;
    const dpr = window.devicePixelRatio || 1;

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 1. Dark Studio Main Background
    ctx.fillStyle = '#080a14';
    ctx.fillRect(0, 0, width, height);

    // 2. ⏱️ PROFESSIONAL STUDIO DAW TIMELINE RULER
    const rulerGrad = ctx.createLinearGradient(0, 0, 0, TOP_RULER_HEIGHT);
    rulerGrad.addColorStop(0, '#0c1020');
    rulerGrad.addColorStop(1, '#090d19');
    ctx.fillStyle = rulerGrad;
    ctx.fillRect(0, 0, width, TOP_RULER_HEIGHT);

    // Solid Divider Line between Ruler and Automation Area
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, TOP_RULER_HEIGHT);
    ctx.lineTo(width, TOP_RULER_HEIGHT);
    ctx.stroke();

    // 3. Time Grid Marks & Ruler Graduations (Logic Pro / Ableton DAW Style)
    let stepSeconds = 15;
    let subStepSeconds = 5;

    if (visibleDuration <= 15) {
      stepSeconds = 1;
      subStepSeconds = 0.25;
    } else if (visibleDuration <= 30) {
      stepSeconds = 2;
      subStepSeconds = 0.5;
    } else if (visibleDuration <= 60) {
      stepSeconds = 5;
      subStepSeconds = 1;
    } else if (visibleDuration <= 120) {
      stepSeconds = 10;
      subStepSeconds = 2.5;
    } else if (visibleDuration <= 240) {
      stepSeconds = 15;
      subStepSeconds = 5;
    } else {
      stepSeconds = 30;
      subStepSeconds = 10;
    }

    const firstSubMark = Math.floor(visibleStartTime / subStepSeconds) * subStepSeconds;

    for (let t = firstSubMark; t <= visibleEndTime + subStepSeconds; t += subStepSeconds) {
      const x = secToCanvasX(t, width);
      if (x < -10 || x > width + 10) continue;

      const isMajor = Math.abs(t % stepSeconds) < 0.05 || Math.abs((t % stepSeconds) - stepSeconds) < 0.05;

      if (isMajor) {
        // Vertical grid line down the workspace
        ctx.strokeStyle = 'rgba(30, 41, 59, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, TOP_RULER_HEIGHT);
        ctx.lineTo(x, height);
        ctx.stroke();

        // Major Tick Mark on Ruler
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, TOP_RULER_HEIGHT - 9);
        ctx.lineTo(x, TOP_RULER_HEIGHT);
        ctx.stroke();

        // Time Label
        const mins = Math.floor(t / 60);
        const secs = Math.floor(t % 60).toString().padStart(2, '0');
        ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText(`${mins}:${secs}`, x, 18);
      } else {
        // Minor Sub-Tick Mark on Ruler
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, TOP_RULER_HEIGHT - 4);
        ctx.lineTo(x, TOP_RULER_HEIGHT);
        ctx.stroke();
      }
    }

    // 4. Horizontal Gain Reference Lines
    const gainGrid = [
      { val: 1.0, label: '100% (Voz Original)', color: '#64748b', lineColor: 'rgba(100, 116, 139, 0.15)' },
      { val: 0.75, label: '75%', color: '#475569', lineColor: 'rgba(71, 85, 105, 0.12)' },
      { val: 0.5, label: '50% (Voz Guía)', color: '#34d399', lineColor: 'rgba(16, 185, 129, 0.20)' },
      { val: 0.25, label: '25%', color: '#475569', lineColor: 'rgba(71, 85, 105, 0.12)' },
      { val: 0.0, label: '0% (Silencio / Mute)', color: '#fb7185', lineColor: 'rgba(244, 63, 94, 0.20)' },
    ];

    gainGrid.forEach(({ val, label, color, lineColor }) => {
      const y = gainToCanvasY(val, height);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, 14, y - 5);
    });

    // 4.5. 🎙️ Background Vocal Floor Shading & Baseline (if enabled)
    if (config.backgroundVocalEnabled) {
      const bgGain = config.backgroundVocalGain ?? 0.20;
      const bgY = gainToCanvasY(bgGain, height);
      const zeroY = gainToCanvasY(0, height);

      // Shaded floor zone
      ctx.fillStyle = 'rgba(168, 85, 247, 0.07)';
      ctx.fillRect(0, bgY, width, zeroY - bgY);

      // Dotted purple baseline
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, bgY);
      ctx.lineTo(width, bgY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#c084fc';
      ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`VOZ DE FONDO: ${Math.round(bgGain * 100)}%`, width - 18, bgY - 5);
    }

    // 5. Draw Waveform Peaks in background
    if (waveformPeaks && waveformPeaks.length > 0) {
      const centerY = height / 2 + 16;
      const maxWaveHeight = (height - TOP_RULER_HEIGHT - BOTTOM_PADDING) / 2;

      ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
      const numPeaks = waveformPeaks.length;

      for (let i = 0; i < numPeaks; i++) {
        const peakTime = (i / numPeaks) * effectiveDuration;
        if (peakTime < visibleStartTime || peakTime > visibleEndTime) continue;

        const x = secToCanvasX(peakTime, width);
        const peakVal = waveformPeaks[i];
        const barHeight = Math.max(1.5, peakVal * maxWaveHeight * 1.35);

        ctx.fillRect(x - 0.5, centerY - barHeight, 1.5, barHeight * 2);
      }
    }

    // 6. Draw Lyrics Section Header Badges
    if (lyrics && lyrics.length > 0) {
      lyrics.forEach((line) => {
        if (line.time >= visibleStartTime && line.time <= visibleEndTime) {
          const x = secToCanvasX(line.time, width);
          const header = line.sectionHeader || (line.text.startsWith('[') && line.text.includes(']') ? line.text.split(']')[0] + ']' : null);

          if (header) {
            const isChorus = /coro|chorus|estribillo|hook/i.test(header);

            ctx.strokeStyle = isChorus ? 'rgba(16, 185, 129, 0.35)' : 'rgba(59, 130, 246, 0.25)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, TOP_RULER_HEIGHT);
            ctx.lineTo(x, height - 10);
            ctx.stroke();

            // Sleek Rounded Section Badge
            const badgeText = header.replace(/^\[|\]$/g, '').toUpperCase();
            ctx.font = '700 9.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
            const textWidth = ctx.measureText(badgeText).width;
            const badgeW = textWidth + 12;
            const badgeH = 16;

            ctx.fillStyle = isChorus ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)';
            ctx.strokeStyle = isChorus ? 'rgba(52, 211, 153, 0.45)' : 'rgba(96, 165, 250, 0.45)';
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(x + 4, TOP_RULER_HEIGHT + 6, badgeW, badgeH, 4);
            } else {
              ctx.rect(x + 4, TOP_RULER_HEIGHT + 6, badgeW, badgeH);
            }
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = isChorus ? '#6ee7b7' : '#93c5fd';
            ctx.textAlign = 'center';
            ctx.fillText(badgeText, x + 4 + badgeW / 2, TOP_RULER_HEIGHT + 18);
          }
        }
      });
    }

    // 7. Draw Clean Automation Curve (Line & Ambient Fill)
    if (sortedPoints.length > 0) {
      const pointsScreen = sortedPoints.map((pt) => ({
        id: pt.id,
        x: secToCanvasX(pt.time, width),
        y: gainToCanvasY(pt.gain, height),
        gain: pt.gain,
        time: pt.time,
        label: pt.label,
      }));

      const firstPt = pointsScreen[0];
      const lastPt = pointsScreen[pointsScreen.length - 1];

      // Curve path
      ctx.beginPath();
      ctx.moveTo(0, firstPt.y);
      ctx.lineTo(firstPt.x, firstPt.y);

      for (let i = 1; i < pointsScreen.length; i++) {
        ctx.lineTo(pointsScreen[i].x, pointsScreen[i].y);
      }

      ctx.lineTo(width, lastPt.y);

      // Ambient fill underneath line
      const fillPath = new Path2D();
      fillPath.moveTo(0, gainToCanvasY(0, height));
      fillPath.lineTo(0, firstPt.y);
      fillPath.lineTo(firstPt.x, firstPt.y);

      for (let i = 1; i < pointsScreen.length; i++) {
        fillPath.lineTo(pointsScreen[i].x, pointsScreen[i].y);
      }

      fillPath.lineTo(width, lastPt.y);
      fillPath.lineTo(width, gainToCanvasY(0, height));
      fillPath.closePath();

      const grad = ctx.createLinearGradient(0, TOP_RULER_HEIGHT, 0, height - BOTTOM_PADDING);
      grad.addColorStop(0, 'rgba(56, 189, 248, 0.14)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
      ctx.fillStyle = grad;
      ctx.fill(fillPath);

      // Solid Curve Line
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // 8. Draw Clean Nodes / Points
      pointsScreen.forEach((pt) => {
        const isSelected = selectedPointIds.has(pt.id);
        const isHovered = pt.id === hoveredPointId;
        const radius = isSelected ? 7.5 : isHovered ? 6.5 : 5;

        // Selection ring
        if (isSelected) {
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, radius + 3, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Outer circle
        ctx.fillStyle = isSelected ? '#ffffff' : pt.gain === 0 ? '#ef4444' : pt.gain >= 0.8 ? '#a855f7' : '#10b981';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fill();

        // Inner clean core
        ctx.fillStyle = isSelected ? '#38bdf8' : '#080a14';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius - 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Tooltip badge
        if (isSelected || isHovered) {
          const badgeText = `${Math.round(pt.gain * 100)}%`;
          ctx.fillStyle = '#ffffff';
          ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(badgeText, pt.x, pt.y - (isSelected ? 13 : 9));
        }
      });
    }

    // 9. 🧲 Magnetic Horizontal Snap Guide Line
    if (activeHorizontalSnap) {
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(0, activeHorizontalSnap.y);
      ctx.lineTo(width, activeHorizontalSnap.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#00f0ff';
      ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`SNAP HORIZONTAL: ${Math.round(activeHorizontalSnap.gain * 100)}%`, width - 18, activeHorizontalSnap.y - 6);
    }

    // 10. 🧲 Magnetic Vertical Snap Guide Line
    if (activeVerticalSnap) {
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(activeVerticalSnap.x, TOP_RULER_HEIGHT);
      ctx.lineTo(activeVerticalSnap.x, height);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#10b981';
      ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
      ctx.textAlign = 'left';
      const snapMin = Math.floor(activeVerticalSnap.time / 60);
      const snapSec = Math.floor(activeVerticalSnap.time % 60).toString().padStart(2, '0');
      const snapMs = Math.round((activeVerticalSnap.time % 1) * 10);
      ctx.fillText(`SNAP VERTICAL: ${snapMin}:${snapSec}.${snapMs}`, activeVerticalSnap.x + 6, TOP_RULER_HEIGHT + 24);
    }

    // 11. Marquee Selection Box
    if (marqueeBox) {
      const left = Math.min(marqueeBox.startX, marqueeBox.currentX);
      const top = Math.min(marqueeBox.startY, marqueeBox.currentY);
      const w = Math.abs(marqueeBox.currentX - marqueeBox.startX);
      const h = Math.abs(marqueeBox.currentY - marqueeBox.startY);

      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.fillRect(left, top, w, h);

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(left, top, w, h);
      ctx.setLineDash([]);
    }

    // 12. 📍 PLAYHEAD PIN ON RULER & LASER NEEDLE THROUGH WORKSPACE
    if (currentTime >= visibleStartTime && currentTime <= visibleEndTime) {
      const playheadX = secToCanvasX(currentTime, width);

      // Playhead Laser Line down the canvas
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playheadX, TOP_RULER_HEIGHT);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      // Top Playhead Scrubber Pill Badge
      const curM = Math.floor(currentTime / 60);
      const curS = Math.floor(currentTime % 60).toString().padStart(2, '0');
      const curMs = Math.floor((currentTime % 1) * 10);
      const timeStr = `${curM}:${curS}.${curMs}`;

      const badgeW = 46;
      const badgeH = 18;
      const badgeX = playheadX - badgeW / 2;
      const badgeY = 5;

      ctx.fillStyle = '#00f0ff';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
      } else {
        ctx.rect(badgeX, badgeY, badgeW, badgeH);
      }
      ctx.fill();

      // Triangle pointer under badge
      ctx.beginPath();
      ctx.moveTo(playheadX - 4, badgeY + badgeH);
      ctx.lineTo(playheadX + 4, badgeY + badgeH);
      ctx.lineTo(playheadX, TOP_RULER_HEIGHT);
      ctx.closePath();
      ctx.fill();

      // Time Text inside Scrubber Badge
      ctx.fillStyle = '#080a14';
      ctx.font = '700 10px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(timeStr, playheadX, badgeY + 12.5);
    }

    ctx.restore();
  }, [
    visibleStartTime,
    visibleEndTime,
    visibleDuration,
    secToCanvasX,
    gainToCanvasY,
    waveformPeaks,
    lyrics,
    sortedPoints,
    selectedPointIds,
    hoveredPointId,
    activeHorizontalSnap,
    activeVerticalSnap,
    marqueeBox,
    currentTime,
    zoomLevel,
    effectiveDuration,
    config.backgroundVocalEnabled,
    config.backgroundVocalGain,
  ]);

  // Dynamic Zoom-Adaptive Point Finder in Screen Space
  const findPointAtScreenCoords = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;

      // Adjust hit precision based on zoom level:
      // When showing full waveform/song (zoom <= 1.2x), use a surgical 9px radius so nearby points don't conflict.
      // When zoomed in, allow a comfortable target (12px to 16px).
      const hitRadius = zoomLevel <= 1.2 ? 9 : zoomLevel <= 2.5 ? 12 : 16;

      let closestPt: VocalAutomationPoint | null = null;
      let minDistance = Infinity;

      for (const pt of config.points) {
        const screenX = secToCanvasX(pt.time, rect.width);
        const screenY = gainToCanvasY(pt.gain, rect.height);

        const dist = Math.hypot(mouseX - screenX, mouseY - screenY);
        if (dist <= hitRadius && dist < minDistance) {
          minDistance = dist;
          closestPt = pt;
        }
      }
      return closestPt;
    },
    [config.points, secToCanvasX, gainToCanvasY, zoomLevel]
  );

  // Mouse Down Handler
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickOffsetY = e.clientY - rect.top;
    const clickSec = canvasXToSec(e.clientX, rect);
    const clickGain = canvasYToGain(e.clientY, rect);

    // Save snapshot before drag for Undo
    dragStartConfigRef.current = config;

    // 1. ⏱️ If clicking on Top Ruler (Y <= TOP_RULER_HEIGHT), Exclusively Move the Playhead Pin
    if (clickOffsetY <= TOP_RULER_HEIGHT) {
      onSeek(Math.max(0, Math.min(effectiveDuration, clickSec)));
      setIsScrubbingRuler(true);
      return;
    }

    // 2. Check if clicking on an EXISTING point
    const hitPoint = findPointAtScreenCoords(e.clientX, e.clientY);
    if (hitPoint) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        setSelectedPointIds((prev) => {
          const next = new Set(prev);
          if (next.has(hitPoint.id)) next.delete(hitPoint.id);
          else next.add(hitPoint.id);
          return next;
        });
      } else {
        if (!selectedPointIds.has(hitPoint.id)) {
          setSelectedPointIds(new Set([hitPoint.id]));
        }
      }
      setDraggedAnchorPointId(hitPoint.id);
      setIsDraggingPoint(true);
      return;
    }

    // 3. If Shift key held: Start Marquee Selection Box
    if (e.shiftKey) {
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      setMarqueeBox({
        startX: mouseX,
        startY: mouseY,
        currentX: mouseX,
        currentY: mouseY,
      });
      return;
    }

    // 4. Click on empty space creates a NEW point and grabs it (with snapping)
    let targetTime = Math.max(0, Math.min(effectiveDuration, Math.round(clickSec * 10) / 10));
    let targetGain = clickGain;

    if (isSnapEnabled) {
      // Horizontal Gain snap
      for (const p of config.points) {
        if (Math.abs(clickGain - p.gain) <= 0.035) {
          targetGain = p.gain;
          break;
        }
      }
      // Vertical Time snap
      for (const p of config.points) {
        const timeDiffSec = Math.abs(clickSec - p.time);
        const pixelDistX = (timeDiffSec / visibleDuration) * rect.width;
        if (pixelDistX <= 14) {
          targetTime = p.time;
          break;
        }
      }
    }

    const newPoint: VocalAutomationPoint = {
      id: `pt_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      time: targetTime,
      gain: targetGain,
      label: `Punto ${config.points.length + 1}`,
    };

    const updatedConfig: VocalAutomationConfig = {
      ...config,
      enabled: true,
      points: [...config.points, newPoint].sort((a, b) => a.time - b.time),
    };

    commitConfig(updatedConfig);
    setSelectedPointIds(new Set([newPoint.id]));
    setDraggedAnchorPointId(newPoint.id);
    setIsDraggingPoint(true);
  };

  // Mouse Move Handler with Dual Horizontal & Vertical Magnetic Snapping
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickOffsetY = e.clientY - rect.top;
    const currentSec = canvasXToSec(e.clientX, rect);
    let currentGain = canvasYToGain(e.clientY, rect);

    // Track ruler hover
    setIsHoveringRuler(clickOffsetY <= TOP_RULER_HEIGHT);

    // Scrubbing timeline ruler
    if (isScrubbingRuler) {
      onSeek(Math.max(0, Math.min(effectiveDuration, currentSec)));
      return;
    }

    // Marquee Box Dragging
    if (marqueeBox) {
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      setMarqueeBox((prev) => (prev ? { ...prev, currentX: mouseX, currentY: mouseY } : null));
      return;
    }

    // Hover detection
    if (!isDraggingPoint) {
      const hitPoint = findPointAtScreenCoords(e.clientX, e.clientY);
      setHoveredPointId(hitPoint?.id || null);
    }

    // Dragging selected point(s) with Dual Horizontal & Vertical Magnetic Snapping
    if (isDraggingPoint && draggedAnchorPointId) {
      let finalTime = Math.max(0, Math.min(effectiveDuration, Math.round(currentSec * 10) / 10));
      const anchorPoint = config.points.find((p) => p.id === draggedAnchorPointId);

      if (anchorPoint) {
        let snappedHoriz = false;
        let snappedVert = false;

        if (isSnapEnabled) {
          const otherPoints = config.points.filter((p) => p.id !== draggedAnchorPointId && !selectedPointIds.has(p.id));

          // 1. 🧲 HORIZONTAL GAIN SNAP
          for (const other of otherPoints) {
            if (Math.abs(currentGain - other.gain) <= 0.035) {
              currentGain = other.gain;
              setActiveHorizontalSnap({
                gain: other.gain,
                y: gainToCanvasY(other.gain, rect.height),
                label: other.label || 'Mismo nivel',
              });
              snappedHoriz = true;
              break;
            }
          }

          if (!snappedHoriz) {
            const standardLevels = [0.0, 0.30, 0.40, 0.50, 1.0];
            for (const lvl of standardLevels) {
              if (Math.abs(currentGain - lvl) <= 0.025) {
                currentGain = lvl;
                setActiveHorizontalSnap({
                  gain: lvl,
                  y: gainToCanvasY(lvl, rect.height),
                  label: `${Math.round(lvl * 100)}%`,
                });
                snappedHoriz = true;
                break;
              }
            }
          }

          // 2. 🧲 VERTICAL TIME SNAP (Alinear verticalmente en el mismo tiempo)
          for (const other of otherPoints) {
            const timeDiffSec = Math.abs(currentSec - other.time);
            const pixelDistX = (timeDiffSec / visibleDuration) * rect.width;
            if (pixelDistX <= 14) {
              finalTime = other.time;
              setActiveVerticalSnap({
                time: other.time,
                x: secToCanvasX(other.time, rect.width),
                label: other.label || 'Mismo tiempo',
              });
              snappedVert = true;
              break;
            }
          }

          // Also check lyrics timestamps for vertical snap
          if (!snappedVert && lyrics && lyrics.length > 0) {
            for (const l of lyrics) {
              const timeDiffSec = Math.abs(currentSec - l.time);
              const pixelDistX = (timeDiffSec / visibleDuration) * rect.width;
              if (pixelDistX <= 12) {
                finalTime = l.time;
                setActiveVerticalSnap({
                  time: l.time,
                  x: secToCanvasX(l.time, rect.width),
                  label: 'Inicio de Letra',
                });
                snappedVert = true;
                break;
              }
            }
          }
        }

        if (!snappedHoriz) setActiveHorizontalSnap(null);
        if (!snappedVert) setActiveVerticalSnap(null);

        const gainDelta = currentGain - anchorPoint.gain;

        setConfig((prev) => {
          const updated = {
            ...prev,
            points: prev.points
              .map((pt) => {
                if (pt.id === draggedAnchorPointId) {
                  const newTime = pt.id === 'pt_start' ? 0 : pt.id === 'pt_end' ? effectiveDuration : finalTime;
                  return { ...pt, time: newTime, gain: currentGain };
                }
                if (selectedPointIds.has(pt.id) && selectedPointIds.size > 1) {
                  const newGain = Math.max(0, Math.min(1.0, +(pt.gain + gainDelta).toFixed(2)));
                  return { ...pt, gain: newGain };
                }
                return pt;
              })
              .sort((a, b) => a.time - b.time),
          };
          audioEngine.setVocalAutomationConfig(updated);
          return updated;
        });
      }
    }
  };

  const handleCanvasMouseUp = () => {
    // If point was dragged, push final position to History
    if (isDraggingPoint && dragStartConfigRef.current) {
      if (JSON.stringify(dragStartConfigRef.current) !== JSON.stringify(config)) {
        setHistory((prev) => {
          const truncated = prev.slice(0, historyIndex + 1);
          const nextHist = [...truncated, config];
          if (nextHist.length > 50) nextHist.shift();
          return nextHist;
        });
        setHistoryIndex((prev) => Math.min(prev + 1, 49));
      }
      dragStartConfigRef.current = null;
    }

    if (marqueeBox && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const minX = Math.min(marqueeBox.startX, marqueeBox.currentX);
      const maxX = Math.max(marqueeBox.startX, marqueeBox.currentX);
      const minY = Math.min(marqueeBox.startY, marqueeBox.currentY);
      const maxY = Math.max(marqueeBox.startY, marqueeBox.currentY);

      const enclosed = new Set(selectedPointIds);

      config.points.forEach((pt) => {
        const px = secToCanvasX(pt.time, rect.width);
        const py = gainToCanvasY(pt.gain, rect.height);
        if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
          enclosed.add(pt.id);
        }
      });

      setSelectedPointIds(enclosed);
      setMarqueeBox(null);
    }

    setIsDraggingPoint(false);
    setDraggedAnchorPointId(null);
    setIsScrubbingRuler(false);
    setActiveHorizontalSnap(null);
    setActiveVerticalSnap(null);
  };

  // 🔍 MAC OPTIMIZED TRACKPAD PINCH & WHEEL ZOOM
  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const mouseTime = visibleStartTime + mouseRatio * visibleDuration;

    // 1. Mac Trackpad 2-finger horizontal swipe
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 2) {
      if (zoomLevel > 1.0 && maxScrollTime > 0) {
        const scrollStep = e.deltaX / 700;
        setScrollLeftRatio((prev) => Math.max(0, Math.min(1.0, prev + scrollStep)));
      }
      return;
    }

    // 2. Mac Trackpad Pinch Gesture (e.ctrlKey === true) OR Mouse Wheel Zoom
    let zoomDelta: number;
    if (e.ctrlKey) {
      zoomDelta = -e.deltaY * 0.02;
    } else {
      const rawDelta = -e.deltaY;
      const clamped = Math.max(-1, Math.min(1, rawDelta / 50));
      zoomDelta = clamped * 0.12;
    }

    const newZoom = Math.max(1.0, Math.min(5.0, +(zoomLevel + zoomDelta).toFixed(2)));

    if (Math.abs(newZoom - zoomLevel) < 0.01) return;

    const newVisibleDur = effectiveDuration / newZoom;
    const newVisibleStart = Math.max(0, Math.min(effectiveDuration - newVisibleDur, mouseTime - mouseRatio * newVisibleDur));
    const newMaxScroll = Math.max(0, effectiveDuration - newVisibleDur);
    const newRatio = newMaxScroll > 0 ? newVisibleStart / newMaxScroll : 0;

    setZoomLevel(newZoom);
    setScrollLeftRatio(Math.max(0, Math.min(1.0, newRatio)));
  };

  // Double click deletes point
  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const hitPoint = findPointAtScreenCoords(e.clientX, e.clientY);
    if (hitPoint && hitPoint.id !== 'pt_start' && hitPoint.id !== 'pt_end') {
      const updatedConfig: VocalAutomationConfig = {
        ...config,
        points: config.points.filter((p) => p.id !== hitPoint.id),
      };
      commitConfig(updatedConfig, '✓ Punto eliminado');
      setSelectedPointIds((prev) => {
        const next = new Set(prev);
        next.delete(hitPoint.id);
        return next;
      });
    }
  };

  // ── BATCH OPERATIONS ON SELECTED POINTS ──
  const handleSetSelectedPointsGain = (gainValue: number) => {
    if (selectedPointIds.size === 0) return;

    const updated = {
      ...config,
      points: config.points.map((p) =>
        selectedPointIds.has(p.id) ? { ...p, gain: gainValue } : p
      ),
    };
    commitConfig(updated, `✓ ${selectedPointIds.size} punto(s) ajustados a ${Math.round(gainValue * 100)}%`);
  };

  // Dedicated "Make Straight Horizontal Line" between selected points
  const handleAlignSelectedToStraightLine = () => {
    if (selectedPointIds.size < 2) return;

    const firstPt = config.points.find((p) => selectedPointIds.has(p.id));
    const targetGain = firstPt ? firstPt.gain : 0.50;

    const updated = {
      ...config,
      points: config.points.map((p) =>
        selectedPointIds.has(p.id) ? { ...p, gain: targetGain } : p
      ),
    };
    commitConfig(updated, `✓ ¡Línea horizontal recta generada a ${Math.round(targetGain * 100)}%!`);
  };

  // Dedicated "Align Vertically / Instant Step Transition"
  const handleAlignSelectedToVerticalStep = () => {
    if (selectedPointIds.size < 2) return;

    const firstPt = config.points.find((p) => selectedPointIds.has(p.id));
    const targetTime = firstPt ? firstPt.time : currentTime;

    const updated = {
      ...config,
      points: config.points.map((p) =>
        selectedPointIds.has(p.id) && p.id !== 'pt_start' && p.id !== 'pt_end'
          ? { ...p, time: targetTime }
          : p
      ).sort((a, b) => a.time - b.time),
    };
    commitConfig(updated, `✓ ¡Corte/Salto vertical alineado en ${targetTime.toFixed(1)}s!`);
  };

  // Snap Single Point to Previous Point's level (Straight line with previous)
  const handleSnapToPreviousPoint = (pointId: string) => {
    const ptIdx = sortedPoints.findIndex((p) => p.id === pointId);
    if (ptIdx <= 0) return;

    const prevPoint = sortedPoints[ptIdx - 1];
    const updated = {
      ...config,
      points: config.points.map((p) =>
        p.id === pointId ? { ...p, gain: prevPoint.gain } : p
      ),
    };
    commitConfig(updated, `✓ Alineado en línea horizontal recta con el punto anterior (${Math.round(prevPoint.gain * 100)}%)`);
  };

  const handleDeleteSelectedPoints = () => {
    if (selectedPointIds.size === 0) return;
    const deletable = Array.from(selectedPointIds).filter((id) => id !== 'pt_start' && id !== 'pt_end');
    if (deletable.length === 0) return;

    const updated = {
      ...config,
      points: config.points.filter((p) => !deletable.includes(p.id)),
    };
    commitConfig(updated, `✓ ${deletable.length} punto(s) eliminados`);
    setSelectedPointIds(new Set());
  };

  const handleSelectAllPoints = () => {
    const all = new Set(config.points.map((p) => p.id));
    setSelectedPointIds(all);
  };

  const handleDeselectAll = () => {
    setSelectedPointIds(new Set());
  };

  // ── INTELLIGENT MULTI-TIER CHORUS & VOCAL PEAK AUTO-DETECTOR ──
  const handleAutoGenerateChorusesCurve = () => {
    if (!lyrics || lyrics.length === 0) {
      setToastMessage('⚠️ No hay letras sincronizadas disponibles para detectar coros.');
      return;
    }

    interface ChorusRange {
      start: number;
      end: number;
      name: string;
    }

    const detectedChoruses: ChorusRange[] = [];
    const chorusRegex = /(?:^|\s|\[|\()(?:coro|chorus|hook|estribillo|pre-?coro|refr[aá]n|drop|climax)(?:\s|:|\d|\]|\)|$)/i;

    let currentBlock: { start: number; end: number; name: string } | null = null;

    for (let i = 0; i < lyrics.length; i++) {
      const line = lyrics[i];
      const header = line.sectionHeader || '';
      const textHasTag = chorusRegex.test(line.text) || chorusRegex.test(header);
      const isHeaderChorus = chorusRegex.test(header);

      if (isHeaderChorus || (textHasTag && !currentBlock)) {
        if (!currentBlock) {
          currentBlock = {
            start: line.time,
            end: line.time + (line.duration || 4.0),
            name: `Coro ${detectedChoruses.length + 1}`,
          };
        } else {
          currentBlock.end = line.time + (line.duration || 4.0);
        }
      } else if (header && !isHeaderChorus && currentBlock) {
        detectedChoruses.push(currentBlock);
        currentBlock = null;
      } else if (currentBlock) {
        currentBlock.end = line.time + (line.duration || 4.0);
      }
    }

    if (currentBlock) {
      detectedChoruses.push(currentBlock);
    }

    if (detectedChoruses.length === 0) {
      const phraseCounts = new Map<string, number>();
      lyrics.forEach((l) => {
        const norm = normalizePhrase(l.text);
        if (norm.length >= 8) {
          phraseCounts.set(norm, (phraseCounts.get(norm) || 0) + 1);
        }
      });

      const repeatedIndices = new Set<number>();
      lyrics.forEach((l, idx) => {
        const norm = normalizePhrase(l.text);
        if (norm.length >= 8 && (phraseCounts.get(norm) || 0) >= 2) {
          for (let k = idx; k < Math.min(lyrics.length, idx + 4); k++) {
            repeatedIndices.add(k);
          }
        }
      });

      let rangeStart: number | null = null;
      let rangeEnd = 0;

      for (let i = 0; i < lyrics.length; i++) {
        if (repeatedIndices.has(i)) {
          if (rangeStart === null) rangeStart = lyrics[i].time;
          rangeEnd = lyrics[i].time + (lyrics[i].duration || 4.0);
        } else {
          if (rangeStart !== null && rangeEnd - rangeStart >= 6.0) {
            detectedChoruses.push({
              start: rangeStart,
              end: rangeEnd,
              name: `Coro ${detectedChoruses.length + 1}`,
            });
          }
          rangeStart = null;
        }
      }

      if (rangeStart !== null && rangeEnd - rangeStart >= 6.0) {
        detectedChoruses.push({
          start: rangeStart,
          end: rangeEnd,
          name: `Coro ${detectedChoruses.length + 1}`,
        });
      }
    }

    if (detectedChoruses.length === 0 && effectiveDuration > 60) {
      detectedChoruses.push({
        start: effectiveDuration * 0.28,
        end: effectiveDuration * 0.44,
        name: 'Coro 1',
      });
      detectedChoruses.push({
        start: effectiveDuration * 0.65,
        end: effectiveDuration * 0.82,
        name: 'Coro 2',
      });
    }

    const mergedChoruses: ChorusRange[] = [];
    detectedChoruses.sort((a, b) => a.start - b.start);

    for (const ch of detectedChoruses) {
      if (mergedChoruses.length === 0) {
        mergedChoruses.push({ ...ch });
      } else {
        const last = mergedChoruses[mergedChoruses.length - 1];
        if (ch.start <= last.end + 3.0) {
          last.end = Math.max(last.end, ch.end);
        } else {
          mergedChoruses.push({ ...ch, name: `Coro ${mergedChoruses.length + 1}` });
        }
      }
    }

    const points: VocalAutomationPoint[] = [
      { id: 'pt_start', time: 0, gain: 0.0, label: 'Inicio' },
    ];

    mergedChoruses.forEach((ch, idx) => {
      const cNum = idx + 1;
      const rampInTime = Math.max(0, ch.start - 0.4);
      const chorusStartTime = Math.max(0, ch.start);
      const chorusEndTime = Math.min(effectiveDuration, ch.end);
      const rampOutTime = Math.min(effectiveDuration, ch.end + 0.4);

      points.push({ id: `pt_c_pre_${cNum}`, time: Math.round(rampInTime * 10) / 10, gain: 0.0 });
      points.push({ id: `pt_c_start_${cNum}`, time: Math.round(chorusStartTime * 10) / 10, gain: 0.5, label: `Coro ${cNum}` });
      points.push({ id: `pt_c_end_${cNum}`, time: Math.round(chorusEndTime * 10) / 10, gain: 0.5 });
      points.push({ id: `pt_c_post_${cNum}`, time: Math.round(rampOutTime * 10) / 10, gain: 0.0 });
    });

    points.push({ id: 'pt_end', time: effectiveDuration, gain: 0.0, label: 'Fin' });

    const updatedConfig: VocalAutomationConfig = {
      ...config,
      enabled: true,
      defaultGain: 0.0,
      points: points.sort((a, b) => a.time - b.time),
    };

    commitConfig(updatedConfig, `✓ ¡Se detectaron ${mergedChoruses.length} coros y se generaron los puntos!`);
  };

  // ── AUTO-DETECT STANZA INTROS / LEAD-INS (INICIOS DE CADA ESTROFA) ──
  const handleAutoGenerateVerseIntrosCurve = () => {
    if (!lyrics || lyrics.length === 0) {
      setToastMessage('⚠️ No hay letras sincronizadas disponibles para detectar estrofas.');
      return;
    }

    const points: VocalAutomationPoint[] = [
      { id: 'pt_start', time: 0, gain: 0.0, label: 'Inicio' },
    ];

    let lastLineEnd = 0;
    let stanzaCount = 0;

    for (let i = 0; i < lyrics.length; i++) {
      const line = lyrics[i];
      const nextLine = lyrics[i + 1];
      const inferredDuration = line.duration && line.duration > 0
        ? line.duration
        : nextLine
          ? Math.max(1.5, Math.min(6.0, nextLine.time - line.time - 0.2))
          : 3.5;

      const timeSinceLast = line.time - lastLineEnd;
      const hasHeader = !!line.sectionHeader || (line.text.startsWith('[') && line.text.includes(']'));
      const isNewStanza = i === 0 || hasHeader || timeSinceLast >= 1.2;

      if (isNewStanza && line.time >= 0.2) {
        stanzaCount++;
        const stanzaStart = Math.max(0, line.time);
        const stanzaLead = Math.max(0, line.time - 0.25);
        const stanzaCueEnd = Math.min(effectiveDuration, line.time + 1.3);
        const stanzaFadeOut = Math.min(effectiveDuration, line.time + 1.7);

        points.push({ id: `pt_s_pre_${stanzaCount}`, time: Math.round(stanzaLead * 10) / 10, gain: 0.0 });
        points.push({ id: `pt_s_in_${stanzaCount}`, time: Math.round(stanzaStart * 10) / 10, gain: 0.40, label: `Estrofa ${stanzaCount}` });
        points.push({ id: `pt_s_hold_${stanzaCount}`, time: Math.round(stanzaCueEnd * 10) / 10, gain: 0.40 });
        points.push({ id: `pt_s_post_${stanzaCount}`, time: Math.round(stanzaFadeOut * 10) / 10, gain: 0.0 });
      }

      lastLineEnd = line.time + inferredDuration;
    }

    points.push({ id: 'pt_end', time: effectiveDuration, gain: 0.0, label: 'Fin' });

    const updatedConfig: VocalAutomationConfig = {
      ...config,
      enabled: true,
      defaultGain: 0.0,
      points: points.sort((a, b) => a.time - b.time),
    };

    commitConfig(updatedConfig, `✓ ¡Se generaron ${stanzaCount} inicios de estrofa con voz guía al 40%!`);
  };

  // ── COMBINED SMART MODE: FULL CHORUSES (50%) + STANZA INTROS (40%) ──
  const handleAutoGenerateSmartCompleteCurve = () => {
    if (!lyrics || lyrics.length === 0) {
      setToastMessage('⚠️ No hay letras sincronizadas disponibles.');
      return;
    }

    const chorusRegex = /(?:^|\s|\[|\()(?:coro|chorus|hook|estribillo|pre-?coro|refr[aá]n|drop|climax)(?:\s|:|\d|\]|\)|$)/i;
    interface Range { start: number; end: number; type: 'chorus' | 'stanza'; label?: string }
    const ranges: Range[] = [];

    const phraseCounts = new Map<string, number>();
    lyrics.forEach((l) => {
      const norm = normalizePhrase(l.text);
      if (norm.length >= 8) phraseCounts.set(norm, (phraseCounts.get(norm) || 0) + 1);
    });

    const isChorusLine = (l: LyricLine) => {
      const norm = normalizePhrase(l.text);
      return chorusRegex.test(l.text) || chorusRegex.test(l.sectionHeader || '') || (norm.length >= 8 && (phraseCounts.get(norm) || 0) >= 2);
    };

    let activeChorus: { start: number; end: number } | null = null;
    let lastLineEnd = 0;
    let stanzaNum = 0;
    let chorusNum = 0;

    for (let i = 0; i < lyrics.length; i++) {
      const line = lyrics[i];
      const nextLine = lyrics[i + 1];
      const inferredDuration = line.duration && line.duration > 0
        ? line.duration
        : nextLine
          ? Math.max(1.5, Math.min(6.0, nextLine.time - line.time - 0.2))
          : 3.5;

      const isCh = isChorusLine(line);

      if (isCh) {
        if (!activeChorus) {
          chorusNum++;
          activeChorus = { start: line.time, end: line.time + inferredDuration };
        } else {
          activeChorus.end = line.time + inferredDuration;
        }
      } else {
        if (activeChorus) {
          ranges.push({ start: activeChorus.start, end: activeChorus.end, type: 'chorus', label: `Coro ${chorusNum}` });
          activeChorus = null;
        }
        const timeSinceLast = line.time - lastLineEnd;
        const hasHeader = !!line.sectionHeader || (line.text.startsWith('[') && line.text.includes(']'));
        const isNewStanza = i === 0 || hasHeader || timeSinceLast >= 1.2;

        if (isNewStanza && line.time >= 0.2) {
          stanzaNum++;
          ranges.push({ start: line.time, end: line.time + 1.3, type: 'stanza', label: `Estrofa ${stanzaNum}` });
        }
      }
      lastLineEnd = line.time + inferredDuration;
    }

    if (activeChorus) {
      ranges.push({ start: activeChorus.start, end: activeChorus.end, type: 'chorus', label: `Coro ${chorusNum}` });
    }

    ranges.sort((a, b) => a.start - b.start);
    const points: VocalAutomationPoint[] = [
      { id: 'pt_start', time: 0, gain: 0.0, label: 'Inicio' },
    ];

    let pIdx = 0;
    for (const r of ranges) {
      pIdx++;
      const gainVal = r.type === 'chorus' ? 0.50 : 0.40;
      const rampIn = Math.max(0, r.start - 0.3);
      const rampOut = Math.min(effectiveDuration, r.end + 0.35);

      points.push({ id: `pt_sm_pre_${pIdx}`, time: Math.round(rampIn * 10) / 10, gain: 0.0 });
      points.push({ id: `pt_sm_in_${pIdx}`, time: Math.round(r.start * 10) / 10, gain: gainVal, label: r.label || (r.type === 'chorus' ? 'Coro' : 'Estrofa') });
      points.push({ id: `pt_sm_hold_${pIdx}`, time: Math.round(r.end * 10) / 10, gain: gainVal });
      points.push({ id: `pt_sm_post_${pIdx}`, time: Math.round(rampOut * 10) / 10, gain: 0.0 });
    }

    points.push({ id: 'pt_end', time: effectiveDuration, gain: 0.0, label: 'Fin' });

    const updatedConfig: VocalAutomationConfig = {
      ...config,
      enabled: true,
      defaultGain: 0.0,
      points: points.sort((a, b) => a.time - b.time),
    };

    commitConfig(updatedConfig, `✓ ¡Modo Inteligente generado: Coros completos (50%) + Inicios de Estrofa (40%)!`);
  };

  // ── AUTO-GENERATE X-SECOND GUIDE BURST WITH SMOOTH FADE (0% IN BETWEEN) ──
  const handleAutoGeneratePointsPerLine = (overrideDuration?: number) => {
    const selectedSeconds = overrideDuration ?? burstDurationSeconds;
    if (!lyrics || lyrics.length === 0) {
      setToastMessage('⚠️ No hay líneas de letra sincronizadas disponibles.');
      return;
    }

    const points: VocalAutomationPoint[] = [
      { id: 'pt_start', time: 0, gain: 0.0, label: 'Inicio' },
    ];

    let lastPointEnd = 0;

    for (let i = 0; i < lyrics.length; i++) {
      const line = lyrics[i];
      const nextLine = lyrics[i + 1];
      const lineStart = Math.max(0, Math.round(line.time * 100) / 100);

      // Cada punto tiene la duración seleccionada (ej: 2.0s o 3.0s) con fade suave
      const maxAvailableTime = nextLine ? Math.max(0.6, nextLine.time - lineStart - 0.15) : selectedSeconds;
      const totalDuration = Math.min(selectedSeconds, maxAvailableTime);

      const fadeInDuration = Math.min(0.20, totalDuration * 0.15);
      const fadeOutDuration = Math.min(0.35, totalDuration * 0.25);
      const sustainDuration = Math.max(0.1, totalDuration - fadeOutDuration);

      const fadeStartTime = Math.max(0, lineStart - fadeInDuration);
      const sustainEndTime = Math.min(effectiveDuration, Math.round((lineStart + sustainDuration) * 100) / 100);
      const fadeEndTime = Math.min(effectiveDuration, Math.round((lineStart + totalDuration) * 100) / 100);

      // 1. Fade-in suave desde 0% antes de la línea
      if (lineStart > 0.1 && fadeStartTime - lastPointEnd >= 0.08) {
        points.push({
          id: `pt_fade_in_zero_${i + 1}`,
          time: Math.max(0, Math.round(fadeStartTime * 100) / 100),
          gain: 0.0,
        });
      }

      // 2. Punto al inicio de la línea cantada (40% de volumen)
      points.push({
        id: `pt_burst_start_${i + 1}`,
        time: lineStart,
        gain: 0.40,
        label: `${line.text.slice(0, 12)} (${selectedSeconds}s)`,
      });

      // 3. Mantiene la voz en 40% durante el cuerpo de la frase
      if (sustainEndTime > lineStart + 0.15) {
        points.push({
          id: `pt_burst_hold_${i + 1}`,
          time: sustainEndTime,
          gain: 0.40,
        });
      }

      // 4. Fade-out suave cayendo a 0% sin cortes bruscos
      points.push({
        id: `pt_fade_out_zero_${i + 1}`,
        time: fadeEndTime,
        gain: 0.0,
      });

      lastPointEnd = fadeEndTime;
    }

    points.push({ id: 'pt_end', time: effectiveDuration, gain: 0.0, label: 'Fin' });

    // Deduplicar timestamps repetidos y ordenar cronológicamente
    const uniquePointsMap = new Map<number, VocalAutomationPoint>();
    points.forEach((pt) => {
      uniquePointsMap.set(pt.time, pt);
    });

    const finalPoints = Array.from(uniquePointsMap.values()).sort((a, b) => a.time - b.time);

    const updatedConfig: VocalAutomationConfig = {
      ...config,
      enabled: true,
      defaultGain: 0.0,
      points: finalPoints,
    };

    commitConfig(
      updatedConfig,
      `✓ ¡Curva generada con Fade Suave! ${selectedSeconds}s de voz al 40% y 0% en pausas`
    );
  };

  // Add Point at Current Playhead Time
  const handleAddPointAtCurrentTime = () => {
    const curSec = Math.round(currentTime * 10) / 10;
    const currentGain = audioEngine.getAutomatedVocalGainAtTime(curSec) ?? 0.5;

    const newPoint: VocalAutomationPoint = {
      id: `pt_now_${Date.now()}`,
      time: curSec,
      gain: currentGain,
      label: `Punto ${config.points.length + 1}`,
    };

    const updatedConfig: VocalAutomationConfig = {
      ...config,
      enabled: true,
      points: [...config.points, newPoint].sort((a, b) => a.time - b.time),
    };

    commitConfig(updatedConfig);
    setSelectedPointIds(new Set([newPoint.id]));
  };

  // Ensure background vocal monitoring is strictly turned off whenever the editor is closed or unmounted
  useEffect(() => {
    return () => {
      const activeConf = audioEngine.getVocalAutomationConfig();
      if (activeConf && activeConf.backgroundVocalEnabled) {
        audioEngine.setVocalAutomationConfig({
          ...activeConf,
          backgroundVocalEnabled: false,
        });
      }
    };
  }, [isOpen]);

  const handleSaveAndClose = () => {
    // La voz de fondo es exclusiva para monitoreo durante la edición.
    // Al guardar y aplicar, se desactiva la voz de fondo para que mande 100% la curva de usuario.
    const finalConfigToSave: VocalAutomationConfig = {
      ...config,
      backgroundVocalEnabled: false,
    };
    const updatedSong: SongItem = {
      ...song,
      vocalAutomation: finalConfigToSave,
      updatedAt: Date.now(),
    };
    audioEngine.setVocalAutomationConfig(finalConfigToSave);
    onSaveAutomation(updatedSong, finalConfigToSave);
    onClose();
  };

  const handleCancelOrClose = () => {
    // Al cerrar sin guardar o cancelar, restauramos la configuración original apagando la voz de fondo
    const restoredConfig: VocalAutomationConfig | null = song.vocalAutomation
      ? { ...song.vocalAutomation, backgroundVocalEnabled: false }
      : null;
    audioEngine.setVocalAutomationConfig(restoredConfig);
    onClose();
  };

  // Horizontal Scrollbar Track click / drag
  const handleScrollbarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const track = scrollbarTrackRef.current;
    if (!track || maxScrollTime <= 0) return;

    const rect = track.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const thumbWidthPx = (visibleDuration / effectiveDuration) * rect.width;
    const availableTrackWidth = rect.width - thumbWidthPx;

    if (availableTrackWidth > 0) {
      const targetLeft = Math.max(0, Math.min(availableTrackWidth, clickX - thumbWidthPx / 2));
      const ratio = targetLeft / availableTrackWidth;
      setScrollLeftRatio(Math.max(0, Math.min(1.0, ratio)));
    }

    setIsDraggingScrollThumb(true);
  };

  // Global mouse handlers for scrollbar dragging
  useEffect(() => {
    if (!isDraggingScrollThumb) return;

    const handleMouseMove = (e: MouseEvent) => {
      const track = scrollbarTrackRef.current;
      if (!track || maxScrollTime <= 0) return;
      const rect = track.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const thumbWidthPx = (visibleDuration / effectiveDuration) * rect.width;
      const availableTrackWidth = rect.width - thumbWidthPx;

      if (availableTrackWidth > 0) {
        const targetLeft = Math.max(0, Math.min(availableTrackWidth, clickX - thumbWidthPx / 2));
        const ratio = targetLeft / availableTrackWidth;
        setScrollLeftRatio(Math.max(0, Math.min(1.0, ratio)));
      }
    };

    const handleMouseUp = () => {
      setIsDraggingScrollThumb(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingScrollThumb, maxScrollTime, visibleDuration, effectiveDuration]);

  // Selected Points List
  const selectedPoints = useMemo(() => {
    return config.points.filter((p) => selectedPointIds.has(p.id));
  }, [config.points, selectedPointIds]);

  const primarySelectedPoint = selectedPoints.length === 1 ? selectedPoints[0] : null;
  const averageSelectedGain = selectedPoints.length > 0
    ? selectedPoints.reduce((sum, p) => sum + p.gain, 0) / selectedPoints.length
    : 0;

  // Dynamic standard cursor style
  const getCanvasCursorClass = () => {
    if (isDraggingPoint || isDraggingScrollThumb) return 'cursor-grabbing';
    if (isScrubbingRuler || isHoveringRuler) return 'cursor-ew-resize';
    if (hoveredPointId) return 'cursor-pointer';
    return 'cursor-default';
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-200 ${
        isFullscreen
          ? 'p-0 bg-[#080a14]'
          : 'p-2 sm:p-5 bg-black/85 backdrop-blur-md'
      }`}
    >
      <div
        className={`flex flex-col w-full bg-[#080a14] overflow-hidden text-slate-200 transition-all duration-200 ${
          isFullscreen
            ? 'h-full max-h-none rounded-none border-0'
            : 'max-w-[1600px] h-[96vh] rounded-3xl border border-slate-800 shadow-2xl shadow-cyan-950/40'
        }`}
      >
        
        {/* ── Top Header (Fixed Height 64px, Never Shifting) ── */}
        <div className="h-16 min-h-16 max-h-16 flex items-center justify-between px-6 border-b border-slate-800 bg-slate-900/80 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black tracking-tight text-white flex items-center gap-2">
                <span className="truncate">Editor de Curva de Voz Guía</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shrink-0">
                  SMART CURVE
                </span>
              </h2>
              <p className="text-xs text-slate-400 font-medium truncate max-w-sm">
                {song.title} {song.artist ? `· ${song.artist}` : ''}
              </p>
            </div>
          </div>

          {/* Right Header Action Items (Stable, Fixed Controls) */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* 🎙️ Voz de Fondo (Background Vocal Floor) Stable Fixed-Width Enclosure */}
            <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-xl border border-slate-800">
              <button
                onClick={() => {
                  const nextState = !config.backgroundVocalEnabled;
                  const updated = {
                    ...config,
                    backgroundVocalEnabled: nextState,
                    backgroundVocalGain: config.backgroundVocalGain || 0.20,
                  };
                  commitConfig(
                    updated,
                    nextState
                      ? `🎙️ Voz de Fondo ACTIVADA (${Math.round((config.backgroundVocalGain || 0.20) * 100)}%) - Línea intacta`
                      : 'Voz de Fondo Desactivada'
                  );
                }}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  config.backgroundVocalEnabled
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
                title="Habilita una voz tenue de fondo continua en toda la canción sin modificar los puntos de tu curva"
              >
                <Radio className={`w-3.5 h-3.5 ${config.backgroundVocalEnabled ? 'text-purple-400' : 'text-slate-500'}`} />
                <span>VOZ FONDO {config.backgroundVocalEnabled ? 'ON' : 'OFF'}</span>
              </button>

              {config.backgroundVocalEnabled && (
                <div className="flex items-center gap-1 pl-1.5 border-l border-slate-800">
                  <input
                    type="range"
                    min="0.05"
                    max="0.50"
                    step="0.05"
                    value={config.backgroundVocalGain || 0.20}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      const updated = {
                        ...config,
                        backgroundVocalGain: val,
                      };
                      setConfig(updated);
                      audioEngine.setVocalAutomationConfig(updated);
                    }}
                    onMouseUp={() => commitConfig(config)}
                    className="w-14 accent-purple-400 cursor-pointer"
                    title="Nivel de volumen de la voz de fondo"
                  />
                  <span className="text-[10px] font-mono font-bold text-purple-300 w-7 text-right">
                    {Math.round((config.backgroundVocalGain || 0.20) * 100)}%
                  </span>
                </div>
              )}
            </div>

            {/* ↩️ Undo & ↪️ Redo Buttons for Mac */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                onClick={handleUndo}
                disabled={historyIndex <= 0}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-30 cursor-pointer transition-colors"
                title="Deshacer última acción (⌘Z)"
              >
                <Undo2 className="w-4 h-4" />
              </button>

              <button
                onClick={handleRedo}
                disabled={historyIndex >= history.length - 1}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-30 cursor-pointer transition-colors"
                title="Rehacer acción (⇧⌘Z)"
              >
                <Redo2 className="w-4 h-4" />
              </button>
            </div>

            {/* Magnetic Snap Toggle */}
            <button
              onClick={() => {
                setIsSnapEnabled((prev) => {
                  const next = !prev;
                  setToastMessage(next ? '🧲 Snap Magnético ACTIVADO (Líneas rectas H y V)' : 'Snap Magnético Desactivado');
                  return next;
                });
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                isSnapEnabled
                  ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-300'
                  : 'bg-slate-900 border-slate-750 text-slate-500 hover:text-slate-400'
              }`}
              title="Alineado magnético a líneas rectas horizontales y verticales"
            >
              <Magnet className={`w-3.5 h-3.5 ${isSnapEnabled ? 'text-cyan-400' : 'text-slate-500'}`} />
              <span>SNAP {isSnapEnabled ? 'ON' : 'OFF'}</span>
            </button>

            {/* Master Automation Toggle */}
            <div className="flex items-center gap-2 bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800">
              <span className="text-xs font-mono font-bold text-slate-400">CURVA:</span>
              <button
                onClick={() => {
                  const updated = { ...config, enabled: !config.enabled };
                  commitConfig(updated);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-black transition-colors cursor-pointer ${
                  config.enabled
                    ? 'bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {config.enabled ? '✓ ON' : 'OFF'}
              </button>
            </div>

            {/* Fullscreen Toggle Button */}
            <button
              onClick={() => setIsFullscreen((prev) => !prev)}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title={isFullscreen ? 'Restaurar ventana reducida' : 'Pantalla Completa (100%)'}
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>

            <button
              onClick={handleCancelOrClose}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
              title="Cerrar editor"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── Main Workspace Body ── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
          {/* Quick Toolbar (Fixed Height 46px) */}
          <div className="h-[46px] min-h-[46px] max-h-[46px] flex items-center justify-between gap-3 px-6 bg-[#0b0e1b] border-b border-slate-800/80 text-xs shrink-0">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              <button
                onClick={handleAddPointAtCurrentTime}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 font-bold cursor-pointer transition-colors shadow-sm shrink-0"
                title="Añade un punto de control en el segundo actual del cabezal de reproducción"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>➕ Punto en {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')}</span>
              </button>

              <button
                onClick={handleAutoGenerateChorusesCurve}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-bold cursor-pointer transition-colors shadow-sm shrink-0"
                title="Detecta automáticamente los coros y crea la curva con voz guía al 50%"
              >
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span>✨ Coros (50%)</span>
              </button>

              <button
                onClick={handleAutoGenerateVerseIntrosCurve}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold cursor-pointer transition-colors shadow-sm shrink-0"
                title="Detecta el arranque de cada estrofa y frase tras pausas musicales y añade 1.3s de voz guía al 40% para dar el tono"
              >
                <Mic className="w-3.5 h-3.5 text-amber-400" />
                <span>🎙️ Inicios de Estrofa</span>
              </button>

              <button
                onClick={handleAutoGenerateSmartCompleteCurve}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-500/30 via-cyan-500/20 to-emerald-500/30 hover:brightness-110 text-white border border-cyan-400/50 font-black cursor-pointer transition-colors shadow-sm shrink-0"
                title="Modo Inteligente Completo: Coros completos al 50% + Inicios de todas las estrofas al 40%"
              >
                <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
                <span>🌟 Coros + Estrofas</span>
              </button>

              {/* Selector de Corte de 1.5s, 2s, 3s, 4s por Línea */}
              <div className="flex items-center rounded-xl bg-blue-950/50 border border-blue-500/40 p-0.5 shrink-0 shadow-sm">
                <button
                  onClick={() => handleAutoGeneratePointsPerLine(burstDurationSeconds)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-blue-300 hover:text-white font-bold cursor-pointer transition-colors"
                  title={`Generar curva con ${burstDurationSeconds} segundos de voz guía en cada línea y silencio (0%) en pausas`}
                >
                  <FileText className="w-3.5 h-3.5 text-blue-400" />
                  <span>⏱️ Guía por Línea:</span>
                </button>
                <div className="flex items-center gap-0.5 pr-1">
                  {[1.5, 2, 3, 4].map((sec) => (
                    <button
                      key={sec}
                      onClick={() => {
                        setBurstDurationSeconds(sec);
                        handleAutoGeneratePointsPerLine(sec);
                      }}
                      className={`px-2 py-0.5 rounded-lg text-[11px] font-black cursor-pointer transition-all ${
                        burstDurationSeconds === sec
                          ? 'bg-blue-500 text-white shadow-[0_0_8px_rgba(59,130,246,0.6)] scale-105'
                          : 'text-blue-300/70 hover:text-white hover:bg-blue-900/50'
                      }`}
                      title={`Generar corte de ${sec} segundos con fade`}
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-4 w-[1px] bg-slate-800 mx-1 shrink-0" />

              <button
                onClick={handleSelectAllPoints}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-bold cursor-pointer transition-colors shrink-0"
                title="Seleccionar todos los puntos (⌘A)"
              >
                <CheckSquare className="w-3 h-3 text-cyan-400" />
                <span>Todos</span>
              </button>

              {selectedPointIds.size > 0 && (
                <button
                  onClick={handleDeselectAll}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-slate-400 hover:text-white text-xs cursor-pointer transition-colors shrink-0"
                >
                  <Square className="w-2.5 h-2.5" />
                  <span>Deseleccionar</span>
                </button>
              )}
            </div>

            {/* Zoom Controls (Fixed Width) */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-slate-400 font-mono text-[10px]">ZOOM:</span>
              <button
                onClick={() => setZoomLevel((z) => Math.max(1.0, +(z - 0.25).toFixed(2)))}
                disabled={zoomLevel <= 1.0}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer transition-colors"
                title="Alejar zoom"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-xs text-cyan-400 font-bold w-10 text-center">
                {zoomLevel.toFixed(1)}x
              </span>
              <button
                onClick={() => setZoomLevel((z) => Math.min(5.0, +(z + 0.25).toFixed(2)))}
                disabled={zoomLevel >= 5.0}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer transition-colors"
                title="Acercar zoom"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              {zoomLevel > 1.0 && (
                <button
                  onClick={() => {
                    setZoomLevel(1.0);
                    setScrollLeftRatio(0);
                  }}
                  className="px-2 py-0.5 rounded text-[10px] font-mono text-slate-400 hover:text-white bg-slate-800/80 cursor-pointer ml-1"
                >
                  100%
                </button>
              )}
            </div>
          </div>

          {/* ── Interactive Curve Timeline Canvas (Completely Static and Responsive) ── */}
          <div className={`relative flex-1 min-h-[220px] bg-[#080a14] select-none overflow-hidden border-b border-slate-800 ${getCanvasCursorClass()}`}>
            <canvas
              ref={canvasRef}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onWheel={handleCanvasWheel}
              onDoubleClick={handleCanvasDoubleClick}
              className="w-full h-full block"
            />
          </div>

          {/* ── HORIZONTAL SCROLLBAR (Visible on Zoom) ── */}
          {zoomLevel > 1.0 && (
            <div className="h-8 min-h-8 max-h-8 px-6 bg-[#0b0e1b] border-b border-slate-800 flex items-center gap-2 shrink-0">
              <span className="text-[10px] font-mono text-cyan-400 font-bold w-14 shrink-0">DESPLAZAR:</span>

              <button
                onClick={() => setScrollLeftRatio((prev) => Math.max(0, prev - 0.15))}
                disabled={scrollLeftRatio <= 0}
                className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer transition-colors shrink-0"
                title="Desplazar a la izquierda"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              {/* Interactive Scrollbar Track */}
              <div
                ref={scrollbarTrackRef}
                onMouseDown={handleScrollbarMouseDown}
                className="flex-1 relative h-4 bg-slate-950 border border-slate-800 rounded-lg cursor-pointer overflow-hidden select-none shadow-inner"
              >
                <div
                  className="absolute top-0.5 bottom-0.5 rounded-md bg-gradient-to-r from-cyan-600 to-cyan-400 border border-white/40 shadow-sm cursor-grab active:cursor-grabbing hover:brightness-110"
                  style={{
                    left: `${(visibleStartTime / effectiveDuration) * 100}%`,
                    width: `${Math.max(4, (visibleDuration / effectiveDuration) * 100)}%`,
                  }}
                />
              </div>

              <button
                onClick={() => setScrollLeftRatio((prev) => Math.min(1.0, prev + 0.15))}
                disabled={scrollLeftRatio >= 1.0}
                className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer transition-colors shrink-0"
                title="Desplazar a la derecha"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              <span className="text-[10px] font-mono text-slate-400 w-24 text-right shrink-0">
                {Math.floor(visibleStartTime / 60)}:{Math.floor(visibleStartTime % 60).toString().padStart(2, '0')} - {Math.floor(visibleEndTime / 60)}:{Math.floor(visibleEndTime % 60).toString().padStart(2, '0')}
              </span>
            </div>
          )}

          {/* ── Interactive Seek Timeline Scrubber Bar (Fixed Height 40px) ── */}
          <div className="h-10 min-h-10 max-h-10 px-6 bg-slate-950 border-b border-slate-800/80 flex items-center gap-4 shrink-0">
            <span className="text-xs font-mono text-cyan-400 font-bold tabular-nums w-12 shrink-0">
              {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')}
            </span>

            {/* Interactive Timeline Track */}
            <div className="flex-1 relative h-6 flex items-center">
              <div className="w-full h-2 bg-slate-900 border border-slate-700 rounded-full overflow-hidden relative shadow-inner">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, (currentTime / effectiveDuration) * 100))}%` }}
                />
              </div>

              {/* Hardware Knob */}
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white border-2 border-slate-900 shadow-[0_0_8px_rgba(255,255,255,0.8)] pointer-events-none z-10"
                style={{ left: `${Math.max(0, Math.min(100, (currentTime / effectiveDuration) * 100))}%` }}
              />

              <input
                type="range"
                min={0}
                max={effectiveDuration}
                step={0.1}
                value={currentTime}
                onChange={(e) => onSeek(parseFloat(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                title="Línea de tiempo de la canción: Arrastra para adelantar o retroceder"
              />
            </div>

            <span className="text-xs font-mono text-slate-400 tabular-nums w-12 text-right shrink-0">
              {Math.floor(effectiveDuration / 60)}:{Math.floor(effectiveDuration % 60).toString().padStart(2, '0')}
            </span>

            <div className="flex items-center gap-1.5 ml-2 shrink-0">
              <button
                onClick={() => onSeek(Math.max(0, currentTime - 5))}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-mono font-bold cursor-pointer transition-colors"
                title="Retroceder 5 segundos"
              >
                <SkipBack className="w-3 h-3 text-slate-400" />
                <span>-5s</span>
              </button>
              <button
                onClick={() => onSeek(Math.min(effectiveDuration, currentTime + 5))}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-mono font-bold cursor-pointer transition-colors"
                title="Adelantar 5 segundos"
              >
                <span>+5s</span>
                <SkipForward className="w-3 h-3 text-slate-400" />
              </button>
            </div>
          </div>

          {/* ── Fixed Height Node Inspector Panel (66px Fixed, Zero Height Shifting) ── */}
          <div className="h-[66px] min-h-[66px] max-h-[66px] px-6 bg-slate-950/95 flex items-center justify-between border-b border-slate-800 shrink-0">
            {selectedPointIds.size > 1 ? (
              /* ── MULTI-POINT SELECTION BATCH CONTROLS ── */
              <div className="flex items-center gap-4 w-full justify-between overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="px-2.5 py-1 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-bold text-xs font-mono flex items-center gap-1.5 shadow-sm shrink-0">
                    <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{selectedPointIds.size} PUNTOS</span>
                  </div>

                  {/* 📏 Straight Horizontal Line */}
                  <button
                    onClick={handleAlignSelectedToStraightLine}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-400/50 font-bold text-xs cursor-pointer transition-colors shrink-0"
                    title="Nivela todos los puntos seleccionados a la misma altura de volumen (Horizontal)"
                  >
                    <AlignJustify className="w-3.5 h-3.5" />
                    <span>📏 Recta Horizontal</span>
                  </button>

                  {/* ⚡ Straight Vertical Step */}
                  <button
                    onClick={handleAlignSelectedToVerticalStep}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-400/50 font-bold text-xs cursor-pointer transition-colors shrink-0"
                    title="Alinea todos los puntos seleccionados en el mismo segundo exacto para crear un corte o salto vertical instantáneo"
                  >
                    <Zap className="w-3.5 h-3.5 text-emerald-400" />
                    <span>⚡ Corte Vertical</span>
                  </button>
                </div>

                {/* Batch Preset Buttons */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-mono text-slate-400 uppercase mr-1">FIJAR:</span>
                  {GAIN_PRESETS.map((preset) => {
                    const Icon = preset.icon;
                    return (
                      <button
                        key={preset.value}
                        onClick={() => handleSetSelectedPointsGain(preset.value)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-bold transition-colors cursor-pointer text-white shrink-0"
                        style={{ borderColor: `${preset.color}66` }}
                        title={`Fijar los ${selectedPointIds.size} puntos seleccionados al ${preset.label}`}
                      >
                        <Icon className="w-3.5 h-3.5" style={{ color: preset.color }} />
                        <span>{preset.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Batch Slider & Batch Delete */}
                <div className="flex items-center gap-2.5 shrink-0">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={averageSelectedGain}
                    onChange={(e) => handleSetSelectedPointsGain(parseFloat(e.target.value))}
                    className="w-24 accent-cyan-400 cursor-pointer"
                    title="Ajustar volumen de todos los puntos seleccionados"
                  />
                  <span className="font-mono text-xs font-bold text-cyan-400 w-10 text-right">
                    {Math.round(averageSelectedGain * 100)}%
                  </span>

                  <button
                    onClick={handleDeleteSelectedPoints}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 text-xs font-bold transition-colors cursor-pointer shrink-0"
                    title="Eliminar todos los puntos seleccionados (⌫)"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Borrar ({selectedPointIds.size})</span>
                  </button>
                </div>
              </div>
            ) : primarySelectedPoint ? (
              /* ── SINGLE POINT INSPECTOR CONTROLS ── */
              <div className="flex items-center gap-4 w-full justify-between overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-2.5 shrink-0">
                  <div
                    className="w-3 h-3 rounded-full border-2 border-white shrink-0"
                    style={{
                      backgroundColor:
                        primarySelectedPoint.gain === 0
                          ? '#ef4444'
                          : primarySelectedPoint.gain >= 0.8
                            ? '#a855f7'
                            : '#10b981',
                    }}
                  />
                  <div className="flex flex-col shrink-0">
                    <span className="text-xs font-bold text-white leading-tight">
                      Punto ({Math.round(primarySelectedPoint.gain * 100)}%)
                    </span>
                    <span className="text-[10px] font-mono text-cyan-400 leading-tight">
                      {Math.floor(primarySelectedPoint.time / 60)}:
                      {Math.floor(primarySelectedPoint.time % 60).toString().padStart(2, '0')}.
                      {Math.round((primarySelectedPoint.time % 1) * 10)} ({primarySelectedPoint.time.toFixed(1)}s)
                    </span>
                  </div>

                  {/* Snap with previous point button */}
                  {sortedPoints.findIndex((p) => p.id === primarySelectedPoint.id) > 0 && (
                    <button
                      onClick={() => handleSnapToPreviousPoint(primarySelectedPoint.id)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 text-xs font-bold cursor-pointer transition-colors shrink-0"
                      title="Iguala la altura con el punto anterior para crear un tramo horizontal recto"
                    >
                      <AlignJustify className="w-3 h-3 text-cyan-400" />
                      <span>📏 Recta con anterior</span>
                    </button>
                  )}
                </div>

                {/* Level Presets for Selected Point */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-mono text-slate-400 uppercase mr-1">NIVEL:</span>
                  {GAIN_PRESETS.map((preset) => {
                    const isActive = Math.abs(primarySelectedPoint.gain - preset.value) < 0.05;
                    const Icon = preset.icon;
                    return (
                      <button
                        key={preset.value}
                        onClick={() => {
                          const updated = {
                            ...config,
                            points: config.points.map((p) =>
                              p.id === primarySelectedPoint.id ? { ...p, gain: preset.value } : p
                            ),
                          };
                          commitConfig(updated);
                        }}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-bold transition-colors cursor-pointer shrink-0 ${
                          isActive
                            ? 'bg-slate-800 border-white text-white shadow-sm'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                        style={{ borderColor: isActive ? preset.color : undefined }}
                        title={preset.desc}
                      >
                        <Icon className="w-3.5 h-3.5" style={{ color: preset.color }} />
                        <span>{preset.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Fine Slider & Delete */}
                <div className="flex items-center gap-2.5 shrink-0">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={primarySelectedPoint.gain}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      const updated = {
                        ...config,
                        points: config.points.map((p) =>
                          p.id === primarySelectedPoint.id ? { ...p, gain: val } : p
                        ),
                      };
                      setConfig(updated);
                      audioEngine.setVocalAutomationConfig(updated);
                    }}
                    onMouseUp={() => {
                      commitConfig(config);
                    }}
                    className="w-24 accent-cyan-400 cursor-pointer"
                  />
                  <span className="font-mono text-xs font-bold text-cyan-400 w-10 text-right">
                    {Math.round(primarySelectedPoint.gain * 100)}%
                  </span>

                  {primarySelectedPoint.id !== 'pt_start' && primarySelectedPoint.id !== 'pt_end' && (
                    <button
                      onClick={() => {
                        const updated = {
                          ...config,
                          points: config.points.filter((p) => p.id !== primarySelectedPoint.id),
                        };
                        commitConfig(updated, '✓ Punto eliminado');
                        setSelectedPointIds(new Set());
                      }}
                      className="p-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-colors cursor-pointer shrink-0"
                      title="Eliminar este punto (⌫)"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between w-full text-slate-400 text-xs">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <span>
                    Haz clic en la línea para agregar puntos · Arrastra para moverlos · <b>VOZ FONDO</b> fija un piso continuo · <b>⌘Z</b> Deshacer.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-slate-400">Total puntos: {config.points.length}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Transport Bar & Save Footer (Fixed Height 64px) ── */}
        <div className="h-16 min-h-16 max-h-16 flex items-center justify-between px-6 bg-slate-900 border-t border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => (isPlaying ? onPause() : onPlay())}
              className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-gradient-to-r from-[#00f0ff] to-[#00b4d8] hover:brightness-110 text-slate-950 font-black text-xs tracking-wider cursor-pointer shadow-lg shadow-cyan-500/25 transition-colors"
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
              <span>{isPlaying ? 'PAUSAR' : 'REPRODUCIR'}</span>
            </button>

            <button
              onClick={() => onSeek(0)}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
              title="Reiniciar al segundo 0"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCancelOrClose}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs cursor-pointer transition-colors"
            >
              Cancelar
            </button>

            <button
              onClick={handleSaveAndClose}
              className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs tracking-wider cursor-pointer shadow-lg shadow-emerald-500/25 transition-colors"
            >
              <Check className="w-4 h-4" />
              <span>GUARDAR Y APLICAR</span>
            </button>
          </div>
        </div>

        {/* ── Floating Discreet Feedback Toast (Bottom-Right, Never Obstructing) ── */}
        {toastMessage && (
          <div className="absolute bottom-20 right-6 z-50 pointer-events-none px-4 py-2 rounded-2xl bg-slate-950/95 border border-cyan-500/60 text-cyan-200 text-xs font-bold shadow-2xl shadow-cyan-950/90 flex items-center gap-2.5 animate-in slide-in-from-bottom-2 fade-in duration-200">
            <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 animate-pulse" />
            <span>{toastMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
};
