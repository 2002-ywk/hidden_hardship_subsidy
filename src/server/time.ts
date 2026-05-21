const DEFAULT_TIME_ZONE = process.env.APP_TIME_ZONE?.trim() || 'Asia/Shanghai';

// For parsing timestamps that do NOT include timezone information, we assume a fixed
// offset (China Standard Time: UTC+08:00). This keeps behavior stable even when the
// server runs in UTC (common on cloud hosts).
const DEFAULT_FIXED_OFFSET_MINUTES = Number(process.env.APP_FIXED_OFFSET_MINUTES ?? 480);

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function pad3(value: number) {
  return String(value).padStart(3, '0');
}

export type DateTimeParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

export function getDateTimePartsInTimeZone(value: Date, timeZone = DEFAULT_TIME_ZONE): DateTimeParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(value);

  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  return {
    year: map.year ?? '1970',
    month: map.month ?? '01',
    day: map.day ?? '01',
    hour: map.hour ?? '00',
    minute: map.minute ?? '00',
    second: map.second ?? '00',
  };
}

export function formatDateTimeInTimeZone(value: Date, timeZone = DEFAULT_TIME_ZONE) {
  const p = getDateTimePartsInTimeZone(value, timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export function formatDateTimeMinuteInTimeZone(value: Date, timeZone = DEFAULT_TIME_ZONE) {
  const p = getDateTimePartsInTimeZone(value, timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// Builds a Date whose ISO string is the wall-clock time in the given timeZone.
// Example: if timeZone shows "2026-04-27 15:36:29", this returns a Date whose
// toISOString() is "2026-04-27T15:36:29.000Z".
//
// This is useful when storing "naive local" datetimes into MySQL DATETIME columns
// via Prisma, while keeping Prisma's DateTime validation happy (it accepts Date/ISO)
// and avoiding environment-dependent timezone shifts.
export function naiveUtcDateFromTimeZone(value: Date, timeZone = DEFAULT_TIME_ZONE) {
  const p = getDateTimePartsInTimeZone(value, timeZone);
  const millis = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
    0
  );
  return new Date(millis);
}

export function monthKeyInTimeZone(value: Date, timeZone = DEFAULT_TIME_ZONE) {
  const p = getDateTimePartsInTimeZone(value, timeZone);
  return `${p.year}-${p.month}`;
}

export function hourInTimeZone(value: Date, timeZone = DEFAULT_TIME_ZONE) {
  const p = getDateTimePartsInTimeZone(value, timeZone);
  return Number(p.hour);
}

function buildUtcMillisFromLocalParts(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  fixedOffsetMinutes: number
) {
  // Interpret the input as a wall-clock time in a fixed-offset zone, then convert to UTC millis.
  const utcMillis = Date.UTC(year, monthIndex, day, hour, minute, second, ms);
  return utcMillis - fixedOffsetMinutes * 60 * 1000;
}

export function parseDateTimeAssumeFixedOffset(
  input: string | undefined | null,
  options?: { fixedOffsetMinutes?: number }
): Date | undefined {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return undefined;

  const fixedOffsetMinutes =
    options?.fixedOffsetMinutes ?? (Number.isFinite(DEFAULT_FIXED_OFFSET_MINUTES) ? DEFAULT_FIXED_OFFSET_MINUTES : 480);

  // If the string includes a timezone, treat it as an absolute instant.
  // Examples: "2026-04-27T10:00:00Z", "2026-04-27T10:00:00+08:00"
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  // YYYY-MM-DD
  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const monthIndex = Number(ymdMatch[2]) - 1;
    const day = Number(ymdMatch[3]);
    const millis = buildUtcMillisFromLocalParts(year, monthIndex, day, 0, 0, 0, 0, fixedOffsetMinutes);
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  // YYYY-MM-DD HH:mm:ss(.SSS) and YYYY-MM-DDTHH:mm:ss(.SSS)
  const normalized = trimmed.replace('T', ' ');
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/
  );
  if (match) {
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    const ms = match[7] ? Number(match[7].padEnd(3, '0')) : 0;
    const millis = buildUtcMillisFromLocalParts(year, monthIndex, day, hour, minute, second, ms, fixedOffsetMinutes);
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  // Digits-only fallback: YYYYMMDDHHmmss / YYYYMMDDHHmm / YYYYMMDD
  const digits = trimmed.replace(/[^\d]/g, '');
  if (/^\d{14}$/.test(digits)) {
    const year = Number(digits.slice(0, 4));
    const monthIndex = Number(digits.slice(4, 6)) - 1;
    const day = Number(digits.slice(6, 8));
    const hour = Number(digits.slice(8, 10));
    const minute = Number(digits.slice(10, 12));
    const second = Number(digits.slice(12, 14));
    const millis = buildUtcMillisFromLocalParts(year, monthIndex, day, hour, minute, second, 0, fixedOffsetMinutes);
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  if (/^\d{12}$/.test(digits)) {
    const year = Number(digits.slice(0, 4));
    const monthIndex = Number(digits.slice(4, 6)) - 1;
    const day = Number(digits.slice(6, 8));
    const hour = Number(digits.slice(8, 10));
    const minute = Number(digits.slice(10, 12));
    const millis = buildUtcMillisFromLocalParts(year, monthIndex, day, hour, minute, 0, 0, fixedOffsetMinutes);
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  if (/^\d{8}$/.test(digits)) {
    const year = Number(digits.slice(0, 4));
    const monthIndex = Number(digits.slice(4, 6)) - 1;
    const day = Number(digits.slice(6, 8));
    const millis = buildUtcMillisFromLocalParts(year, monthIndex, day, 0, 0, 0, 0, fixedOffsetMinutes);
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  // Epoch timestamps: seconds(10) / milliseconds(13)
  if (/^\d{10}$/.test(digits)) {
    const parsed = new Date(Number(digits) * 1000);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  if (/^\d{13}$/.test(digits)) {
    const parsed = new Date(Number(digits));
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  // Last resort: let JS parse (engine-dependent for non-ISO strings).
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function formatLocalDateTimeForSql(value: Date, timeZone = DEFAULT_TIME_ZONE) {
  // Returns "YYYY-MM-DD HH:mm:ss" in the target time zone, useful for generating
  // MySQL-compatible strings when needed.
  return formatDateTimeInTimeZone(value, timeZone);
}

export function formatLocalDateForSql(value: Date, timeZone = DEFAULT_TIME_ZONE) {
  const p = getDateTimePartsInTimeZone(value, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function buildLocalDateTimeText(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms = 0
) {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}${
    ms ? `.${pad3(ms)}` : ''
  }`;
}
