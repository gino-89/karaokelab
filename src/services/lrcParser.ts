import { LyricLine, ArtistRole } from '../types';

/**
 * Detects if a song or lyrics represent a multi-singer duet (Hombre/Mujer/Ambos).
 */
export function detectIsDuetLyrics(lyrics: LyricLine[], artist = ''): boolean {
  if (artist && /(feat\.|ft\.|&|duet|dueto|x\s)/i.test(artist)) {
    return true;
  }
  return lyrics.some((l) =>
    /(\[hombre\]|\[mujer\]|\[él\]|\[ella\]|\[male\]|\[female\]|\[v1\]|\[v2\]|\[both\]|\[ambos\]|\[dueto\]|\(él\)|\(ella\)|\(hombre\)|\(mujer\))/i.test(
      l.text
    )
  );
}

/**
 * Cleans singer/duet prefix tags from lyric text for elegant display while singing.
 */
export function cleanLyricText(text: string): string {
  if (!text) return '';
  return text
    // Strip singer tags [Hombre], [Mujer], [Ambos], [artist-0], etc.
    .replace(/\[(?:hombre|mujer|él|el|ella|male|female|v1|v2|both|all|ambos|juntos|dueto|coro|todos|singer\s*\d+|artist-\d+)[^\]]*\]\s*/gi, '')
    // Strip structural section tags [Intro:], [Verso 1: Chris Brown], [Refrán: Wisin, Chris Brown], [Coro], [Pre-Coro], [Outro]
    .replace(/\[(?:intro|verso|verse|coro|chorus|pre-coro|pre-chorus|refrán|refrain|puente|bridge|outro|estribillo|hook|interlude|solo)[^\]]*\]\s*/gi, '')
    // Strip any [ArtistName:] prefixes
    .replace(/\[[a-záéíóúüñ\s,\.\-&]+:[^\]]*\]\s*/gi, '')
    // Strip any remaining brackets at start
    .replace(/^\[[^\]]+\]\s*/g, '')
    .replace(/^\((?:hombre|mujer|él|ella|male|female|v1|v2|both|all|ambos)\)\s*/gi, '')
    .replace(/^\s*:\s*/, '')
    .trim();
}

/**
 * Parses LRC synchronized lyrics text into array of LyricLine
 * Handles standard [mm:ss.xx] and [mm:ss] formats, multiple timestamps per line, and offsets.
 */
export function parseLRC(lrcText: string): LyricLine[] {
  if (!lrcText || typeof lrcText !== 'string') return [];

  const lines = lrcText.split(/\r?\n/);
  const result: LyricLine[] = [];
  let globalOffset = 0;
  let currentSectionHeader: string | undefined = undefined;

  const offsetRegex = /\[offset:\s*([+-]?\d+)\s*\]/i;
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const offsetMatch = trimmed.match(offsetRegex);
    if (offsetMatch) {
      globalOffset = parseInt(offsetMatch[1], 10) / 1000;
      continue;
    }

    const timestamps: number[] = [];
    let match: RegExpExecArray | null;
    timeRegex.lastIndex = 0;

    while ((match = timeRegex.exec(trimmed)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      let ms = 0;
      if (match[3]) {
        const msStr = match[3];
        if (msStr.length === 1) ms = parseInt(msStr, 10) * 100;
        else if (msStr.length === 2) ms = parseInt(msStr, 10) * 10;
        else ms = parseInt(msStr.substring(0, 3), 10);
      }

      const totalSeconds = minutes * 60 + seconds + ms / 1000;
      timestamps.push(totalSeconds);
    }

    // Detect standalone section headers or artists metadata
    if (timestamps.length === 0 && /^\[.+\]$/.test(trimmed)) {
      if (trimmed.startsWith('[artists:')) {
        continue;
      }
      currentSectionHeader = trimmed;
      continue;
    }

    const rawLyricText = trimmed.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();

    let singer: string | undefined = undefined;
    const singerMatch = rawLyricText.match(/^\[([a-zA-Z0-9_\-\sáéíóúüñÁÉÍÓÚÜÑ\.\&]+)\]/);
    if (singerMatch) {
      const tag = singerMatch[1].trim();
      if (/^(hombre|él|el|male|boy|v1|singer\s*1|voz\s*1)$/i.test(tag)) {
        singer = 'singer1';
      } else if (/^(mujer|ella|female|girl|v2|singer\s*2|voz\s*2)$/i.test(tag)) {
        singer = 'singer2';
      } else if (/^(both|all|juntos|todos|ambos|dueto|coro|duo)$/i.test(tag)) {
        singer = 'both';
      } else {
        singer = tag;
      }
    } else if (/\[(hombre|él|el|male|boy|v1|singer\s*1|voz\s*1)\]|\((hombre|él|el|male|boy|v1)\)|♂/i.test(rawLyricText)) {
      singer = 'singer1';
    } else if (/\[(mujer|ella|female|girl|v2|singer\s*2|voz\s*2)\]|\((mujer|ella|female|girl|v2)\)|♀/i.test(rawLyricText)) {
      singer = 'singer2';
    } else if (/\[(both|all|juntos|todos|ambos|dueto|coro|duo)\]|\((both|all|juntos|todos|ambos|dueto|coro|duo)\)|👥/i.test(rawLyricText)) {
      singer = 'both';
    }

    const cleanText = cleanLyricText(rawLyricText);
    if (!cleanText && timestamps.length === 0) continue;

    if (timestamps.length > 0) {
      for (const time of timestamps) {
        const adjustedTime = Math.max(0, time + globalOffset);
        result.push({
          time: adjustedTime,
          text: cleanText || '♫',
          singer,
          sectionHeader: currentSectionHeader,
        });
      }
    }
  }

  result.sort((a, b) => a.time - b.time);

  for (let i = 0; i < result.length; i++) {
    if (i < result.length - 1) {
      result[i].duration = Math.max(0.8, result[i + 1].time - result[i].time);
    } else {
      result[i].duration = 4.0;
    }
  }

  return result;
}

