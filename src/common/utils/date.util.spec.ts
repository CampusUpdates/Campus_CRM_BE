import { isPreferredDateInPast } from './date.util';

describe('date.util - isPreferredDateInPast', () => {
  const getFormattedDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  it('accepts today local date as valid (not in past)', () => {
    const todayStr = getFormattedDate(new Date());
    expect(isPreferredDateInPast(todayStr)).toBe(false);
  });

  it('accepts future dates as valid', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(isPreferredDateInPast(getFormattedDate(tomorrow))).toBe(false);

    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    expect(isPreferredDateInPast(getFormattedDate(nextMonth))).toBe(false);
  });

  it('rejects dates in the past', () => {
    expect(isPreferredDateInPast('2020-01-01')).toBe(true);
    expect(isPreferredDateInPast('2024-05-15')).toBe(true);
  });

  it('handles empty, null, or undefined values safely without crashing', () => {
    expect(isPreferredDateInPast('')).toBe(false);
    expect(isPreferredDateInPast('   ')).toBe(false);
    expect(isPreferredDateInPast(null as any)).toBe(false);
    expect(isPreferredDateInPast(undefined as any)).toBe(false);
  });

  it('correctly handles ISO strings or date strings with timestamps', () => {
    const todayStr = `${getFormattedDate(new Date())}T00:00:00.000Z`;
    expect(isPreferredDateInPast(todayStr)).toBe(false);

    expect(isPreferredDateInPast('2020-01-01T10:00:00.000Z')).toBe(true);
  });
});
