import {
  thinkEvaluationStartRequestSchema,
  thinkEvaluationStatusResponseSchema,
  type ThinkEvaluationStartRequest,
  type ThinkEvaluationStatusResponse,
} from "@holon/evaluation";
import { baselineCorpusV3 } from "@holon/evaluation/corpus/v3";

interface EvaluationAgentStub {
  reviewStatus(workflowId: string): Promise<ThinkEvaluationStatusResponse>;
  startReview(
    request: ThinkEvaluationStartRequest,
    workflowId: string,
  ): Promise<string>;
}

export type EvaluationAgentResolver = (
  agentName: string,
) => Promise<EvaluationAgentStub>;

const allowedCaseIds = new Set(baselineCorpusV3.map(({ id }) => id));
const agentNamePattern = /^eval-[a-f0-9]{64}$/u;
const workflowIdPattern = /^review-[a-f0-9]{64}$/u;
const maximumRequestBytes = 4_096;

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    headers: { "cache-control": "no-store" },
    status,
  });
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function hasValidAuthorization(
  request: Request,
  expectedToken: string,
): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  if (
    authorization === null ||
    !authorization.startsWith("Bearer ") ||
    expectedToken.length < 16 ||
    expectedToken.length > 4_096
  ) {
    return false;
  }
  const supplied = authorization.slice("Bearer ".length);
  const [left, right] = await Promise.all([
    digest(supplied),
    digest(expectedToken),
  ]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

async function agentIdentity(request: ThinkEvaluationStartRequest): Promise<{
  readonly agentName: string;
  readonly workflowId: string;
}> {
  const identity = await digest(
    [request.sourceRevision, request.evaluationRunId, request.caseId].join(":"),
  );
  const hex = [...identity]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { agentName: `eval-${hex}`, workflowId: `review-${hex}` };
}

async function readStartRequest(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) ||
      Number(contentLength) > maximumRequestBytes)
  ) {
    throw new TypeError("request body is too large");
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new TypeError("request content type is invalid");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumRequestBytes) {
    throw new TypeError("request body is too large");
  }
  return JSON.parse(text) as unknown;
}

export function createHarnessEvaluationHandler(
  env: Pick<Cloudflare.Env, "SOURCE_REVISION" | "THINK_EVALUATION_API_TOKEN">,
  resolveAgent: EvaluationAgentResolver,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (
      !(await hasValidAuthorization(request, env.THINK_EVALUATION_API_TOKEN))
    ) {
      return json({ error: "unauthorized" }, 401);
    }
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/runs") {
      let startRequest: ThinkEvaluationStartRequest;
      try {
        startRequest = thinkEvaluationStartRequestSchema.parse(
          await readStartRequest(request),
        );
      } catch {
        return json({ error: "invalid_run_request" }, 400);
      }
      if (
        startRequest.sourceRevision !== env.SOURCE_REVISION ||
        !allowedCaseIds.has(startRequest.caseId)
      ) {
        return json({ error: "run_not_allowed" }, 409);
      }
      try {
        const identity = await agentIdentity(startRequest);
        const agent = await resolveAgent(identity.agentName);
        const workflowId = await agent.startReview(
          startRequest,
          identity.workflowId,
        );
        return json({
          agentName: identity.agentName,
          sourceRevision: env.SOURCE_REVISION,
          workflowId,
        });
      } catch {
        return json({ error: "run_unavailable" }, 503);
      }
    }
    const match = /^\/runs\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (request.method === "GET" && match !== null) {
      const agentName = decodeURIComponent(match[1]!);
      const workflowId = decodeURIComponent(match[2]!);
      if (
        !agentNamePattern.test(agentName) ||
        !workflowIdPattern.test(workflowId) ||
        agentName.slice("eval-".length) !== workflowId.slice("review-".length)
      ) {
        return json({ error: "run_not_found" }, 404);
      }
      try {
        const agent = await resolveAgent(agentName);
        return json(
          thinkEvaluationStatusResponseSchema.parse(
            await agent.reviewStatus(workflowId),
          ),
        );
      } catch {
        return json({ error: "run_unavailable" }, 503);
      }
    }
    return json({ error: "not_found" }, 404);
  };
}
