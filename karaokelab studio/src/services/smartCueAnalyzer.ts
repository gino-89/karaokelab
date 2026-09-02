import { LyricLine } from '../types';

export interface SmartCueSegment {
  start: number;
  end: number;
  type: 'intro' | 'chorus' | 'outro';
  label: string;
  targetGain: number; // 0.0 to 1.0
}

/**
 * Normalizes text for phrase similarity comparison
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\[.*?\]|\(.*?\)/g, '')
    .replace(/[^\w\s]/g, '')
    .trim();
}

/**
 * Intelligent Musical Song Structure & Vocal Cue Analyzer
 * - Coros: Acompañamiento armónico en estribillos completos
 * - Entradas de versos: Guía de entonación al arrancar cada frase
 * - Salidas de versos: Remate y segunda voz al cerrar cada frase
 */
export function analyzeSmartVocalCues(lyrics: LyricLine[]): SmartCueSegment[] {
  if (!lyrics || lyrics.length === 0) return [];

  const segments: SmartCueSegment[] = [];
  const lineCount = lyrics.length;

  // 1. Frequency Analysis: identify repeated lines (Choruses / Estribillos)
  const phraseCounts = new Map<string, number>();
  for (const line of lyrics) {
    const clean = normalizeText(line.text);
    if (clean.length >= 8) {
      phraseCounts.set(clean, (phraseCounts.get(clean) || 0) + 1);
    }
  }

  const chorusKeywords = /coro|chorus|hook|estribillo|juntos|todos|\(all\)/i;

  for (let i = 0; i < lineCount; i++) {
    const line = lyrics[i];
    const dur = Math.max(1.8, line.duration || 3.5);
    const clean = normalizeText(line.text);
    const count = phraseCounts.get(clean) || 0;
    const hasChorusTag = chorusKeywords.test(line.text);
    const isChorus = hasChorusTag || count >= 2;

    // ── CASE A: COROS (Acompañamiento armónico completo en el estribillo) ──
    if (isChorus) {
      segments.push({
        start: line.time,
        end: line.time + Math.min(dur * 0.9, 5.0),
        type: 'chorus',
        label: '✨ CORO GUÍA (ACOMPAÑAMIENTO)',
        targetGain: 0.40,
      });
      continue;
    }

    // ── CASE B: ENTRADAS DE VERSOS (Arranque rápido de frase: primer 25%, ~0.8s a 1.4s) ──
    const entryDuration = Math.max(0.8, Math.min(1.4, dur * 0.25));
    segments.push({
      start: line.time,
      end: line.time + entryDuration,
      type: 'intro',
      label: '✨ ENTRADA DE VERSO',
      targetGain: 0.38,
    });

    // ── CASE C: SALIDAS DE VERSOS (Remate rápido de frase: último 20%, ~0.7s a 1.2s) ──
    if (dur >= 2.4) {
      const outroDuration = Math.max(0.7, Math.min(1.2, dur * 0.20));
      const outroStart = line.time + dur - outroDuration;

      // Asegurar que no se solape con la entrada
      if (outroStart > line.time + entryDuration + 0.3) {
        segments.push({
          start: outroStart,
          end: line.time + dur,
          type: 'outro',
          label: '✨ REMATE / SALIDA',
          targetGain: 0.32,
        });
      }
    }
  }

  // Sort segments by start time
  segments.sort((a, b) => a.start - b.start);
  return segments;
}

/**
 * Evaluates current time against pre-analyzed smart cues and returns active target gain and cue type
 */
export function getActiveSmartCue(
  currentTime: number,
  cues: SmartCueSegment[]
): { targetGain: number; cueType: 'intro' | 'chorus' | 'outro' | null; label: string | null } {
  for (const cue of cues) {
    if (currentTime >= cue.start && currentTime <= cue.end) {
      return {
        targetGain: cue.targetGain,
        cueType: cue.type,
        label: cue.label,
      };
    }
  }
  return {
    targetGain: 0.0,
    cueType: null,
    label: null,
  };
}

export interface CalculatedWordFill {
  word: string;
  fillPercentage: number; // 0 to 100
  isSung: boolean;
  isCurrent: boolean;
}

/**
 * Adaptive Musical Syllabic & Phonetic Pacing Engine
 * Analyzes word lengths, vowels, syllables, tempo (BPM), and real time-gap until the next lyric
 * to dynamically adapt the vocal sweep to match fast raps, normal rhythms, and slow held ballads.
 */
