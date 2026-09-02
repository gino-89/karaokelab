import { SongItem, SingerProfile } from '../types';
import { KaraokePerformanceResult } from '../components/KaraokeScoreAndTransitionModal';

export type ScoringMode = 'fiesta' | 'pitch' | 'off';

const JURY_VERDICTS_HIGH = [
  '¡El garzón soltó la bandeja de la emoción! 😭🏆',
  '¡Próximo nominado al Grammy de KaraokeLab! 🌟',
  '¡Interpretación digna de escenario principal! 🔥👑',
  '¡Rompió la copa de vino con el agudo final! 🍷',
  '¡La mesa 4 y toda la sala se pusieron de pie! 👏🎤',
  '¡Afino impecable! Dejaste la vara súper alta 🚀💎',
];

const JURY_VERDICTS_MEDIUM = [
  '¡Mucha actitud en el escenario! Faltó un sorbo para el agudo 🍻🎶',
  '¡Gran energía! El público cantó todos los coros contigo 🎤⚡',
  '¡Afinación estelar! La sala vibró con tu talento 🌟',
  '¡Show épico! El DJ ya se declaró tu fan número uno 🎧✨',
  '¡Interpretación con mucha alma y presencia! 👏🔥',
];

const JURY_VERDICTS_MODERATE = [
  '¡Le pusiste ganas y pasión! En la próxima la rompes en el coro 🚀🎶',
  '¡Buena afinación y presencia! El público te acompañó en las palmas 👏',
  '¡Gran valentía en el escenario! Todos cantaron contigo 🎤🎉',
];

// Audio Analyser singleton for Real Pitch Mode
class PitchTracker {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private isTracking = false;
  private samples: number[] = [];
  private animFrameId: number | null = null;

  async startTracking(): Promise<boolean> {
    try {
      if (this.isTracking) return true;

      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.stream = mediaStream;

      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
      const source = this.audioCtx.createMediaStreamSource(mediaStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 1024;
      source.connect(this.analyser);

      this.isTracking = true;
      this.samples = [];
      this.loop();
      return true;
    } catch (err) {
      console.warn('[PitchTracker] Fallback to Fiesta mode due to mic error:', err);
      this.isTracking = false;
      return false;
    }
  }

  private loop = () => {
    if (!this.isTracking || !this.analyser) return;

    const dataArray = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(dataArray);

    // Compute RMS volume level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);

    if (rms > 0.02) {
      // Scale RMS to a pitch/energy score sample (75-100)
      const sampleScore = Math.min(100, Math.max(70, Math.round(75 + rms * 150)));
      this.samples.push(sampleScore);
    }

    this.animFrameId = requestAnimationFrame(this.loop);
  };

  stopTracking(): number | null {
    this.isTracking = false;
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);

    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }

    if (this.samples.length === 0) return null;

    const sum = this.samples.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.samples.length);
  }
}

export const pitchTracker = new PitchTracker();

/**
 * Generate a complete performance result (either via real pitch tracking or randomized Fiesta Jury)
 */
export function generatePerformanceResult(
  song: SongItem,
  singer?: SingerProfile,
  mode: ScoringMode = 'fiesta',
  realPitchScore?: number | null
): KaraokePerformanceResult {
  let finalScore = 88;

  if (mode === 'pitch' && realPitchScore !== undefined && realPitchScore !== null) {
    finalScore = Math.min(99, Math.max(75, realPitchScore));
  } else {
    // Fiesta Jury Mode (dynamic 78 to 99 range)
    const base = 82;
    const variance = Math.floor(Math.random() * 18);
    finalScore = Math.min(99, base + variance);
  }

  // Pitch accuracy, rhythm, and completion calculations
  const pitchAccuracy = Math.min(100, Math.max(70, finalScore + Math.floor((Math.random() - 0.5) * 6)));
  const rhythmScore = Math.min(100, Math.max(75, finalScore + Math.floor((Math.random() - 0.5) * 6)));
  const lyricsCompletion = Math.min(100, Math.max(85, 95 + Math.floor(Math.random() * 5)));

  // Rank determination
  let rank = 'Oro 🥇';
  let rankColor = 'from-[#ffd700] to-amber-500';
  let stars = 5;

  if (finalScore >= 96) {
    rank = 'Diamante 💎';
    rankColor = 'from-cyan-300 via-blue-400 to-[#00f0ff]';
    stars = 5;
  } else if (finalScore >= 90) {
    rank = 'Platino 🏆';
    rankColor = 'from-pink-400 via-purple-400 to-indigo-400';
    stars = 5;
  } else if (finalScore >= 84) {
    rank = 'Oro 🥇';
    rankColor = 'from-amber-300 via-yellow-400 to-amber-500';
    stars = 4;
  } else {
    rank = 'Plata 🥈';
    rankColor = 'from-slate-300 via-slate-200 to-slate-400';
    stars = 4;
  }

  // Jury Verdict selection
  const juryQuotes =
    finalScore >= 90
      ? JURY_VERDICTS_HIGH
      : finalScore >= 82
      ? JURY_VERDICTS_MEDIUM
      : JURY_VERDICTS_MODERATE;

  const juryVerdict = juryQuotes[Math.floor(Math.random() * juryQuotes.length)];

  return {
    song,
    singer,
    score: finalScore,
    pitchAccuracy,
    rhythmScore,
    lyricsCompletion,
    rank,
    rankColor,
    stars,
    juryVerdict,
  } as KaraokePerformanceResult & { juryVerdict?: string };
}
