/**
 * KaraokeLab Vocal Gender & Duet Classifier v2
 *
 * Architecture:
 *  1. The PYTHON backend (classify_vocal.py) is the SINGLE source of truth.
 *     It runs PYIN pitch extraction + adaptive per-song boundary + sliding-window diarization.
 *  2. This module CONSUMES the Python segments (cached after first call).
 *  3. If Python is unavailable → Artist Knowledge Base fallback.
 *  4. If artist unknown → LRC text-tag fallback → default to singer1.
 *
 * REMOVED vs v1:
 *  - YIN pitch estimator (browser-side) — inaccurate, redundant with Python
 *  - buildGlobalPitchHistogram — CPU-heavy, overlapped with Python
 *  - computePhraseDominantPitch — overlapped with Python segments
 *  - smoothHistogram / findHistogramPeaks — only needed by the above
 */

import { LyricLine } from '../types';
import { audioBufferToWavBlob } from './audioEngine';

export type SingerGender = 'singer1' | 'singer2' | 'both';

export interface SongVocalProfile {
  isDuet: boolean;
  primaryGender: SingerGender;
  maleCentroidHz: number;
  femaleCentroidHz: number;
  splitHz: number;
  confidence: number;
}

// ── FEMALE ARTIST KNOWLEDGE BASE ─────────────────────────────────────────────
const FEMALE_NAMES = new Set([
  'shakira','karol g','adele','beyonce','beyoncé','taylor swift','rihanna',
  'billie eilish','rosalia','rosalía','dua lipa','celine dion','whitney houston',
  'lady gaga','ariana grande','becky g','natti natasha','thalia','thalía',
  'paulina rubio','mon laferte','natalia lafourcade','ana gabriel','rocio durcal',
  'rocío dúrcal','selena','selena quintanilla','selena gomez','gloria estefan',
  'ivy queen','mariah carey','katy perry','sia','madonna','britney spears',
  'avril lavigne','camila cabello','olivia rodrigo','sabrina carpenter',
  'chappell roan','lana del rey','kali uchis','anitta','greeicy','kany garcia',
  'kany garcía','paloma mami','emilia','tini','maria becerra','maría becerra',
  'young miko','villano antillano','jennifer lopez','jlo','alicia keys',
  'christina aguilera','gwen stefani','demi lovato','miley cyrus','pink','p!nk',
  'kesha','norah jones','amy winehouse','laura pausini','marta sanchez','marta sánchez',
  'belinda','danna paola','danna','gloria trevi','yuri','alejandra guzman',
  'alejandra guzmán','fey','kenia os','cazzu','tokischa','bad gyal','aitana',
  'lola indigo','lola índigo','ana mena','rozalen','rozalén','vanesa martin',
  'vanesa martín','malu','malú','amaia montero','alaska','merche','bebe','soraya',
  'paty cantu','paty cantú','ximena sariñana','carla morrison','julieta venegas',
  'ely guerra','lila downs','omara portuondo','celia cruz','la india','olga tanon',
  'olga tañón','ednita nazario','yolandita monge','lupita dalessio','daniela romo',
  'myriam hernandez','myriam hernández','mercedes sosa','soledad pastorutti',
  'valeria lynch','cher','cardi b','megan thee stallion','nicki minaj','doja cat',
]);

// ── MALE ARTIST KNOWLEDGE BASE ───────────────────────────────────────────────
const MALE_NAMES = new Set([
  'bad bunny','luis miguel','ed sheeran','daddy yankee','j balvin','maluma',
  'ozuna','anuel aa','anuel','rauw alejandro','feid','myke towers','eladio carrion',
  'eladio carrión','farruko','don omar','wisin','yandel','romeo santos','prince royce',
  'marc anthony','juan luis guerra','ricky martin','enrique iglesias','julio iglesias',
  'chayanne','alejandro sanz','ricardo arjona','camilo','sebastian yatra',
  'sebastián yatra','manuel turizo','christian nodal','peso pluma','carin leon',
  'carín león','junior h','natanael cano','bizarrap','quevedo','duki','trueno',
  'c. tangana','melendi','fito paez','fito páez','joaquin sabina','joaquín sabina',
  'bunbury','gustavo cerati','michael jackson','freddie mercury','bruno mars',
  'the weeknd','justin bieber','drake','post malone','eminem','kendrick lamar',
  'harry styles','shawn mendes','elton john','frank sinatra','elvis presley',
  'bob marley','chris martin','adam levine','bono','juanes','fonseca','carlos vives',
  'andres cepeda','andrés cepeda','residente','morat','noel schajris','leonel garcia',
  'jorge drexler','andres calamaro','andrés calamaro','charly garcia','charly garcía',
  'luis fonsi','david bisbal','pablo alboran','pablo alborán','manuel carrasco',
  'alejandro fernandez','alejandro fernández','vicente fernandez','vicente fernández',
  'pepe aguilar','marco antonio solis','juan gabriel','jose jose','josé josé',
  'camilo sesto','nicky jam','arcangel','arcángel','zion','lennox','jhayco',
  'jhay cortez','sech','de la ghetto','tego calderon','tego calderón','pedro infante',
  'jorge negrete','pablo milanes','silvio rodriguez',
]);

