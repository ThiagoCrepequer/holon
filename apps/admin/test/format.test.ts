import { describe, expect, it } from "vitest";

import {
  formatDateTimeUtc,
  formatNumber,
  formatTableDateTimeUtc,
} from "../app/utils/format.js";

describe("Deterministic formatting helpers", () => {
  describe("formatNumber", () => {
    it("formats numbers with en-US comma separation", () => {
      expect(formatNumber(0)).toBe("0");
      expect(formatNumber(120)).toBe("120");
      expect(formatNumber(12400)).toBe("12,400");
      expect(formatNumber(1000000)).toBe("1,000,000");
    });

    it("handles null, undefined, and NaN gracefully", () => {
      expect(formatNumber(null)).toBe("0");
      expect(formatNumber(undefined)).toBe("0");
      expect(formatNumber(Number.NaN)).toBe("0");
    });
  });

  describe("formatDateTimeUtc", () => {
    it("formats ISO string deterministically in UTC", () => {
      const formatted = formatDateTimeUtc("2026-09-04T18:02:31.000Z");
      expect(formatted).toBe("Sep 4, 2026, 18:02:31 UTC");
    });

    it("formats Date object deterministically in UTC", () => {
      const date = new Date("2026-01-15T09:30:00.000Z");
      const formatted = formatDateTimeUtc(date);
      expect(formatted).toBe("Jan 15, 2026, 09:30:00 UTC");
    });

    it("handles empty or invalid inputs", () => {
      expect(formatDateTimeUtc(null)).toBe("");
      expect(formatDateTimeUtc(undefined)).toBe("");
      expect(formatDateTimeUtc("")).toBe("");
      expect(formatDateTimeUtc("invalid-date")).toBe("");
    });
  });

  describe("formatTableDateTimeUtc", () => {
    it("formats table short timestamp in UTC", () => {
      const formatted = formatTableDateTimeUtc("2026-09-04T18:02:31.000Z");
      expect(formatted).toBe("Sep 4, 18:02 UTC");
    });

    it("returns dash for empty or invalid inputs", () => {
      expect(formatTableDateTimeUtc(null)).toBe("—");
      expect(formatTableDateTimeUtc(undefined)).toBe("—");
      expect(formatTableDateTimeUtc("")).toBe("—");
      expect(formatTableDateTimeUtc("invalid-date")).toBe("—");
    });
  });
});
