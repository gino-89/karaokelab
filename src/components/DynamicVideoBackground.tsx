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
  const videoDurationRef = useRef<number>(0);
  const lastSeekTimeRef = useRef<number>(Date.now());
  const prevTimeRef = useRef<number>(currentTime || 0);

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

  // 1. REQUISITO: CERO BLEED-THROUGH (Anti-destello del video anterior)
  // Ajuste de estado síncrono durante render: en cuanto cambia la canción o video,
  // la cortina se vuelve 100% NEGRA antes de pintar cualquier fotograma.
  if (songKey !== prevSongKey || config.videoId !== prevVideoId) {
    setPrevSongKey(songKey);
    setPrevVideoId(config.videoId);
    setIsVideoVisible(false);
  }

  // Cortina de transición suave durante cambio de canción
  useEffect(() => {
    try {
      const win = iframeRef.current?.contentWindow;
      if (win) {
        win.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: '' }), '*');
        win.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [0] }), '*');
        win.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [0, true] }), '*');
        win.postMessage(JSON.stringify({ event: 'command', func: 'unloadModule', args: ['captions'] }), '*');
        if (!isPlaying) {
          win.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' }), '*');
        }
      }
    } catch (_) {}

    const timer = setTimeout(() => {
      setIsVideoVisible(true);
    }, 300);

    return () => clearTimeout(timer);
  }, [config.videoId, songKey]);

  // Construcción de URL con mute estricto, loop y sin controles
  const embedUrl = useRef<string>('');
  const lastVideoIdRef = useRef<string>('');
  const lastSongKeyRef = useRef<string>('');

  if (config.videoId && (config.videoId !== lastVideoIdRef.current || songKey !== lastSongKeyRef.current)) {
    lastVideoIdRef.current = config.videoId;
    lastSongKeyRef.current = songKey || '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const autoPlayParam = isPlaying ? 1 : 0;
    embedUrl.current = `https://www.youtube-nocookie.com/embed/${config.videoId}?autoplay=${autoPlayParam}&mute=1&controls=0&showinfo=0&rel=0&enablejsapi=1&playsinline=1&webkit-playsinline=1&iv_load_policy=3&modestbranding=1&disablekb=1&fs=0&cc_load_policy=0&cc_lang_pref=none&origin=${encodeURIComponent(origin)}`;
  }

  // 2. REQUISITO: SINCRONIZACIÓN MILIMÉTRICA EN CUALQUIER MOMENTO (MODULO TIMELINE)
  // Calcula el fotograma exacto para que el video de fondo en cualquier pantalla
  // (Mini-player, TV, Modal) coincida exactamente en el mismo segundo relativo.
  const getSyncedPosition = (time: number) => {
    const dur = videoDurationRef.current;
    if (dur && dur > 0) {
      const mod = time % dur;
      return Math.min(dur - 0.5, Math.max(0, mod));
    }
    return Math.max(0, time);
  };

  // Escucha duración y eventos de loop del video de YouTube
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
        const win = iframeRef.current?.contentWindow;

        // Cada vez que el video empieza o cambia de estado, desactiva inmediatamente los subtítulos (CC)
        if (state === 1 || state === '1' || state === 2 || state === '2') {
          if (win) {
            win.postMessage(JSON.stringify({ event: 'command', func: 'unloadModule', args: ['captions'] }), '*');
            win.postMessage(JSON.stringify({ event: 'command', func: 'setOption', args: ['captions', 'track', {}] }), '*');
            win.postMessage(JSON.stringify({ event: 'command', func: 'setOption', args: ['captions', 'fontSize', -1] }), '*');
          }
        }

        // Si el video de fondo llega al final, reinicia en 0 inmediatamente en bucle continuo
        if (state === 0 || state === '0') {
          if (win) {
            win.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: '' }), '*');
            win.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [0, true] }), '*');
            win.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: '' }), '*');
            win.postMessage(JSON.stringify({ event: 'command', func: 'unloadModule', args: ['captions'] }), '*');
          }
        }
      } catch (_) {}
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Sincronización de Play / Pausa cuando cambia el estado de reproducción
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

  // Sincronización solo cuando el usuario hace un salto / seek manual grande (>2 segundos)
  useEffect(() => {
    if (!config.enabled || config.mode === 'off' || !config.videoId || currentTime === undefined) return;

    const delta = Math.abs(currentTime - prevTimeRef.current);
    const now = Date.now();

    // Solo si hubo un salto manual real (> 2s) y con debounce de 600ms para no saturar postMessages
    if (delta > 2.0 && now - lastSeekTimeRef.current > 600) {
      lastSeekTimeRef.current = now;
      prevTimeRef.current = currentTime;
      try {
        const win = iframeRef.current?.contentWindow;
        if (win) {
          const safeTime = getSyncedPosition(currentTime);
          win.postMessage(
            JSON.stringify({
              event: 'command',
              func: 'seekTo',
              args: [safeTime, true],
            }),
            '*'
          );
        }
      } catch (_) {}
    } else {
      prevTimeRef.current = currentTime;
    }
  }, [currentTime, config.enabled, config.mode, config.videoId]);

  // Auto-resync y reanudación del video de fondo al volver de otra pestaña o app en iPad / Safari
  useEffect(() => {
    if (!config.enabled || config.mode === 'off' || !config.videoId) return;

    const handleWakeSync = () => {
      if (document.visibilityState === 'visible' && isPlaying) {
        try {
          const win = iframeRef.current?.contentWindow;
          if (win) {
            win.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: '' }), '*');
            win.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [0] }), '*');
            if (currentTime !== undefined && currentTime > 0) {
              const safeTime = getSyncedPosition(currentTime);
              win.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [safeTime, true] }), '*');
            }
            win.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: '' }), '*');
          }
        } catch (_) {}
      }
    };

    document.addEventListener('visibilitychange', handleWakeSync);
    window.addEventListener('focus', handleWakeSync);
    window.addEventListener('pageshow', handleWakeSync);

    return () => {
      document.removeEventListener('visibilitychange', handleWakeSync);
      window.removeEventListener('focus', handleWakeSync);
      window.removeEventListener('pageshow', handleWakeSync);
    };
  }, [isPlaying, currentTime, config.enabled, config.mode, config.videoId]);

  const hasValidSong = Boolean(
    songKey &&
    songKey.trim() !== '' &&
    !songKey.startsWith('___') &&
    !songKey.startsWith('—') &&
    !songKey.includes('— Selecciona una canción —')
  );

  // Mantener componente montado solo si hay una canción válida y video configurado
  if (!config.enabled || config.mode === 'off' || !config.videoId || !hasValidSong) {
    return null;
  }

  // Capa oscura de contraste cinemático (77% - 96%)
  const overlayOpacity = Math.max(0.77, Math.min(0.96, config.overlayOpacity ?? 0.77));

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 w-full h-full overflow-hidden pointer-events-none select-none z-0 bg-[#04060c] ${className}`}
    >
      {/* Cortina Negra Anti-Bleed: Se activa al 100% de inmediato al cambiar de canción */}
      <div
        className={`absolute inset-0 bg-[#04060c] transition-opacity duration-1000 z-10 ${
          isVideoVisible ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      />

      {/* Frame 16:9 con escala 1.35x para recortar barras, logos y controles de YouTube */}
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
            transform: 'scale(1.45)',
            transformOrigin: 'center center',
            pointerEvents: 'none',
          }}
          onLoad={() => {
            try {
              const win = iframeRef.current?.contentWindow;
              if (win) {
                const disableCaptions = () => {
                  try {
                    win.postMessage(JSON.stringify({ event: 'command', func: 'unloadModule', args: ['captions'] }), '*');
                    win.postMessage(JSON.stringify({ event: 'command', func: 'setOption', args: ['captions', 'track', {}] }), '*');
                    win.postMessage(JSON.stringify({ event: 'command', func: 'setOption', args: ['captions', 'fontSize', -3] }), '*');
                    win.postMessage(JSON.stringify({ event: 'command', func: 'setOption', args: ['cc', 'track', {}] }), '*');
                  } catch (_) {}
                };

                win.postMessage(JSON.stringify({ event: 'listening', id: config.videoId }), '*');
                win.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: '' }), '*');
                win.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [0] }), '*');
                disableCaptions();

                // Reintentos automáticos para atrapar el módulo de captions en cuanto YouTube lo inicialice
                setTimeout(disableCaptions, 400);
                setTimeout(disableCaptions, 1200);
                setTimeout(disableCaptions, 2500);
                
                // Si la pantalla se abre a mitad de canción (ej. a los 40s), sincroniza inmediatamente
                if (isPlaying && currentTime && currentTime > 2) {
                  const safeStart = getSyncedPosition(currentTime);
                  win.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [safeStart, true] }), '*');
                  win.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: '' }), '*');
                } else if (isPlaying) {
                  win.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [0, true] }), '*');
                  win.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: '' }), '*');
                } else {
                  win.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' }), '*');
                }
              }
            } catch (_) {}
          }}
        />

        {/* Escudo protector invisible contra toques de iPadOS (evita que aparezcan los botones gigantes centrales de Apple) */}
        <div className="absolute inset-0 pointer-events-auto z-10 select-none" style={{ touchAction: 'none' }} />
      </div>

      {/* Capa de contraste oscuro */}
      <div
        className="absolute inset-0 transition-opacity duration-300 pointer-events-none"
        style={{
          backgroundColor: `rgba(4, 6, 12, ${overlayOpacity})`,
          transform: 'translateZ(0)',
        }}
      />

      {/* Halo de lectura central */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(4, 6, 12, 0.20) 0%, rgba(4, 6, 12, 0.05) 70%, transparent 100%)',
        }}
      />

      {/* Viñeta sutil */}
      <div className="absolute inset-0 bg-radial-gradient from-transparent via-transparent to-slate-950/90 pointer-events-none" />
    </div>
  );
};
