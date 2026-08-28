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

  // Record the start time on initial mount so when TV mode or mini player opens, it starts right at current playback time
  const initialStartTimeRef = useRef<number>(Math.max(0, Math.floor(currentTime || 0)));
  const lastSeekTimeRef = useRef<number>(Date.now());
  const prevTimeRef = useRef<number>(currentTime || 0);

  // Quick fade-in curtain (1.2s instead of 4.5s) so the background transition is smooth and fast
  useEffect(() => {
    setIsVideoVisible(false);
    const timer = setTimeout(() => {
      setIsVideoVisible(true);
    }, 1200);

    return () => clearTimeout(timer);
  }, [config.videoId, songKey]);

  // Sync Play / Pause command when playback state changes
  useEffect(() => {
    if (!config.enabled || config.mode === 'off' || !config.videoId) return;

    // Check if song has ended
    const isSongEnded = duration !== undefined && duration > 0 && currentTime !== undefined && currentTime >= duration - 0.5;
    const shouldPlay = isPlaying && !isSongEnded;

    if (prevIsPlayingRef.current === shouldPlay) return;
    prevIsPlayingRef.current = shouldPlay;

    try {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;

      win.postMessage(
        JSON.stringify({
          event: 'command',
          func: shouldPlay ? 'playVideo' : 'pauseVideo',
          args: '',
        }),
        '*'
      );
    } catch (_) {}
  }, [isPlaying, config.enabled, config.mode, config.videoId, duration, currentTime]);

  // Sync Seek position when user jumps / seeks in the song
  useEffect(() => {
    if (!config.enabled || config.mode === 'off' || !config.videoId || currentTime === undefined) return;

    const delta = Math.abs(currentTime - prevTimeRef.current);
    const now = Date.now();

    // If time jumped by more than 2 seconds (manual seek)
    if (delta > 2.0 && now - lastSeekTimeRef.current > 800) {
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

  // Construct optimized, zero-controls, muted, loop URL with exact start second
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const startSeconds = initialStartTimeRef.current;
  const startParam = startSeconds > 0 ? `&start=${startSeconds}` : '';
  const embedUrl = `https://www.youtube-nocookie.com/embed/${config.videoId}?autoplay=${isPlaying ? 1 : 0}${startParam}&mute=1&controls=0&showinfo=0&rel=0&loop=1&playlist=${config.videoId}&enablejsapi=1&playsinline=1&iv_load_policy=3&modestbranding=1&disablekb=1&fs=0&cc_load_policy=0&origin=${encodeURIComponent(origin)}`;

  const overlayOpacity = Math.max(0.2, Math.min(0.95, config.overlayOpacity ?? 0.82));
  const blurPx = Math.max(0, Math.min(10, config.blurAmount ?? 0));

  return (
    <div className={`absolute inset-0 w-full h-full overflow-hidden pointer-events-none select-none z-0 ${className}`}>
      {/* High-def Cover Thumbnail Mask - Displayed seamlessly during startup */}
      <div
        className={`absolute inset-0 bg-cover bg-center transition-opacity duration-700 ${
          isVideoVisible ? 'opacity-0' : 'opacity-100'
        }`}
        style={{
          backgroundImage: `url(https://i.ytimg.com/vi/${config.videoId}/hqdefault.jpg)`,
          filter: blurPx > 0 ? `blur(${blurPx}px)` : 'none',
          transform: 'translate3d(0, 0, 0)',
        }}
      />

      {/* Scaled & Centered 16:9 Frame - Strictly bounded to container box */}
      <div
        className={`absolute inset-0 w-full h-full flex items-center justify-center overflow-hidden pointer-events-none transition-opacity duration-700 ${
          isVideoVisible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ pointerEvents: 'none', touchAction: 'none', transform: 'translate3d(0, 0, 0)' }}
      >
        <iframe
          ref={iframeRef}
          key={`${config.videoId}_${songKey || 'default'}`}
          src={embedUrl}
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
            filter: blurPx > 0 ? `blur(${blurPx}px)` : 'none',
            transform: 'translate3d(0, 0, 0)',
          }}
        />
      </div>

      {/* Dark Contrast Overlay - Pure GPU-friendly solid layer when blur is 0 */}
      <div
        className="absolute inset-0 transition-all duration-300"
        style={{
          backgroundColor: `rgba(4, 6, 12, ${overlayOpacity})`,
          backdropFilter: blurPx > 0 ? `blur(${blurPx}px)` : 'none',
          WebkitBackdropFilter: blurPx > 0 ? `blur(${blurPx}px)` : 'none',
          transform: 'translate3d(0, 0, 0)',
        }}
      />

      {/* Subtle Vignette & Gradient Edges */}
      <div className="absolute inset-0 bg-radial-gradient from-transparent via-transparent to-slate-950/90 pointer-events-none" />
    </div>
  );
};
