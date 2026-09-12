/**
 * Text search and normalization utilities.
 * Enables accent-insensitive, diacritic-insensitive, case-insensitive fuzzy matching.
 */

/**
 * Normalizes text for search by:
 * 1. Decomposing combined graphemes with Unicode NFD (e.g. 'á' -> 'a' + acute accent)
 * 2. Stripping all diacritical marks (á, é, í, ó, ú, ü, ñ, etc.)
 * 3. Converting to lowercase
 * 4. Trimming whitespace
 *
 * Example:
 * normalizeSearchText('Corazón') === 'corazon'
 * normalizeSearchText('Día') === 'dia'
 * normalizeSearchText('Éxitos') === 'exitos'
 */
export function normalizeSearchText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Returns true if target contains the query, ignoring case and accents/tildes.
 */
export function searchMatches(target: string | null | undefined, query: string): boolean {
  if (!query) return true;
  if (!target) return false;
  const normalizedTarget = normalizeSearchText(target);
  const normalizedQuery = normalizeSearchText(query);
  return normalizedTarget.includes(normalizedQuery);
}
