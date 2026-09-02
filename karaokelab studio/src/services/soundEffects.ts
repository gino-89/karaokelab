/**
 * Realistic Live Concert Stadium Crowd Engine (Applause, Cheering Screams, Whistles & Fanfares)
 * Generates an authentic concert ovation atmosphere using Web Audio API.
 */

export class SoundEffectsEngine {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext {
    if (!this.ctx) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioContextClass();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Play dynamic, realistic Live Stadium Concert Ovation (Claps + Screaming "WOOO!" + Whistles)
   */
  public playApplause(score = 92) {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      const duration = 5.2;

      // Master output with stereo panning & compression feel
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.01, now);
      masterGain.gain.linearRampToValueAtTime(0.85, now + 0.18); // Explosive crowd burst
      masterGain.gain.setValueAtTime(0.85, now + 3.2);
      masterGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      masterGain.connect(ctx.destination);

      // ── 1. STADIUM CROWD CHEER & SCREAM ROAR ("WOOOOO!", "YEAAAH!") ──
      // Multi-layer stereo pink noise with sweeping vocal formant resonance
      const cheerBuffer = ctx.createBuffer(2, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = cheerBuffer.getChannelData(ch);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < data.length; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
          b6 = white * 0.115926;
        }
      }

      const cheerSource = ctx.createBufferSource();
      cheerSource.buffer = cheerBuffer;

      // Formant filters for collective human voice cheer
      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.frequency.setValueAtTime(750, now);
      f1.frequency.exponentialRampToValueAtTime(1100, now + 1.2);
      f1.frequency.exponentialRampToValueAtTime(800, now + 3.5);
      f1.Q.value = 3.2;

      const f2 = ctx.createBiquadFilter();
      f2.type = 'peaking';
      f2.frequency.setValueAtTime(1800, now);
      f2.gain.value = 8.0;
      f2.Q.value = 2.5;

      const f3 = ctx.createBiquadFilter();
      f3.type = 'lowpass';
      f3.frequency.setValueAtTime(4200, now);

      cheerSource.connect(f1);
      f1.connect(f2);
      f2.connect(f3);
      f3.connect(masterGain);

      cheerSource.start(now);
      cheerSource.stop(now + duration);

      // ── 2. MULTIPLE LIVE WHISTLES FROM THE CROWD ──
      const whistleCount = 3 + Math.floor((score / 100) * 3); // 3 to 6 crowd whistles
      for (let w = 0; w < whistleCount; w++) {
        const wStart = now + 0.2 + w * 0.5 + Math.random() * 0.4;
        const wDuration = 0.7 + Math.random() * 0.6;
        const baseFreq = 2400 + Math.random() * 900; // 2.4kHz - 3.3kHz

        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

        osc.type = 'sine';
        // Pitch upward swoop with vibrato
        osc.frequency.setValueAtTime(baseFreq * 0.8, wStart);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.35, wStart + 0.18);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.05, wStart + wDuration);

        oscGain.gain.setValueAtTime(0.001, wStart);
        oscGain.gain.linearRampToValueAtTime(0.12, wStart + 0.08);
        oscGain.gain.exponentialRampToValueAtTime(0.001, wStart + wDuration);

        if (panner) {
          panner.pan.value = (Math.random() * 2 - 1) * 0.8;
          osc.connect(oscGain);
          oscGain.connect(panner);
          panner.connect(masterGain);
        } else {
          osc.connect(oscGain);
          oscGain.connect(masterGain);
        }

        osc.start(wStart);
        osc.stop(wStart + wDuration);
      }

      // ── 3. MASSIVE HIGH-DENSITY CLAPPING APPLAUSE ──
      const clapCount = 120 + Math.floor((score / 100) * 80); // 120 to 200 claps
      for (let c = 0; c < clapCount; c++) {
        const clapTime = now + Math.pow(Math.random(), 0.85) * (duration - 0.7);
        const clapLen = 0.025 + Math.random() * 0.03;

        const clapBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * clapLen), ctx.sampleRate);
        const clapData = clapBuf.getChannelData(0);
        const decayRate = 80 + Math.random() * 60;
        for (let i = 0; i < clapData.length; i++) {
          const env = Math.exp((-i / ctx.sampleRate) * decayRate);
          clapData[i] = (Math.random() * 2 - 1) * env;
        }

        const clapSrc = ctx.createBufferSource();
        clapSrc.buffer = clapBuf;

        const clapFilt = ctx.createBiquadFilter();
        clapFilt.type = 'bandpass';
        clapFilt.frequency.value = 1200 + Math.random() * 1600; // 1.2kHz - 2.8kHz
        clapFilt.Q.value = 2.8 + Math.random() * 2.0;

        const clapGain = ctx.createGain();
        clapGain.gain.setValueAtTime(0.18 + Math.random() * 0.28, clapTime);

        clapSrc.connect(clapFilt);
        clapFilt.connect(clapGain);
        clapGain.connect(masterGain);

        clapSrc.start(clapTime);
      }

      // ── 4. EXCITED VOCAL CROWD SHOUTS ("YEEAH!", "WOOO!") ──
      const shoutPitches = [340, 420, 520, 640];
      shoutPitches.forEach((pitch, sIdx) => {
        const sTime = now + 0.12 + sIdx * 0.45;
        const sDur = 0.9;
        const shoutOsc = ctx.createOscillator();
        const shoutGain = ctx.createGain();

        shoutOsc.type = 'sawtooth';
        shoutOsc.frequency.setValueAtTime(pitch, sTime);
        shoutOsc.frequency.exponentialRampToValueAtTime(pitch * 1.25, sTime + 0.25);
        shoutOsc.frequency.exponentialRampToValueAtTime(pitch * 0.9, sTime + sDur);

        // Human vocal tract formant filter
        const vocalFormant = ctx.createBiquadFilter();
        vocalFormant.type = 'bandpass';
        vocalFormant.frequency.value = 950 + sIdx * 180;
        vocalFormant.Q.value = 4.5;

        shoutGain.gain.setValueAtTime(0.001, sTime);
        shoutGain.gain.linearRampToValueAtTime(0.08, sTime + 0.1);
        shoutGain.gain.exponentialRampToValueAtTime(0.001, sTime + sDur);

        shoutOsc.connect(vocalFormant);
        vocalFormant.connect(shoutGain);
        shoutGain.connect(masterGain);

        shoutOsc.start(sTime);
        shoutOsc.stop(sTime + sDur);
      });
    } catch (err) {
      console.warn('Could not synthesize concert crowd audio:', err);
    }
  }

  /**
   * Play short countdown tick beep
   */
  public playCountdownBeep(isFinal = false) {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(isFinal ? 880 : 587.33, now); // A5 for GO, D5 for tick

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (isFinal ? 0.4 : 0.15));

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + (isFinal ? 0.45 : 0.2));
    } catch (_) {}
  }
}

export const soundEffects = new SoundEffectsEngine();