/**
 * Strips singer names from section headers like [Verso 1: Ari] -> [Verso 1].
 */
export function cleanSectionHeader(header?: string): string {
  if (!header) return '';
  if (header.includes(':')) {
    const part = header.replace(/^\[/, '').split(':')[0].trim();
    return `[${part}]`;
  }
  return header;
}

/**
 * Updates or sets the singer in a section header, e.g. [Verso 1: Ari] -> [Verso 1: Erika].
 */
export function updateSectionHeaderSinger(header?: string, newSingerName?: string): string | undefined {
  if (!header) {
    return newSingerName ? `[Verso: ${newSingerName}]` : undefined;
  }
  const clean = cleanSectionHeader(header);
  const base = clean.replace(/^\[|\]$/g, '').trim();
  if (newSingerName) {
    return `[${base}: ${newSingerName}]`;
  }
  return `[${base}]`;
}

/**
 * Formats LyricLine array back into synchronized LRC text, preserving singer roles, section headers & custom artists.
 */
export function formatLRC(lyrics: LyricLine[], artists?: ArtistRole[]): string {
  const result: string[] = [];

  if (artists && artists.length > 0) {
    try {
      result.push(`[artists:${JSON.stringify(artists)}]`);
    } catch (_) {}
  }

  let lastHeader = '';
  for (const line of lyrics) {
    if (line.sectionHeader && line.sectionHeader !== lastHeader) {
      lastHeader = line.sectionHeader;
      result.push(line.sectionHeader);
    }

    const text = cleanLyricText(line.text);
    if (!text || text === '♫') continue;

    const mins = Math.floor(line.time / 60);
    const secs = Math.floor(line.time % 60);
    const hundredths = Math.floor((line.time % 1) * 100);
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');

    let singerTag = '';
    if (line.singer) {
      singerTag = `[${line.singer}] `;
    }

    result.push(`[${pad(mins)}:${pad(secs)}.${pad(hundredths)}] ${singerTag}${text}`);
  }

  return result.join('\n').trim();
}

/**
 * Extracts embedded artist roles list from LRC text if present.
 */
export function parseArtistsFromLRC(lrcText: string): ArtistRole[] | null {
  if (!lrcText) return null;
  const match = lrcText.match(/\[artists:(.+?)\]/);
  if (match && match[1]) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (_) {}
  }
  return null;
}

/**
 * Aligns plain text lines to detected vocal activity intervals.
 */
export function alignPlainTextToVocalPhrases(
  plainText: string,
  vocalPhrases: Array<{ start: number; end: number; duration: number }>,
  trackDuration: number
): LyricLine[] {
  const lines = plainText
    .split(/\r?\n/)
    .map((l) => l.replace(/^\[\d+:\d+(\.\d+)?\]\s*/, '').trim())
    .filter((l) => l.length > 0 && !l.startsWith('(') && !l.endsWith(')'));

  if (lines.length === 0) return [];

  if (vocalPhrases && vocalPhrases.length > 0) {
    const result: LyricLine[] = [];
    const step = Math.max(1, vocalPhrases.length / lines.length);

    for (let i = 0; i < lines.length; i++) {
      const phraseIdx = Math.min(vocalPhrases.length - 1, Math.floor(i * step));
      const phrase = vocalPhrases[phraseIdx];
      result.push({
        time: phrase.start,
        text: lines[i],
        duration: Math.max(1.2, phrase.duration),
      });
    }
    return result;
  }

  // Fallback: distribute evenly
  const intro = Math.min(8.0, trackDuration * 0.08);
  const step = Math.max(2.5, (trackDuration - intro - 4) / lines.length);
  return lines.map((text, idx) => ({
    time: intro + idx * step,
    text,
    duration: Math.min(step * 0.9, 5.0),
  }));
}

/**
 * Generates structured lyrics aligned with real detected vocal phrases
 */
