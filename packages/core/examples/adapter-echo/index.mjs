export function createAdapter(runtime) {
  return {
    manifest: {
      name: "example-echo",
      version: "0.1.0",
      entry: "./index.mjs",
      agentDockApi: "v1",
      runtime: { id: "example-echo", versionRange: "*" },
      capabilities: ["execute", "stream_events", "cancel", "healthcheck"],
      requiredPermissions: [],
    },
    async healthCheck() {
      return { healthy: true, runtime };
    },
    async *execute(request) {
      yield {
        runId: request.runId,
        sequence: 0,
        timestamp: new Date().toISOString(),
        type: "message",
        payload: { text: `example:${request.task}` },
      };
      yield {
        runId: request.runId,
        sequence: 1,
        timestamp: new Date().toISOString(),
        type: "status",
        payload: { status: "succeeded", exitCode: 0 },
      };
    },
    async cancel() {},
  };
}
