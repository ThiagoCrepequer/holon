import {
  reviewCursorPositionSchema as positionSchema,
  type PrivateReviewSummary,
  type ReviewListInput,
} from "@holon/contracts/dashboard-reviews";
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
const decode = (value: string) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (x) =>
    x.charCodeAt(0),
  );
const scope = (input: ReviewListInput) =>
  JSON.stringify([
    input.workspaceId,
    input.installationId,
    input.repositoryId,
    input.status,
    input.search,
    input.limit,
  ]);
export function createReviewCursor(secret: string | undefined) {
  const key = () => {
    if (!secret) throw new Error("cursor_key_missing");
    return crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  };

  return {
    async write(
      last: PrivateReviewSummary,
      input: ReviewListInput,
    ): Promise<string> {
      const body = encode(
        new TextEncoder().encode(
          JSON.stringify({
            activityAt: last.activityAt,
            pullRequestNumber: last.pullRequestNumber,
          }),
        ),
      );
      const sig = await crypto.subtle.sign(
        "HMAC",
        await key(),
        new TextEncoder().encode(scope(input) + "." + body),
      );
      return body + "." + encode(new Uint8Array(sig));
    },
    async read(value: string, input: ReviewListInput) {
      try {
        const parts = value.split(".");
        if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error();
        const valid = await crypto.subtle.verify(
          "HMAC",
          await key(),
          decode(parts[1]),
          new TextEncoder().encode(scope(input) + "." + parts[0]),
        );
        if (!valid) throw new Error();
        return positionSchema.parse(
          JSON.parse(new TextDecoder().decode(decode(parts[0]))),
        );
      } catch {
        throw new Error("invalid_review_cursor");
      }
    },
  };
}