export function generateGenericLyrics(
  songTitle: string,
  artist: string,
  duration: number,
  vocalPhrases?: Array<{ start: number; end: number; duration: number }>
): LyricLine[] {
  if (vocalPhrases && vocalPhrases.length > 0) {
    const lines: LyricLine[] = [
      { time: 1.0, text: `▶ ${songTitle}`, duration: 3.0 },
      { time: 4.5, text: `✦ ${artist || 'Karaoke Version'}`, duration: 3.5 },
    ];

    const phrases = [
      "Siente el ritmo en la pista instrumental",
      "La melodía fluye por todo el lugar",
      "Canta con fuerza y pasión al compás",
      "La música suena brillante y triunfal",
      "El bajo resuena con gran intensidad",
      "Tu voz es la reina en este escenario",
      "Sigue la letra que brilla al cantar",
      "Momento perfecto para disfrutar",
    ];

    for (let i = 0; i < vocalPhrases.length; i++) {
      const p = vocalPhrases[i];
      if (p.start > 8.0 && p.start < duration - 6.0) {
        lines.push({
          time: p.start,
          text: phrases[i % phrases.length],
          duration: Math.max(1.5, p.duration),
        });
      }
    }

    lines.push({
      time: Math.max(10, duration - 5.0),
      text: `★ [FINAL // EXCELENTE SCORE]`,
      duration: 3.0,
    });

    lines.sort((a, b) => a.time - b.time);
    return lines;
  }

  const lines: LyricLine[] = [
    { time: 1.0, text: `▶ ${songTitle}`, duration: 3.0 },
    { time: 4.5, text: `✦ ${artist || 'Karaoke Version'}`, duration: 3.5 },
    { time: 8.5, text: `⚡ [INICIO // PREPÁRATE PARA CANTAR]`, duration: 4.0 },
  ];

  const interval = 7.5;
  const numSections = Math.floor((duration - 16) / interval);

  const phraseBank = [
    "Siente el ritmo en la pista instrumental",
    "La melodía fluye por todo el lugar",
    "Canta con fuerza y pasión al compás",
    "La música suena brillante y triunfal",
    "El bajo resuena con gran intensidad",
    "Tu voz es la reina en este escenario",
    "Sigue la letra que brilla al cantar",
    "Momento perfecto para disfrutar",
  ];

  for (let i = 0; i < numSections; i++) {
    const t = 14 + i * interval;
    if (t < duration - 8) {
      lines.push({
        time: t,
        text: phraseBank[i % phraseBank.length],
        duration: interval * 0.9,
      });
    }
  }

  lines.push({
    time: Math.max(10, duration - 5.0),
    text: `★ [FINAL // EXCELENTE SCORE]`,
    duration: 3.0,
  });

  return lines;
}

// ─── GENIUS / PLAIN LYRICS FORMAT PARSER ──────────────────────────────────────

export const FEMALE_PALETTE = [
  '#ff007f', // 1. Rosa Neón Vibrante
  '#a855f7', // 2. Morado / Púrpura Eléctrico (Alto contraste vs rosa)
  '#f97316', // 3. Naranja / Coral Neón
  '#14b8a6', // 4. Turquesa / Teal Menta
  '#e11d48', // 5. Rojo Rubí Intenso
  '#ec4899', // 6. Magenta Fucsia
];

export const MALE_PALETTE = [
  '#00f0ff', // 1. Cyan / Celeste Eléctrico
  '#84cc16', // 2. Verde Lima Neón (Alto contraste vs cyan)
  '#3b82f6', // 3. Azul Cobalto / Real
  '#eab308', // 4. Amarillo Ámbar / Oro
  '#06b6d4', // 5. Azul Océano
  '#6366f1', // 6. Índigo Eléctrico
];

export const ARTIST_PALETTE = [
  ...FEMALE_PALETTE,
  ...MALE_PALETTE,
  '#eab308', // Dorado Ámbar (Ambos / Dúo)
  '#10b981', // Verde Esmeralda
];