export function computeIntelligentWordFills(
  lyric: LyricLine | null,
  effectiveTime: number,
  nextLyricTime?: number,
  trackBpm?: number
): CalculatedWordFill[] {
  if (!lyric || !lyric.text) return [];

  // Case A: Explicit word-level timestamps exist
  if (lyric.words && lyric.words.length > 0) {
    return lyric.words.map((w) => {
      let fill = 0;
      if (effectiveTime >= w.end) {
        fill = 100;
      } else if (effectiveTime > w.start) {
        const dur = Math.max(0.08, w.end - w.start);
        const ratio = Math.max(0, Math.min(1, (effectiveTime - w.start) / dur));
        const smoothRatio = ratio * ratio * (3 - 2 * ratio);
        fill = smoothRatio * 100;
      }
      return {
        word: w.word,
        fillPercentage: fill,
        isSung: fill === 100,
        isCurrent: fill > 0 && fill < 100,
      };
    });
  }

  // Case B: Variable Speed & Phonetic Weight Engine
  const rawWords = lyric.text.split(/\s+/).filter(Boolean);
  if (rawWords.length === 0) return [];

  // Determine realistic active phrase duration from next line arrival
  const gapToNext = typeof nextLyricTime === 'number' && nextLyricTime > lyric.time
    ? (nextLyricTime - lyric.time)
    : (lyric.duration || 3.8);

  const baseDur = lyric.duration && lyric.duration > 0 ? lyric.duration : gapToNext;
  const lineDuration = Math.max(0.8, Math.min(baseDur, gapToNext * 0.95));

  // Count total vowels & syllables across phrase to determine singing speed
  let totalVowels = 0;
  rawWords.forEach(w => {
    const clean = w.toLowerCase().replace(/[^a-záéíóúüñ]/g, '');
    totalVowels += Math.max(1, (clean.match(/[aeiouáéíóúü]/g) || []).length);
  });

  const syllablesPerSec = totalVowels / Math.max(0.5, lineDuration);
  const isFastPace = syllablesPerSec >= 3.8;
  const isSlowPace = syllablesPerSec <= 2.0;

  // Calculate phonetic weights dynamically adapted to singing velocity
  const weights = rawWords.map((word, idx) => {
    const clean = word.toLowerCase().replace(/[^a-záéíóúüñ]/g, '');
    const vowels = Math.max(1, (clean.match(/[aeiouáéíóúü]/g) || []).length);

    let baseWeight = isFastPace
      ? vowels * 1.2 + clean.length * 0.4
      : isSlowPace
      ? vowels * 2.2 + clean.length * 0.3
      : vowels * 1.6 + clean.length * 0.35;

    // Fast unstressed pickups / prepositions / articles
    const isPickup = ['y', 'a', 'de', 'la', 'el', 'un', 'en', 'al', 'se', 'me', 'te', 'que', 'mi', 'tu', 'su', 'por', 'con', 'si', 'no', 'o', 'lo', 'le'].includes(clean);
    if (isPickup) {
      baseWeight = isFastPace ? baseWeight * 0.45 : baseWeight * 0.65;
    }

    // Final word sustain bonus (singers hold the last note of a musical phrase)
    if (idx === rawWords.length - 1) {
      baseWeight *= isSlowPace ? 1.7 : isFastPace ? 1.2 : 1.45;
    }

    return baseWeight;
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const elapsed = Math.max(0, effectiveTime - lyric.time);
  const lineProgressRatio = Math.max(0, Math.min(1, elapsed / lineDuration));

  let accumulated = 0;
  return rawWords.map((word, idx) => {
    const startRatio = accumulated / totalWeight;
    accumulated += weights[idx];
    const endRatio = accumulated / totalWeight;

    let fill = 0;
    if (lineProgressRatio >= endRatio) {
      fill = 100;
    } else if (lineProgressRatio > startRatio) {
      const normalizedRatio = (lineProgressRatio - startRatio) / (endRatio - startRatio);
      // Silky Smoothstep S-curve vocal glide: f(t) = t^2 * (3 - 2t)
      const smoothed = normalizedRatio * normalizedRatio * (3 - 2 * normalizedRatio);
      fill = Math.min(100, Math.max(0, smoothed * 100));
    }

    return {
      word,
      fillPercentage: fill,
      isSung: fill === 100,
      isCurrent: fill > 0 && fill < 100,
    };
  });
}

