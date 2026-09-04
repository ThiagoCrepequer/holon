import { describe, expect, it, vi } from "vitest";

const { cloudflareOptions } = vi.hoisted(() => ({
  cloudflareOptions: vi.fn(),
}));
vi.mock("@cloudflare/vite-plugin", () => ({ cloudflare: cloudflareOptions }));
vi.mock("@react-router/dev/vite", () => ({ reactRouter: () => [] }));
vi.mock("@tailwindcss/vite", () => ({ default: () => [] }));

import config from "../vite.config.js";

describe("local development configuration", () => {
  it.each([
    { command: "serve" as const, isPreview: false, local: true },
    { command: "serve" as const, isPreview: true, local: false },
    { command: "build" as const, isPreview: false, local: false },
  ])(
    "loads local auth settings only for $command with preview=$isPreview",
    ({ command, isPreview, local }) => {
      cloudflareOptions.mockClear();
      if (typeof config === "function")
        config({ command, isPreview, mode: "development" });
      const options = cloudflareOptions.mock.calls.at(-1)?.[0];
      const original = { secrets: { required: ["ADMIN_CURSOR_HMAC_KEYS"] } };
      const override = options?.config?.(original);
      if (local) {
        expect(override?.secrets?.required).toEqual([
          "ADMIN_CURSOR_HMAC_KEYS",
          "DEV_BYPASS_AUTH",
          "DEV_USER_EMAIL",
        ]);
      } else {
        expect(override).toBeUndefined();
      }
      expect(original.secrets.required).toEqual(["ADMIN_CURSOR_HMAC_KEYS"]);
    },
  );
});
