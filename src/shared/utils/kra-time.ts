/**
 * KRA timestamps are Kenyan wall-clock time. Format them in Africa/Nairobi explicitly rather than
 * with Date's local-time getters, which read whatever timezone the server happens to run in (a UTC
 * server prints Kenyan evenings three hours early; a US server prints the wrong calendar day).
 */
const KRA_TIME_ZONE = 'Africa/Nairobi';

/** Wall-clock time a backdated sale is stamped with: a real, unambiguous mid-day, never midnight. */
export const BACKDATED_SALE_TIME = '120000';

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: KRA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export type KraClockParts = {
  yyyy: string;
  mm: string;
  dd: string;
  hh: string;
  mi: string;
  ss: string;
};

/** The Kenyan calendar date and clock time of an instant. */
export function kraClockParts(d: Date): KraClockParts {
  const parts: Record<string, string> = {};
  for (const p of formatter.formatToParts(d)) parts[p.type] = p.value;
  return {
    yyyy: parts.year,
    mm: parts.month,
    dd: parts.day,
    hh: parts.hour,
    mi: parts.minute,
    ss: parts.second,
  };
}

/** KRA's `yyyyMMdd`, in Kenya. */
export function formatKraDate(d: Date): string {
  const p = kraClockParts(d);
  return `${p.yyyy}${p.mm}${p.dd}`;
}

/** KRA's `yyyyMMddHHmmss`, in Kenya. */
export function formatKraDateTime(d: Date): string {
  const p = kraClockParts(d);
  return `${p.yyyy}${p.mm}${p.dd}${p.hh}${p.mi}${p.ss}`;
}

/**
 * The date and time to put on a sale sent to KRA.
 *
 * With no sale date, or a sale date that is today in Kenya, this is the real current time. A
 * backdated sale keeps the date it was given and is stamped mid-day: its real time is unknown,
 * and a made-up midnight read back through a timezone shows as 03:00 (or the wrong day).
 */
export function resolveKraSaleMoment(
  saleDate: string | null | undefined,
  now: Date,
): { yyyyMMdd: string; yyyyMMddhhmmss: string } {
  const today = formatKraDate(now);
  const requested = saleDate ? saleDate.replace(/-/g, '') : today;
  if (!/^\d{8}$/.test(requested) || requested === today) {
    return { yyyyMMdd: today, yyyyMMddhhmmss: formatKraDateTime(now) };
  }
  return {
    yyyyMMdd: requested,
    yyyyMMddhhmmss: `${requested}${BACKDATED_SALE_TIME}`,
  };
}
