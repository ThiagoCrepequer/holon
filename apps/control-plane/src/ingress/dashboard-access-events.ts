import {
  githubAccessEventSchema,
  githubAccessQueueMessageSchema,
  type GitHubAccessEvent,
} from "@holon/contracts/dashboard-collaboration";
/** Private binding only. Webhook signatures and provider payloads are verified by ingress. */
export async function forwardDashboardAccessEvent(
  environment: { DASHBOARD_ACCESS_EVENTS?: unknown },
  event: GitHubAccessEvent,
): Promise<void> {
  const sink = environment.DASHBOARD_ACCESS_EVENTS;
  if (
    !sink ||
    typeof sink !== "object" ||
    !("applyEvent" in sink) ||
    typeof sink.applyEvent !== "function"
  )
    throw new Error("invalid dashboard access binding");
  await sink.applyEvent(githubAccessEventSchema.parse(event));
}

export async function dispatchDashboardAccessMessages(
  messages: readonly { body: unknown; ack(): void; retry(): void }[],
  environment: { DASHBOARD_ACCESS_EVENTS?: unknown },
): Promise<void> {
  for (const message of messages) {
    const parsed = githubAccessQueueMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      message.ack();
      continue;
    }
    try {
      await forwardDashboardAccessEvent(environment, parsed.data.access);
      message.ack();
    } catch {
      message.retry();
    }
  }
}
