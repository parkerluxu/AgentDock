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

const profileSchema = z.object({
  id: identifier,
  runtimeId: identifier,
  policyId: identifier,
  extends: identifier.optional(),
  settings: z.record(z.unknown()).default({}),
});

const projectSchema = z.object({
  id: identifier,
  rootDir: z.string().min(1),
  profileIds: z.array(identifier).default([]),
  defaultProfileId: identifier.optional(),
});

export const configSchema = z.object({
  version: z.literal(1),
  dataDir: z.string().min(1).optional(),
  runtimes: z.array(runtimeSchema).default([]),
  profiles: z.array(profileSchema).default([]),
  projects: z.array(projectSchema).default([]),
  policies: z.array(policySchema).default([]),
});

export type AgentDockConfig = z.infer<typeof configSchema>;

export type ConfigRuntime = AgentDockConfig["runtimes"][number] & {
  capabilities: RuntimeCapability[];
};

export type ConfigPolicy = AgentDockConfig["policies"][number] & {
  network: NetworkPolicy;
};

export function parseConfig(input: unknown): AgentDockConfig {
  return configSchema.parse(input);
}
