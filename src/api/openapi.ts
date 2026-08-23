export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "AgentDock Local API",
    version: "v1",
    description: "Local-first control plane API. The service is intended for loopback clients and requires a Bearer token.",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ bearerAuth: [] }],
  paths: {
    "/health": {
      get: {
        operationId: "getHealth",
        responses: { "200": { description: "API health", content: { "application/json": { schema: { $ref: "#/components/schemas/HealthResponse" } } } } },
      },
    },
    "/openapi.json": {
      get: {
        operationId: "getOpenApiDocument",
        responses: { "200": { description: "OpenAPI document", content: { "application/json": { schema: { type: "object" } } } } },
      },
    },
    "/runtimes": {
      get: {
        operationId: "listRuntimes",
        responses: { "200": { description: "Configured Runtime descriptors", content: { "application/json": { schema: { type: "object", required: ["runtimes"], properties: { runtimes: { type: "array", items: { $ref: "#/components/schemas/Runtime" } } } } } } } },
      },
    },
    "/sessions": {
      get: {
        operationId: "listSessions",
        responses: { "200": { description: "Local sessions", content: { "application/json": { schema: { type: "object", required: ["sessions"], properties: { sessions: { type: "array", items: { $ref: "#/components/schemas/Session" } } } } } } } },
      },
    },
    "/runs": {
      get: {
        operationId: "listRuns",
        parameters: [
          { $ref: "#/components/parameters/RunStatus" },
          { $ref: "#/components/parameters/ProjectId" },
          { $ref: "#/components/parameters/Limit" },
        ],
        responses: { "200": { description: "Runs", content: { "application/json": { schema: { type: "object", required: ["runs"], properties: { runs: { type: "array", items: { $ref: "#/components/schemas/Run" } } } } } } }, ...errorResponses() },
      },
      post: {
        operationId: "createRun",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateRunRequest" } } } },
        responses: {
          "202": { description: "Run created", content: { "application/json": { schema: { $ref: "#/components/schemas/CreateRunResponse" } } } },
          "200": { description: "Existing Run returned for an idempotent request", content: { "application/json": { schema: { $ref: "#/components/schemas/CreateRunResponse" } } } },
          ...errorResponses("400", "401", "409", "413", "415", "429"),
        },
      },
    },
    "/runs/{runId}": {
      parameters: [{ $ref: "#/components/parameters/RunId" }],
      get: {
        operationId: "getRun",
        responses: { "200": { description: "Run details and immutable snapshot", content: { "application/json": { schema: { type: "object", required: ["run"], properties: { run: { $ref: "#/components/schemas/Run" } } } } } }, ...errorResponses("401", "404") },
      },
    },
    "/runs/{runId}/cancel": {
      parameters: [{ $ref: "#/components/parameters/RunId" }],
      post: {
        operationId: "cancelRun",
        responses: { "202": { description: "Cancellation requested", content: { "application/json": { schema: { $ref: "#/components/schemas/CancelResponse" } } } }, ...errorResponses("401", "404", "409") },
      },
    },
    "/runs/{runId}/events": {
      parameters: [{ $ref: "#/components/parameters/RunId" }, { $ref: "#/components/parameters/After" }],
      get: {
        operationId: "getRunEvents",
        parameters: [{ $ref: "#/components/parameters/Stream" }],
        responses: {
          "200": {
            description: "Historical JSON events or an SSE stream when stream=sse or Accept is text/event-stream",
            content: {
              "application/json": { schema: { type: "object", required: ["events"], properties: { events: { type: "array", items: { $ref: "#/components/schemas/RunEvent" } } } } },
              "text/event-stream": { schema: { type: "string", description: "SSE frames with event id equal to the Run event sequence." } },
            },
          },
          ...errorResponses("401", "404", "413"),
        },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    parameters: {
      RunId: { name: "runId", in: "path", required: true, schema: { type: "string" } },
      RunStatus: { name: "status", in: "query", schema: { $ref: "#/components/schemas/RunStatus" } },
      ProjectId: { name: "projectId", in: "query", schema: { type: "string" } },
      Limit: { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000 } },
      After: { name: "after", in: "query", schema: { type: "integer", minimum: -1 } },
      Stream: { name: "stream", in: "query", schema: { type: "string", enum: ["sse"] } },
      IdempotencyKey: { name: "Idempotency-Key", in: "header", schema: { type: "string", minLength: 1, maxLength: 128 } },
    },
    schemas: {
      HealthResponse: { type: "object", required: ["healthy", "apiVersion"], properties: { healthy: { type: "boolean" }, apiVersion: { type: "string", enum: ["v1"] } } },
      Runtime: { type: "object", required: ["id", "adapter", "args", "enabled", "capabilities"], properties: { id: { type: "string" }, adapter: { type: "string" }, binary: { type: "string" }, args: { type: "array", items: { type: "string" } }, version: { type: "string" }, enabled: { type: "boolean" }, capabilities: { type: "array", items: { type: "string" } } } },
      Session: { type: "object", required: ["id", "runtimeId", "resumable", "status", "createdAt", "updatedAt"], properties: { id: { type: "string" }, projectId: { type: "string" }, runtimeId: { type: "string" }, runtimeSessionId: { type: "string" }, resumable: { type: "boolean" }, status: { type: "string", enum: ["active", "archived"] }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } } },
      RunStatus: { type: "string", enum: ["queued", "running", "succeeded", "failed", "cancelled", "timed_out"] },
      Run: { type: "object", required: ["id", "runtimeId", "profileId", "task", "status", "snapshot", "createdAt"], properties: { id: { type: "string" }, runtimeId: { type: "string" }, profileId: { type: "string" }, projectId: { type: "string" }, sessionId: { type: "string" }, task: { type: "string" }, status: { $ref: "#/components/schemas/RunStatus" }, snapshot: { type: "object" }, createdAt: { type: "string", format: "date-time" }, ownerPid: { type: "integer" }, startedAt: { type: "string", format: "date-time" }, finishedAt: { type: "string", format: "date-time" }, exitCode: { type: "integer" }, errorCode: { type: "string" } } },
      RunEvent: { type: "object", required: ["runId", "sequence", "timestamp", "type", "payload"], properties: { runId: { type: "string" }, sequence: { type: "integer", minimum: 0 }, timestamp: { type: "string", format: "date-time" }, type: { type: "string", enum: ["status", "message", "tool_call", "tool_result", "error"] }, payload: { type: "object" } } },
      CreateRunRequest: { type: "object", required: ["task"], properties: { task: { type: "string", minLength: 1 }, profileId: { type: "string" }, projectId: { type: "string" }, sessionId: { type: "string" }, idempotencyKey: { type: "string", minLength: 1, maxLength: 128 }, requiredCapabilities: { type: "array", items: { type: "string" } }, network: { type: "string", enum: ["deny", "allow"] }, filesystemWrite: { type: "boolean" } } },
      CreateRunResponse: { type: "object", required: ["run", "created", "eventsUrl"], properties: { run: { $ref: "#/components/schemas/Run" }, created: { type: "boolean" }, eventsUrl: { type: "string" } } },
      CancelResponse: { type: "object", required: ["runId", "cancellationRequested"], properties: { runId: { type: "string" }, cancellationRequested: { type: "boolean" } } },
      ErrorResponse: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: { type: "object" } } } } },
    },
  },
} as const;

function errorResponses(...statusCodes: string[]): Record<string, unknown> {
  const codes = statusCodes.length > 0 ? statusCodes : ["400"];
  return Object.fromEntries(codes.map((status) => [status, { description: "API error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }]));
}
