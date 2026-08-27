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
  currentTime = 0,
  duration,
  className = '',
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const prevIsPlayingRef = useRef<boolean>(isPlaying);
  const lastKnownTimeRef = useRef<number>(currentTime);
  const [isVideoVisible, setIsVideoVisible] = useState(false);

  // Soft fade-in curtain: Only visible on initial load of a new video to hide YouTube start overlay
  useEffect(() => {
    setIsVideoVisible(false);
    const timer = setTimeout(() => {
      setIsVideoVisible(true);
    }, 4000);

    return () => clearTimeout(timer);
  }, [config.videoId, songKey]);

  // Sync Play / Pause command ONLY when playback state actually changes
  useEffect(() => {
    if (!config.enabled || config.mode === 'off' || !config.videoId) return;

    // Check if song has ended
    const isSongEnded = duration !== undefined && duration > 0 && currentTime >= duration - 0.5;
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
  }, [isPlaying, config.enabled, config.mode, config.videoId, currentTime, duration]);

  // Sync Seek Time when currentTime jumps significantly (e.g. user seeks on scrubber, changes lyric line, etc.)
  useEffect(() => {
    if (!config.enabled || config.mode === 'off' || !config.videoId) return;

    const timeDiff = Math.abs(currentTime - lastKnownTimeRef.current);
    // If difference is greater than 2 seconds, it was an explicit user seek or major sync jump
    if (timeDiff > 2.0) {
      lastKnownTimeRef.current = currentTime;
      try {
        const win = iframeRef.current?.contentWindow;
        if (win) {
          win.postMessage(
            JSON.stringify({
              event: 'command',
              func: 'seekTo',
              args: [Math.max(0, currentTime), true],
            }),
            '*'
          );
        }
      } catch (_) {}
    } else {
      lastKnownTimeRef.current = currentTime;
    }
  }, [currentTime, config.enabled, config.mode, config.videoId]);

  if (!config.enabled || config.mode === 'off' || !config.videoId) {
    return null;
  }

  // Construct optimized, zero-controls, muted, loop URL starting at the current playback time
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const initialStartSec = Math.max(0, Math.floor(currentTime || 0));
  const embedUrl = `https://www.youtube-nocookie.com/embed/${config.videoId}?autoplay=${isPlaying ? 1 : 0}&start=${initialStartSec}&mute=1&controls=0&showinfo=0&rel=0&loop=1&playlist=${config.videoId}&enablejsapi=1&playsinline=1&iv_load_policy=3&modestbranding=1&disablekb=1&fs=0&cc_load_policy=0&origin=${encodeURIComponent(origin)}`;

  const overlayOpacity = Math.max(0.2, Math.min(0.95, config.overlayOpacity ?? 0.70));
  const blurPx = Math.max(0, Math.min(10, config.blurAmount ?? 1));

  return (
    <div className={`absolute inset-0 w-full h-full overflow-hidden pointer-events-none select-none z-0 ${className}`}>
      {/* High-def Cover Thumbnail Mask */}
      <div
        className={`absolute inset-0 bg-cover bg-center transition-opacity duration-1000 ${
          isVideoVisible ? 'opacity-0' : 'opacity-100'
        }`}
        style={{
          backgroundImage: `url(https://i.ytimg.com/vi/${config.videoId}/hqdefault.jpg)`,
          filter: 'blur(8px)',
        }}
      />

      {/* Scaled & Centered 16:9 Frame - Strictly bounded to container box */}
      <div
        className={`absolute inset-0 w-full h-full flex items-center justify-center overflow-hidden pointer-events-none transition-opacity duration-1000 ${
          isVideoVisible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ pointerEvents: 'none', touchAction: 'none' }}
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
          }}
        />
      </div>

      {/* Dark Contrast & Glassmorphism Overlay */}
      <div
        className="absolute inset-0 transition-all duration-300"
        style={{
          backgroundColor: `rgba(6, 8, 15, ${overlayOpacity})`,
          backdropFilter: blurPx > 0 ? `blur(${blurPx}px)` : 'none',
          WebkitBackdropFilter: blurPx > 0 ? `blur(${blurPx}px)` : 'none',
        }}
      />

      {/* Subtle Vignette & Gradient Edges */}
      <div className="absolute inset-0 bg-radial-gradient from-transparent via-transparent to-slate-950/90 pointer-events-none" />
    </div>
  );
};

