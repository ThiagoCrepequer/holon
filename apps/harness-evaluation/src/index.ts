import { getAgentByName } from "agents";

import { createHarnessEvaluationHandler } from "./router.js";

export { HarnessEvaluationAgent } from "./agent.js";
export { HarnessEvaluationWorkflow } from "./workflow.js";

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const handler = createHarnessEvaluationHandler(env, async (agentName) =>
      getAgentByName(env.HARNESS_EVALUATION_AGENTS, agentName),
    );
    return await handler(request);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
