export type OptionalIntegration = "analytics_engine" | "queue_metrics";

export type IntegrationUnavailableReason =
  | "missing_configuration"
  | "request_failed"
  | "upstream_error";

export interface IntegrationUnavailableLog {
  readonly event: "holon.admin.integration_unavailable";
  readonly integration: OptionalIntegration;
  readonly reason: IntegrationUnavailableReason;
  readonly upstreamStatus?: number | undefined;
}

export type ObservabilityLogger = (entry: IntegrationUnavailableLog) => void;

export const consoleObservabilityLogger: ObservabilityLogger = (entry) => {
  console.warn(JSON.stringify(entry));
};
