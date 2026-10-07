import React, { useEffect, useRef, useState } from 'react';
import { VideoBackgroundConfig } from '../types';

interface DynamicVideoBackgroundProps {
  config: VideoBackgroundConfig;
  isPlaying: boolean;
  songKey?: string;
  currentTime?: number;
  duration?: number;
  className?: string;
}

export const DynamicVideoBackground: React.FC<DynamicVideoBackgroundProps> = ({
  config,
  isPlaying,
  songKey,
  currentTime,
  duration,
  className = '',
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const prevIsPlayingRef = useRef<boolean>(isPlaying);
  const [isVideoVisible, setIsVideoVisible] = useState(false);
  const videoDurationRef = useRef<number>(0);

  // Dynamic container sizing: adapts seamlessly to mini player box or fullscreen modes
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
      }
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            setContainerSize({ width: Math.round(width), height: Math.round(height) });
          }
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    } else {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }
  }, []);

  // Compute exact 16:9 dimensions to cover container, maintaining a safe 1.25x crop for YouTube titles/controls
  const targetDims = React.useMemo(() => {
    const cw = containerSize.width > 0 ? containerSize.width : (typeof window !== 'undefined' ? window.innerWidth : 1280);
    const ch = containerSize.height > 0 ? containerSize.height : (typeof window !== 'undefined' ? window.innerHeight : 720);

    const targetRatio = 16 / 9;
    const currentRatio = cw / ch;

    let baseW = cw;
    let baseH = ch;

    if (currentRatio > targetRatio) {
      baseW = cw;
      baseH = Math.round(cw / targetRatio);
    } else {
      baseH = ch;
      baseW = Math.round(ch * targetRatio);
    }

    return {
      width: `${baseW}px`,
      height: `${baseH}px`,
    };
  }, [containerSize.width, containerSize.height]);

  // Pure black fade curtain on song/video change
  useEffect(() => {
    setIsVideoVisible(false);
    try {
      const win = iframeRef.current?.contentWindow;
      if (win) {
        win.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: '' }), '*');
        win.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [0] }), '*');
        win.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [0, true] }), '*');
        if (!isPlaying) {
          win.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' }), '*');
        }
      }
    } catch (_) {}

    const timer = setTimeout(() => {
      setIsVideoVisible(true);
    }, 1500); // 1.5s transition curtain

    return () => clearTimeout(timer);
  }, [config.videoId, songKey]);

  // Construct optimized, zero-controls, strictly muted, loop URL with playlist param & youtube-nocookie
  const embedUrl = useRef<string>('');
  const lastVideoIdRef = useRef<string>('');
  const lastSongKeyRef = useRef<string>('');

  if (config.videoId && (config.videoId !== lastVideoIdRef.current || songKey !== lastSongKeyRef.current)) {
    lastVideoIdRef.current = config.videoId;
    lastSongKeyRef.current = songKey || '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const autoPlayParam = isPlaying ? 1 : 0;
    embedUrl.current = `https://www.youtube-nocookie.com/embed/${config.videoId}?autoplay=${autoPlayParam}&mute=1&controls=0&showinfo=0&rel=0&loop=1&playlist=${config.videoId}&enablejsapi=1&playsinline=1&iv_load_policy=3&modestbranding=1&disablekb=1&fs=0&cc_load_policy=0&origin=${encodeURIComponent(origin)}`;
  }

  // Listen for iframe duration and state changes: auto-restart immediately if video ends (loop protection)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        let data = event.data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch (_) { return; }
        }
        const dur = data?.info?.duration ?? data?.infoDelivery?.duration;
        if (typeof dur === 'number' && dur > 0) {
          videoDurationRef.current = dur;
        }

        const state = data?.info?.playerState ?? data?.infoDelivery?.playerState;
        // If background video ever reaches end, immediately restart at 0 to guarantee continuous loop without end screens
        if (state === 0 || state === '0') {
          const win = iframeRef.current?.contentWindow;
          if (win) {
            win.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: '' }), '*');
            win.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [0, true] }), '*');
            win.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: '' }), '*');
          }
        }
      } catch (_) {}
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Sync Play / Pause command ONLY when isPlaying state actually changes (0 FPS postMessage overhead)
  useEffect(() => {
    if (!config.enabled || config.mode === 'off' || !config.videoId) return;

    const isSongEnded = duration !== undefined && duration > 0 && currentTime !== undefined && currentTime >= duration - 0.5;
    const shouldPlay = isPlaying && !isSongEnded;

    if (prevIsPlayingRef.current === shouldPlay) return;
    prevIsPlayingRef.current = shouldPlay;

    try {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;

      if (shouldPlay) {
        win.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: '' }), '*');
        win.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [0] }), '*');
        win.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: '' }), '*');
      } else {
        win.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' }), '*');
      }
    } catch (_) {}
  }, [isPlaying, config.enabled, config.mode, config.videoId, duration]);

  // Keep component mounted even when paused so video does NOT reload from 0s on resume
  if (!config.enabled || config.mode === 'off' || !config.videoId) {
    return null;
  }

  // Balanced cinematic contrast overlay (77% dark tint) - Clear video & high lyric readability
  const overlayOpacity = Math.max(0.77, Math.min(0.96, config.overlayOpacity ?? 0.77));

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 w-full h-full overflow-hidden pointer-events-none select-none z-0 bg-[#04060c] ${className}`}
    >
      {/* High-def Cover Transition Mask - Pure dark stage during startup & song changes */}
      <div
        className={`absolute inset-0 bg-[#04060c] transition-opacity duration-1000 z-10 ${
          isVideoVisible ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      />

      {/* Scaled & Centered 16:9 Frame - Scaled 1.25x to safely crop top title and bottom bars without distortion */}
      <div
        className={`absolute inset-0 w-full h-full flex items-center justify-center overflow-hidden pointer-events-none transition-opacity duration-1000 ${
          isVideoVisible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ pointerEvents: 'none', touchAction: 'none', transform: 'translateZ(0)', willChange: 'opacity' }}
      >
        <iframe
          ref={iframeRef}
          key={`${config.videoId}_${songKey || 'default'}`}
          src={embedUrl.current}
          title="Dynamic Background Video"
          tabIndex={-1}
          aria-hidden="true"
          allow="autoplay; encrypted-media"
          className="pointer-events-none border-0 select-none"
          style={{
            width: targetDims.width,
            height: targetDims.height,
            maxWidth: 'none',
            maxHeight: 'none',
            transform: 'scale(1.25)',
            transformOrigin: 'center center',
          }}
          onLoad={() => {
            try {
              const win = iframeRef.current?.contentWindow;
              if (win) {
                win.postMessage(JSON.stringify({ event: 'listening', id: config.videoId }), '*');
                win.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: '' }), '*');
                win.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [0] }), '*');
                if (isPlaying) {
                  win.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: '' }), '*');
                } else {
                  win.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' }), '*');
                }
              }
            } catch (_) {}
          }}
        />
      </div>

      {/* Dark Contrast Overlay - Zero GPU-cost flat alpha layer */}
      <div
        className="absolute inset-0 transition-opacity duration-300 pointer-events-none"
        style={{
          backgroundColor: `rgba(4, 6, 12, ${overlayOpacity})`,
          transform: 'translateZ(0)',
        }}
      />

      {/* Center Reading Spotlight: subtle dark halo right where the lyrics sit */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(4, 6, 12, 0.20) 0%, rgba(4, 6, 12, 0.05) 70%, transparent 100%)',
        }}
      />

      {/* Subtle Vignette & Gradient Edges */}
      <div className="absolute inset-0 bg-radial-gradient from-transparent via-transparent to-slate-950/90 pointer-events-none" />
    </div>
  );
};
