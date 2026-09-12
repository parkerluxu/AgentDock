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
    "/sessions": {
      get: {
        operationId: "listSessions",
        responses: { "200": { description: "Local sessions", content: { "application/json": { schema: { type: "object", required: ["sessions"], properties: { sessions: { type: "array", items: { $ref: "#/components/schemas/Session" } } } } } } } },
      },
    },
    "/projects": {
      get: {
        operationId: "listProjects",
        responses: { "200": { description: "Configured projects", content: { "application/json": { schema: { type: "object", required: ["projects"], properties: { projects: { type: "array", items: { $ref: "#/components/schemas/Project" } } } } } } } },
      },
    },
    "/projects/{projectId}/agents": {
      parameters: [{ $ref: "#/components/parameters/ProjectPathId" }],
      put: {
        operationId: "bindProjectAgents",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ProjectAgentBindingRequest" } } } },
        responses: { "200": { description: "Project Agent bindings updated" }, ...errorResponses("400", "401", "404", "409", "413", "415", "422") },
      },
    },
    "/engines": {
      get: {
        operationId: "listEngines",
        responses: { "200": { description: "Configured Agent Engines", content: { "application/json": { schema: { type: "object", required: ["engines"], properties: { engines: { type: "array", items: { $ref: "#/components/schemas/AgentEngine" } } } } } } } },
      },
    },
    "/agents": {
      get: {
        operationId: "listAgents",
        responses: { "200": { description: "Configured externally callable Agents", content: { "application/json": { schema: { type: "object", required: ["agents"], properties: { agents: { type: "array", items: { $ref: "#/components/schemas/Agent" } } } } } } } },
      },
      post: {
        operationId: "createAgent",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AgentMutationRequest" } } } },
        responses: { "201": { description: "Agent registered and configuration hot-reloaded when safe" }, ...errorResponses("400", "401", "409", "413", "415", "422") },
      },
    },
    "/agents/{agentId}": {
      parameters: [{ $ref: "#/components/parameters/AgentId" }],
      get: { operationId: "getAgent", responses: { "200": { description: "Configured Agent" }, ...errorResponses("401", "404") } },
      put: { operationId: "updateAgent", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AgentMutationRequest" } } } }, responses: { "200": { description: "Agent updated" }, ...errorResponses("400", "401", "409", "413", "415", "422") } },
      delete: { operationId: "deleteAgent", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["revision", "hash"], properties: { revision: { type: "string" }, hash: { type: "string" }, confirmHighRisk: { type: "boolean" } } } } } }, responses: { "200": { description: "Agent removed from configuration" }, ...errorResponses("400", "401", "409", "413", "415", "422") } },
    },
    "/agents/{agentId}/invoke": {
      parameters: [{ $ref: "#/components/parameters/AgentId" }],
      post: {
        operationId: "invokeAgentStream",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/InvokeAgentRequest" } } } },
        responses: {
          "200": { description: "Agent invocation event stream. The first accepted event contains the Run id and replay URL.", content: { "text/event-stream": { schema: { type: "string", description: "accepted event followed by sequenced Run events." } } } },
          ...errorResponses("400", "401", "406", "409", "413", "415", "429"),
        },
      },
    },
    "/environments": {
      get: {
        operationId: "listEnvironments",
        responses: { "200": { description: "Agent Environments with directory and drift status", content: { "application/json": { schema: { type: "object", required: ["environments"], properties: { environments: { type: "array", items: { $ref: "#/components/schemas/EnvironmentStatus" } } } } } } }, ...errorResponses("401", "422") },
      },
      post: {
        operationId: "createEnvironment",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/EnvironmentMutationRequest" } } } },
        responses: { "201": { description: "Environment created; managed directories and manifest initialized" }, ...errorResponses("400", "401", "409", "413", "415", "422") },
      },
    },
    "/environments/import": {
      post: {
        operationId: "importEnvironment",
        requestBody: { required: true, content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/EnvironmentMutationRequest" }, { type: "object", required: ["sourceConfigDir"], properties: { sourceConfigDir: { type: "string" } } }] } } } },
        responses: { "201": { description: "Native configuration imported into a managed or external Environment" }, ...errorResponses("400", "401", "409", "413", "415", "422") },
      },
    },
    "/environments/{environmentId}": {
      parameters: [{ $ref: "#/components/parameters/EnvironmentId" }],
      get: { operationId: "getEnvironment", responses: { "200": { description: "Environment status", content: { "application/json": { schema: { $ref: "#/components/schemas/EnvironmentStatus" } } } }, ...errorResponses("401", "404", "422") } },
      put: { operationId: "updateEnvironment", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/EnvironmentMutationRequest" } } } }, responses: { "200": { description: "Environment updated" }, ...errorResponses("400", "401", "409", "413", "415", "422") } },
      delete: { operationId: "deleteEnvironment", description: "Removes the configuration object but preserves all native directories.", responses: { "200": { description: "Environment configuration deleted; directories preserved" }, ...errorResponses("400", "401", "409", "415", "422") } },
    },
    "/environments/{environmentId}/rescan": {
      parameters: [{ $ref: "#/components/parameters/EnvironmentId" }],
      post: { operationId: "rescanEnvironment", responses: { "200": { description: "Updated manifest and configuration hash" }, ...errorResponses("401", "404", "422") } },
    },
    "/environments/{environmentId}/copy": {
      parameters: [{ $ref: "#/components/parameters/EnvironmentId" }],
      post: { operationId: "copyEnvironment", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/EnvironmentMutationRequest" } } } }, responses: { "201": { description: "Managed Environment copy created; state and cache are not copied" }, ...errorResponses("400", "401", "404", "409", "415", "422") } },
    },
    "/environments/{environmentId}/backups": {
      parameters: [{ $ref: "#/components/parameters/EnvironmentId" }],
      get: { operationId: "listEnvironmentBackups", responses: { "200": { description: "Environment configuration backups" }, ...errorResponses("401", "404") } },
      post: { operationId: "backupEnvironment", responses: { "201": { description: "Environment configDir backed up; state/cache excluded" }, ...errorResponses("401", "404", "422") } },
    },
    "/environments/{environmentId}/restore": {
      parameters: [{ $ref: "#/components/parameters/EnvironmentId" }],
      post: { operationId: "restoreEnvironment", responses: { "200": { description: "Environment configDir restored and rescanned" }, ...errorResponses("400", "401", "404", "409", "415", "422") } },
    },
    "/config": {
      get: {
        operationId: "getConfig",
        responses: { "200": { description: "Configuration snapshot", content: { "application/json": { schema: { $ref: "#/components/schemas/ConfigSnapshot" } } } }, ...errorResponses("401", "422") },
      },
      put: {
        operationId: "saveConfig",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SaveConfigRequest" } } } },
        responses: { "200": { description: "Configuration saved atomically and hot-reloaded when safe", content: { "application/json": { schema: { $ref: "#/components/schemas/ConfigSaveResponse" } } } }, ...errorResponses("400", "401", "409", "413", "415", "422") },
      },
    },
    "/config/preview": {
      post: {
        operationId: "previewConfig",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PreviewConfigRequest" } } } },
        responses: { "200": { description: "Validated configuration preview and diff", content: { "application/json": { schema: { $ref: "#/components/schemas/ConfigPreview" } } } }, ...errorResponses("400", "401", "413", "415", "422") },
      },
    },
    "/config/backups": {
      get: {
        operationId: "listConfigBackups",
        responses: { "200": { description: "Available configuration backups", content: { "application/json": { schema: { type: "object", required: ["backups"], properties: { backups: { type: "array", items: { $ref: "#/components/schemas/ConfigBackup" } } } } } } } },
      },
    },
    "/config/restore": {
      post: {
        operationId: "restoreConfigBackup",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/RestoreConfigRequest" } } } },
        responses: { "200": { description: "Configuration restored atomically and hot-reloaded when safe", content: { "application/json": { schema: { $ref: "#/components/schemas/ConfigSaveResponse" } } } }, ...errorResponses("400", "401", "404", "409", "413", "415", "422") },
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
      AgentId: { name: "agentId", in: "path", required: true, schema: { type: "string" } },
      EnvironmentId: { name: "environmentId", in: "path", required: true, schema: { type: "string" } },
      RunStatus: { name: "status", in: "query", schema: { $ref: "#/components/schemas/RunStatus" } },
      ProjectId: { name: "projectId", in: "query", schema: { type: "string" } },
      ProjectPathId: { name: "projectId", in: "path", required: true, schema: { type: "string" } },
      Limit: { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000 } },
      After: { name: "after", in: "query", schema: { type: "integer", minimum: -1 } },
      Stream: { name: "stream", in: "query", schema: { type: "string", enum: ["sse"] } },
      IdempotencyKey: { name: "Idempotency-Key", in: "header", schema: { type: "string", minLength: 1, maxLength: 128 } },
    },
    schemas: {
      HealthResponse: { type: "object", required: ["healthy", "apiVersion"], properties: { healthy: { type: "boolean" }, apiVersion: { type: "string", enum: ["v1"] }, configRevision: { type: "string" } } },
      Runtime: { type: "object", required: ["id", "adapter", "args", "enabled", "capabilities"], properties: { id: { type: "string" }, adapter: { type: "string" }, binary: { type: "string" }, args: { type: "array", items: { type: "string" } }, version: { type: "string" }, enabled: { type: "boolean" }, capabilities: { type: "array", items: { type: "string" } } } },
      AgentEngine: { $ref: "#/components/schemas/Runtime" },
      EnvironmentPermission: { type: "object", required: ["id", "filesystem", "environment", "network"], properties: { id: { type: "string" }, filesystem: { type: "object" }, environment: { type: "object" }, network: { type: "string", enum: ["deny", "allow"] } } },
      Agent: { type: "object", required: ["id", "engineId", "environmentId", "permissionId", "enabled", "processEnv", "settings"], properties: { id: { type: "string" }, engineId: { type: "string" }, environmentId: { type: "string" }, permissionId: { type: "string" }, enabled: { type: "boolean" }, processEnv: { type: "object", additionalProperties: { type: "string" } }, settings: { type: "object" } } },
      AgentMutationRequest: { type: "object", required: ["agent", "revision", "hash"], properties: { agent: { $ref: "#/components/schemas/Agent" }, revision: { type: "string" }, hash: { type: "string" }, confirmHighRisk: { type: "boolean" } } },
      AgentEnvironment: { type: "object", required: ["id", "directoryMode", "launchArgs", "settings"], properties: { id: { type: "string" }, engineId: { type: "string" }, permissionId: { type: "string" }, extends: { type: "string" }, directoryMode: { type: "string", enum: ["managed", "external"] }, homeDir: { type: "string" }, configDir: { type: "string" }, stateDir: { type: "string" }, cacheDir: { type: "string" }, launchArgs: { type: "array", items: { type: "string" } }, settings: { type: "object" } } },
      EnvironmentManifest: { type: "object", required: ["manifestVersion", "environmentId", "directoryMode", "configDir", "stateDir", "cacheDir", "configHash", "scannedAt"], properties: { manifestVersion: { type: "integer", enum: [1] }, environmentId: { type: "string" }, engineId: { type: "string" }, directoryMode: { type: "string", enum: ["managed", "external"] }, homeDir: { type: "string" }, configDir: { type: "string" }, stateDir: { type: "string" }, cacheDir: { type: "string" }, configHash: { type: "string" }, scannedAt: { type: "string", format: "date-time" } } },
      EnvironmentStatus: { type: "object", required: ["environment", "drifted", "healthy", "issues"], properties: { environment: { $ref: "#/components/schemas/AgentEnvironment" }, manifest: { $ref: "#/components/schemas/EnvironmentManifest" }, currentHash: { type: "string" }, drifted: { type: "boolean" }, healthy: { type: "boolean" }, issues: { type: "array", items: { type: "string" } } } },
      EnvironmentMutationRequest: { type: "object", required: ["environment", "revision", "hash"], properties: { environment: { $ref: "#/components/schemas/AgentEnvironment" }, revision: { type: "string" }, hash: { type: "string" }, confirmHighRisk: { type: "boolean" } } },
      Session: { type: "object", required: ["id", "engineId", "resumable", "status", "createdAt", "updatedAt"], properties: { id: { type: "string" }, projectId: { type: "string" }, agentId: { type: "string" }, engineId: { type: "string" }, environmentId: { type: "string" }, runtimeSessionId: { type: "string" }, resumable: { type: "boolean" }, status: { type: "string", enum: ["active", "archived"] }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } } },
      Project: { type: "object", required: ["id", "rootDir", "agentIds"], properties: { id: { type: "string" }, rootDir: { type: "string" }, agentIds: { type: "array", items: { type: "string" } }, defaultAgentId: { type: "string" }, environmentIds: { type: "array", items: { type: "string" } }, defaultEnvironmentId: { type: "string" } } },
      ProjectAgentBindingRequest: { type: "object", required: ["agentIds", "revision", "hash"], properties: { agentIds: { type: "array", items: { type: "string" } }, defaultAgentId: { type: "string" }, revision: { type: "string" }, hash: { type: "string" }, confirmHighRisk: { type: "boolean" } } },
      ConfigSnapshot: { type: "object", required: ["config", "revision", "hash"], properties: { config: { type: "object" }, revision: { type: "string" }, hash: { type: "string" } } },
      ConfigDiffEntry: { type: "object", required: ["path", "before", "after"], properties: { path: { type: "string" }, before: {}, after: {} } },
      ConfigRisk: { type: "object", required: ["required", "reasons"], properties: { required: { type: "boolean" }, reasons: { type: "array", items: { type: "string" } } } },
      ConfigPreview: { type: "object", required: ["valid", "config", "revision", "hash", "diff", "highRisk", "policyIssues"], properties: { valid: { type: "boolean" }, config: { type: "object" }, revision: { type: "string" }, hash: { type: "string" }, diff: { type: "array", items: { $ref: "#/components/schemas/ConfigDiffEntry" } }, highRisk: { $ref: "#/components/schemas/ConfigRisk" }, policyIssues: { type: "array", items: { type: "object" } }, dryRun: { type: "object" } } },
      PreviewConfigRequest: { type: "object", required: ["config"], properties: { config: { type: "object" }, dryRun: { $ref: "#/components/schemas/DryRunRequest" } } },
      SaveConfigRequest: { type: "object", required: ["config", "revision", "hash"], properties: { config: { type: "object" }, revision: { type: "string" }, hash: { type: "string" }, confirmHighRisk: { type: "boolean" }, dryRun: { $ref: "#/components/schemas/DryRunRequest" } } },
      RestoreConfigRequest: { type: "object", required: ["backupId", "revision", "hash"], properties: { backupId: { type: "string" }, revision: { type: "string" }, hash: { type: "string" }, confirmHighRisk: { type: "boolean" } } },
      DryRunRequest: { type: "object", required: ["task"], properties: { task: { type: "string", minLength: 1 }, agentId: { type: "string" }, environmentId: { type: "string" }, projectId: { type: "string" } } },
      ConfigBackup: { type: "object", required: ["id", "createdAt", "size"], properties: { id: { type: "string" }, createdAt: { type: "string", format: "date-time" }, size: { type: "integer" } } },
      ConfigSaveResponse: { allOf: [{ $ref: "#/components/schemas/ConfigSnapshot" }, { type: "object", required: ["diff", "highRisk", "backupId", "auditId", "restartRequired"], properties: { diff: { type: "array", items: { $ref: "#/components/schemas/ConfigDiffEntry" } }, highRisk: { $ref: "#/components/schemas/ConfigRisk" }, backupId: { type: "string" }, auditId: { type: "string" }, restartRequired: { type: "boolean" }, restartReasons: { type: "array", items: { type: "string" } } } }] },
      RunStatus: { type: "string", enum: ["queued", "running", "succeeded", "failed", "cancelled", "timed_out"] },
      Run: { type: "object", required: ["id", "engineId", "environmentId", "task", "status", "snapshot", "createdAt"], properties: { id: { type: "string" }, engineId: { type: "string" }, environmentId: { type: "string" }, projectId: { type: "string" }, sessionId: { type: "string" }, task: { type: "string" }, status: { $ref: "#/components/schemas/RunStatus" }, snapshot: { type: "object" }, createdAt: { type: "string", format: "date-time" }, ownerPid: { type: "integer" }, startedAt: { type: "string", format: "date-time" }, finishedAt: { type: "string", format: "date-time" }, exitCode: { type: "integer" }, errorCode: { type: "string" } } },
      RunEvent: { type: "object", required: ["runId", "sequence", "timestamp", "type", "payload"], properties: { runId: { type: "string" }, sequence: { type: "integer", minimum: 0 }, timestamp: { type: "string", format: "date-time" }, type: { type: "string", enum: ["status", "message", "tool_call", "tool_result", "error"] }, payload: { type: "object" } } },
      CreateRunRequest: { type: "object", required: ["task"], properties: { task: { type: "string", minLength: 1 }, agentId: { type: "string" }, environmentId: { type: "string" }, projectId: { type: "string" }, sessionId: { type: "string" }, idempotencyKey: { type: "string", minLength: 1, maxLength: 128 }, requiredCapabilities: { type: "array", items: { type: "string" } }, network: { type: "string", enum: ["deny", "allow"] }, filesystemWrite: { type: "boolean" } } },
      InvokeAgentRequest: { type: "object", required: ["task"], properties: { task: { type: "string", minLength: 1 }, projectId: { type: "string" }, sessionId: { type: "string" }, idempotencyKey: { type: "string", minLength: 1, maxLength: 128 }, requiredCapabilities: { type: "array", items: { type: "string" } }, network: { type: "string", enum: ["deny", "allow"] }, filesystemWrite: { type: "boolean" } } },
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
