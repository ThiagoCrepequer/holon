/** Only catalogued messages may cross logging and durable Workflow boundaries. */
export const diagnosticMessages = {
  github_current_key_missing:
    "Missing GitHub App private key: configure GITHUB_APP_PRIVATE_KEY_CURRENT",
  github_previous_without_current:
    "GITHUB_APP_PRIVATE_KEY_PREVIOUS cannot be configured without a CURRENT key",
  github_app_id_invalid: "GitHub App ID must be a positive safe integer",
  github_app_slug_invalid: "GitHub App slug must use GitHub slug characters",

  github_key_pkcs1_unsupported:
    "The JWT signer requires a PKCS#8 PEM; the supplied key uses PKCS#1.",
  github_key_openssh_unsupported:
    "The JWT signer requires a PKCS#8 PEM; the supplied key uses OpenSSH.",
  github_key_invalid:
    "The private key could not be imported or used for signing.",
  github_configuration_invalid:
    "GitHub App configuration is missing or invalid.",
  github_auth_rejected: "GitHub rejected the App authentication credentials.",
  github_permission_denied: "GitHub denied access to the requested resource.",
  github_response_invalid:
    "The GitHub response did not satisfy the expected contract.",
  github_rate_limited: "GitHub rate limited the request.",
  github_unavailable: "GitHub is temporarily unavailable.",
  github_transport_failed:
    "The GitHub request failed before a usable response was received.",
  github_unknown_failure:
    "An unrecognized GitHub client error occurred; inspect its phase and origin code.",
} as const;
export type DiagnosticReason = keyof typeof diagnosticMessages;

export function diagnosticReason(value: unknown): DiagnosticReason | undefined {
  return typeof value === "string" && Object.hasOwn(diagnosticMessages, value)
    ? (value as DiagnosticReason)
    : undefined;
}

export function nativeErrorCode(value: unknown): string | undefined {
  return typeof value === "string" &&
    [
      "ERR_OSSL_UNSUPPORTED",
      "ERR_OSSL_ASN1_WRONG_TAG",
      "ERR_OSSL_ASN1_TOO_LONG",
      "ERR_INVALID_ARG_TYPE",
      "ERR_INVALID_ARG_VALUE",
      "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE",
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ENOTFOUND",
      "UND_ERR_CONNECT_TIMEOUT",
    ].includes(value)
    ? value
    : undefined;
}
