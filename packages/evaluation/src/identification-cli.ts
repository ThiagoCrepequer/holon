import { GatewayProjectIdentificationModel } from "@holon/model";

import { evaluateIdentification } from "./identification.js";
const mode = process.argv[2];
if (mode !== "offline" && mode !== "live")
  throw new Error("Choose offline or live explicitly");
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
let inputTokens = 0,
  outputTokens = 0;
const model =
  mode === "live"
    ? new GatewayProjectIdentificationModel(
        {
          accountId: required("AI_GATEWAY_ACCOUNT_ID"),
          apiToken: required("AI_GATEWAY_API_TOKEN"),
          gatewayId: required("AI_GATEWAY_ID"),
          model: required("AI_MODEL_ID"),
        },
        (input, output) => {
          inputTokens += input;
          outputTokens += output;
        },
      )
    : undefined;
const report = await evaluateIdentification(model);
process.stdout.write(
  JSON.stringify({ ...report, mode, inputTokens, outputTokens }) + "\n",
);
if (
  report.falseExact ||
  report.failures ||
  report.precision < 0.98 ||
  report.recall < 0.9
)
  process.exitCode = 1;
