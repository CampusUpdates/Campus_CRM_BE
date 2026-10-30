/**
 * Campus CRM - Phone Number Normalization Utility
 *
 * Normalizes phone numbers to standard 10-digit format for Indian phone numbers,
 * handling permitted formatting differences (spaces, hyphens, parentheses)
 * and country-code prefixes (+91, 91, 0).
 */

export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length > 10) {
    return digits.slice(-10);
  }
  return digits;
}

/**
 * Returns candidate phone strings for querying indexed phone fields in Postgres.
 * E.g., for '9876543210' -> ['9876543210', '+919876543210', '919876543210', '09876543210', ...]
 * Accepts a single phone string or an Iterable of phone strings.
 */
export function getPhoneQueryCandidates(
  phoneOrIterable: string | Iterable<string> | null | undefined,
): string[] {
  if (!phoneOrIterable) return [];
  const candidates = new Set<string>();

  const inputList: string[] =
    typeof phoneOrIterable === 'string'
      ? [phoneOrIterable]
      : Array.from(phoneOrIterable);

  for (const item of inputList) {
    if (!item) continue;
    const raw = String(item).trim();
    if (raw) {
      candidates.add(raw);
    }

    const norm = normalizePhone(raw);
    if (norm && norm.length >= 10) {
      candidates.add(norm);
      candidates.add(`+91${norm}`);
      candidates.add(`91${norm}`);
      candidates.add(`0${norm}`);
      candidates.add(`+91 ${norm}`);
      candidates.add(`+91-${norm}`);
    }
  }

  return Array.from(candidates);
}