/** Check if an artist or singer name is female */
export function isFemaleName(name: string): boolean {
  if (!name) return false;
  const clean = name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (/^(mujer|ella|female|woman|girl|chica|dama|female\s*\d*)$/i.test(clean)) return true;

  const femaleKeywords = [
    'anahi', 'dulce', 'maite', 'shakira', 'karol', 'adele', 'beyonce', 'taylor', 'rihanna',
    'rosalia', 'dua', 'celine', 'whitney', 'gaga', 'ariana', 'becky', 'natti', 'thalia',
    'paulina', 'mon', 'natalia', 'selena', 'gloria', 'ivy', 'mariah', 'katy', 'sia', 'madonna',
    'britney', 'avril', 'camila', 'olivia', 'sabrina', 'chappell', 'lana', 'kali', 'anitta',
    'greeicy', 'kany', 'paloma', 'emilia', 'tini', 'maria', 'miko', 'villano', 'jennifer',
    'alicia', 'christina', 'gwen', 'demi', 'miley', 'pink', 'kesha', 'norah', 'amy', 'laura',
    'marta', 'belinda', 'danna', 'yuri', 'alejandra', 'fey', 'kenia', 'cazzu', 'tokischa',
    'aitana', 'lola', 'ana', 'vanesa', 'malu', 'amaia', 'alaska', 'paty', 'ximena', 'carla',
    'julieta', 'ely', 'lila', 'omara', 'celia', 'olga', 'ednita', 'lupita', 'daniela', 'myriam',
    'mercedes', 'soledad', 'valeria', 'cher', 'cardi', 'megan', 'nicki', 'doja', 'lucia',
    'sofia', 'valentina', 'isabella', 'victoria', 'elena', 'carmen', 'juana', 'paula', 'claudia',
    'fernanda', 'andrea', 'gabriela', 'mariana', 'juliana', 'patricia', 'susana', 'teresa',
    'rosa', 'monica', 'lorena', 'vanessa', 'silvia', 'adriana', 'carolina', 'beatriz', 'sandra'
  ];

  for (const kw of femaleKeywords) {
    if (clean === kw || clean.startsWith(kw + ' ') || clean.includes(' ' + kw) || clean.includes(kw)) {
      return true;
    }
  }

  const firstName = clean.split(/\s+/)[0];
  if (/^[a-z]+(ina|ela|ita|ica|isa|ia|ura|ana|ena|ona)$/i.test(firstName)) return true;
  if (firstName.endsWith('a') && !['joshua', 'luca', 'sasha', 'luka', 'mustafa'].includes(firstName)) return true;

  return false;
}

/** Check if an artist or singer name is male */
export function isMaleName(name: string): boolean {
  if (!name) return false;
  const clean = name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (/^(hombre|el|male|man|boy|chico|caballero|varon|male\s*\d*)$/i.test(clean)) return true;

  const maleKeywords = [
    'christian', 'christopher', 'alfonso', 'poncho', 'bad bunny', 'luis', 'ed', 'daddy',
    'balvin', 'maluma', 'ozuna', 'anuel', 'rauw', 'feid', 'myke', 'eladio', 'farruko', 'don',
    'wisin', 'yandel', 'romeo', 'prince', 'marc', 'juan', 'ricky', 'enrique', 'julio', 'chayanne',
    'alejandro', 'ricardo', 'camilo', 'sebastian', 'manuel', 'nodal', 'peso', 'carin', 'junior',
    'natanael', 'bizarrap', 'quevedo', 'duki', 'trueno', 'tangana', 'melendi', 'fito', 'joaquin',
    'bunbury', 'gustavo', 'michael', 'freddie', 'bruno', 'weeknd', 'justin', 'drake', 'post',
    'eminem', 'kendrick', 'harry', 'shawn', 'elton', 'frank', 'elvis', 'bob', 'chris', 'adam',
    'bono', 'juanes', 'fonseca', 'carlos', 'andres', 'residente', 'noel', 'leonel', 'jorge',
    'charly', 'david', 'pablo', 'pepe', 'marco', 'jose', 'nicky', 'arcangel', 'zion', 'lennox',
    'jhay', 'sech', 'tego', 'pedro', 'silvio', 'miguel', 'antonio', 'francisco', 'javier', 'diego',
    'sergio', 'roberto', 'fernando', 'mario', 'alberto', 'raul', 'hugo', 'victor', 'rodrigo'
  ];

  for (const kw of maleKeywords) {
    if (clean === kw || clean.startsWith(kw + ' ') || clean.includes(' ' + kw) || clean.includes(kw)) {
      return true;
    }
  }

  const firstName = clean.split(/\s+/)[0];
  if (firstName.endsWith('o') || firstName.endsWith('os') || firstName.endsWith('on') || firstName.endsWith('or') || firstName.endsWith('el')) return true;

  return false;
}

/** Resolves the ideal feminine (red/rose) or masculine (blue/cyan) color for an artist name */
export function resolveArtistColor(name: string, femaleIndex = 0, maleIndex = 0): string {
  if (isFemaleName(name)) {
    return FEMALE_PALETTE[femaleIndex % FEMALE_PALETTE.length];
  }
  if (isMaleName(name)) {
    return MALE_PALETTE[maleIndex % MALE_PALETTE.length];
  }
  // Default alternating fallback
  return femaleIndex <= maleIndex ? FEMALE_PALETTE[femaleIndex % FEMALE_PALETTE.length] : MALE_PALETTE[maleIndex % MALE_PALETTE.length];
}

export interface GeniusParseResult {
  lyrics: LyricLine[];
  allArtists: ArtistRole[];
  singer1Artists: string[];  // primary artist
  singer2Artists: string[];  // secondary artists
  isDuet: boolean;
}

