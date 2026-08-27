import React, { useState, useEffect, useRef } from 'react';
import { SongItem, LyricLine } from '../types';
import { audioEngine } from '../services/audioEngine';
import { videoRecorder } from '../services/videoRecorder';
import {
  X,
  Square,
  Sparkles,
  Sliders,
  CheckCircle2,
  Wand2,
} from 'lucide-react';

interface LyricalVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  song: SongItem | null;
  lyrics: LyricLine[];
  duration: number;
}

export type VideoTheme = 'cyberpunk' | 'nebula' | 'synthwave' | 'rave' | 'tokyo';

export const LyricalVideoModal: React.FC<LyricalVideoModalProps> = ({
  isOpen,
  onClose,
  song,
  lyrics,
  duration,
}) => {
  const [theme, setTheme] = useState<VideoTheme>('cyberpunk');
  const [vocalPreset, setVocalPreset] = useState<'karaoke' | 'duet' | 'original'>('karaoke');
  const [isRendering, setIsRendering] = useState(false);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const starsRef = useRef<Array<{ x: number; y: number; z: number; size: number; color: string }>>([]);
  const sakuraRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; rot: number; rotSpeed: number; size: number }>>([]);
  const roadOffsetRef = useRef(0);

  // Initialize stars and particles
  useEffect(() => {
    if (starsRef.current.length === 0) {
      for (let i = 0; i < 150; i++) {
        starsRef.current.push({
          x: (Math.random() - 0.5) * 1280,
          y: (Math.random() - 0.5) * 720,
          z: Math.random() * 1000 + 1,
          size: Math.random() * 2 + 1,
          color: Math.random() > 0.5 ? '#00f0ff' : Math.random() > 0.5 ? '#ff007f' : '#ffffff',
        });
      }
    }
    if (sakuraRef.current.length === 0) {
      for (let i = 0; i < 40; i++) {
        sakuraRef.current.push({
          x: Math.random() * 1280,
          y: Math.random() * 720,
          vx: Math.random() * 1.5 + 0.5,
          vy: Math.random() * 1.2 + 0.8,
          rot: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.04,
          size: Math.random() * 8 + 6,
        });
      }
    }
  }, []);

  // Main HD Canvas Render Loop (1280 x 720 @ 60 FPS)
  useEffect(() => {
    if (!isOpen) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = 1280;
    const height = 720;
    canvas.width = width;
    canvas.height = height;

    const bufferLength = 128;
    const freqData = new Uint8Array(bufferLength);
    const timeData = new Uint8Array(bufferLength);

    const render = () => {
      animFrameRef.current = requestAnimationFrame(render);

      // 1. Audio telemetry
      let bassEnergy = 0;
      let midEnergy = 0;
      let trebleEnergy = 0;

      if (audioEngine.analyserNode && audioEngine.getIsPlaying()) {
        audioEngine.analyserNode.getByteFrequencyData(freqData);
        audioEngine.analyserNode.getByteTimeDomainData(timeData);

        for (let i = 0; i < 16; i++) bassEnergy += freqData[i];
        bassEnergy /= 16 * 255;

        for (let i = 16; i < 64; i++) midEnergy += freqData[i];
        midEnergy /= 48 * 255;

        for (let i = 64; i < 128; i++) trebleEnergy += freqData[i];
        trebleEnergy /= 64 * 255;
      } else {
        const t = Date.now() / 1000;
        for (let i = 0; i < bufferLength; i++) {
          freqData[i] = Math.floor((Math.sin(t * 3 + i * 0.1) * 0.5 + 0.5) * 55);
          timeData[i] = 128 + Math.floor(Math.sin(t * 4 + i * 0.2) * 20);
        }
        bassEnergy = 0.2;
        midEnergy = 0.15;
        trebleEnergy = 0.1;
      }

      roadOffsetRef.current = (roadOffsetRef.current + 2 + bassEnergy * 8) % 40;

      // 2. THEME BACKGROUND DRAWING
      if (theme === 'cyberpunk') {
        // Dark Void
        ctx.fillStyle = '#060611';
        ctx.fillRect(0, 0, width, height);

        // Cyberpunk Radial Aura
        const aura = ctx.createRadialGradient(width / 2, height * 0.45, 10, width / 2, height * 0.45, 600);
        aura.addColorStop(0, `rgba(0, 240, 255, ${0.12 + bassEnergy * 0.15})`);
        aura.addColorStop(0.5, `rgba(255, 0, 127, ${0.08 + bassEnergy * 0.1})`);
        aura.addColorStop(1, 'transparent');
        ctx.fillStyle = aura;
        ctx.fillRect(0, 0, width, height);

        // 3D Perspective Wireframe Horizon
        const horizonY = height * 0.48;
        ctx.strokeStyle = `rgba(0, 240, 255, ${0.25 + bassEnergy * 0.35})`;
        ctx.lineWidth = 1.5;

        // Vanishing perspective lines
        const vanishingX = width / 2;
        for (let x = -width * 0.5; x <= width * 1.5; x += 100) {
          ctx.beginPath();
          ctx.moveTo(vanishingX, horizonY);
          ctx.lineTo(x, height);
          ctx.stroke();
        }

        // Horizontal perspective lines
        for (let y = horizonY; y < height; y += 12 + ((y - horizonY) * 0.15)) {
          const adjustedY = y + (roadOffsetRef.current * ((y - horizonY) / height));
          if (adjustedY < height) {
            ctx.beginPath();
            ctx.moveTo(0, adjustedY);
            ctx.lineTo(width, adjustedY);
            ctx.stroke();
          }
        }

        // Equalizer Towers at horizon
        const numTowers = 48;
        const towerW = (width - 120) / numTowers;
        for (let i = 0; i < numTowers; i++) {
          const val = freqData[Math.floor((i / numTowers) * 80)] / 255;
          const towerH = Math.max(4, val * 160);
          const x = 60 + i * towerW;
          const y = horizonY - towerH;

          const grad = ctx.createLinearGradient(0, horizonY, 0, y);
          grad.addColorStop(0, 'rgba(0, 240, 255, 0.8)');
          grad.addColorStop(0.5, 'rgba(189, 0, 255, 0.8)');
          grad.addColorStop(1, 'rgba(255, 0, 127, 0.9)');
          ctx.fillStyle = grad;
          ctx.fillRect(x, y, towerW - 4, towerH);
        }
      } else if (theme === 'synthwave') {
        // Synthwave 80s Sunset
        const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
        bgGrad.addColorStop(0, '#0a021a');
        bgGrad.addColorStop(0.5, '#2e0854');
        bgGrad.addColorStop(0.7, '#670a66');
        bgGrad.addColorStop(1, '#050014');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        // Segmented Neon Sun
        const sunX = width / 2;
        const sunY = height * 0.42;
        const sunRadius = 110 + bassEnergy * 25;
        const sunGrad = ctx.createLinearGradient(0, sunY - sunRadius, 0, sunY + sunRadius);
        sunGrad.addColorStop(0, '#ffea00');
        sunGrad.addColorStop(0.5, '#ff007f');
        sunGrad.addColorStop(1, '#7900ff');

        ctx.fillStyle = sunGrad;
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
        ctx.fill();

        // Horizontal sun slices (Synthwave 80s aesthetic)
        ctx.fillStyle = '#2e0854';
        for (let s = sunY - 20; s < sunY + sunRadius; s += 14) {
          const sliceH = Math.max(2, (s - (sunY - 20)) * 0.18);
          ctx.fillRect(sunX - sunRadius - 10, s, sunRadius * 2 + 20, sliceH);
        }

        // Synthwave Road
        const roadHorizon = height * 0.52;
        ctx.strokeStyle = `rgba(255, 0, 127, ${0.4 + bassEnergy * 0.4})`;
        ctx.lineWidth = 2;
        for (let x = -width * 0.4; x <= width * 1.4; x += 120) {
          ctx.beginPath();
          ctx.moveTo(sunX, roadHorizon);
          ctx.lineTo(x, height);
          ctx.stroke();
        }
      } else if (theme === 'nebula') {
        // Deep Space Nebula
        ctx.fillStyle = '#02020a';
        ctx.fillRect(0, 0, width, height);

        // 3D Starfield
        for (const s of starsRef.current) {
          s.z -= 4 + bassEnergy * 15;
          if (s.z <= 0) s.z = 1000;
          const k = 400 / s.z;
          const px = s.x * k + width / 2;
          const py = s.y * k + height / 2;

          if (px >= 0 && px < width && py >= 0 && py < height) {
            ctx.fillStyle = s.color;
            ctx.shadowColor = s.color;
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.arc(px, py, Math.max(1, s.size * (1 - s.z / 1000) * 2), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.shadowBlur = 0;

        // Pulsating Cosmic Ring
        const ringRadius = 140 + bassEnergy * 60;
        ctx.strokeStyle = `rgba(0, 240, 255, ${0.6 + bassEnergy * 0.4})`;
        ctx.lineWidth = 4;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(width / 2, height * 0.4, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (theme === 'rave') {
        // Hyper Rave / Strobe
        ctx.fillStyle = bassEnergy > 0.65 ? 'rgba(30, 0, 40, 1)' : '#05050e';
        ctx.fillRect(0, 0, width, height);

        // Laser Rays
        const numRays = 32;
        for (let i = 0; i < numRays; i++) {
          const angle = (i / numRays) * Math.PI * 2 + (Date.now() * 0.001);
          const rayLen = 600 + (freqData[i % freqData.length] / 255) * 300;
          const x2 = width / 2 + Math.cos(angle) * rayLen;
          const y2 = height * 0.4 + Math.sin(angle) * rayLen;

          ctx.strokeStyle = i % 2 === 0 ? `rgba(0, 240, 255, 0.4)` : `rgba(255, 0, 127, 0.4)`;
          ctx.lineWidth = 2 + bassEnergy * 3;
          ctx.beginPath();
          ctx.moveTo(width / 2, height * 0.4);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      } else {
        // Tokyo Twilight Lo-Fi
        const tokyoGrad = ctx.createLinearGradient(0, 0, 0, height);
        tokyoGrad.addColorStop(0, '#100a26');
        tokyoGrad.addColorStop(0.5, '#3a1854');
        tokyoGrad.addColorStop(0.8, '#70246a');
        tokyoGrad.addColorStop(1, '#1b082e');
        ctx.fillStyle = tokyoGrad;
        ctx.fillRect(0, 0, width, height);

        // Sakura Floating Petals
        for (const p of sakuraRef.current) {
          p.x += p.vx * (1 + bassEnergy);
          p.y += p.vy * (1 + bassEnergy);
          p.rot += p.rotSpeed;
          if (p.x > width) p.x = 0;
          if (p.y > height) p.y = 0;

          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = 'rgba(255, 180, 220, 0.65)';
          ctx.shadowColor = '#ff80bf';
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // 3. TOP CINEMATIC HEADER BADGE
      ctx.fillStyle = 'rgba(8, 8, 20, 0.88)';
      ctx.fillRect(40, 25, width - 80, 60);
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(40, 25, width - 80, 60);

      // AI Studio Icon & Track
      ctx.font = '900 22px Orbitron, sans-serif';
      ctx.fillStyle = '#00f0ff';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 12;
      ctx.textAlign = 'left';
      const titleText = (song?.title || 'CYBERKARAOKE TRACK').toUpperCase();
      ctx.fillText(`✨ ${titleText}`, 60, 62);

      ctx.font = '700 13px Rajdhani, sans-serif';
      ctx.fillStyle = '#ff007f';
      ctx.shadowColor = '#ff007f';
      ctx.shadowBlur = 8;
      ctx.fillText(song?.artist ? `ARTISTA: ${song.artist.toUpperCase()}` : 'AI KARAOKE EDITION', 60 + ctx.measureText(`✨ ${titleText}`).width + 25, 61);

      ctx.font = '700 12px JetBrains Mono, monospace';
      ctx.fillStyle = '#00ff9d';
      ctx.shadowColor = '#00ff9d';
      ctx.shadowBlur = 6;
      ctx.textAlign = 'right';
      ctx.fillText(
        vocalPreset === 'karaoke'
          ? '● DSP KARAOKE (SIN VOZ)'
          : vocalPreset === 'duet'
          ? '● DUETO (VOZ 40%)'
          : '● AUDIO ORIGINAL',
        width - 60,
        54
      );
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fillText(`TEMPO: ${song?.bpm || 128} BPM • TONO: ${song?.key || 'Am'}`, width - 60, 72);
      ctx.shadowBlur = 0;

      // 4. KARAOKE LYRICS ENGINE WITH REAL-TIME WORD/LINE WIPE
      const currTime = audioEngine.getCurrentTime();
      let activeIndex = -1;
      for (let i = 0; i < lyrics.length; i++) {
        if (currTime >= lyrics[i].time) activeIndex = i;
        else break;
      }

      const activeLyric = activeIndex >= 0 ? lyrics[activeIndex] : null;
      const nextLyric = activeIndex >= 0 && activeIndex < lyrics.length - 1 ? lyrics[activeIndex + 1] : null;

      // Lyric Stage Box (Bottom Center)
      const lyricBoxY = height * 0.62;
      const lyricBoxH = 195;
      ctx.fillStyle = 'rgba(6, 6, 18, 0.9)';
      ctx.fillRect(40, lyricBoxY, width - 80, lyricBoxH);
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(40, lyricBoxY, width - 80, lyricBoxH);

      // Score / Party Badge
      ctx.fillStyle = 'rgba(255, 0, 127, 0.2)';
      ctx.fillRect(60, lyricBoxY + 15, 140, 24);
      ctx.strokeStyle = '#ff007f';
      ctx.lineWidth = 1;
      ctx.strokeRect(60, lyricBoxY + 15, 140, 24);

      ctx.font = '700 11px JetBrains Mono, monospace';
      ctx.fillStyle = '#ff007f';
      ctx.textAlign = 'center';
      ctx.fillText('⚡ KARAOKE ON-STAGE', 130, lyricBoxY + 31);

      if (activeLyric && activeLyric.text) {
        // ACTIVE LYRIC - DUAL TONE KARAOKE GLOW WIPE
        ctx.font = '900 40px Plus Jakarta Sans, sans-serif';
        ctx.textAlign = 'center';

        const lyricText = activeLyric.text;
        const textMetrics = ctx.measureText(lyricText);
        const textWidth = textMetrics.width;
        const textX = width / 2;
        const textY = lyricBoxY + 88;

        // Base text (inactive / upcoming syllables in white/silver)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fillText(lyricText, textX, textY);

        // Active Singing Progress Wipe (0.0 to 1.0)
        const lineDuration = activeLyric.duration || 4.0;
        const lineProgress = Math.max(0, Math.min(1, (currTime - activeLyric.time) / lineDuration));

        // Base text outline & fill (unsung)
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.strokeText(lyricText, textX, textY);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.40)';
        ctx.fillText(lyricText, textX, textY);

        // Clip and render singing highlight (100% Crisp Solid Gold / Amber)
        ctx.save();
        ctx.beginPath();
        const clipStartX = textX - textWidth / 2 - 10;
        const clipW = (textWidth + 20) * lineProgress;
        ctx.rect(clipStartX, textY - 55, clipW, 80);
        ctx.clip();

        ctx.lineWidth = 5;
        ctx.strokeStyle = '#000000';
        ctx.strokeText(lyricText, textX, textY);
        ctx.fillStyle = '#ffdd00';
        ctx.fillText(lyricText, textX, textY);
        ctx.restore();

        // NEXT LYRIC PREVIEW
        if (nextLyric && nextLyric.text) {
          ctx.font = '700 22px Plus Jakarta Sans, sans-serif';
          ctx.fillStyle = '#34d399';
          ctx.fillText(`▶ SIGUIENTE: ${nextLyric.text}`, width / 2, lyricBoxY + 152);
        }
      } else {
        // Intro waiting text
        ctx.font = '900 32px Plus Jakarta Sans, sans-serif';
        ctx.fillStyle = '#ffdd00';
        ctx.fillText('♫ [PREPÁRATE PARA CANTAR] ♫', width / 2, lyricBoxY + 105);
      }
      ctx.shadowBlur = 0;

      // 5. TIMELINE SCRUBBER PROGRESS
      const totalDur = duration || 1;
      const progress = Math.min(1, Math.max(0, currTime / totalDur));
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(40, height - 16, width - 80, 6);

      ctx.fillStyle = '#00f0ff';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 10;
      ctx.fillRect(40, height - 16, (width - 80) * progress, 6);
      ctx.shadowBlur = 0;
    };

    render();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isOpen, theme, vocalPreset, song, lyrics, duration]);

  // Apply vocal preset
  const handleVocalPresetChange = (preset: 'karaoke' | 'duet' | 'original') => {
    setVocalPreset(preset);
    if (preset === 'karaoke') {
      audioEngine.setVocalGain(0.0);
      audioEngine.setMusicGain(1.0);
    } else if (preset === 'duet') {
      audioEngine.setVocalGain(0.4);
      audioEngine.setMusicGain(1.0);
    } else {
      audioEngine.setVocalGain(1.0);
      audioEngine.setMusicGain(1.0);
    }
  };

  // Start Automated Lyrical Video Export
  const handleStartExport = async () => {
    if (!canvasRef.current) return;

    // Apply vocal gain preset
    handleVocalPresetChange(vocalPreset);

    // Initialize/start audio engine from 0:00
    audioEngine.seek(0);
    await audioEngine.play(0);

    const streamDest = audioEngine.getMediaStreamDestination();
    const success = videoRecorder.startRecording(canvasRef.current, streamDest.stream);

    if (success) {
      setIsRendering(true);
      setRecordedSeconds(0);
      setDownloadSuccess(false);

      timerRef.current = window.setInterval(() => {
        setRecordedSeconds((prev) => {
          const next = prev + 1;
          // Auto finish when song ends
          if (next >= Math.ceil(duration) && duration > 0) {
            handleStopExport();
          }
          return next;
        });
      }, 1000);
    }
  };

  // Stop Export and Download Video
  const handleStopExport = async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    audioEngine.pause();
    setIsRendering(false);

    try {
      await videoRecorder.stopRecording(song?.title ? `${song.title}_Karaoke_AI` : 'Karaoke_Video_AI');
      setDownloadSuccess(true);
    } catch (err) {
      console.error('Error finalising video export:', err);
    }
  };

  if (!isOpen) return null;

  const formatSecs = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex items-center justify-center p-3 sm:p-6 select-none overflow-y-auto">
      <div className="w-full max-w-5xl bg-[#0a0a18] border border-[#00f0ff]/50 rounded-xl shadow-[0_0_40px_rgba(0,240,255,0.3)] flex flex-col overflow-hidden my-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-[#080814]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/40 shadow-[0_0_12px_rgba(0,240,255,0.4)]">
              <Wand2 className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="font-cyber font-bold text-sm sm:text-base text-white tracking-wider flex items-center gap-2">
                <span>ESTUDIO DE GENERACIÓN DE VIDEO KARAOKE // IA</span>
                <span className="px-2 py-0.5 rounded bg-[#ff007f]/20 text-[#ff007f] text-[10px] font-mono-code font-bold border border-[#ff007f]/40">
                  AI 4K ENGINE
                </span>
              </h2>
              <span className="text-[11px] font-mono-code text-[#00ff9d]">
                1280x720 • 60 FPS • Sincronización Karaoke con Relleno de Letras • DSP Sin Voz
              </span>
            </div>
          </div>
          <button
            onClick={() => {
              if (isRendering) handleStopExport();
              onClose();
            }}
            className="text-white/40 hover:text-white font-mono-code text-base p-1.5 rounded bg-white/5 hover:bg-white/10 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 flex flex-col gap-4">
          {/* HD Canvas Video Preview */}
          <div className="relative w-full aspect-video bg-black rounded-lg border border-white/15 overflow-hidden shadow-[0_0_25px_rgba(0,0,0,0.9)]">
            <canvas ref={canvasRef} className="w-full h-full block object-contain" />
            {isRendering && (
              <div className="absolute top-3 left-3 flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-rose-950/90 border border-rose-500 text-rose-200 text-xs font-mono-code font-bold animate-pulse shadow-[0_0_20px_rgba(244,63,94,0.6)]">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
                GRABANDO VIDEO KARAOKE CON IA: {formatSecs(recordedSeconds)} / {formatSecs(duration)}
              </div>
            )}
          </div>

          {/* AI Video Settings & Theme Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Visual AI Themes */}
            <div className="bg-white/5 border border-white/10 rounded-lg p-3.5 flex flex-col gap-2.5">
              <label className="text-xs font-bold font-mono-code text-white/80 uppercase tracking-wider flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-[#00f0ff]" />
                Escenario Visual de IA:
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                {[
                  { id: 'cyberpunk', label: 'CYBER GRID', icon: '🌆' },
                  { id: 'synthwave', label: '80s RETRO', icon: '📼' },
                  { id: 'nebula', label: 'ESPACIO', icon: '🌌' },
                  { id: 'rave', label: 'LASER RAVE', icon: '⚡' },
                  { id: 'tokyo', label: 'TOKYO LOFI', icon: '🌸' },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id as VideoTheme)}
                    className={`py-2 px-1 rounded border text-center transition-all cursor-pointer flex flex-col items-center gap-1 ${
                      theme === t.id
                        ? 'bg-[#00f0ff]/25 border-[#00f0ff] text-white shadow-[0_0_10px_rgba(0,240,255,0.4)]'
                        : 'bg-black/40 border-white/10 text-white/60 hover:border-white/20'
                    }`}
                  >
                    <span className="text-base">{t.icon}</span>
                    <span className="text-[10px] font-mono-code font-bold uppercase">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Vocal Track Preset */}
            <div className="bg-white/5 border border-white/10 rounded-lg p-3.5 flex flex-col gap-2.5">
              <label className="text-xs font-bold font-mono-code text-white/80 uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-3.5 h-3.5 text-[#ff007f]" />
                Modo Vocal del Video:
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'karaoke', label: 'SIN VOZ', desc: '100% Instrumental' },
                  { id: 'duet', label: 'DUETO', desc: 'Voz Guía 40%' },
                  { id: 'original', label: 'ORIGINAL', desc: 'Voz Completa 100%' },
                ].map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleVocalPresetChange(p.id as 'karaoke' | 'duet' | 'original')}
                    className={`p-2 rounded border text-left transition-all cursor-pointer flex flex-col ${
                      vocalPreset === p.id
                        ? 'bg-[#ff007f]/20 border-[#ff007f] text-white shadow-[0_0_10px_rgba(255,0,127,0.4)]'
                        : 'bg-black/40 border-white/10 text-white/60 hover:border-white/20'
                    }`}
                  >
                    <span className="text-xs font-bold font-mono-code">{p.label}</span>
                    <span className="text-[9px] opacity-60 font-mono-code">{p.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Download Success Notice */}
          {downloadSuccess && (
            <div className="p-3 rounded-lg bg-[#00ff9d]/20 border border-[#00ff9d]/50 text-[#00ff9d] text-xs font-mono-code flex items-center justify-between shadow-[0_0_15px_rgba(0,255,157,0.3)]">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>¡Video generado y descargado exitosamente en calidad HD con letras sincronizadas!</span>
              </div>
            </div>
          )}

          {/* Export Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-white/10">
            <div className="text-[11px] font-mono-code text-white/50 text-center sm:text-left">
              {song?.title ? (
                <span>
                  Canción activa: <strong className="text-white">{song.title}</strong> ({formatSecs(duration)}) • {lyrics.length} líneas de letras
                </span>
              ) : (
                <span className="text-amber-400">Selecciona o genera una pista para exportar el video</span>
              )}
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              {isRendering ? (
                <button
                  id="btn-stop-ai-video-export"
                  onClick={handleStopExport}
                  className="w-full sm:w-auto px-6 py-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-mono-code font-bold text-xs tracking-wider cursor-pointer shadow-[0_0_20px_rgba(244,63,94,0.6)] flex items-center justify-center gap-2"
                >
                  <Square className="w-4 h-4 fill-current" />
                  <span>DETENER Y DESCARGAR VIDEO WEBM</span>
                </button>
              ) : (
                <button
                  id="btn-start-ai-video-export"
                  onClick={handleStartExport}
                  disabled={!song}
                  className="w-full sm:w-auto px-6 py-3 rounded-lg bg-gradient-to-r from-[#00f0ff] via-[#bd00ff] to-[#ff007f] hover:opacity-90 text-white font-mono-code font-black text-xs uppercase tracking-widest cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shadow-[0_0_25px_rgba(0,240,255,0.5)] flex items-center justify-center gap-2.5 transition-all"
                >
                  <Wand2 className="w-4 h-4 animate-bounce" />
                  <span>GENERAR Y DESCARGAR VIDEO CON IA</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
