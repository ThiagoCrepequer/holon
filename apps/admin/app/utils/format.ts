/**
 * Deterministic formatting helpers for numbers, durations, and UTC timestamps.
 *
 * Using explicit UTC time zones and standard "en-US" formatting guarantees
 * exact string parity between SSR (server) and client-side hydration, preventing
 * React hydration errors regardless of the user's browser locale.
 */

const integerFormatter = new Intl.NumberFormat("en-US");

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "0";
  }
  return integerFormatter.format(value);
}

const fullDateTimeUtcFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function formatDateTimeUtc(
  value: string | number | Date | null | undefined,
): string {
  if (!value) return "";
  const date = typeof value === "object" ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${fullDateTimeUtcFormatter.format(date)} UTC`;
}

const tableDateTimeUtcFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatTableDateTimeUtc(
  value: string | number | Date | null | undefined,
): string {
  if (!value) return "—";
  const date = typeof value === "object" ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${tableDateTimeUtcFormatter.format(date)} UTC`;
}