const SECTION_KEYWORDS = /^(chorus|verse|verso|bridge|puente|intro|outro|hook|pre-chorus|prechorus|post-chorus|postchorus|pre-coro|precoro|post-coro|postcoro|refrain|coro|refrán|refran|estribillo|estrofa|instrumental|solo|drop|letra|lyrics)(\s*\d+)?$/i;

/** Normalize an artist name for comparison and display */
export function cleanArtistName(raw: string): string {
  return (raw || '').trim().toLowerCase().replace(/[^a-z0-9áéíóúüñ ]/gi, '').trim();
}

/** Title case artist name for UI display (e.g. "daddy yankee" -> "Daddy Yankee") */
export function titleCaseArtist(name: string): string {
  if (!name) return '';
  return name
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Extract artist name(s) and metadata from a section header line.
 * Handles:
 * - [Refrán: Wisin, Chris Brown ]
 * - [Pre-Coro: Wisin, Yandel ]
 * - [Daddy Yankee (Ozuna):]
 * - [Ozuna:]
 * - [Daddy:]
 * - [Verso 1: Daddy Yankee]
 * - [Coro: Daddy Yankee & Ozuna]
 * - [Chorus:] (structural only)
 */
export function extractArtistsFromHeader(headerText: string): {
  artists: string[];
  isBoth: boolean;
  isStructural: boolean;
} {
  let inner = headerText.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (inner.endsWith(':')) inner = inner.slice(0, -1).trim();

  // If format is [Section: Artist] e.g. [Verso 1: Daddy Yankee] or [Coro: Daddy Yankee & Ozuna]
  if (inner.includes(':')) {
    const colonIdx = inner.indexOf(':');
    const prefix = inner.substring(0, colonIdx).trim();
    const suffix = inner.substring(colonIdx + 1).trim();
    if (SECTION_KEYWORDS.test(prefix)) {
      inner = suffix;
    }
  }

  // Check if inner is purely structural (e.g. 'Chorus', 'Verso 1')
  if (SECTION_KEYWORDS.test(inner) && !/(feat|\&|\by\b|\bwith\b|\bcon\b)/i.test(inner)) {
    return { artists: [], isBoth: false, isStructural: true };
  }

  // Check for parenthesized secondary artist e.g. 'Daddy Yankee (Ozuna)'
  const artists: string[] = [];
  const parenMatch = inner.match(/^(.+?)\s*\((.+?)\)$/);
  if (parenMatch) {
    const a1 = cleanArtistName(parenMatch[1]);
    const a2 = cleanArtistName(parenMatch[2]);
    if (a1 && !SECTION_KEYWORDS.test(a1)) artists.push(a1);
    if (a2 && !SECTION_KEYWORDS.test(a2)) artists.push(a2);
    return { artists, isBoth: artists.length > 1, isStructural: false };
  }

  // Split on delimiters: feat., ft., &, y, with, con, comma, /, x, +
  const splitParts = inner.split(/(?:\s+feat\.?\s+|\s+ft\.?\s+|\s+&\s+|\s+y\s+|\s+with\s+|\s+con\s+|\s*,\s*|\s*\/\s*|\s+x\s+|\s*\+\s*)/i);
  for (const p of splitParts) {
    const c = cleanArtistName(p);
    if (c && !SECTION_KEYWORDS.test(c)) {
      artists.push(c);
    }
  }

  return { artists, isBoth: artists.length > 1, isStructural: artists.length === 0 };
}

/**
 * Detects if a text block is in "Genius format" (has [ArtistName:] or [Section: Artist] headers).
 */
export function isGeniusFormat(text: string): boolean {
  if (!text) return false;
  const lines = text.split(/\r?\n/);
  const sectionHeaders = lines.filter(l => {
    const t = l.trim();
    if (!t.startsWith('[') || !t.endsWith(']')) return false;
    if (/^\[\d{1,2}:\d{2}/.test(t)) return false; // skip timestamps
    const { artists, isStructural } = extractArtistsFromHeader(t);
    return artists.length > 0 || isStructural;
  });
  return sectionHeaders.length >= 1;
}

/**
 * Parse Genius/Letras.com lyrics format into LyricLine[].
 * Automatically discovers ALL artists with dynamic color palettes and assigns roles.
 */
export function parseGeniusLyrics(
  text: string,
  duration = 180,
  startSec = 8
): GeniusParseResult {
  const lines = text.split(/\r?\n/);

  // ── Step 1: Extract unique primary artist names with alias consolidation ──
  const uniqueArtists: string[] = []; // canonical artist names in appearance order

  function findOrAddArtist(name: string): string | null {
    const clean = cleanArtistName(name);
    if (!clean) return null;
    // Check if it matches an existing artist or alias (e.g. 'daddy' -> 'daddy yankee')
    for (const existing of uniqueArtists) {
      if (existing === clean || existing.includes(clean) || clean.includes(existing)) {
        return existing;
      }
    }
    uniqueArtists.push(clean);
    return clean;
  }

  for (const rawLine of lines) {
    const t = rawLine.trim();
    if (!t.startsWith('[') || (!t.endsWith(']') && !t.endsWith(']:'))) continue;
    if (/^\[\d{1,2}:\d{2}/.test(t)) continue; // skip LRC timestamps

    const { artists } = extractArtistsFromHeader(t);
    for (const a of artists) {
      findOrAddArtist(a);
    }
  }

  // Create ArtistRole array for ALL detected artists with distinct gender-aware colors
  let femaleCount = 0;
  let maleCount = 0;
  const allArtists: ArtistRole[] = uniqueArtists.map((name, idx) => {
    const formattedName = titleCaseArtist(name);
    const isFem = isFemaleName(formattedName);
    const isM = isMaleName(formattedName);
    const color = resolveArtistColor(
      formattedName,
      isFem ? femaleCount++ : femaleCount,
      isM ? maleCount++ : maleCount
    );
    return {
      id: `artist-${idx}`,
      name: formattedName,
      color,
    };
  });

  const artistMap = new Map<string, string>(); // canonicalName -> artistId ('artist-0', 'artist-1', ...)
  uniqueArtists.forEach((name, idx) => {
    artistMap.set(name, `artist-${idx}`);
  });

  const isDuet = uniqueArtists.length >= 2;
  const singer1Artists = uniqueArtists.filter((_, idx) => idx === 0).map(titleCaseArtist);
  const singer2Artists = uniqueArtists.filter((_, idx) => idx > 0).map(titleCaseArtist);

  function resolveSingerForArtists(artists: string[]): string | null {
    if (!isDuet || artists.length === 0) return null;
    const resolvedRoles = new Set<string>();
    for (const a of artists) {
      const canon = findOrAddArtist(a);
      if (canon && artistMap.has(canon)) {
        resolvedRoles.add(artistMap.get(canon)!);
      }
    }
    if (resolvedRoles.size > 1 || (artists.length > 1 && resolvedRoles.size > 0)) return 'both';
    if (resolvedRoles.size === 1) return Array.from(resolvedRoles)[0];
    return null;
  }

  // ── Step 2: Parse lyric lines, tracking current singer & section header ────
  interface ParsedVerse {
    text: string;
    singer: string;
    sectionHeader?: string;
  }
  const defaultSingleId = allArtists.length > 0 ? allArtists[0].id : 'artist-0';
  const verses: ParsedVerse[] = [];
  let currentSinger: string = defaultSingleId;
  let currentSectionHeader: string | undefined = undefined;

  for (const rawLine of lines) {
    const t = rawLine.trim();
    if (!t) continue;

    // Check for section header
    if ((t.startsWith('[') && (t.endsWith(']') || t.endsWith(']:'))) && !/^\[\d{1,2}:\d{2}/.test(t)) {
      currentSectionHeader = t.endsWith(':') ? t.slice(0, -1) : t;
      if (isDuet) {
        const { artists, isBoth, isStructural } = extractArtistsFromHeader(t);
        if (isBoth) {
          currentSinger = 'both';
        } else if (!isStructural && artists.length > 0) {
          const resolved = resolveSingerForArtists(artists);
          if (resolved) currentSinger = resolved;
        }
      } else {
        currentSinger = defaultSingleId;
      }
      continue;
    }

    // Skip metadata headers
    if (/^"[^"]+"$/.test(t)) continue;
    if (/^\(feat\..*\)$/i.test(t)) continue;

    const cleanT = cleanLyricText(t);
    if (!cleanT) continue;

    verses.push({
      text: cleanT,
      singer: isDuet ? currentSinger : defaultSingleId,
      sectionHeader: currentSectionHeader,
    });
  }

  // ── Step 3: Distribute timestamps evenly ───────────────────────────────────
  const nonEmptyVerses = verses.filter(v => v.text.trim().length > 0);
  if (nonEmptyVerses.length === 0) {
    return { lyrics: [], allArtists, singer1Artists, singer2Artists, isDuet };
  }

  const intro = Math.max(4, Math.min(startSec, duration * 0.08));
  const available = Math.max(10, duration - intro - 4);
  const step = Math.max(2.0, available / nonEmptyVerses.length);

  const lyrics: LyricLine[] = nonEmptyVerses.map((v, idx) => ({
    time: +(intro + idx * step).toFixed(2),
    text: cleanLyricText(v.text),
    duration: +(Math.min(step * 0.92, 6.0)).toFixed(2),
    singer: isDuet ? v.singer : defaultSingleId,
    sectionHeader: v.sectionHeader,
  }));

  return { lyrics, allArtists, singer1Artists, singer2Artists, isDuet };
}

/**
 * Fuses exact millisecond-synced timestamps from an LRC track with Genius section headers and artist roles.
 * Provides 100% millisecond precision + rich multi-artist coloring in a single unified lyric set.
 */
export function mergeGeniusRolesWithSyncedLrc(
  geniusLyrics: LyricLine[],
  syncedLyrics: LyricLine[]
): LyricLine[] {
  if (!syncedLyrics || syncedLyrics.length === 0) return geniusLyrics;
  if (!geniusLyrics || geniusLyrics.length === 0) return syncedLyrics;

  function norm(str: string): string {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/gi, ' ')
      .trim();
  }

  function getTokens(str: string): Set<string> {
    return new Set(norm(str).split(/\s+/).filter(w => w.length > 1));
  }

  let gCursor = 0;
  let currentSinger = geniusLyrics[0]?.singer;
  let currentHeader = geniusLyrics[0]?.sectionHeader;

  return syncedLyrics.map((syncedLine) => {
    const sClean = norm(syncedLine.text);
    const sTokens = getTokens(syncedLine.text);

    let bestScore = -1;
    let bestMatchIdx = -1;

    // Search around current cursor
    const windowStart = Math.max(0, gCursor - 2);
    const windowEnd = Math.min(geniusLyrics.length, gCursor + 12);

    for (let i = windowStart; i < windowEnd; i++) {
      const gClean = norm(geniusLyrics[i].text);
      if (sClean === gClean) {
        bestScore = 1.0;
        bestMatchIdx = i;
        break;
      }
      if (sClean && gClean && (sClean.includes(gClean) || gClean.includes(sClean))) {
        const score = 0.85;
        if (score > bestScore) {
          bestScore = score;
          bestMatchIdx = i;
        }
      } else {
        // Token intersection
        const gTokens = getTokens(geniusLyrics[i].text);
        if (sTokens.size > 0 && gTokens.size > 0) {
          let common = 0;
          for (const tok of sTokens) {
            if (gTokens.has(tok)) common++;
          }
          const jaccard = common / Math.max(sTokens.size, gTokens.size);
          if (jaccard > 0.4 && jaccard > bestScore) {
            bestScore = jaccard;
            bestMatchIdx = i;
          }
        }
      }
    }

    if (bestMatchIdx !== -1) {
      gCursor = bestMatchIdx + 1;
      currentSinger = geniusLyrics[bestMatchIdx].singer;
      currentHeader = geniusLyrics[bestMatchIdx].sectionHeader;
    }

    return {
      ...syncedLine,
      singer: currentSinger || syncedLine.singer,
      sectionHeader: currentHeader || syncedLine.sectionHeader,
    };
  });
}

/**
 * Database of known famous vocal group and duo lineups for instant automatic artist discovery.
 */
export const KNOWN_VOCAL_GROUPS: Record<string, string[]> = {
  'rbd': ['Anahí', 'Dulce María', 'Maite Perroni', 'Christian Chávez', 'Christopher Uckermann'],
  'wisin & yandel': ['Wisin', 'Yandel'],
  'wisin y yandel': ['Wisin', 'Yandel'],
  'zion & lennox': ['Zion', 'Lennox'],
  'zion y lennox': ['Zion', 'Lennox'],
  'jowell & randy': ['Jowell', 'Randy'],
  'jowell y randy': ['Jowell', 'Randy'],
  'alexis & fido': ['Alexis', 'Fido'],
  'ha*ash': ['Hanna', 'Ashley'],
  'ha-ash': ['Hanna', 'Ashley'],
  'ha ash': ['Hanna', 'Ashley'],
  'jesse & joy': ['Jesse', 'Joy'],
  'jesse y joy': ['Jesse', 'Joy'],
  'sin bandera': ['Noel Schajris', 'Leonel García'],
  'camila': ['Mario Domm', 'Pablo Hurtado', 'Samo'],
  'reik': ['Jesús Navarro', 'Julio Ramírez', 'Bibi Marín'],
  'morat': ['Juan Pablo Isaza', 'Juan Pablo Villamil', 'Martín Vargas', 'Simón Vargas'],
  'cnco': ['Christopher', 'Erick Brian', 'Richard', 'Zabdiel'],
  'blackpink': ['Jisoo', 'Jennie', 'Rosé', 'Lisa'],
  'bts': ['RM', 'Jin', 'Suga', 'J-Hope', 'Jimin', 'V', 'Jungkook'],
};

/**
 * Automatically extracts ALL artist roles from song title and artist metadata,
 * resolving collaborations (feat., ft., &, y, with, commas) and band member lineups.
 */
export function extractAllArtistsFromMetadata(artistString = '', titleString = ''): ArtistRole[] {
  const unique: string[] = [];

  function addUnique(name: string) {
    const c = cleanArtistName(name);
    if (!c || c.length < 2) return;
    if (['official', 'video', 'lyrics', 'letra', 'audio', 'remix', 'version', 'karaoke', 'instrumental', 'hd', 'ft', 'feat'].includes(c)) return;
    for (const u of unique) {
      if (u === c || u.includes(c) || c.includes(u)) return;
    }
    unique.push(c);
  }

  // 1. Check if artist matches known famous band/duo lineup
  const cleanMain = cleanArtistName(artistString);
  if (KNOWN_VOCAL_GROUPS[cleanMain]) {
    KNOWN_VOCAL_GROUPS[cleanMain].forEach(addUnique);
  }

  // 2. Parse artist string
  if (artistString) {
    const rawArtists = artistString.split(/(?:\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+|\s+&\s+|\s+y\s+|\s+and\s+|\s+with\s+|\s+con\s+|\s*,\s*|\s*\/\s*|\s+x\s+|\s*\+\s*|\s+vs\.?\s+)/i);
    for (const p of rawArtists) {
      const clean = p.replace(/[\(\)\[\]]/g, '').trim();
      if (clean) addUnique(clean);
    }
  }

  // 3. Extract featured artists from title string
  if (titleString) {
    const featMatches = titleString.matchAll(/(?:\(|\[)?(?:feat\.?|ft\.?|featuring|with|con)\s+([^\)\]]+)(?:\)|\])?/gi);
    for (const m of featMatches) {
      const featPart = m[1];
      const featSplit = featPart.split(/(?:\s+&\s+|\s+y\s+|\s+and\s+|\s*,\s*|\s*\/\s*|\s+x\s+|\s*\+\s*)/i);
      for (const f of featSplit) {
        const clean = f.replace(/[\(\)\[\]]/g, '').trim();
        if (clean) addUnique(clean);
      }
    }
  }

  if (unique.length === 0 && artistString) {
    unique.push(cleanArtistName(artistString));
  }

  let femaleCount = 0;
  let maleCount = 0;
  return unique.map((name, idx) => {
    const formattedName = titleCaseArtist(name);
    const isFem = isFemaleName(formattedName);
    const isM = isMaleName(formattedName);
    const color = resolveArtistColor(
      formattedName,
      isFem ? femaleCount++ : femaleCount,
      isM ? maleCount++ : maleCount
    );
    return {
      id: `artist-${idx}`,
      name: formattedName,
      color,
    };
  });
}

/**
 * Extract artist names from a track artist string (e.g. "Daddy Yankee feat. Ozuna" -> ["Daddy Yankee", "Ozuna"])
 */
export function extractDuetArtistsFromMetadata(artistString: string, titleString = ''): {
  singer1: string | null;
  singer2: string | null;
  isDuet: boolean;
} {
  const all = extractAllArtistsFromMetadata(artistString, titleString);
  if (all.length >= 2) {
    return {
      singer1: all[0].name,
      singer2: all[1].name,
      isDuet: true,
    };
  }
  return {
    singer1: all[0]?.name || (artistString ? titleCaseArtist(artistString) : null),
    singer2: null,
    isDuet: false,
  };
}

/**
 * Unified resolver for artist name, color, and duo/group flag.
 * Guarantees 100% color parity across Mini Player, Fullscreen TV, and Standalone TV.
 */
export function resolveArtistInfo(
  singerVal: string | undefined,
  artistsList: ArtistRole[] | undefined,
  songArtist = '',
  songTitle = ''
): { id: string; name: string; color: string; isBoth: boolean } {
  let effectiveArtists: ArtistRole[] = [];
  if (artistsList && artistsList.length > 0) {
    effectiveArtists = artistsList;
  } else if (songArtist) {
    effectiveArtists = extractAllArtistsFromMetadata(songArtist, songTitle || '');
  }

  if (effectiveArtists.length === 0) {
    return {
      id: 'artist-0',
      name: songArtist ? titleCaseArtist(songArtist) : 'Artista',
      color: '#00f0ff',
      isBoth: false,
    };
  }

  // If single artist song, everything belongs to that single artist
  if (effectiveArtists.length === 1) {
    const single = effectiveArtists[0];
    return {
      id: single.id,
      name: single.name,
      color: single.color,
      isBoth: false,
    };
  }

  // Multi-artist / Duet / Group resolution
  if (!singerVal || singerVal === 'both' || singerVal === 'all') {
    const namesStr = effectiveArtists.length > 2
      ? 'Todos'
      : (effectiveArtists.map(a => a.name).join(' & ') || 'Ambos');
    return {
      id: 'both',
      name: namesStr,
      color: '#fbbf24',
      isBoth: true,
    };
  }

  const foundById = effectiveArtists.find(a => a.id === singerVal);
  if (foundById) return { ...foundById, isBoth: false };

  if (singerVal === 'singer1' && effectiveArtists.length > 0) {
    return { ...effectiveArtists[0], isBoth: false };
  }
  if (singerVal === 'singer2' && effectiveArtists.length > 1) {
    return { ...effectiveArtists[1], isBoth: false };
  }

  const foundByName = effectiveArtists.find(a => a.name.toLowerCase() === singerVal.toLowerCase());
  if (foundByName) return { ...foundByName, isBoth: false };

  return {
    id: singerVal,
    name: singerVal,
    color: '#00f0ff',
    isBoth: false,
  };
}
