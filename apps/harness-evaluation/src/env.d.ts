import type { HarnessEvaluationAgent } from "./agent.js";

declare global {
  namespace Cloudflare {
    interface Env {
      AI_GATEWAY_ACCOUNT_ID: string;
      AI_GATEWAY_API_TOKEN: string;
      AI_GATEWAY_ID: string;
      AI_MODEL_ID: string;
      HARNESS_EVALUATION_AGENTS: DurableObjectNamespace<HarnessEvaluationAgent>;
      SOURCE_REVISION: string;
      THINK_EVALUATION_API_TOKEN: string;
      THINK_EVALUATION_WORKFLOW: Workflow;
    }
  }
}
