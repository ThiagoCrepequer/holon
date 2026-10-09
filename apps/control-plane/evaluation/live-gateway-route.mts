import { z } from "zod";

import { modelSpendPolicy } from "./live-model-spend.js";

/** Read-only route and price guard before any paid call. */
export async function verifyBenchmarkRoute(config: {
  accountId: string;
  gatewayId: string;
  token: string;
}) {
  const routeResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-gateway/gateways/${config.gatewayId}/routes`,
    {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  const routeData = z
    .looseObject({
      success: z.boolean(),
      data: z
        .looseObject({
          routes: z.array(
            z.looseObject({
              name: z.string(),
              deployment: z
                .looseObject({ version_id: z.string() })
                .nullable()
                .optional(),
            }),
          ),
        })
        .optional(),
    })
    .parse(await routeResponse.json());
  const route = routeData.data?.routes.find(
    (item) => item.name === "pr-review",
  );
  if (!routeResponse.ok || !routeData.success || !route)
    throw new Error("Cannot verify configured Gateway route");
  const routeList = z
    .looseObject({
      data: z.looseObject({
        routes: z.array(z.looseObject({ id: z.string(), name: z.string() })),
      }),
    })
    .parse(routeData);
  const routeId = routeList.data.routes.find(
    (item) => item.name === "pr-review",
  )!.id;
  const routeVersion = z
    .looseObject({
      success: z.literal(true),
      result: z.looseObject({
        data: z.array(
          z.looseObject({
            type: z.string(),
            properties: z
              .looseObject({
                provider: z.string(),
                model: z.string(),
                retries: z.literal(0),
              })
              .optional(),
          }),
        ),
      }),
    })
    .parse(
      await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-gateway/gateways/${config.gatewayId}/routes/${routeId}/versions/${route.deployment?.version_id}`,
        {
          headers: { Authorization: `Bearer ${config.token}` },
          signal: AbortSignal.timeout(15_000),
        },
      ).then((response) => response.json()),
    );
  const routeModels = routeVersion.result.data
    .filter((item) => item.type === "model")
    .map((item) => item.properties!);
  if (
    routeModels.length !== 2 ||
    routeModels.some((item) => item.provider !== "openrouter") ||
    JSON.stringify(routeModels.map((item) => item.model).toSorted()) !==
      JSON.stringify(
        [
          "google/gemma-4-26b-a4b-it:free",
          "google/gemma-4-26b-a4b-it-20260403",
        ].toSorted(),
      )
  )
    throw new Error(
      "Route no longer matches the costed two-attempt model policy",
    );
  const priceResponse = await fetch(
    "https://openrouter.ai/api/v1/models/google/gemma-4-26b-a4b-it/endpoints",
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!priceResponse.ok) throw new Error("Cannot verify current model prices");
  const prices = z
    .looseObject({
      data: z.looseObject({
        endpoints: z
          .array(
            z.looseObject({
              pricing: z.looseObject({
                prompt: z.string(),
                completion: z.string(),
                request: z.string().optional(),
              }),
            }),
          )
          .min(1),
      }),
    })
    .parse(await priceResponse.json());
  if (
    prices.data.endpoints.some(({ pricing }) => {
      const input = Number(pricing.prompt) * 1_000_000_000;
      const output = Number(pricing.completion) * 1_000_000_000;
      return (
        !Number.isFinite(input) ||
        !Number.isFinite(output) ||
        input < 0 ||
        output < 0 ||
        input > modelSpendPolicy.inputNanodollarsPerToken ||
        output > modelSpendPolicy.outputNanodollarsPerToken ||
        (pricing.request !== undefined && Number(pricing.request) !== 0)
      );
    })
  )
    throw new Error("Model pricing exceeds the campaign reservation policy");
  return {
    routeModels,
    routeDeployment: route.deployment?.version_id ?? null,
    pricesVerifiedAt: new Date().toISOString(),
  };
}
