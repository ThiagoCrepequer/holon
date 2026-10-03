// Leituras de evidências; este módulo nunca pausa, retoma ou publica recursos.
// Contratos oficiais consultados em 2026-10-02:
// https://developers.cloudflare.com/api/resources/queues/methods/get/
// https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/list/
// https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/
// https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/get/
// https://developers.cloudflare.com/api/resources/containers/subresources/applications/methods/get/
// https://developers.cloudflare.com/api/resources/containers/subresources/applications/subresources/instances/methods/list/

const ORIGIN = "https://api.cloudflare.com";
const PER_PAGE = 100;
const MAX_PAGES = 100;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_ID = /^[0-9a-f]{32}$/i;
const INSTANCE_ID = /^[0-9a-f]{64}$/i;
const WORKERS = new Set(["holon-control-plane", "holon-repository-executor"]);
const WORKFLOW_STATES = new Set([
  "queued",
  "running",
  "paused",
  "errored",
  "terminated",
  "complete",
  "waitingForPause",
  "waiting",
  "rollingBack",
]);
const CONTAINER_STATES = new Set([
  "provisioning",
  "running",
  "failed",
  "stopping",
  "stopped",
  "unhealthy",
  "inactive",
  "unknown",
]);
const HEALTH_STATES = new Set(["healthy", "degraded", "unhealthy", "pending"]);

function fail(reason) {
  // Somente mensagens locais: nunca repassar corpo, token ou erro do provedor.
  throw new Error(`Cloudflare: ${reason}.`);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value, max = 4096) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    // oxlint-disable-next-line no-control-regex -- Rejeita controles em IDs e tokens.
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function tokenValue(value) {
  if (value === undefined || value === null || value === "") return null;
  if (!string(value)) fail("paginação inválida");
  return value;
}

function knownKeys(value, keys) {
  if (!object(value) || Object.keys(value).some((key) => !keys.includes(key))) {
    fail("formato de paginação desconhecido");
  }
}

function unique(rows) {
  if (new Set(rows.map((row) => row.id)).size !== rows.length) {
    fail("identidades repetidas na consulta");
  }
  return rows.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function bodyJson(response) {
  const type = response.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/iu.test(type)) {
    fail("tipo de resposta inválido");
  }
  const length = response.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/u.test(length) || Number(length) > MAX_BYTES)
  ) {
    fail("resposta excede o limite");
  }
  if (!response.body) fail("resposta vazia");
  const reader = response.body.getReader();
  let size = 0;
  const parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        void reader.cancel().catch(() => {});
        fail("resposta excede o limite");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/**
 * Evidências somente de leitura. O chamador decide quais estados bloqueiam.
 * Container.health é amostrado/opcional; nunca comprova conclusão de rollout.
 */
