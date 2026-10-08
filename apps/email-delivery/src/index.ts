import {
  deliveryWakeSchema,
  type DeliveryWakeResult,
} from "@holon/contracts/dashboard";
import { WorkerEntrypoint } from "cloudflare:workers";

export default class EmailDelivery extends WorkerEntrypoint {
  override fetch(): Response {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  async wake(input: unknown): Promise<DeliveryWakeResult> {
    if (!deliveryWakeSchema.safeParse(input).success)
      throw new Error("invalid_request");
    // Queue/publisher is M4. Do not claim accepted or sent in the bootstrap.
    return { status: "unavailable" };
  }
}
