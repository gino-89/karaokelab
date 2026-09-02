import React, { useEffect, useRef, useState } from 'react';
import { Activity, Radio, Disc, Maximize2, Minimize2, Waves } from 'lucide-react';
import { audioEngine } from '../services/audioEngine';
import { LyricLine } from '../types';

interface AudioVisualizerProps {
  isPlaying: boolean;
  currentLyric?: LyricLine | null;
  nextLyric?: LyricLine | null;
  currentTime: number;
  songTitle?: string;
  songArtist?: string;
  bpm?: number;
  canvasRefCallback?: (canvas: HTMLCanvasElement | null) => void;
}

type VisualizerMode = 'bars' | 'radial' | 'wave' | 'matrix';

export const AudioVisualizer: React.FC<AudioVisualizerProps> = React.memo(({
  isPlaying,
  bpm = 120,
  canvasRefCallback,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<VisualizerMode>('bars');

  // Peak caps physics state
  const peaksRef = useRef<number[]>([]);
  const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; size: number; color: string; life: number }>>([]);
  const rotationRef = useRef<number>(0);

  // Expose canvas ref to parent for video recording if needed
  useEffect(() => {
    if (canvasRefCallback && canvasRef.current) {
      canvasRefCallback(canvasRef.current);
    }
  }, [canvasRefCallback]);

  // Setup visualizer render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animId: number;
    const bufferLength = 128;
    const freqData = new Uint8Array(bufferLength);
    const timeData = new Uint8Array(bufferLength);

    // Initialize particles
    if (particlesRef.current.length === 0) {
      for (let i = 0; i < 35; i++) {
        particlesRef.current.push({
          x: Math.random() * 600,
          y: Math.random() * 300,
          vx: (Math.random() - 0.5) * 1.2,
          vy: (Math.random() - 0.5) * 1.2,
          size: Math.random() * 2 + 1,
          color: Math.random() > 0.5 ? '#00f0ff' : '#ff007f',
          life: Math.random(),
        });
      }
    }

    const render = () => {
      animId = requestAnimationFrame(render);

      const width = canvas.width;
      const height = canvas.height;

      // Extract Web Audio FFT data if available
      let bassEnergy = 0;
      let midEnergy = 0;
      let trebleEnergy = 0;

      if (audioEngine.analyserNode && isPlaying) {
        audioEngine.analyserNode.getByteFrequencyData(freqData);
        audioEngine.analyserNode.getByteTimeDomainData(timeData);

        // Calculate band energies
        for (let i = 0; i < 16; i++) bassEnergy += freqData[i];
        for (let i = 16; i < 64; i++) midEnergy += freqData[i];
        for (let i = 64; i < 128; i++) trebleEnergy += freqData[i];
        bassEnergy /= 16 * 255;
        midEnergy /= 48 * 255;
        trebleEnergy /= 64 * 255;
      } else {
        // Idle animation when paused
        const timeSec = Date.now() / 1000;
        for (let i = 0; i < bufferLength; i++) {
          const wave = Math.sin(timeSec * 2 + i * 0.15) * 0.5 + 0.5;
          freqData[i] = Math.floor(wave * 30);
          timeData[i] = 128 + Math.floor(Math.sin(timeSec * 3 + i * 0.2) * 12);
        }
        bassEnergy = 0.08;
      }

      // 1. Clear with deep cyber dark background
      ctx.fillStyle = '#090b14';
      ctx.fillRect(0, 0, width, height);

      // 2. Draw subtle background cyber grid
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.04)';
      ctx.lineWidth = 1;
      const gridSize = 32;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // If not playing, stop animation loop completely to drop CPU/GPU usage to 0%
      if (!isPlaying) {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.font = '700 11px -apple-system, BlinkMacSystemFont, "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('AUDIO VISUALIZER // PAUSADO', width / 2, height / 2);
        return;
      }

      // 3. Audio reactive particles
      const speedMultiplier = 1 + bassEnergy * 2.0;
      for (const p of particlesRef.current) {
        p.x += p.vx * speedMultiplier;
        p.y += p.vy * speedMultiplier;

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.fillStyle = p.color;
        if (bassEnergy > 0.3) {
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 4 + bassEnergy * 6;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + bassEnergy * 0.6), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // 4. Render selected visualizer mode cleanly
      if (mode === 'bars') {
        renderSpectrumBars(ctx, width, height, freqData, bassEnergy);
      } else if (mode === 'radial') {
        renderRadialHUD(ctx, width, height, freqData, bassEnergy);
      } else if (mode === 'wave') {
        renderOscilloscopeWave(ctx, width, height, timeData, bassEnergy);
      } else {
        renderMatrixHUD(ctx, width, height, freqData, bassEnergy);
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [mode, isPlaying]);

  // Handle Canvas Resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        canvasRef.current.width = Math.floor(rect.width * window.devicePixelRatio);
        canvasRef.current.height = Math.floor(rect.height * window.devicePixelRatio);
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        }
      }
    };

    handleResize();
    const observer = new ResizeObserver(handleResize);
    if (containerRef.current) observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  /**
   * Mode 1: Cyber Spectrum Bars with falling peak caps
   */
  const renderSpectrumBars = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    freqData: Uint8Array,
    bassEnergy: number
  ) => {
    const displayWidth = width / window.devicePixelRatio;
    const displayHeight = height / window.devicePixelRatio;
    const numBars = 42;
    const padding = 12;
    const availableWidth = displayWidth - padding * 2;
    const barWidth = Math.max(3, (availableWidth - (numBars - 1) * 2.5) / numBars);
    const maxHeight = displayHeight * 0.78;
    const baselineY = displayHeight - 12;

    if (peaksRef.current.length !== numBars) {
      peaksRef.current = new Array(numBars).fill(0);
    }

    for (let i = 0; i < numBars; i++) {
      const dataIdx = Math.floor((i / numBars) * 75);
      const val = freqData[dataIdx] / 255;
      const barHeight = Math.max(4, val * maxHeight);
      const x = padding + i * (barWidth + 2.5);
      const y = baselineY - barHeight;

      // Update falling peak cap
      if (barHeight > peaksRef.current[i]) {
        peaksRef.current[i] = barHeight;
      } else {
        peaksRef.current[i] = Math.max(0, peaksRef.current[i] - 1.5);
      }

      // Bar Gradient (Cyan -> Indigo -> Magenta)
      const grad = ctx.createLinearGradient(0, baselineY, 0, y);
      grad.addColorStop(0, '#00f0ff');
      grad.addColorStop(0.5, '#7928ca');
      grad.addColorStop(1, '#ff007f');

      ctx.fillStyle = grad;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = val > 0.6 ? 8 : 2;
      ctx.fillRect(x, y, barWidth, barHeight);

      // Peak Cap line
      const peakY = baselineY - peaksRef.current[i] - 2;
      ctx.fillStyle = '#00ff9d';
      ctx.shadowColor = '#00ff9d';
      ctx.shadowBlur = 6;
      ctx.fillRect(x, peakY, barWidth, 2);
    }
    ctx.shadowBlur = 0;
  };

  /**
   * Mode 2: Circular Cyberpunk Radial HUD Radar
   */
  const renderRadialHUD = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    freqData: Uint8Array,
    bassEnergy: number
  ) => {
    const displayWidth = width / window.devicePixelRatio;
    const displayHeight = height / window.devicePixelRatio;
    const centerX = displayWidth / 2;
    const centerY = displayHeight / 2;
    const baseRadius = Math.min(displayWidth, displayHeight) * 0.28 + bassEnergy * 10;
    const numPoints = 48;

    rotationRef.current += 0.01;

    // Glowing center pulse
    const centerGrad = ctx.createRadialGradient(centerX, centerY, 5, centerX, centerY, baseRadius);
    centerGrad.addColorStop(0, 'rgba(255, 0, 127, 0.35)');
    centerGrad.addColorStop(0.7, 'rgba(0, 240, 255, 0.12)');
    centerGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = centerGrad;
    ctx.beginPath();
    ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
    ctx.fill();

    // Radial frequency spikes
    ctx.lineWidth = 2.2;
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2 + rotationRef.current;
      const dataIdx = Math.floor((i / numPoints) * 70);
      const val = freqData[dataIdx] / 255;
      const spikeLen = Math.max(5, val * (baseRadius * 0.9));

      const x1 = centerX + Math.cos(angle) * baseRadius;
      const y1 = centerY + Math.sin(angle) * baseRadius;
      const x2 = centerX + Math.cos(angle) * (baseRadius + spikeLen);
      const y2 = centerY + Math.sin(angle) * (baseRadius + spikeLen);

      ctx.strokeStyle = i % 2 === 0 ? '#00f0ff' : '#ff007f';
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = val > 0.5 ? 8 : 2;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Outer rotating HUD ring
    ctx.strokeStyle = 'rgba(0, 255, 157, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(centerX, centerY, baseRadius * 1.5, -rotationRef.current * 1.2, Math.PI * 2 - rotationRef.current * 1.2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
  };

  /**
   * Mode 3: Laser Oscilloscope Waveform
   */
  const renderOscilloscopeWave = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    timeData: Uint8Array,
    bassEnergy: number
  ) => {
    const displayWidth = width / window.devicePixelRatio;
    const displayHeight = height / window.devicePixelRatio;
    const centerY = displayHeight / 2;

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 10;

    ctx.beginPath();
    const sliceWidth = displayWidth / timeData.length;
    let x = 0;

    for (let i = 0; i < timeData.length; i++) {
      const v = timeData[i] / 128.0;
      const y = (v * (displayHeight * 0.4)) + centerY - (displayHeight * 0.2);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }
    ctx.stroke();

    // Magenta shadow wave
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ff007f';
    ctx.shadowColor = '#ff007f';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    x = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = timeData[i] / 128.0;
      const y = (v * (displayHeight * 0.4)) + centerY - (displayHeight * 0.2) + 4;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  /**
   * Mode 4: Matrix Digital Spectrum HUD
   */
  const renderMatrixHUD = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    freqData: Uint8Array,
    bassEnergy: number
  ) => {
    const displayWidth = width / window.devicePixelRatio;
    const displayHeight = height / window.devicePixelRatio;
    const cols = 22;
    const rows = 12;
    const padding = 16;
    const availableW = displayWidth - padding * 2;
    const colWidth = availableW / cols;
    const rowHeight = (displayHeight - 24) / rows;
    const startX = padding;
    const startY = displayHeight - 12;

    for (let c = 0; c < cols; c++) {
      const dataIdx = Math.floor((c / cols) * 70);
      const val = freqData[dataIdx] / 255;
      const activeRows = Math.floor(val * rows);

      for (let r = 0; r < rows; r++) {
        const x = startX + c * colWidth;
        const y = startY - (r + 1) * rowHeight;
        const isActive = r <= activeRows;

        if (isActive) {
          const color = r > 9 ? '#ff007f' : r > 6 ? '#ffe600' : '#00f0ff';
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = 4;
          ctx.fillRect(x + 1.5, y + 1.5, colWidth - 3, rowHeight - 3);
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
          ctx.shadowBlur = 0;
          ctx.fillRect(x + 1.5, y + 1.5, colWidth - 3, rowHeight - 3);
        }
      }
    }
    ctx.shadowBlur = 0;
  };

  return (
    <div
      ref={containerRef}
      className="h-44 sm:h-48 bg-[#0c0e17] border border-slate-700/70 rounded-xl relative overflow-hidden flex flex-col shadow-lg"
    >
      {/* Top Clean Header Bar */}
      <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800/80 flex items-center justify-between z-10">
        {/* Mode Switcher Buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode('bars')}
            className={`px-2 py-0.5 text-[10px] font-mono uppercase font-bold rounded transition-all cursor-pointer ${
              mode === 'bars'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                : 'text-slate-400 hover:text-white bg-slate-800/50'
            }`}
          >
            BARS
          </button>

          <button
            onClick={() => setMode('radial')}
            className={`px-2 py-0.5 text-[10px] font-mono uppercase font-bold rounded transition-all cursor-pointer ${
              mode === 'radial'
                ? 'bg-pink-500/20 text-pink-300 border border-pink-500/50'
                : 'text-slate-400 hover:text-white bg-slate-800/50'
            }`}
          >
            RADAR
          </button>

          <button
            onClick={() => setMode('wave')}
            className={`px-2 py-0.5 text-[10px] font-mono uppercase font-bold rounded transition-all cursor-pointer ${
              mode === 'wave'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                : 'text-slate-400 hover:text-white bg-slate-800/50'
            }`}
          >
            WAVE
          </button>

          <button
            onClick={() => setMode('matrix')}
            className={`px-2 py-0.5 text-[10px] font-mono uppercase font-bold rounded transition-all cursor-pointer ${
              mode === 'matrix'
                ? 'bg-amber-400/20 text-amber-300 border border-amber-400/50'
                : 'text-slate-400 hover:text-white bg-slate-800/50'
            }`}
          >
            MATRIX
          </button>
        </div>

        {/* Live Audio Status */}
        <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold">
          {isPlaying ? (
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              EN VIVO
            </span>
          ) : (
            <span className="text-slate-500">PAUSA</span>
          )}
        </div>
      </div>

      {/* Reactive Visualizer Canvas */}
      <div className="flex-1 relative">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>

      {/* Bottom Sub-Telemetry Bar */}
      <div className="px-3 py-1 bg-slate-950/90 border-t border-slate-800/60 flex items-center justify-between text-[9px] font-mono text-slate-500">
        <span>EQ // 128 BANDAS</span>
        <span className="text-amber-400/80 font-bold">{bpm} BPM</span>
        <span>44.1 kHz</span>
      </div>
    </div>
  );
});
