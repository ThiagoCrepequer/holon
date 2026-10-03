// Executed only by cli.test.mjs in a separate process. Every command and HTTP
// request is intercepted before importing the CLI; no real remote operation exists.
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import readline from "node:readline/promises";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

const scenario = process.argv[2];
const temporary = process.argv[3];
const accountId = "a".repeat(32);
const queueId = "b".repeat(32);
const revision = "c".repeat(40);
const namespaceId = "d".repeat(32);
const applicationId = "11111111-1111-4111-8111-111111111111";
const cpVersion = "22222222-2222-4222-8222-222222222222";
const exVersion = "33333333-3333-4333-8333-333333333333";
const deploymentId = "44444444-4444-4444-8444-444444444444";
const root = fileURLToPath(new URL("../../../", import.meta.url)).replace(
  /\/$/u,
  "",
);
const calls = [];
let paused = false;
let confirmations = 0;
let rolloutConfirmed = false;
Object.defineProperty(process.stdin, "isTTY", { value: true });
Object.defineProperty(process.stdout, "isTTY", { value: true });
process.env.CLOUDFLARE_API_TOKEN = "offline-simulation-token";
if (scenario === "missing-token") delete process.env.CLOUDFLARE_API_TOKEN;
if (scenario === "lock-existing")
  await fs.writeFile(`${temporary}/holon-deploy.lock`, "existing");

childProcess.spawn = (executable, args, options) => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  calls.push([executable, ...args]);
  setImmediate(() => {
    let text = "";
    let code = 0;
    if (executable === "git") {
      if (args.includes("--show-toplevel")) text = root;
      else if (args.includes("HEAD")) text = revision;
      else if (args.includes("--git-common-dir")) text = temporary;
      else if (args[0] === "status")
        text = scenario === "dirty-tree" ? " M changed.ts" : "";
      else throw new Error("Unexpected Git command");
    } else if (executable === "pnpm") {
      if (args[0] === "--version")
        text = scenario === "wrong-toolchain" ? "11.19.0" : "11.24.0";
      else if (args[0] === "verify")
        code = scenario === "verify-failed" ? 1 : 0;
      else if (args.includes("pause-delivery")) paused = true;
      else if (args.includes("resume-delivery")) paused = false;
      else if (args.includes("deploy")) {
        if (
          options.env.CLOUDFLARE_ACCOUNT_ID !== accountId ||
          options.env.CLOUDFLARE_ENV !== "" ||
          options.env.CLOUDFLARE_API_BASE_URL !==
            "https://api.cloudflare.com/client/v4" ||
          options.env.WRANGLER_LOG_SANITIZE !== "true" ||
          args[args.indexOf("--env") + 1] !== "" ||
          !args.includes(revision)
        )
          throw new Error("Wrong command binding");
        if (
          scenario === "fail-executor" &&
          args.includes("apps/repository-executor/wrangler.jsonc")
        )
          code = 1;
      } else throw new Error("Unexpected pnpm command");
    } else throw new Error("Real command forbidden");
    child.stdout.end(text);
    child.stderr.end();
    child.emit("close", code);
  });
  return child;
};

readline.createInterface = () => ({
  on() {},
  close() {},
  async question(prompt) {
    if (prompt.startsWith("ID/")) return "change-123";
    confirmations++;
    const phrase = prompt.split("\n")[1];
    if (phrase.startsWith("RETOMAR")) rolloutConfirmed = true;
    if (scenario === "reject-drain" && phrase.startsWith("DRENADO"))
      return "cancelar";
    return phrase;
  },
});

const appendFile = fs.appendFile;
fs.appendFile = async (path, value, options) => {
  if (scenario === "audit-failed" && JSON.parse(value).stage === "completed")
    throw new Error("simulated audit failure");
  return appendFile(path, value, options);
};
syncBuiltinESMExports();

const response = (result, resultInfo) =>
  new Response(
    JSON.stringify({
      success: true,
      errors: [],
      messages: [],
      result,
      ...(resultInfo ? { result_info: resultInfo } : {}),
    }),
    { headers: { "content-type": "application/json" } },
  );
globalThis.fetch = async (url, options) => {
  if (
    options.method !== "GET" ||
    !url.startsWith(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/`,
    )
  )
    throw new Error("Real request forbidden");
  const path = new URL(url).pathname;
  if (path.includes("/queues/"))
    return response({
      queue_id: queueId,
      queue_name: "holon-review-jobs",
      settings: { delivery_paused: paused },
    });
  if (path.includes("/workflows/")) {
    if (scenario === "interrupt-final" && rolloutConfirmed)
      process.emit("SIGINT");
    const result =
      scenario === "active-workflow"
        ? [
            {
              id: "active",
              status: "running",
              version_id: cpVersion,
              workflow_id: deploymentId,
            },
          ]
        : [];
    return response(result, {
      count: result.length,
      per_page: 100,
      cursor: null,
    });
  }
  if (path.endsWith("/deployments"))
    return response({
      deployments: [
        {
          id: deploymentId,
          strategy: "percentage",
          versions: [
            {
              version_id: path.includes("control-plane")
                ? cpVersion
                : exVersion,
              percentage: 100,
            },
          ],
        },
      ],
    });
  if (path.includes("/versions/")) {
    const executor = path.includes("repository-executor");
    return response({
      id: executor ? exVersion : cpVersion,
      annotations: {
        "workers/tag": scenario === "wrong-tag" ? "wrong" : revision,
      },
      bindings: executor
        ? [
            {
              name: "SANDBOXES",
              type: "durable_object_namespace",
              class_name: "HolonSandbox",
              namespace_id: namespaceId,
            },
          ]
        : [],
    });
  }
  if (path.endsWith("/instances-v2"))
    return response([], { next_page_token: null });
  if (path.includes("/containers/applications/"))
    return response({
      id: applicationId,
      account_id: accountId,
      scheduling_policy: "default",
      configuration: { image: "registry.cloudflare.com/holon:image-hash" },
      version: 1,
      durable_objects: { namespace_id: namespaceId },
    });
  throw new Error("Unexpected API request");
};

const { main } = await import("../cli.mjs");
let failed = false;
try {
  await main([
    "--account",
    accountId,
    "--queue",
    queueId,
    "--application",
    applicationId,
    "--revision",
    revision,
  ]);
} catch {
  failed = true;
}
console.log(
  "SIMULATION_RESULT " +
    JSON.stringify({ failed, paused, calls, confirmations }),
);