// ── KNOWN DUET GROUPS ────────────────────────────────────────────────────────
const DUET_INDICATORS = [
  'pimpinela','rbd','ha*ash','ha ash','jesse & joy','jesse y joy','mecano',
  'roxette','abba','fleetwood mac','eurythmics','clean bandit','paramore',
  'la oreja de van gogh','la quinta estacion',
];

// ─── CACHE ────────────────────────────────────────────────────────────────────

let _cacheKey         = '';
let _cachedProfile:   SongVocalProfile | null = null;
let _cachedSegments:  any[] | null            = null;

/**
 * Invalidate all caches. Call this whenever a new song is loaded.
 */
export function invalidateVocalProfileCache() {
  _cacheKey        = '';
  _cachedProfile   = null;
  _cachedSegments  = null;
}

// ─── ARTIST KNOWLEDGE LOOKUP ─────────────────────────────────────────────────

function resolveFromKnowledgeBase(
  artistName: string,
  lyrics: LyricLine[]
): { knownGender: SingerGender | null; isDuet: boolean } {
  const clean = (artistName || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  // Known duet groups
  const isKnownDuetGroup = DUET_INDICATORS.some(d => clean.includes(d));

  // Mixed-gender collaboration: split on feat/ft/&/y/con/x/,/slash
  const parts = clean.split(/(?:feat\.|ft\.|\s&\s|\sy\s|\scon\s|\sx\s|,\s|\/)/).map(s => s.trim()).filter(Boolean);
  let hasMale   = false;
  let hasFemale = false;
  for (const p of parts) {
    if (FEMALE_NAMES.has(p)) hasFemale = true;
    if (MALE_NAMES.has(p))   hasMale   = true;
  }
  const isMixedCollab = hasMale && hasFemale;

  // Explicit duet tags in LRC
  const hasDuetTags = lyrics.some(l =>
    /\[(hombre|mujer|él|ella|male|female|v1|v2|both|ambos|dueto)\]/i.test(l.text || '')
  );

  const isDuet = isKnownDuetGroup || isMixedCollab || hasDuetTags;

  // Gender of primary artist (first part)
  let knownGender: SingerGender | null = null;
  for (const name of FEMALE_NAMES) {
    if (clean === name || clean.includes(name)) { knownGender = 'singer2'; break; }
  }
  if (!knownGender) {
    for (const name of MALE_NAMES) {
      if (clean === name || clean.includes(name)) { knownGender = 'singer1'; break; }
    }
  }

  return { knownGender, isDuet };
}

// ─── FAST SYNC PROFILE (no audio, no API) ────────────────────────────────────

/**
 * Instant synchronous profile — uses only the knowledge base and LRC tags.
 * Safe to call on every render. Returns cached async result if available.
 */
export function analyzeSongVocalProfileSync(
  lyrics: LyricLine[] = [],
  artistName = ''
): SongVocalProfile {
  if (_cachedProfile) return _cachedProfile;

  const { knownGender, isDuet } = resolveFromKnowledgeBase(artistName, lyrics);
  return {
    isDuet,
    primaryGender: knownGender ?? 'singer1',
    maleCentroidHz: 135,
    femaleCentroidHz: 265,
    splitHz: 210,
    confidence: knownGender ? 90 : 55,
  };
}

// ─── FULL ASYNC PROFILE (calls Python backend) ───────────────────────────────

/**
 * Full async analysis — calls Python PYIN diarizer, caches segments.
 * Safe to call from button handlers; does NOT block the audio thread.
 */
export async function analyzeSongVocalProfile(
  vocalsBuffer: AudioBuffer | null,
  lyrics: LyricLine[] = [],
  artistName = ''
): Promise<SongVocalProfile> {
  const songLenKey = vocalsBuffer?.length ?? 0;
  const cacheKey   = `${artistName}|${songLenKey}`;
  if (_cacheKey === cacheKey && _cachedProfile) return _cachedProfile;

  const { knownGender, isDuet: knowledgeDuet } = resolveFromKnowledgeBase(artistName, lyrics);

  // ── No audio: knowledge base only ────────────────────────────────────────
  if (!vocalsBuffer) {
    const profile: SongVocalProfile = {
      isDuet: knowledgeDuet,
      primaryGender: knownGender ?? (knowledgeDuet ? 'singer1' : 'singer1'),
      maleCentroidHz: 130,
      femaleCentroidHz: 265,
      splitHz: 210,
      confidence: knownGender ? 90 : 55,
    };
    _cacheKey       = cacheKey;
    _cachedProfile  = profile;
    return profile;
  }

  // ── Call Python PYIN backend ──────────────────────────────────────────────
  try {
    const wavBlob    = audioBufferToWavBlob(vocalsBuffer);
    const arrayBuf   = await wavBlob.arrayBuffer();
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 90_000); // 90s max

    const response = await fetch('/api/classify-vocal-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: arrayBuf,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        const aiIsDuet = Boolean(data.isDuet || knowledgeDuet);
        const primary  = (data.primaryGender as SingerGender) ?? (knownGender ?? 'singer1');

        const profile: SongVocalProfile = {
          isDuet:          aiIsDuet,
          primaryGender:   primary,
          maleCentroidHz:  130,
          femaleCentroidHz: 270,
          splitHz:         data.splitHz ?? 210,
          confidence:      99,
        };

        _cacheKey        = cacheKey;
        _cachedProfile   = profile;
        _cachedSegments  = Array.isArray(data.segments) ? data.segments : null;

        console.log(
          `[VocalClassifier] PYIN ✓ isDuet=${aiIsDuet} primary=${primary}`,
          `male=${data.malePercentage}% female=${data.femalePercentage}%`,
          `segments=${data.segments?.length ?? 0}`,
        );
        return profile;
      }
    }
  } catch (aiErr: any) {
    if (aiErr?.name !== 'AbortError') {
      console.warn('[VocalClassifier] Python backend unavailable, using knowledge base:', aiErr?.message);
    }
  }

  // ── Python unavailable: knowledge base fallback ───────────────────────────
  const fallback: SongVocalProfile = {
    isDuet:          knowledgeDuet,
    primaryGender:   knownGender ?? 'singer1',
    maleCentroidHz:  135,
    femaleCentroidHz: 265,
    splitHz:         210,
    confidence:      knownGender ? 88 : 55,
  };
  _cacheKey      = cacheKey;
  _cachedProfile = fallback;
  return fallback;
}

