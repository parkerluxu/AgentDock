import type { AgentDockConfig, ConfigEngine, ConfigEnvironment, ConfigEnvironmentPermission } from "./schema.js";
import type { Agent } from "../core/types.js";

export interface EnvironmentCatalog {
  engines: ConfigEngine[];
  environments: ConfigEnvironment[];
  agents: Agent[];
  permissions: ConfigEnvironmentPermission[];
}

export function environmentCatalog(config: AgentDockConfig): EnvironmentCatalog {
  return {
    engines: config.engines,
    environments: config.environments,
    agents: config.agents,
    permissions: config.environmentPermissions,
  };
}

/** Returns explicit Agents, or a deterministic view for pre-Agent configs. */
export function configuredAgents(config: AgentDockConfig): Agent[] {
  if (config.agents.length > 0) return config.agents;
  return config.environments.flatMap((environment) => {
    if (!environment.engineId || !environment.permissionId) return [];
    return [{ id: environment.id, engineId: environment.engineId, environmentId: environment.id, permissionId: environment.permissionId, enabled: true, processEnv: {}, settings: {} }];
  });
}
