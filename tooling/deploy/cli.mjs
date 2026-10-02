import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { deployCoordinated, DeploymentGuardError, workers } from "./guard.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const usage = `Deploy coordenado do Holon (altera produção):
  pnpm run deploy --account <32 hex> --queue <32 hex> --application <UUID> --revision <Git SHA completo>
Requer terminal interativo, CLOUDFLARE_API_TOKEN existente, Node 24, pnpm 11.24.0,
checkout limpo e pnpm verify aprovado. A fila é pausada; o operador comprova
batches/cleanup drenados e rollout concluído. Não há --yes nem retomada automática.
Veja docs/operations/guarded-deployment.md. --help não acessa a rede.`;

export function parseArguments(argv) {
  const result = {};
  const names = {
    "--account": "accountId",
    "--queue": "queueId",
    "--application": "applicationId",
    "--revision": "revision",
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = names[argv[i]];
    if (!key || result[key] || !argv[i + 1])
      throw new Error("Argumentos inválidos. Use --help.");
    result[key] = argv[i + 1];
  }
  if (
    !/^[a-f0-9]{32}$/u.test(result.accountId ?? "") ||
    !/^[a-f0-9]{32}$/u.test(result.queueId ?? "") ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
      result.applicationId ?? "",
    ) ||
    !/^[a-f0-9]{40}$/u.test(result.revision ?? "")
  )
    throw new Error(
      "Informe conta, fila, aplicação e SHA completos. Use --help.",
    );
  return result;
}

export function deploymentCommand(worker, revision) {
  if (!workers.includes(worker) || !/^[a-f0-9]{40}$/u.test(revision))
    throw new Error("Destino inválido.");
  const app =
    worker === "holon-control-plane" ? "control-plane" : "repository-executor";
  return [
    "exec",
    "wrangler",
    "deploy",
    "--config",
    `apps/${app}/wrangler.jsonc`,
    "--env",
    "",
    "--tag",
    revision,
    "--message",
    `Holon coordinated deployment ${revision}`,
  ];
}

export function queueCommand(action) {
  if (!["pause-delivery", "resume-delivery"].includes(action))
    throw new Error("Ação de fila inválida.");
  return [
    "exec",
    "wrangler",
    "queues",
    action,
    "holon-review-jobs",
    "--config",
    "apps/control-plane/wrangler.jsonc",
    "--env",
    "",
  ];
}

export function commandEnvironment(source, accountId) {
  return {
    ...source,
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_ENV: "",
    CLOUDFLARE_API_BASE_URL: "https://api.cloudflare.com/client/v4",
    CLOUDFLARE_API_KEY: "",
    CLOUDFLARE_EMAIL: "",
    WRANGLER_LOG_SANITIZE: "true",
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_SEND_ERROR_REPORTS: "false",
    pnpm_config_verify_deps_before_run: "error",
  };
}

export function confirmationPhrase(stage, binding, context) {
  if (stage === "rollout-and-resume")
    return `RETOMAR ${context.deployed[workers[0]].versionId} ${context.deployed[workers[1]].versionId} ${context.container.image} ${binding}`;
  return `${stage === "drain" ? "DRENADO" : "PAUSAR"} ${context.revision} ${binding}`;
}

function run(executable, args, env, capture = false) {
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: false,
    });
    let output = "";
    let oversized = false;
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.resume();
      child.stdout.on("data", (chunk) => {
        if (output.length + chunk.length > 1_000_000) {
          oversized = true;
          child.kill();
        } else output += chunk;
      });
    }
    child.on("error", () =>
      reject(new Error("Falha ao iniciar comando local.")),
    );
    child.on("close", (code) =>
      code === 0 && !oversized
        ? accept(output.trim())
        : reject(new Error("Comando local não concluiu com sucesso.")),
    );
  });
}

export async function main(argv) {
  if (argv.length === 1 && argv[0] === "--help") {
    process.stdout.write(usage + "\n");
    return;
  }
  const options = parseArguments(argv);
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      "Este deploy exige terminal interativo e evidência do operador; nada foi alterado.",
    );
  if (!process.versions.node.startsWith("24.")) throw new Error("Use Node 24.");
  if (!process.env.CLOUDFLARE_API_TOKEN)
    throw new Error(
      "Disponibilize uma credencial Cloudflare já autorizada no ambiente; não a cole no terminal de confirmação.",
    );
  // Explicit account applies to both REST probes and Wrangler. No inferred account,
  // arbitrary command, profile, config override or deployment flags are accepted.
  const env = commandEnvironment(process.env, options.accountId);
  if ((await run("pnpm", ["--version"], env, true)) !== "11.24.0")
    throw new Error("Use pnpm 11.24.0.");
  const assertLocalRevision = async () => {
    if (
      (await run("git", ["rev-parse", "--show-toplevel"], env, true)) !==
        root.replace(/\/$/u, "") ||
      (await run("git", ["rev-parse", "HEAD"], env, true)) !==
        options.revision ||
      (await run(
        "git",
        ["status", "--porcelain", "--untracked-files=all"],
        env,
        true,
      )) !== ""
    )
      throw new Error("Checkout mudou ou não está limpo no SHA informado.");
  };
  await assertLocalRevision();
  const common = resolve(
    root,
    await run("git", ["rev-parse", "--git-common-dir"], env, true),
  );
  const lockPath = resolve(common, "holon-deploy.lock");
  const lock = await open(lockPath, "wx", 0o600).catch(() => {
    throw new Error(
      "Outro deploy local está ativo ou deixou lock. Inspecione o runbook antes de remover o lock.",
    );
  });
  const sessionId = randomUUID();
  await lock.writeFile(
    JSON.stringify({ sessionId, pid: process.pid, ...options }) + "\n",
  );
  const auditDirectory = resolve(common, "holon-deploy-audit");
  let terminal;
  const interruption = new AbortController();
  const interrupt = () => interruption.abort();
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    await mkdir(auditDirectory, { recursive: true, mode: 0o700 });
    const auditPath = resolve(auditDirectory, `${sessionId}.jsonl`);
    const audit = (record) =>
      appendFile(
        auditPath,
        JSON.stringify({ at: new Date().toISOString(), sessionId, ...record }) +
          "\n",
        { mode: 0o600 },
      );
    await audit({ stage: "start", ...options });
    process.stdout.write(
      "Verificando o checkout antes de qualquer alteração remota...\n",
    );
    await run("pnpm", ["verify"], env);
    await assertLocalRevision();
    interruption.signal.throwIfAborted();
    const { createCloudflareReader } = await import("./cloudflare.mjs");
    terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const reader = createCloudflareReader({
      accountId: options.accountId,
      queueId: options.queueId,
      token: env.CLOUDFLARE_API_TOKEN,
    });
    terminal.on("SIGINT", interrupt);
    const confirm = async (stage, binding, context) => {
      interruption.signal.throwIfAborted();
      process.stdout.write(JSON.stringify(context, null, 2) + "\n");
      if (stage === "pause-delivery")
        process.stdout.write(
          "Confirme a janela exclusiva: nenhum outro operador, automação de deploy ou criação/restart manual de Workflow poderá agir até a retomada. Autorize pausar a fila deste ambiente.\n",
        );
      if (stage === "drain")
        process.stdout.write(
          "A lista de Workflows não comprova a drenagem. Verifique batches já entregues, todos os ledgers com cleanup/supersession pendentes e runs retidas fora da lista da API. Aguarde conclusão; não confirme se faltar evidência. Mantenha a janela exclusiva.\n",
        );
      if (stage === "rollout-and-resume")
        process.stdout.write(
          "Confirme no painel o rollout COMPLETO desta aplicação/imagem, a imagem esperada no resultado do build/deploy e ambos os IDs de versão acima. API sem instâncias não prova conclusão. Confirme também que cleanup continua drenado. Esta confirmação autoriza retomar a fila.\n",
        );
      const evidence = (
        await terminal.question(
          "ID/referência do registro operacional que contém a evidência (sem segredos): ",
          { signal: interruption.signal },
        )
      ).trim();
      const phrase = confirmationPhrase(stage, binding, context);
      const answer = await terminal.question(
        `Digite exatamente para continuar, ou Ctrl+C para parar:\n${phrase}\n> `,
        { signal: interruption.signal },
      );
      if (answer !== phrase) throw new Error("Confirmação recusada.");
      await audit({ stage, binding, context, evidence });
      return { binding, evidence };
    };
    try {
      const result = await deployCoordinated(
        { ...options, sessionId },
        {
          reader,
          signal: interruption.signal,
          assertLocalRevision: async () => {
            interruption.signal.throwIfAborted();
            await assertLocalRevision();
          },
          confirm,
          command: {
            pause: () => run("pnpm", queueCommand("pause-delivery"), env),
            resume: () => run("pnpm", queueCommand("resume-delivery"), env),
            deploy: (worker, revision) =>
              run("pnpm", deploymentCommand(worker, revision), env),
          },
        },
      );
      try {
        await audit({ stage: "completed", result });
      } catch {
        let queuePaused = false;
        try {
          await run("pnpm", queueCommand("pause-delivery"), env);
          queuePaused = (await reader.queue()).paused === true;
        } catch {
          /* Preserve unknown queue state. */
        }
        throw new DeploymentGuardError("audit_write_failed", queuePaused);
      }
      process.stdout.write(
        "Deploy coordenado verificado com evidência do operador; entrega da fila retomada. Smoke não executado.\n",
      );
    } catch (error) {
      await audit({
        stage: "failed",
        code: "deployment_failed",
        queuePaused: error.queuePaused === true,
      }).catch(() => {});
      process.stderr.write(
        error.queuePaused === true
          ? "Fila confirmada pausada. Não houve retomada automática.\n"
          : "Não foi possível confirmar o estado da fila. Confira imediatamente no painel antes de outra ação.\n",
      );
      throw error;
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    terminal?.close();
    await lock.close();
    await unlink(lockPath);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
