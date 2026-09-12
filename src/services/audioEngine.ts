/**
 * CyberKaraoke Web Audio Engine
 * Pure SoundTouch WSOLA Studio Engine:
 * - 100% Constant Tempo (Tempo = 1.0, zero acceleration or slowdown)
 * - Seamless Live Pitch Transposition (pitch changes on-the-fly without stopping or jumping)
 * - Rock-Solid Monotonic Timeline Clock (0 jumps, 0 glitches on pause/resume)
 */

import { PitchShifter } from 'soundtouchjs';
import { VocalAutomationConfig } from '../types';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private instrumentalBuffer: AudioBuffer | null = null;
  private vocalsBuffer: AudioBuffer | null = null;

  // SoundTouch PitchShifters
  private instrumentalPitchShifter: PitchShifter | null = null;
  private vocalPitchShifter: PitchShifter | null = null;
  private singlePitchShifter: PitchShifter | null = null;

  // Nodes for Mixing & Gain Control
  private vocalGainNode: GainNode | null = null;
  private musicGainNode: GainNode | null = null;
  private masterGainNode: GainNode | null = null;
  public analyserNode: AnalyserNode | null = null;
  public mediaStreamDest: MediaStreamAudioDestinationNode | null = null;

  // Microphone Nodes
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micGainNode: GainNode | null = null;

  // Playback State & Monotonic Hardware Clock
  private startTime = 0;
  private pauseOffset = 0;
  private isPlaying = false;
  private pitchShiftSemitones = 0;
  private isLooping = false;
  private loopStart = 0;
  private loopEnd = 0;

  // Volume gains
  private vocalGain = 1.0;
  private targetVocalGain = 1.0;
  private musicGain = 1.0;
  private masterGain = 1.0;
  private micGain = 1.0;
  private onTrackEndCallbacks: Set<() => void> = new Set();

  // Continuous background audio keep-alive (hardware audio pipeline anchor for iOS/iPadOS Safari)
  private keepAliveAudio: HTMLAudioElement | null = null;
  private silentWavUrl: string | null = null;

  /**
   * Generates a valid 2-second 22050Hz 16-bit mono PCM silent WAV Blob URL.
   * This is 100% inaudible (pure zeros), but provides a valid audio stream that prevents
   * iOS / iPadOS WebKit power watchdogs from aborting or suspending background audio.
   */
  private getSilentWavUrl(): string {
    if (this.silentWavUrl) return this.silentWavUrl;
    try {
      const sampleRate = 22050;
      const numSamples = sampleRate * 2; // 2 seconds
      const dataSize = numSamples * 2; // 16-bit mono = 2 bytes per sample
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);

      // 'RIFF' chunk descriptor
      view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46);
      view.setUint32(4, 36 + dataSize, true);
      // 'WAVE' format
      view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45);
      // 'fmt ' subchunk
      view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20);
      view.setUint32(16, 16, true); // Subchunk1Size
      view.setUint16(20, 1, true);  // AudioFormat (1 = PCM)
      view.setUint16(22, 1, true);  // NumChannels (1 = Mono)
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true); // ByteRate
      view.setUint16(32, 2, true);  // BlockAlign
      view.setUint16(34, 16, true); // BitsPerSample
      // 'data' subchunk
      view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61);
      view.setUint32(40, dataSize, true);
      // Bytes 44+ are automatically 0s (pure silence)

      const blob = new Blob([view], { type: 'audio/wav' });
      this.silentWavUrl = URL.createObjectURL(blob);
      return this.silentWavUrl;
    } catch (_) {
      return '';
    }
  }

  private initKeepAliveAudio(): HTMLAudioElement | null {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    try {
      if (!this.keepAliveAudio) {
        let el = document.getElementById('karaokelab-ios-audio-anchor') as HTMLAudioElement | null;
        if (!el) {
          el = document.createElement('audio');
          el.id = 'karaokelab-ios-audio-anchor';
          el.setAttribute('playsinline', 'true');
          el.setAttribute('webkit-playsinline', 'true');
          el.setAttribute('x-webkit-airplay', 'allow');
          el.style.position = 'fixed';
          el.style.left = '-9999px';
          el.style.top = '-9999px';
          el.style.width = '1px';
          el.style.height = '1px';
          el.style.opacity = '0.01';
          el.style.pointerEvents = 'none';
          document.body.appendChild(el);
        }
        el.loop = true;
        el.preload = 'auto';
        // Non-zero volume prevents iOS WebKit power daemon from flagging the element as muted,
        // while the PCM data itself is 100% digital silence (amplitude 0).
        el.volume = 1.0;
        const wavUrl = this.getSilentWavUrl();
        if (wavUrl && el.src !== wavUrl) {
          el.src = wavUrl;
        }
        this.keepAliveAudio = el;
      }
      return this.keepAliveAudio;
    } catch (_) {
      return null;
    }
  }

  /**
   * Pre-unlocks audio playback directly in response to a user interaction (touch/click).
   * Guarantees iOS / iPadOS Safari marks both the AudioContext and media element as user-activated.
   */
  public unlockAudioForIOS() {
    if (typeof window === 'undefined') return;
    try {
      const ctx = this.getAudioContext();
      if (ctx.state === 'suspended' || (ctx.state as any) === 'interrupted') {
        ctx.resume().catch(() => {});
      }
      const audio = this.initKeepAliveAudio();
      if (audio && audio.paused && !this.isPlaying) {
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.then === 'function') {
          playPromise
            .then(() => {
              if (!this.isPlaying && this.keepAliveAudio) {
                this.keepAliveAudio.pause();
              }
            })
            .catch(() => {});
        }
      }
    } catch (_) {}
  }

  private startKeepAlive() {
    if (typeof window === 'undefined') return;
    try {
      const audio = this.initKeepAliveAudio();
      if (audio) {
        audio.play().catch(() => {});
      }
    } catch (_) {}
  }

  private stopKeepAlive() {
    if (this.keepAliveAudio) {
      try {
        this.keepAliveAudio.pause();
      } catch (_) {}
    }
  }

  public onTrackEnded(callback: () => void): () => void {
    this.onTrackEndCallbacks.add(callback);
    return () => {
      this.onTrackEndCallbacks.delete(callback);
    };
  }

  private notifyTrackEnded() {
    this.onTrackEndCallbacks.forEach((cb) => {
      try {
        cb();
      } catch (e) {
        console.error('Track end callback error:', e);
      }
    });
  }

  constructor() {}

  public getAudioContext(): AudioContext {
    if (!this.ctx) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      try {
        this.ctx = new AudioContextClass({ latencyHint: 'interactive' });
      } catch (_) {
        this.ctx = new AudioContextClass();
      }
      this.ctx.onstatechange = () => {
        if (this.isPlaying && (this.ctx?.state === 'suspended' || (this.ctx?.state as any) === 'interrupted')) {
          this.ctx.resume().catch(() => {});
        }
      };
      this.initNodes();
    }
    return this.ctx;
  }

  public setLatencyMode(mode: 'interactive' | 'balanced' | 'playback') {
    try {
      if (this.ctx) {
        const currentIsPlaying = this.isPlaying;
        const pos = this.getCurrentTime();
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        
        const currentAudioBuf = this.audioBuffer;
        const currentInstBuf = this.instrumentalBuffer;
        const currentVocBuf = this.vocalsBuffer;

        this.ctx.close().catch(() => {});
        this.ctx = new AudioContextClass({ latencyHint: mode });
        this.ctx.onstatechange = () => {
          if (this.isPlaying && (this.ctx?.state === 'suspended' || (this.ctx?.state as any) === 'interrupted')) {
            this.ctx.resume().catch(() => {});
          }
        };
        this.initNodes();

        if (currentInstBuf && currentVocBuf) {
          this.setStemBuffers(currentInstBuf, currentVocBuf);
        } else if (currentAudioBuf) {
          this.setAudioBuffer(currentAudioBuf);
        }

        if (currentIsPlaying) {
          this.play(pos);
        }
      }
    } catch (e) {
      console.warn('Latency mode switch fallback:', e);
    }
  }

  public resumeContextSync() {
    try {
      if (this.ctx && (this.ctx.state === 'suspended' || (this.ctx.state as any) === 'interrupted')) {
        this.ctx.resume().catch(() => {});
      }
      if (this.isPlaying && this.keepAliveAudio && this.keepAliveAudio.paused) {
        this.keepAliveAudio.play().catch(() => {});
      }
    } catch (_) {}
  }

  private initNodes() {
    if (!this.ctx) return;
    if (!this.masterGainNode) {
      this.masterGainNode = this.ctx.createGain();
      this.masterGainNode.gain.setValueAtTime(this.masterGain, this.ctx.currentTime);
      this.masterGainNode.connect(this.ctx.destination);
    }
    if (!this.analyserNode) {
      this.analyserNode = this.ctx.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.82;
      this.masterGainNode.connect(this.analyserNode);
    }
    if (!this.mediaStreamDest) {
      try {
        this.mediaStreamDest = this.ctx.createMediaStreamDestination();
        this.masterGainNode.connect(this.mediaStreamDest);
      } catch (e) {
        console.warn('createMediaStreamDestination fallback:', e);
      }
    }
    if (!this.vocalGainNode) {
      this.vocalGainNode = this.ctx.createGain();
      this.vocalGainNode.gain.setValueAtTime(this.vocalGain, this.ctx.currentTime);
      this.vocalGainNode.connect(this.masterGainNode);
    }
    if (!this.musicGainNode) {
      this.musicGainNode = this.ctx.createGain();
      this.musicGainNode.gain.setValueAtTime(this.musicGain, this.ctx.currentTime);
      this.musicGainNode.connect(this.masterGainNode);
    }
  }

  public getMediaStreamDestination(): MediaStreamAudioDestinationNode {
    this.getAudioContext();
    this.initNodes();
    return this.mediaStreamDest!;
  }

  public async decodeAudio(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (_) {}
    }

    const bufferClone = arrayBuffer.slice(0);

    return new Promise<AudioBuffer>((resolve, reject) => {
      ctx.decodeAudioData(
        bufferClone,
        (decoded) => resolve(decoded),
        (err) => {
          console.warn('decodeAudioData error:', err);
          reject(err || new Error('Error al decodificar audio'));
        }
      ).catch?.((err: any) => reject(err));
    });
  }

  public clearBuffers() {
    this.stop();
    this.audioBuffer = null;
    this.instrumentalBuffer = null;
    this.vocalsBuffer = null;
    this.pauseOffset = 0;
  }

  public setAudioBuffer(buffer: AudioBuffer) {
    this.stop();
    this.audioBuffer = buffer;
    this.instrumentalBuffer = null;
    this.vocalsBuffer = null;
    this.pauseOffset = 0;
    this.loopEnd = buffer.duration;
  }

  public setStemBuffers(instrumental: AudioBuffer | null, vocals: AudioBuffer | null) {
    this.stop();
    this.instrumentalBuffer = instrumental;
    this.vocalsBuffer = vocals;
    if (instrumental) {
      this.audioBuffer = instrumental;
      this.loopEnd = instrumental.duration;
    } else if (vocals) {
      this.audioBuffer = vocals;
      this.loopEnd = vocals.duration;
    }
    this.pauseOffset = 0;
  }

  public getAudioBuffer(): AudioBuffer | null {
    return this.audioBuffer;
  }

  public getInstrumentalBuffer(): AudioBuffer | null {
    return this.instrumentalBuffer;
  }

  public getVocalsBuffer(): AudioBuffer | null {
    return this.vocalsBuffer;
  }

  /**
   * Monotonic high-resolution timeline tracking. Never jumps, never returns stale 0s.
   */
  public getCurrentTime(): number {
    if (!this.isPlaying || !this.ctx) {
      return this.pauseOffset;
    }
    const elapsed = this.ctx.currentTime - this.startTime;
    const dur = this.getDuration();
    return Math.max(0, Math.min(dur, this.pauseOffset + elapsed));
  }

  public getDuration(): number {
    if (this.instrumentalBuffer) return this.instrumentalBuffer.duration;
    return this.audioBuffer ? this.audioBuffer.duration : 0;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  private setupGraph() {
    this.getAudioContext();
    this.initNodes();
  }

  /**
   * Starts playback with SoundTouch WSOLA (Constant 1.0 tempo).
   */
  public async play(offsetSeconds?: number) {
    const dur = this.getDuration();
    if (dur <= 0) return;
    const ctx = this.getAudioContext();

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (_) {}
    }

    if (this.isPlaying) {
      this.stopSource();
    }

    this.setupGraph();

    if (offsetSeconds !== undefined) {
      this.pauseOffset = Math.max(0, Math.min(offsetSeconds, dur));
    }

    const startPos = this.pauseOffset;
    this.startTime = ctx.currentTime;

    // ── Mode A: Dual-Stem Synchronized Playback ──
    if (this.instrumentalBuffer) {
      this.instrumentalPitchShifter = new PitchShifter(
        ctx,
        this.instrumentalBuffer,
        4096,
        () => {
          if (this.isPlaying && this.getCurrentTime() >= dur - 0.5) {
            if (this.isLooping) {
              this.play(this.loopStart);
            } else {
              this.isPlaying = false;
              this.pauseOffset = 0;
              this.notifyTrackEnded();
            }
          }
        }
      );
      this.instrumentalPitchShifter.tempo = 1.0;
      this.instrumentalPitchShifter.pitchSemitones = this.pitchShiftSemitones;
      this.instrumentalPitchShifter.connect(this.musicGainNode!);

      if (this.vocalsBuffer) {
        this.vocalPitchShifter = new PitchShifter(
          ctx,
          this.vocalsBuffer,
          4096
        );
        this.vocalPitchShifter.tempo = 1.0;
        this.vocalPitchShifter.pitchSemitones = this.pitchShiftSemitones;
        this.vocalPitchShifter.connect(this.vocalGainNode!);
      }

      if (startPos > 0 && dur > 0) {
        const ratio = Math.max(0, Math.min(0.999, startPos / dur));
        this.instrumentalPitchShifter.percentagePlayed = ratio;
        if (this.vocalPitchShifter) {
          this.vocalPitchShifter.percentagePlayed = ratio;
        }
      }

      this.isPlaying = true;
      this.startKeepAlive();
      return;
    }

    // ── Mode B: Single Audio Buffer Fallback ──
    if (this.audioBuffer) {
      this.singlePitchShifter = new PitchShifter(
        ctx,
        this.audioBuffer,
        4096,
        () => {
          if (this.isPlaying && this.getCurrentTime() >= dur - 0.5) {
            if (this.isLooping) {
              this.play(this.loopStart);
            } else {
              this.isPlaying = false;
              this.pauseOffset = 0;
              this.notifyTrackEnded();
            }
          }
        }
      );
      this.singlePitchShifter.tempo = 1.0;
      this.singlePitchShifter.pitchSemitones = this.pitchShiftSemitones;
      this.singlePitchShifter.connect(this.musicGainNode!);

      if (startPos > 0 && dur > 0) {
        const ratio = Math.max(0, Math.min(0.999, startPos / dur));
        this.singlePitchShifter.percentagePlayed = ratio;
      }

      this.isPlaying = true;
      this.startKeepAlive();
    }
  }

  public pause() {
    if (!this.isPlaying) return;
    this.pauseOffset = this.getCurrentTime();
    this.stopSource();
    this.isPlaying = false;
    this.stopKeepAlive();
  }

  public stop() {
    this.stopSource();
    this.audioBuffer = null;
    this.vocalsBuffer = null;
    this.instrumentalBuffer = null;
    this.pauseOffset = 0;
    this.isPlaying = false;
    this.stopKeepAlive();
  }

  private stopSource() {
    if (this.instrumentalPitchShifter) {
      try {
        this.instrumentalPitchShifter.disconnect();
      } catch (_) {}
      this.instrumentalPitchShifter = null;
    }
    if (this.vocalPitchShifter) {
      try {
        this.vocalPitchShifter.disconnect();
      } catch (_) {}
      this.vocalPitchShifter = null;
    }
    if (this.singlePitchShifter) {
      try {
        this.singlePitchShifter.disconnect();
      } catch (_) {}
      this.singlePitchShifter = null;
    }
  }

  public seek(seconds: number) {
    const dur = this.getDuration();
    const target = Math.max(0, Math.min(seconds, dur));
    this.pauseOffset = target;
    if (this.ctx) {
      this.startTime = this.ctx.currentTime;
    }
    if (this.isPlaying) {
      this.stopSource();
      this.play(target);
    }
  }

  /**
   * Updates pitch shift instantly ON THE FLY without restarting or jumping.
   */
  public setPitchShift(semitones: number) {
    this.pitchShiftSemitones = semitones;
    if (this.instrumentalPitchShifter) {
      this.instrumentalPitchShifter.tempo = 1.0;
      this.instrumentalPitchShifter.pitchSemitones = semitones;
    }
    if (this.vocalPitchShifter) {
      this.vocalPitchShifter.tempo = 1.0;
      this.vocalPitchShifter.pitchSemitones = semitones;
    }
    if (this.singlePitchShifter) {
      this.singlePitchShifter.tempo = 1.0;
      this.singlePitchShifter.pitchSemitones = semitones;
    }
  }

  public setVocalGain(val: number, rampTime = 0.03) {
    const clamped = Math.max(0, Math.min(val, 2.5));
    this.targetVocalGain = clamped;
    this.vocalGain = clamped;

    if (this.vocalGainNode && this.ctx) {
      const now = this.ctx.currentTime;
      try {
        this.vocalGainNode.gain.cancelScheduledValues(now);
        this.vocalGainNode.gain.setValueAtTime(this.vocalGainNode.gain.value, now);
        this.vocalGainNode.gain.linearRampToValueAtTime(clamped, now + rampTime);
      } catch (_) {
        this.vocalGainNode.gain.setValueAtTime(clamped, now);
      }
    }
  }

  private vocalAutomationConfig: VocalAutomationConfig | null = null;

  public setVocalAutomationConfig(config: VocalAutomationConfig | null) {
    this.vocalAutomationConfig = config;
  }

  public getVocalAutomationConfig(): VocalAutomationConfig | null {
    return this.vocalAutomationConfig;
  }

  /**
   * Evaluates the automated target vocal gain for a timestamp in seconds
   * using continuous point-to-point node automation curve with linear interpolation.
   * Returns null if automation is not enabled or has no points.
   */
  public getAutomatedVocalGainAtTime(time: number): number | null {
    if (!this.vocalAutomationConfig || !this.vocalAutomationConfig.enabled) {
      return null;
    }

    const { points } = this.vocalAutomationConfig;
    if (!points || points.length === 0) {
      return null;
    }

    if (points.length === 1) {
      return points[0].gain;
    }

    // Points sorted chronologically
    const sorted = [...points].sort((a, b) => a.time - b.time);

    let rawGain = sorted[sorted.length - 1].gain;

    // Before first point
    if (time <= sorted[0].time) {
      rawGain = sorted[0].gain;
    } else if (time >= sorted[sorted.length - 1].time) {
      // After last point
      rawGain = sorted[sorted.length - 1].gain;
    } else {
      // Interpolate between point i and point i+1
      for (let i = 0; i < sorted.length - 1; i++) {
        const p1 = sorted[i];
        const p2 = sorted[i + 1];
        if (time >= p1.time && time <= p2.time) {
          const timeDiff = p2.time - p1.time;
          if (timeDiff <= 0.001) {
            rawGain = p2.gain;
          } else {
            const progress = (time - p1.time) / timeDiff;
            rawGain = p1.gain + (p2.gain - p1.gain) * progress;
          }
          break;
        }
      }
    }

    // If Background Vocal is enabled, enforce minimum background floor without modifying curve points
    if (this.vocalAutomationConfig.backgroundVocalEnabled) {
      const bgGain = this.vocalAutomationConfig.backgroundVocalGain ?? 0.20;
      return Math.max(bgGain, rawGain);
    }

    return rawGain;
  }

  public getVocalGain(): number {
    return this.vocalGain;
  }

  public setMusicGain(val: number) {
    this.musicGain = Math.max(0, Math.min(val, 2.5));
    if (this.musicGainNode && this.ctx) {
      this.musicGainNode.gain.setValueAtTime(this.musicGain, this.ctx.currentTime);
    }
  }

  public getMusicGain(): number {
    return this.musicGain;
  }

  public setMasterGain(val: number) {
    this.masterGain = Math.max(0, Math.min(val, 2.5));
    if (this.masterGainNode && this.ctx) {
      this.masterGainNode.gain.setValueAtTime(this.masterGain, this.ctx.currentTime);
    }
  }

  public setLoop(looping: boolean, start = 0, end?: number) {
      this.isLooping = looping;
    this.loopStart = start;
    this.loopEnd = end || this.getDuration();
  }

  public generateSyntheticToneBuffer(durationSec = 180, bpm = 120): AudioBuffer {
    const ctx = this.getAudioContext();
    const sampleRate = ctx.sampleRate || 44100;
    const duration = Math.max(10, durationSec);
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(2, numSamples, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    const beatSec = 60 / Math.max(60, bpm);
    const totalBeats = Math.floor(duration / beatSec);

    for (let beat = 0; beat < totalBeats; beat++) {
      const beatStartTime = beat * beatSec;
      const startSample = Math.floor(beatStartTime * sampleRate);
      const beatSamples = Math.floor(beatSec * sampleRate);
      const freq = beat % 4 === 0 ? 220 : 440;

      for (let s = 0; s < beatSamples; s++) {
        const sampleIdx = startSample + s;
        if (sampleIdx >= numSamples) break;
        const t = s / sampleRate;
        const env = Math.exp(-t * 8);
        const val = Math.sin(2 * Math.PI * freq * t) * env * 0.2;
        left[sampleIdx] = val;
        right[sampleIdx] = val;
      }
    }
    return buffer;
  }

  public async enableMicrophone(enable: boolean): Promise<boolean> {
    const ctx = this.getAudioContext();
    this.initNodes();
    if (enable) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        this.micSource = ctx.createMediaStreamSource(this.micStream);
        this.micGainNode = ctx.createGain();
        this.micGainNode.gain.setValueAtTime(this.micGain, ctx.currentTime);

        this.micSource.connect(this.micGainNode);
        if (this.masterGainNode) {
          this.micGainNode.connect(this.masterGainNode);
        }
        return true;
      } catch (err) {
        console.warn('Mic access denied or error:', err);
        return false;
      }
    } else {
      if (this.micStream) {
        this.micStream.getTracks().forEach((t) => t.stop());
        this.micStream = null;
      }
      if (this.micSource) {
        this.micSource.disconnect();
        this.micSource = null;
      }
      return false;
    }
  }

  public setMicGain(val: number) {
    this.micGain = val;
    if (this.micGainNode && this.ctx) {
      this.micGainNode.gain.setValueAtTime(val, this.ctx.currentTime);
    }
  }

  public getMicGainNode(): GainNode | null {
    return this.micGainNode;
  }
}

export const audioEngine = new AudioEngine();

export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM 16-bit
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const numSamples = buffer.length;
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      let sample = channels[channel][i];
      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([view], { type: 'audio/wav' });
}
