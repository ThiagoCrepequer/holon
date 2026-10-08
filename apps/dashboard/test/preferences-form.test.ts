import { describe, expect, it, vi } from "vitest";

import {
  preferencesCommand,
  inferDeviceTimezone,
  preferenceFields,
} from "../app/features/preferences/preferences-form.js";

describe("personal preference form boundary", () => {
  it("validates form fields independently and accepts both languages and IANA zones", () => {
    expect(
      preferenceFields({ language: "pt-BR", timezone: "America/Sao_Paulo" }),
    ).toEqual({ locale: "pt-BR", timezone: "America/Sao_Paulo" });
    expect(preferenceFields({ language: "en", timezone: "UTC" })).toEqual({
      locale: "en",
      timezone: "UTC",
    });
    expect(preferenceFields({ language: "fr", timezone: "UTC" })).toBeNull();
    expect(preferenceFields({ language: "en", timezone: "+02:00" })).toBeNull();
  });
  it("infers a supported device zone and explicitly falls back to UTC", () => {
    expect(inferDeviceTimezone(() => "Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(inferDeviceTimezone(() => "invalid")).toBe("UTC");
    expect(
      inferDeviceTimezone(() => {
        throw new Error("unavailable");
      }),
    ).toBe("UTC");
  });
  it("sends only personal fields, CSRF and the cancellation signal", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ preferences: { locale: "en", timezone: "UTC" } }),
      );
    const signal = new AbortController().signal;
    expect(
      await preferencesCommand(
        { locale: "en", timezone: "UTC" },
        "csrf",
        signal,
        fetcher,
      ),
    ).toEqual({ status: "saved", value: { locale: "en", timezone: "UTC" } });
    expect(fetcher).toHaveBeenCalledWith("/api/preferences", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf" },
      body: '{"locale":"en","timezone":"UTC"}',
      signal,
    });
  });
  it.each([401, 403])(
    "denied session %i never fabricates a saved result",
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
      expect(
        await preferencesCommand(
          { locale: "en", timezone: "UTC" },
          "csrf",
          new AbortController().signal,
          fetcher,
        ),
      ).toEqual({ status: "session-lost" });
    },
  );
  it.each([
    Response.json({ locale: "en", timezone: "+03:00" }),
    Response.json({ locale: "en", timezone: "UTC" }, { status: 503 }),
    new Response("invalid json"),
  ])("unconfirmed responses stay failures", async (response) => {
    expect(
      await preferencesCommand(
        { locale: "en", timezone: "UTC" },
        "csrf",
        new AbortController().signal,
        vi.fn().mockResolvedValue(response),
      ),
    ).toEqual({ status: "unconfirmed" });
  });
  it("network failure preserves the unknown outcome for retry", async () => {
    expect(
      await preferencesCommand(
        { locale: "en", timezone: "UTC" },
        "csrf",
        new AbortController().signal,
        vi.fn().mockRejectedValue(new Error("private message")),
      ),
    ).toEqual({ status: "unconfirmed" });
  });
});
