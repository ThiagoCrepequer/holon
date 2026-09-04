/**
 * Deterministic formatting helpers for numbers, durations, and UTC timestamps.
 *
 * Using explicit UTC time zones and standard "en-US" formatting guarantees
 * exact string parity between SSR (server) and client-side hydration, preventing
 * React hydration errors regardless of the user's browser locale.
 */

export function parseUtcDate(
  value: string | number | Date | null | undefined,
): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    let str = value.trim();
    if (!str) return null;
    if (/^\d+$/.test(str)) {
      const d = new Date(Number.parseInt(str, 10));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (!str.includes("T") && str.includes(" ")) {
      str = str.replace(" ", "T");
    }
    if (!str.endsWith("Z") && !/[+-]\d{2}(?::?\d{2})?$/.test(str)) {
      str += "Z";
    }
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

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
  const date = parseUtcDate(value);
  if (!date) return "";
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
  const date = parseUtcDate(value);
  if (!date) return "—";
  return `${tableDateTimeUtcFormatter.format(date)} UTC`;
}
