import type { EmailResult } from "@holon/contracts/email-delivery";
const permanent = new Set([
  "E_VALIDATION_ERROR",
  "E_FIELD_MISSING",
  "E_TOO_MANY_RECIPIENTS",
  "E_TOO_MANY_ATTACHMENTS",
  "E_SENDER_NOT_VERIFIED",
  "E_RECIPIENT_NOT_ALLOWED",
  "E_RECIPIENT_SUPPRESSED",
  "E_SENDER_DOMAIN_NOT_AVAILABLE",
  "E_CONTENT_TOO_LARGE",
  "E_DELIVERY_FAILED",
  "E_HEADER_NOT_ALLOWED",
  "E_HEADER_USE_API_FIELD",
  "E_HEADER_VALUE_INVALID",
  "E_HEADER_VALUE_TOO_LONG",
  "E_HEADER_NAME_INVALID",
  "E_HEADERS_TOO_LARGE",
  "E_HEADERS_TOO_MANY",
]);
const transient = new Set([
  "E_RATE_LIMIT_EXCEEDED",
  "E_DAILY_LIMIT_EXCEEDED",
  "E_INTERNAL_SERVER_ERROR",
]);
export async function sendInvitation(
  binding: SendEmail,
  message: EmailMessageBuilder,
): Promise<EmailResult["outcome"]> {
  try {
    const response = await binding.send(message);
    return typeof response?.messageId === "string" &&
      response.messageId.length > 0
      ? "accepted"
      : "unknown";
  } catch (error: unknown) {
    const code =
      error && typeof error === "object" && "code" in error ? error.code : null;
    if (typeof code === "string" && permanent.has(code)) return "permanent";
    if (typeof code === "string" && transient.has(code)) return "transient";
    return "unknown";
  }
}
