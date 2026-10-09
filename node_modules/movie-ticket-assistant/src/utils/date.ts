/**
 * Date and Time utilities for Seat Drop Sniper
 */

/**
 * Normalizes user date input into standard YYYY-MM-DD ISO string
 */
export function normalizeToIsoDate(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();

  // If already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // Handle DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Handle natural language like "13th October", "13 October", "Oct 13"
  const cleaned = trimmed.replace(/(st|nd|rd|th)/gi, '');
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return trimmed;
}

/**
 * Formats ISO date to readable string, e.g. "Sun, 13 Oct 2026"
 */
export function formatDateDisplay(isoDate: string): string {
  if (!isoDate) return '';
  try {
    const [year, month, day] = isoDate.split('-').map(Number);
    if (!year || !month || !day) return isoDate;
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

/**
 * Returns an array of upcoming date options starting today for easy selection
 */
export function getUpcomingDateOptions(count = 7): Array<{
  isoDate: string;
  label: string;
  relativeLabel: string;
}> {
  const options: Array<{ isoDate: string; label: string; relativeLabel: string }> = [];
  const today = new Date();

  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const isoDate = `${year}-${month}-${day}`;

    let relativeLabel = '';
    if (i === 0) relativeLabel = 'Today';
    else if (i === 1) relativeLabel = 'Tomorrow';
    else relativeLabel = d.toLocaleDateString('en-US', { weekday: 'short' });

    const monthName = d.toLocaleDateString('en-US', { month: 'short' });
    const label = `${d.getDate()} ${monthName}`;

    options.push({ isoDate, label, relativeLabel });
  }

  return options;
}

/**
 * Format milliseconds remaining into MM:SS or HH:MM:SS
 */
export function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return '00:00';
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Standard cinema time slots
 */
export type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'night';

export const TIME_SLOT_CONFIG: Record<
  TimeSlot,
  { label: string; desc: string; icon: string }
> = {
  morning: { label: 'Morning', desc: 'Before 12 PM', icon: '🌅' },
  afternoon: { label: 'Afternoon', desc: '12 PM – 5 PM', icon: '☀️' },
  evening: { label: 'Evening', desc: '5 PM – 9 PM', icon: '🌆' },
  night: { label: 'Night', desc: 'After 9 PM', icon: '🌙' },
};

/**
 * Classifies a time string (e.g. "14:30", "19:00", "10:15") into a TimeSlot
 */
export function getTimeSlot(timeStr: string): TimeSlot {
  if (!timeStr) return 'afternoon';
  const hour = parseInt(timeStr.split(':')[0], 10);
  if (isNaN(hour)) return 'afternoon';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

/**
 * Default rows to search: B, C, D, E, F
 * Excludes front row A (too close to screen) and back rows G-N (e.g. L, N)
 */
export const DEFAULT_ALLOWED_ROWS = ['B', 'C', 'D', 'E', 'F'];

/**
 * Normalizes row labels like "Row B", "B01", "b", "B" into uppercase single letter "B"
 */
export function normalizeRowLabel(row: string): string {
  if (!row) return '';
  return row.trim().toUpperCase().replace(/^ROW\s*/i, '').replace(/\d+$/, '');
}

/**
 * Checks whether a row matches the list of allowed rows
 */
export function isRowAllowed(rowLabel: string, allowedRows?: string[]): boolean {
  if (!allowedRows || allowedRows.length === 0) return true;
  const cleanLabel = normalizeRowLabel(rowLabel);
  return allowedRows.some(a => normalizeRowLabel(a) === cleanLabel);
}
