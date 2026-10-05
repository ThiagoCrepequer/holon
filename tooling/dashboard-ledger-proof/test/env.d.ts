import type { ProofLedger } from "../src/ledger-proof.js";
import type { EffectGate } from "./effect-gate.js";

declare global {
  namespace Cloudflare {
    interface Env {
      EFFECT_GATES: DurableObjectNamespace<EffectGate>;
      PROOF_LEDGERS: DurableObjectNamespace<ProofLedger>;
    }
  }
}
