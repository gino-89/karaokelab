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
  const [prevKey, setPrevKey] = useState<string | undefined>(songKey);
  const [prevVideoId, setPrevVideoId] = useState<string | undefined>(config.videoId);
  const [isVideoVisible, setIsVideoVisible] = useState<boolean>(false);

  // Synchronous state reset during render when song or video changes
  // This guarantees ZERO frames of old video bleed-through during transitions!
  if (songKey !== prevKey || config.videoId !== prevVideoId) {
    setPrevKey(songKey);
    setPrevVideoId(config.videoId);
    setIsVideoVisible(false);
  }

  const lastSeekTimeRef = useRef<number>(Date.now());
  const prevTimeRef = useRef<number>(currentTime || 0);

  // Fade in curtain after video loads or after 1s
  useEffect(() => {
    setIsVideoVisible(false);
    const timer = setTimeout(() => {
      setIsVideoVisible(true);
    }, 1000);

    return () => clearTimeout(timer);
  }, [config.videoId, songKey]);

  // Compute fresh embed URL with optional start timestamp
  const startSec = Math.max(0, Math.floor(currentTime || 0));
  const startParam = startSec > 0 ? `&start=${startSec}` : '';
  const currentEmbedUrl = config.videoId
    ? `https://www.youtube.com/embed/${config.videoId}?autoplay=1&mute=1&controls=0&rel=0&playsinline=1&enablejsapi=1${startParam}`
    : '';

  // Sync Play / Pause command when playback state changes
  useEffect(() => {
    if (!config.enabled || config.mode === 'off' || !config.videoId) return;

    try {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;

      if (currentTime !== undefined) {
        win.postMessage(
          JSON.stringify({
            event: 'command',
            func: 'seekTo',
            args: [currentTime, true],
          }),
          '*'
        );
      }

      win.postMessage(
        JSON.stringify({
          event: 'command',
          func: isPlaying ? 'playVideo' : 'pauseVideo',
          args: '',
        }),
        '*'
      );
    } catch (_) {}
  }, [isPlaying, config.enabled, config.mode, config.videoId]);

  // Sync Seek position when user jumps / seeks in the song
  useEffect(() => {
    if (!config.enabled || config.mode === 'off' || !config.videoId || currentTime === undefined) return;

    const delta = Math.abs(currentTime - prevTimeRef.current);
    const now = Date.now();

    // If time jumped by more than 1.5 seconds (manual seek)
    if (delta > 1.5 && now - lastSeekTimeRef.current > 500) {
      lastSeekTimeRef.current = now;
      prevTimeRef.current = currentTime;
      try {
        const win = iframeRef.current?.contentWindow;
        if (win) {
          win.postMessage(
            JSON.stringify({
              event: 'command',
              func: 'seekTo',
              args: [currentTime, true],
            }),
            '*'
          );
        }
      } catch (_) {}
    } else {
      prevTimeRef.current = currentTime;
    }
  }, [currentTime, config.enabled, config.mode, config.videoId]);

  // Keep component mounted even when paused so video does NOT reload from 0s on resume
  if (!config.enabled || config.mode === 'off' || !config.videoId) {
    return null;
  }

  const overlayOpacity = Math.max(0.15, Math.min(0.85, config.overlayOpacity ?? 0.45));

  return (
    <div className={`absolute inset-0 w-full h-full overflow-hidden pointer-events-none select-none z-0 bg-[#04060c] ${className}`}>
      {/* High-def Cover Thumbnail Mask - Displayed seamlessly during startup */}
      {config.videoId && (
        <div
          className={`absolute inset-0 bg-cover bg-center transition-opacity duration-500 ${
            isVideoVisible ? 'opacity-0' : 'opacity-100'
          }`}
          style={{
            backgroundImage: `url(https://i.ytimg.com/vi/${config.videoId}/hqdefault.jpg)`,
          }}
        />
      )}

      {/* Solid Black Transition Mask - Immediately covers the stage during song changes */}
      <div
        className={`absolute inset-0 bg-[#04060c] transition-opacity duration-500 z-10 ${
          isVideoVisible ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      />

      {/* Scaled & Centered 16:9 Frame - Hardware accelerated with 3D transform */}
      <div
        className={`absolute inset-0 w-full h-full flex items-center justify-center overflow-hidden pointer-events-none transition-opacity duration-700 ${
          isVideoVisible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ pointerEvents: 'none', touchAction: 'none', transform: 'translateZ(0)', willChange: 'opacity' }}
      >
        <iframe
          ref={iframeRef}
          key={`${config.videoId}_${songKey || 'default'}`}
          src={currentEmbedUrl}
          title="Dynamic Background Video"
          tabIndex={-1}
          aria-hidden="true"
          allow="autoplay; encrypted-media"
          className="pointer-events-none border-0 select-none scale-[1.35]"
          style={{
            width: '120%',
            height: '120%',
            pointerEvents: 'none',
            touchAction: 'none',
            transform: 'translate3d(0, 0, 0)',
            willChange: 'transform',
          }}
          onLoad={() => {
            try {
              const win = iframeRef.current?.contentWindow;
              if (win) {
                win.postMessage(JSON.stringify({ event: 'listening', id: config.videoId }), '*');
                if (currentTime) {
                  win.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [currentTime, true] }), '*');
                }
                if (!isPlaying) {
                  win.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' }), '*');
                } else {
                  win.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: '' }), '*');
                }
              }
            } catch (_) {}
            setIsVideoVisible(true);
          }}
        />
      </div>

      {/* Dark Contrast Overlay - Zero GPU-cost flat alpha layer */}
      <div
        className="absolute inset-0 transition-opacity duration-300 pointer-events-none z-20"
        style={{
          backgroundColor: `rgba(4, 6, 12, ${overlayOpacity})`,
          transform: 'translateZ(0)',
        }}
      />

      {/* Subtle Vignette & Gradient Edges */}
      <div className="absolute inset-0 bg-radial-gradient from-transparent via-transparent to-slate-950/90 pointer-events-none z-20" />
    </div>
  );
};
