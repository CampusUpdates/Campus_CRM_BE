/**
 * Checks whether a given date string (YYYY-MM-DD or ISO string) represents a date
 * strictly in the past, taking both local server time and UTC into account so that
 * today's date in the user's intended timezone is never rejected across timezone boundaries.
 */
export function isPreferredDateInPast(dateStr: string): boolean {
  if (!dateStr || !dateStr.trim()) return false;
  const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return false;

  const inputDateStr = `${match[1]}-${match[2]}-${match[3]}`;

  const now = new Date();

  // Local server today (YYYY-MM-DD)
  const localYear = now.getFullYear();
  const localMonth = String(now.getMonth() + 1).padStart(2, '0');
  const localDay = String(now.getDate()).padStart(2, '0');
  const localToday = `${localYear}-${localMonth}-${localDay}`;

  // UTC today (YYYY-MM-DD)
  const utcYear = now.getUTCFullYear();
  const utcMonth = String(now.getUTCMonth() + 1).padStart(2, '0');
  const utcDay = String(now.getUTCDate()).padStart(2, '0');
  const utcToday = `${utcYear}-${utcMonth}-${utcDay}`;

  // Considered in the past only if strictly earlier than today in both local and UTC boundaries
  return inputDateStr < localToday && inputDateStr < utcToday;
}
