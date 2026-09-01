// Lightweight, 100% Free, Native In-Browser Hardware Device Fingerprint Generator
// Combines WebGL GPU renderer, Canvas 2D entropy, screen metrics, and hardware concurrency

export async function getDeviceFingerprint(): Promise<string> {
  const cached = localStorage.getItem('karaokelab_device_fp_v1');
  if (cached && cached.startsWith('fp_')) {
    return cached;
  }

  const components: string[] = [];

  // 1. Screen resolution, orientation, color depth & pixel ratio
  try {
    components.push(`${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`);
    components.push(`dpr_${window.devicePixelRatio || 1}`);
  } catch (_) {}

  // 2. Hardware concurrency & device memory
  try {
    components.push(`cores_${navigator.hardwareConcurrency || 2}`);
    components.push(`mem_${(navigator as any).deviceMemory || 'na'}`);
    components.push(`platform_${navigator.platform || ''}`);
  } catch (_) {}

  // 3. Timezone offset
  try {
    components.push(`tz_${Intl.DateTimeFormat().resolvedOptions().timeZone || new Date().getTimezoneOffset()}`);
  } catch (_) {}

  // 4. WebGL GPU Vendor & Renderer
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '';
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
        components.push(`gl_${vendor}_${renderer}`);
      }
    }
  } catch (_) {}

  // 5. Canvas 2D drawing entropy
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 30;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(10, 5, 60, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('KaraokeLab⚡', 12, 8);
      components.push(`cv_${canvas.toDataURL().slice(-30)}`);
    }
  } catch (_) {}

  // 6. Fast deterministic 32-bit FNV-1a hash
  const rawString = components.join('||');
  let hash = 2166136261;
  for (let i = 0; i < rawString.length; i++) {
    hash ^= rawString.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  const hexHash = `fp_${(hash >>> 0).toString(16).padStart(8, '0')}`;
  try {
    localStorage.setItem('karaokelab_device_fp_v1', hexHash);
  } catch (_) {}

  return hexHash;
}