// ─── PER-LINE CLASSIFIER (used during render — no DSP) ───────────────────────

/**
 * Classify a single lyric line's singer.
 * Priority: explicit LRC tag → saved manual override → cached Python segment → profile default.
 * NO audio processing — fast, safe to call every render frame.
 */
export function classifyVocalGenderForLine(
  line: LyricLine,
  _vocalsBuffer: AudioBuffer | null = null,
  _fallbackIndex = 0,
  artistName = ''
): SingerGender {
  if (!line) return 'singer1';

  const text  = line.text || '';
  const upper = text.toUpperCase();

  // 1. Explicit text tags — highest priority
  if (/\[(ALL|JUNTOS|BOTH|TODOS|AMBOS|DUETO|CORO|DUO)\]/i.test(text))       return 'both';
  if (/\[(HOMBRE|EL|ÉL|MALE|BOY|V1|SINGER.?1|VOZ.?1)\]/i.test(text) || upper.includes('♂')) return 'singer1';
  if (/\[(MUJER|ELLA|FEMALE|GIRL|V2|SINGER.?2|VOZ.?2)\]/i.test(text) || upper.includes('♀')) return 'singer2';

  // 2. Saved manual override
  if (line.singer) return line.singer as SingerGender;

  // 3. Python segment lookup
  if (_cachedSegments && _cachedSegments.length > 0) {
    const singer = _lookupSegmentSinger(line.time, line.duration ?? 2.5);
    if (singer) return singer;
  }

  // 4. Knowledge-base fallback
  const profile = analyzeSongVocalProfileSync([], artistName);
  return profile.primaryGender;
}

