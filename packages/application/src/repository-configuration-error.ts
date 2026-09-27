export class RepositoryConfigurationError extends Error {
  readonly retryAfterMs: number | undefined;
  readonly line: number | undefined;
  readonly column: number | undefined;
  constructor(
    readonly code: string,
    readonly location = "configuration",
    details: {
      retryAfterMs?: number | undefined;
      line?: number | undefined;
      column?: number | undefined;
    } = {},
  ) {
    super(
      `Repository configuration: ${code} at ${location}${details.line === undefined ? "" : ` (${details.line}:${details.column ?? 1})`}`,
    );
    this.name = "RepositoryConfigurationError";
    this.retryAfterMs = details.retryAfterMs;
    this.line = details.line;
    this.column = details.column;
  }
}
