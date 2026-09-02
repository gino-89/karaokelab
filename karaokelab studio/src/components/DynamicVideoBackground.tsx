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

  // Soft fade-in curtain: Stays visible for 4.5s to 100% guarantee that YouTube's 5s HUD auto-hides before the video is shown
  useEffect(() => {
    setIsVideoVisible(false);
    const timer = setTimeout(() => {
      setIsVideoVisible(true);
    }, 4500); // 4.5s hides the entire YouTube startup overlay

    return () => clearTimeout(timer);
  }, [config.videoId, songKey]);

  // Sync Play / Pause command ONLY when playback state actually changes (prevents HUD animation flashes)
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
  }, [isPlaying, config.enabled, config.mode, config.videoId, currentTime, duration]);

  if (!config.enabled || config.mode === 'off' || !config.videoId || !isPlaying) {
    return null;
  }

  // Construct optimized, zero-controls, muted, loop URL with playlist param
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const embedUrl = `https://www.youtube-nocookie.com/embed/${config.videoId}?autoplay=${isPlaying ? 1 : 0}&mute=1&controls=0&showinfo=0&rel=0&loop=1&playlist=${config.videoId}&enablejsapi=1&playsinline=1&iv_load_policy=3&modestbranding=1&disablekb=1&fs=0&cc_load_policy=0&origin=${encodeURIComponent(origin)}`;

  const overlayOpacity = Math.max(0.2, Math.min(0.95, config.overlayOpacity ?? 0.70));
  const blurPx = Math.max(0, Math.min(10, config.blurAmount ?? 1));

  return (
    <div className={`absolute inset-0 w-full h-full overflow-hidden pointer-events-none select-none z-0 ${className}`}>
      {/* High-def Cover Thumbnail Mask - Displayed seamlessly during startup so 0 HUD icons are visible */}
      <div
        className={`absolute inset-0 bg-cover bg-center transition-opacity duration-1000 ${
          isVideoVisible ? 'opacity-0' : 'opacity-100'
        }`}
        style={{
          backgroundImage: `url(https://i.ytimg.com/vi/${config.videoId}/hqdefault.jpg)`,
          filter: 'blur(8px)',
        }}
      />

      {/* Scaled & Centered 16:9 Desktop Frame - Scaled 1.45x to crop top title and bottom bars */}
      <div className={`absolute inset-0 w-full h-full flex items-center justify-center overflow-hidden pointer-events-none transition-opacity duration-1000 ${
        isVideoVisible ? 'opacity-100' : 'opacity-0'
      }`}>
        <iframe
          ref={iframeRef}
          key={`${config.videoId}_${songKey || 'default'}`}
          src={embedUrl}
          title="Dynamic Background Video"
          width="1920"
          height="1080"
          allow="autoplay; encrypted-media"
          className="pointer-events-none border-0 select-none scale-[1.45]"
          style={{
            width: '100vw',
            height: '56.25vw',
            minHeight: '100vh',
            minWidth: '177.77vh',
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