// ─── BATCH CLASSIFIER ────────────────────────────────────────────────────────

/**
 * Classify ALL lyric lines with full async PYIN analysis.
 * Call ONLY from button handlers — never on each render.
 */
export async function classifyAllLyricsVocalGender(
  lyrics: LyricLine[],
  vocalsBuffer: AudioBuffer | null,
  artistName = '',
  forceReclassify = true
): Promise<LyricLine[]> {
  if (!lyrics || lyrics.length === 0) return [];

  // Run full async profile (calls Python, caches segments)
  const profile = await analyzeSongVocalProfile(vocalsBuffer, lyrics, artistName);

  // Yield so audio thread can breathe between classification phases
  await _yield();

  const raw: SingerGender[] = [];

  for (let idx = 0; idx < lyrics.length; idx++) {
    const line  = lyrics[idx];
    const text  = line.text || '';
    const upper = text.toUpperCase();

    // Priority 1: Explicit LRC text tags
    if (/\[(ALL|JUNTOS|BOTH|TODOS|AMBOS|DUETO|CORO|DUO)\]/i.test(text))       { raw.push('both');    continue; }
    if (/\[(HOMBRE|EL|ÉL|MALE|BOY|V1|SINGER.?1|VOZ.?1)\]/i.test(text) || upper.includes('♂')) { raw.push('singer1'); continue; }
    if (/\[(MUJER|ELLA|FEMALE|GIRL|V2|SINGER.?2|VOZ.?2)\]/i.test(text) || upper.includes('♀')) { raw.push('singer2'); continue; }

    // Priority 2: Manual override (only if not forcing reclassification)
    if (!forceReclassify && line.singer) { raw.push(line.singer as SingerGender); continue; }

    // Priority 3: Python diarization segments (most accurate)
    if (_cachedSegments && _cachedSegments.length > 0) {
      const singer = _lookupSegmentSinger(line.time, line.duration ?? 2.5);
      if (singer) { raw.push(singer); continue; }
    }

    // Priority 4: Profile default (knowledge base)
    raw.push(profile.primaryGender);

    // Yield every 25 lines to keep audio smooth
    if (idx % 25 === 0) await _yield();
  }

  // ── 3-line blip smoothing: remove isolated single-line anomalies ──────────
  // Preserves explicit tags and natural duet alternations.
  const smoothed = [...raw];
  for (let i = 1; i < smoothed.length - 1; i++) {
    const hasTag = /\[(hombre|mujer|el|ella|male|female|v1|v2|both|ambos)\]/i.test(lyrics[i].text || '');
    if (!hasTag) {
      const prev = smoothed[i - 1];
      const curr = smoothed[i];
      const next = smoothed[i + 1];
      if (prev === next && curr !== prev && curr !== 'both') {
        smoothed[i] = prev;
      }
    }
  }

  return lyrics.map((line, idx) => ({ ...line, singer: smoothed[idx] }));
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Find the dominant singer for a lyric line's time window using cached Python segments.
 */
function _lookupSegmentSinger(
  lineTime: number,
  lineDuration: number
): SingerGender | null {
  if (!_cachedSegments || _cachedSegments.length === 0) return null;

  const windowStart = Math.max(0, lineTime - 0.8);
  const windowEnd   = lineTime + Math.max(2.0, lineDuration + 0.8);

  let s1Weight   = 0;
  let s2Weight   = 0;
  let bothWeight = 0;

  for (const seg of _cachedSegments) {
    const overlapStart = Math.max(windowStart, seg.start);
    const overlapEnd   = Math.min(windowEnd,   seg.end);
    const overlap      = Math.max(0, overlapEnd - overlapStart);
    if (overlap <= 0) continue;
    if (seg.singer === 'singer1') s1Weight   += overlap;
    else if (seg.singer === 'singer2') s2Weight += overlap;
    else if (seg.singer === 'both')  bothWeight += overlap;
  }

  const total = s1Weight + s2Weight + bothWeight;
  if (total < 0.05) return null; // insufficient overlap — no confident assignment

  if (bothWeight / total >= 0.32) return 'both';
  return s1Weight >= s2Weight ? 'singer1' : 'singer2';
}

/** Yield control to the browser event loop (keeps audio thread unblocked). */
function _yield(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}
