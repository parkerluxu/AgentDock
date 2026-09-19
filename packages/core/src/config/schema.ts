import { z } from "zod";
import type { NetworkPolicy, RuntimeCapability } from "../core/types.js";

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "must be a lowercase identifier");

const runtimeCapability = z.enum([
  "execute",
  "stream_events",
  "cancel",
  "create_session",
  "resume_session",
  "healthcheck",
]);

const runtimeSchema = z.object({
  id: identifier,
  adapter: z.string().min(1),
  binary: z.string().min(1).optional(),
  args: z.array(z.string()).default([]),
  version: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  capabilities: z.array(runtimeCapability).default([]),
});

const engineSchema = runtimeSchema;

const secretReferenceSchema = z.object({
  provider: z.enum(["env", "keychain", "custom"]),
  key: z.string().min(1),
});

const policySchema = z.object({
  id: identifier,
  filesystem: z.object({
    roots: z.array(z.string().min(1)).min(1),
    write: z.boolean().default(false),
  }),
  environment: z.object({
    allow: z.array(z.string()).default([]),
    secretRefs: z.record(secretReferenceSchema).optional(),
  }),
  network: z.enum(["deny", "allow"]).default("deny"),
});

const environmentPermissionSchema = policySchema;

const environmentSchema = z.object({
  id: identifier,
  /** Legacy placement; new configs bind these through agents[]. */
  engineId: identifier.optional(),
  permissionId: identifier.optional(),
  extends: identifier.optional(),
  directoryMode: z.enum(["managed", "external"]).default("managed"),
  /** Complete native Agent home, including config, skills, plugins and related files. */
  homeDir: z.string().min(1).optional(),
  configDir: z.string().min(1).optional(),
  stateDir: z.string().min(1).optional(),
  cacheDir: z.string().min(1).optional(),
  launchArgs: z.array(z.string()).default([]),
  settings: z.record(z.unknown()).default({}),
});

const agentSchema = z.object({
  id: identifier,
  engineId: identifier,
  environmentId: identifier,
  permissionId: identifier,
  enabled: z.boolean().default(true),
  /** Non-secret variables overlaid on the child process environment. */
  processEnv: z.record(z.string()).default({}),
  settings: z.record(z.unknown()).default({}),
});

const projectSchema = z.object({
  id: identifier,
  rootDir: z.string().min(1),
  agentIds: z.array(identifier).default([]),
  defaultAgentId: identifier.optional(),
  /** Legacy placement; new configs bind Agents instead. */
  environmentIds: z.array(identifier).default([]),
  defaultEnvironmentId: identifier.optional(),
});

const storageSchema = z.object({
  /** Delete terminal Run data older than this many days when the store opens. */
  retentionDays: z.number().int().positive().optional(),
  /** Keep message/tool output payloads in SQLite and historical exports. */
  saveOutput: z.boolean().default(true),
}).default({});

const loggingSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("warn"),
}).default({});

const redactionSchema = z.object({
  /** Additional object keys whose values must be masked in logs and API output. */
  additionalKeys: z.array(z.string().min(1)).default([]),
}).default({});

export const configSchema = z.object({
  version: z.literal(1),
  dataDir: z.string().min(1).optional(),
  storage: storageSchema,
  logging: loggingSchema,
  redaction: redactionSchema,
  engines: z.array(engineSchema).default([]),
  environments: z.array(environmentSchema).default([]),
  agents: z.array(agentSchema).default([]),
  projects: z.array(projectSchema).default([]),
  environmentPermissions: z.array(environmentPermissionSchema).default([]),
}).strict();

export type AgentDockConfig = z.infer<typeof configSchema>;

export type ConfigEngine = AgentDockConfig["engines"][number] & { capabilities: RuntimeCapability[] };
export type ConfigEnvironment = AgentDockConfig["environments"][number];
export type ConfigEnvironmentPermission = AgentDockConfig["environmentPermissions"][number] & { network: NetworkPolicy };

export function parseConfig(input: unknown): AgentDockConfig {
  return configSchema.parse(input);
}
