import { DurableObject } from "cloudflare:workers";

// Controlled external service: no ledger storage or scheduler is mocked.
export class EffectGate extends DurableObject {
  private readonly entered = Promise.withResolvers<void>();
  private readonly released = Promise.withResolvers<void>();

  public hold(): Promise<void> {
    this.entered.resolve();
    return this.released.promise;
  }
  public waitForEntry(): Promise<void> {
    return this.entered.promise;
  }
  public finish(): void {
    this.released.resolve();
  }
}
