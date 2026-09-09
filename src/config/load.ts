import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ZodError } from "zod";
import { parseConfig, type AgentDockConfig } from "./schema.js";

export class ConfigValidationError extends Error {
  public readonly issues: Array<{ path: string; message: string }>;

  public constructor(issues: Array<{ path: string; message: string }>) {
    super(`Configuration is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}).`);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

export function validateConfig(input: unknown): AgentDockConfig {
  try {
    const config = parseConfig(input);
    const issues: Array<{ path: string; message: string }> = [];
    const checkUniqueIds = (items: Array<{ id: string }>, collection: string): Set<string> => {
      const ids = new Set<string>();
      for (const [index, item] of items.entries()) {
        if (ids.has(item.id)) {
          issues.push({ path: `${collection}.${index}.id`, message: `duplicate id "${item.id}".` });
        }
        ids.add(item.id);
      }
      return ids;
    };

    const engineIds = checkUniqueIds(config.engines, "engines");
    const environmentIds = checkUniqueIds(config.environments, "environments");
    const agentIds = checkUniqueIds(config.agents, "agents");
    const permissionIds = checkUniqueIds(config.environmentPermissions, "environmentPermissions");
    checkUniqueIds(config.projects, "projects");

    for (const [index, environment] of config.environments.entries()) {
      if (environment.engineId !== undefined && !engineIds.has(environment.engineId)) {
        issues.push({ path: `environments.${index}.engineId`, message: `unknown engine "${environment.engineId}".` });
      }
      if (environment.permissionId !== undefined && !permissionIds.has(environment.permissionId)) {
        issues.push({ path: `environments.${index}.permissionId`, message: `unknown environment permission "${environment.permissionId}".` });
      }
      if (environment.directoryMode === "external" && !environment.homeDir && !environment.configDir) {
        issues.push({ path: `environments.${index}.homeDir`, message: "is required for an external environment." });
      }
      if (environment.extends === environment.id) {
        issues.push({ path: `environments.${index}.extends`, message: "an environment cannot extend itself." });
      } else if (environment.extends !== undefined && !environmentIds.has(environment.extends)) {
        issues.push({ path: `environments.${index}.extends`, message: `unknown parent environment "${environment.extends}".` });
      }
    }
    for (const [index, agent] of config.agents.entries()) {
      if (!engineIds.has(agent.engineId)) issues.push({ path: `agents.${index}.engineId`, message: `unknown engine "${agent.engineId}".` });
      if (!environmentIds.has(agent.environmentId)) issues.push({ path: `agents.${index}.environmentId`, message: `unknown environment "${agent.environmentId}".` });
      if (!permissionIds.has(agent.permissionId)) issues.push({ path: `agents.${index}.permissionId`, message: `unknown environment permission "${agent.permissionId}".` });
    }
    for (const [index, environment] of config.environments.entries()) {
      const chain = new Set<string>();
      let current = environment;
      while (current.extends !== undefined) {
        if (chain.has(current.id)) {
          issues.push({ path: `environments.${index}.extends`, message: `environment inheritance cycle detected at "${current.id}".` });
          break;
        }
        chain.add(current.id);
        const parent = config.environments.find((item) => item.id === current.extends);
        if (!parent) break;
        current = parent;
      }
    }
    for (const [index, project] of config.projects.entries()) {
      for (const [agentIndex, agentId] of project.agentIds.entries()) {
        if (!agentIds.has(agentId)) issues.push({ path: `projects.${index}.agentIds.${agentIndex}`, message: `unknown agent "${agentId}".` });
      }
      if (project.defaultAgentId !== undefined && !project.agentIds.includes(project.defaultAgentId)) {
        issues.push({ path: `projects.${index}.defaultAgentId`, message: "must be included in agentIds." });
      }
      for (const [environmentIndex, environmentId] of project.environmentIds.entries()) {
        if (!environmentIds.has(environmentId)) {
          issues.push({ path: `projects.${index}.environmentIds.${environmentIndex}`, message: `unknown environment "${environmentId}".` });
        }
      }
      if (project.defaultEnvironmentId !== undefined && !project.environmentIds.includes(project.defaultEnvironmentId)) {
        issues.push({ path: `projects.${index}.defaultEnvironmentId`, message: "must be included in environmentIds." });
      }
    }

    if (issues.length > 0) {
      throw new ConfigValidationError(issues);
    }
    return config;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ConfigValidationError(
        error.issues.map((issue) => ({
          path: issue.path.length > 0 ? issue.path.join(".") : "<root>",
          message: issue.message,
        })),
      );
    }
    throw error;
  }
}

export async function loadConfig(filePath: string): Promise<AgentDockConfig> {
  const absolutePath = resolve(filePath);
  let text: string;
  try {
    text = await readFile(absolutePath, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "read_error";
    const message = code === "ENOENT" ? "File does not exist." : `Could not read file: ${String(error)}`;
    throw new ConfigValidationError([{ path: absolutePath, message }]);
  }
  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch (error) {
    throw new ConfigValidationError([{ path: "<file>", message: `Invalid JSON: ${String(error)}` }]);
  }
  return validateConfig(input);
}
