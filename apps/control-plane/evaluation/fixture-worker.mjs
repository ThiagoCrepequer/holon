import { WorkerEntrypoint, RpcTarget } from "cloudflare:workers";

class FixtureOperation extends RpcTarget {
  constructor(result) {
    super();
    this.output = result;
  }
  result() {
    return this.output;
  }
  cancel() {}
  [Symbol.dispose]() {}
}

/** Controlled external executor boundary; all reads/searches execute against an isolated local image. */
export default class FixtureExecutor extends WorkerEntrypoint {
  async request(path, data) {
    const response = await fetch(this.env.LIVE_RELAY_URL + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("Fixture transport failed");
    return response.json();
  }
  async startTool(runId, call) {
    return new FixtureOperation(await this.request("/tool", { runId, call }));
  }
  async getEvidencePack(runId) {
    return this.request("/evidence", { runId });
  }
  async cleanup(runId) {
    await this.request("/cleanup", { runId });
  }
  hasContext() {
    return false;
  }
  loadContext() {
    throw new Error("Unsupported fixture operation");
  }
  prepareRepository() {
    throw new Error("Unsupported fixture operation");
  }
  runTool() {
    throw new Error("Unsupported fixture operation");
  }
}