export function createCloudflareReader({
  accountId,
  queueId,
  token,
  fetchImpl = fetch,
}) {
  if (
    typeof accountId !== "string" ||
    !HEX_ID.test(accountId) ||
    typeof queueId !== "string" ||
    !HEX_ID.test(queueId) ||
    !string(token, 16_384) ||
    /\s/u.test(token) ||
    typeof fetchImpl !== "function"
  ) {
    fail("configuração inválida");
  }
  const accountPath = `/client/v4/accounts/${accountId}`;

  async function get(path, query = {}) {
    const url = new URL(`${ORIGIN}${accountPath}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== null) url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    let timeout;
    const expired = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("timeout"));
      }, TIMEOUT_MS);
    });
    try {
      const data = await Promise.race([
        (async () => {
          const response = await fetchImpl(url.href, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
            redirect: "error",
            signal: controller.signal,
          });
          if (
            !response.ok ||
            response.status < 200 ||
            response.status >= 300 ||
            response.redirected ||
            (response.url && response.url !== url.href)
          ) {
            fail("requisição recusada");
          }
          return bodyJson(response);
        })(),
        expired,
      ]);
      if (
        !object(data) ||
        data.success !== true ||
        (data.errors !== undefined &&
          (!Array.isArray(data.errors) || data.errors.length !== 0)) ||
        (data.messages !== undefined && !Array.isArray(data.messages)) ||
        !Object.hasOwn(data, "result")
      ) {
        fail("envelope de resposta inválido");
      }
      return data;
    } catch {
      // Não usar cause nem interpolar mensagens/URLs devolvidas pelo transporte.
      return fail("leitura falhou ou resposta inválida");
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  async function queue() {
    const { result } = await get(`/queues/${queueId}`);
    if (
      !object(result) ||
      result.queue_id !== queueId ||
      result.queue_name !== "holon-review-jobs" ||
      !object(result.settings) ||
      typeof result.settings.delivery_paused !== "boolean"
    ) {
      fail("identidade ou estado da fila inválido");
    }
    return { paused: result.settings.delivery_paused };
  }

  async function workflows() {
    const rows = [];
    const cursors = new Set();
    let cursor = null;
    let workflowId;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await get("/workflows/holon-review-workflow/instances", {
        per_page: PER_PAGE,
        cursor,
      });
      if (!Array.isArray(data.result) || data.result.length > PER_PAGE) {
        fail("lista de Workflows inválida");
      }
      for (const row of data.result) {
        if (
          !object(row) ||
          !string(row.id, 100) ||
          !WORKFLOW_STATES.has(row.status) ||
          typeof row.version_id !== "string" ||
          !UUID.test(row.version_id) ||
          typeof row.workflow_id !== "string" ||
          !UUID.test(row.workflow_id)
        ) {
          fail("instância de Workflow inválida");
        }
        workflowId ??= row.workflow_id;
        if (workflowId !== row.workflow_id)
          fail("identidade de Workflow divergente");
        rows.push({
          id: row.id,
          status: row.status,
          versionId: row.version_id,
        });
      }
      const info = data.result_info;
      knownKeys(info, [
        "count",
        "per_page",
        "cursor",
        "total_count",
        "page",
        "total_pages",
      ]);
      if (
        info.count !== data.result.length ||
        info.per_page !== PER_PAGE ||
        (info.total_count !== undefined && !integer(info.total_count)) ||
        (info.page !== undefined && !integer(info.page)) ||
        (info.total_pages !== undefined && !integer(info.total_pages))
      ) {
        fail("paginação de Workflows inválida");
      }
      const next = tokenValue(info.cursor);
      if (!next) {
        // Um lote cheio sem cursor pode ocultar uma página. Nunca inferir total
        // pelo total_count obsoleto, que é impreciso na paginação por cursor.
        if (
          (data.result.length === PER_PAGE && !Object.hasOwn(info, "cursor")) ||
          (info.total_pages !== undefined &&
            (info.page === undefined || info.total_pages > info.page))
        ) {
          fail("paginação de Workflows ambígua");
        }
        return unique(rows);
      }
      if (data.result.length === 0 || cursors.has(next))
        fail("cursor de Workflow repetido ou inválido");
      cursors.add(next);
      cursor = next;
    }
    return fail("limite de páginas de Workflows excedido");
  }

  async function deployment(worker) {
    if (!WORKERS.has(worker)) fail("Worker não permitido");
    const { result } = await get(`/workers/scripts/${worker}/deployments`);
    if (
      !object(result) ||
      !Array.isArray(result.deployments) ||
      result.deployments.length === 0 ||
      result.deployments.length > 100
    ) {
      fail("lista de deployments inválida");
    }
    // A API documenta o primeiro item como o deployment que serve o tráfego.
    const active = result.deployments[0];
    if (
      !object(active) ||
      typeof active.id !== "string" ||
      !UUID.test(active.id) ||
      active.strategy !== "percentage" ||
      !Array.isArray(active.versions) ||
      active.versions.length !== 1 ||
      !object(active.versions[0]) ||
      active.versions[0].percentage !== 100 ||
      typeof active.versions[0].version_id !== "string" ||
      !UUID.test(active.versions[0].version_id)
    ) {
      fail("deployment ativo não tem uma versão integral identificável");
    }
    const versionId = active.versions[0].version_id;
    const version = (
      await get(`/workers/workers/${worker}/versions/${versionId}`)
    ).result;
    if (
      !object(version) ||
      version.id !== versionId ||
      !object(version.annotations) ||
      !string(version.annotations["workers/tag"], 1024)
    ) {
      fail("tag ou identidade da versão inválida");
    }
    let sandboxNamespaceId;
    if (worker === "holon-repository-executor") {
      if (
        !Array.isArray(version.bindings) ||
        version.bindings.some(
          (binding) =>
            !object(binding) ||
            !string(binding.name, 128) ||
            !string(binding.type, 128),
        )
      ) {
        fail("bindings da versão do executor inválidos");
      }
      const bindings = version.bindings.filter(
        (binding) => binding.name === "SANDBOXES",
      );
      if (bindings.length !== 1) fail("binding SANDBOXES ausente ou ambíguo");
      const binding = bindings[0];
      if (
        binding.type !== "durable_object_namespace" ||
        binding.class_name !== "HolonSandbox" ||
        typeof binding.namespace_id !== "string" ||
        !HEX_ID.test(binding.namespace_id) ||
        (binding.script_name !== undefined && binding.script_name !== worker) ||
        binding.environment !== undefined ||
        binding.dispatch_namespace !== undefined
      ) {
        fail("binding SANDBOXES não identifica o HolonSandbox local");
      }
      sandboxNamespaceId = binding.namespace_id;
    }
    return {
      deploymentId: active.id,
      versionId,
      tag: version.annotations["workers/tag"],
      ...(sandboxNamespaceId === undefined ? {} : { sandboxNamespaceId }),
    };
  }

  async function container(applicationId, expectedNamespaceId) {
    if (
      !string(applicationId, 128) ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(applicationId) ||
      typeof expectedNamespaceId !== "string" ||
      !HEX_ID.test(expectedNamespaceId)
    ) {
      fail("identificador de aplicação inválido");
    }
    const path = `/containers/applications/${applicationId}`;
    const app = (await get(path)).result;
    if (
      !object(app) ||
      app.id !== applicationId ||
      app.account_id !== accountId ||
      app.scheduling_policy !== "default" ||
      !object(app.durable_objects) ||
      app.durable_objects.namespace_id !== expectedNamespaceId ||
      !object(app.configuration) ||
      !string(app.configuration.image) ||
      !integer(app.version) ||
      (app.active_rollout_id !== undefined &&
        !string(app.active_rollout_id, 128))
    ) {
      fail("aplicação ou política de Containers não suportada");
    }
    let health = null;
    if (app.health !== undefined) {
      if (
        !object(app.health) ||
        !object(app.health.instances) ||
        !integer(app.health.instances.active) ||
        !integer(app.health.instances.assigned) ||
        !Array.isArray(app.health.errors) ||
        (app.health.summary !== undefined &&
          !HEALTH_STATES.has(app.health.summary))
      ) {
        fail("saúde de Containers inválida");
      }
      health = {
        summary: app.health.summary ?? null,
        active: app.health.instances.active,
        assigned: app.health.instances.assigned,
        errorCount: app.health.errors.length,
      };
    }
    const rows = [];
    const cursors = new Set();
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await get(`${path}/instances-v2`, {
        per_page: PER_PAGE,
        page_token: cursor,
      });
      if (!Array.isArray(data.result) || data.result.length > PER_PAGE) {
        fail("lista de instâncias de Containers inválida");
      }
      for (const row of data.result) {
        if (
          !object(row) ||
          typeof row.id !== "string" ||
          !INSTANCE_ID.test(row.id) ||
          row.application_id !== applicationId ||
          !object(row.status) ||
          !CONTAINER_STATES.has(row.status.state)
        ) {
          fail("instância de Container inválida");
        }
        const historical =
          row.status.state === "stopped" || row.status.state === "inactive";
        const unavailableImage =
          row.image === undefined || row.image === null || row.image === "";
        if (!string(row.image) && !(historical && unavailableImage)) {
          fail("imagem da instância de Container inválida");
        }
        rows.push({
          id: row.id,
          image: unavailableImage ? null : row.image,
          state: row.status.state,
        });
      }
      const info = data.result_info;
      knownKeys(info, ["next_page_token", "page_token", "per_page"]);
      if (
        (info.per_page !== undefined && info.per_page !== PER_PAGE) ||
        (info.page_token !== undefined &&
          tokenValue(info.page_token) !== cursor)
      ) {
        fail("paginação de Containers inválida");
      }
      const next = tokenValue(info.next_page_token);
      if (!next) {
        return {
          applicationId,
          namespaceId: app.durable_objects.namespace_id,
          image: app.configuration.image,
          version: app.version,
          activeRolloutId: app.active_rollout_id ?? null,
          health,
          instances: unique(rows),
        };
      }
      if (data.result.length === 0 || cursors.has(next))
        fail("cursor de Container repetido ou inválido");
      cursors.add(next);
      cursor = next;
    }
    return fail("limite de páginas de Containers excedido");
  }

  return Object.freeze({ queue, workflows, deployment, container });
}
