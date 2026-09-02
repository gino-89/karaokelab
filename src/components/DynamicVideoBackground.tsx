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
  const [prevSongKey, setPrevSongKey] = useState(songKey);
  const [prevVideoId, setPrevVideoId] = useState(config.videoId);
  const [isVideoVisible, setIsVideoVisible] = useState(false);

  // Synchronous state adjustment during render when song or video changes
  // Guarantees zero frames of old video bleed-through during transitions!
  if (songKey !== prevSongKey || config.videoId !== prevVideoId) {
    setPrevSongKey(songKey);
    setPrevVideoId(config.videoId);
    setIsVideoVisible(false);
  }

  // Record the start time on initial mount so when TV mode or mini player opens, it starts right at current playback time
  const initialStartTimeRef = useRef<number>(Math.max(0, Math.floor(currentTime || 0)));
  const lastSeekTimeRef = useRef<number>(Date.now());
  const prevTimeRef = useRef<number>(currentTime || 0);

  // 2-second pure black fade curtain (2000ms) and instant seekTo(0) reset on song/video change
  useEffect(() => {
    setIsVideoVisible(false);
    try {
      const win = iframeRef.current?.contentWindow;
      if (win) {
        win.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [0, true] }), '*');
      }
    } catch (_) { }

    const timer = setTimeout(() => {
      setIsVideoVisible(true);
    }, 2200);

    return () => clearTimeout(timer);
  }, [config.videoId, songKey]);

  // Static embed URL per videoId & songKey (starts at 0s for new songs, or current time when mounting mid-song)
  const embedUrl = useRef<string>('');
  const lastVideoIdRef = useRef<string>('');
  const lastSongKeyRef = useRef<string>('');

  if (config.videoId && (config.videoId !== lastVideoIdRef.current || songKey !== lastSongKeyRef.current)) {
    lastVideoIdRef.current = config.videoId;
    lastSongKeyRef.current = songKey || '';
    const startSec = Math.max(0, Math.floor(currentTime || 0));
    const startParam = startSec > 0 ? `&start=${startSec}` : '';
    embedUrl.current = `https://www.youtube.com/embed/${config.videoId}?autoplay=1&mute=1&controls=0&rel=0&playsinline=1&enablejsapi=1&loop=1&playlist=${config.videoId}${startParam}`;
  }

  const videoDurationRef = useRef<number>(0);

  // Listen for iframe duration and state changes: auto-restart immediately if video ends
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
        // If background video ever reaches end, immediately restart at 0 to guarantee infinite loop without end screens
        if (state === 0 || state === '0') {
          const win = iframeRef.current?.contentWindow;
          if (win) {
            win.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [0, true] }), '*');
            win.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: '' }), '*');
          }
        }
      } catch (_) {}
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Sync Play / Pause command when playback state changes
  useEffect(() => {
    if (!config.enabled || config.mode === 'off' || !config.videoId) return;

    try {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;

      if (currentTime !== undefined) {
        const safeTime = videoDurationRef.current > 0 ? (currentTime % videoDurationRef.current) : currentTime;
        win.postMessage(
          JSON.stringify({
            event: 'command',
            func: 'seekTo',
            args: [safeTime, true],
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
    } catch (_) { }
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
          const safeTime = videoDurationRef.current > 0 ? (currentTime % videoDurationRef.current) : currentTime;
          win.postMessage(
            JSON.stringify({
              event: 'command',
              func: 'seekTo',
              args: [safeTime, true],
            }),
            '*'
          );
        }
      } catch (_) { }
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
      {/* High-def Cover Transition Mask - Pure dark stage during startup & song changes */}
      <div
        className={`absolute inset-0 bg-[#04060c] transition-opacity duration-1000 z-10 ${isVideoVisible ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
      />

      {/* Scaled & Centered 16:9 Frame - Hardware accelerated with 3D transform */}
      <div
        className={`absolute inset-0 w-full h-full flex items-center justify-center overflow-hidden pointer-events-none transition-opacity duration-1000 ${isVideoVisible ? 'opacity-100' : 'opacity-0'
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
            } catch (_) { }
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

      {/* Subtle Vignette & Gradient Edges */}
      <div className="absolute inset-0 bg-radial-gradient from-transparent via-transparent to-slate-950/90 pointer-events-none" />
    </div>
  );
};
