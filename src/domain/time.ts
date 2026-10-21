export const DAY_MS = 86_400_000;

const SOURCE_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Converts a publisher timestamp to an epoch in the local-clock frame.
 *
 * Zone-free values (`2026-08-10T22:15:00.000`, `2026-08-10 22:15:00.0000000`, `2026-08-10`)
 * are read as wall-clock time. Values with an explicit zone are true instants and keep it.
 */
export function sourceTimestampToEpoch(value: string): number {
  const match = SOURCE_TIMESTAMP.exec(value.trim());
  if (!match) return Number.NaN;
  const [, year, month, day, hour = '00', minute = '00', second = '00', fraction = '', zone] = match;
  const milliseconds = Number(fraction.padEnd(3, '0').slice(0, 3));
  const wallClock = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    milliseconds,
  );
  const parsed = new Date(wallClock);
  const validCalendar = parsed.getUTCFullYear() === Number(year)
    && parsed.getUTCMonth() === Number(month) - 1
    && parsed.getUTCDate() === Number(day)
    && parsed.getUTCHours() === Number(hour)
    && parsed.getUTCMinutes() === Number(minute);
  if (!validCalendar) return Number.NaN;
  if (!zone) return wallClock;
  return Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}.${String(milliseconds).padStart(3, '0')}${zone}`);
}

/** Joins a publisher date and optional `HH:MM[:SS]` time into a zone-free timestamp. */
export function combineDateAndTime(dateValue: string, timeValue?: string): string {
  const date = dateValue.slice(0, 10);
  const time = timeValue && /^\d{2}:\d{2}/.test(timeValue) ? timeValue.slice(0, 8) : '00:00:00';
  return `${date}T${time.length === 5 ? `${time}:00` : time}`;
}

export function hourFromTimestamp(value: string): number | null {
  const match = /[T ](\d{2}):/.exec(value);
  if (!match?.[1]) return null;
  const hour = Number(match[1]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

export function formatSourceTimestamp(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute] = match;
  return `${month}/${day}/${year} · ${hour}:${minute}`;
}

/** `YYYY-MM-DD` of a local-clock epoch. */
export function isoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/** Zone-free `YYYY-MM-DDTHH:mm:ss` of a local-clock epoch. */
export function localClockTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 19);
}

export function startOfDay(epochMs: number): number {
  return Math.floor(epochMs / DAY_MS) * DAY_MS;
}

const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string) {
  let formatter = wallClockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    wallClockFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Converts a true UTC instant into the local-clock frame of `timeZone`. */
export function toLocalClockEpoch(utcEpochMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    wallClockFormatter(timeZone)
      .formatToParts(new Date(utcEpochMs))
      .map((part) => [part.type, part.value]),
  );
  const wholeSeconds = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return wholeSeconds + (((utcEpochMs % 1000) + 1000) % 1000);
}

const dayLabel = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const shortDayLabel = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
});

/** `Jun 30, 2026` for a local-clock epoch. */
export function formatDay(epochMs: number): string {
  return dayLabel.format(new Date(epochMs));
}

/** `Jun 1 – Jun 30, 2026` for an inclusive local-clock day range. */
export function formatDayRange(firstDayEpochMs: number, lastDayEpochMs: number): string {
  const sameYear = new Date(firstDayEpochMs).getUTCFullYear() === new Date(lastDayEpochMs).getUTCFullYear();
  const first = sameYear ? shortDayLabel.format(new Date(firstDayEpochMs)) : formatDay(firstDayEpochMs);
  return `${first} – ${formatDay(lastDayEpochMs)}`;
}
