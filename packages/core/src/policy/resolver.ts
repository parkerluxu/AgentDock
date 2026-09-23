import { isAbsolute, relative, resolve, win32 } from "node:path";
import type { AgentDockConfig, ConfigEnvironment } from "../config/schema.js";
import type { Agent, AgentEnvironment, EnvironmentPermission, ExecutionContext, Project, RunRouteSnapshot, SecretReference } from "../core/types.js";
import { configuredAgents } from "../config/model.js";
import { toRuntimeDescriptor } from "../runtime/configuration.js";
import { readEnvironmentManifestSync, resolveEnvironmentDirectories } from "../environment/manager.js";

export interface ResolveOptions { config: AgentDockConfig; baseDirectory: string; agentId?: string; environmentId?: string; projectId?: string; environment?: NodeJS.ProcessEnv }

export function resolveExecutionContext(options: ResolveOptions): ExecutionContext {
  const { config, baseDirectory } = options;
  const projectConfig = findProject(config, options.projectId) ?? (config.projects.length === 1 ? config.projects[0] : undefined);
  const selectedAgent = selectAgent(config, options.agentId ?? projectConfig?.defaultAgentId, projectConfig);
  if (selectedAgent && options.environmentId && options.environmentId !== selectedAgent.environmentId) {
    throw new Error(`Agent "${selectedAgent.id}" is bound to Environment "${selectedAgent.environmentId}" and cannot use "${options.environmentId}".`);
  }
  const environmentId = options.environmentId ?? selectedAgent?.environmentId ?? projectConfig?.defaultEnvironmentId;
  if (!environmentId) throw new Error("An environmentId is required when no Project default Environment is configured.");
  const environmentConfig = resolveEnvironment(config, environmentId);
  if (projectConfig && !projectConfig.agentIds.length && projectConfig.environmentIds.length && !projectConfig.environmentIds.includes(environmentConfig.id)) throw new Error(`Environment "${environmentConfig.id}" is not enabled for Project "${projectConfig.id}".`);
  const engineId = selectedAgent?.engineId ?? environmentConfig.engineId;
  const permissionId = selectedAgent?.permissionId ?? environmentConfig.permissionId;
  const engineConfig = engineId ? config.engines.find((item) => item.id === engineId) : undefined;
  if (!engineConfig) throw new Error(`Engine "${environmentConfig.engineId}" was not found.`);
  if (!engineConfig.enabled) throw new Error(`Engine "${engineConfig.id}" is disabled.`);
  const permissionConfig = permissionId ? config.environmentPermissions.find((item) => item.id === permissionId) : undefined;
  if (!permissionConfig) throw new Error(`Environment Permission "${permissionId ?? "<none>"}" was not found.`);
  const directories = resolveEnvironmentDirectories(config, baseDirectory, environmentConfig);
  const engine = toRuntimeDescriptor(engineConfig);
  engine.args = [...engine.args, ...environmentConfig.launchArgs];
  const agentEnvironment: AgentEnvironment = { id: environmentConfig.id, ...(engineId ? { engineId } : {}), ...(permissionId ? { permissionId } : {}), ...(environmentConfig.extends ? { extends: environmentConfig.extends } : {}), directoryMode: environmentConfig.directoryMode, homeDir: directories.configDir, ...directories, launchArgs: environmentConfig.launchArgs, settings: { ...environmentConfig.settings, ...(selectedAgent?.settings ?? {}) } };
  const environmentPermission: EnvironmentPermission = { id: permissionConfig.id, filesystem: permissionConfig.filesystem, environment: { allow: permissionConfig.environment.allow, ...(permissionConfig.environment.secretRefs ? { secretRefs: permissionConfig.environment.secretRefs } : {}) }, network: permissionConfig.network };
  const project: Project | undefined = projectConfig ? { id: projectConfig.id, rootDir: resolveConfiguredPath(baseDirectory, projectConfig.rootDir), ...(projectConfig.agentIds.length ? { agentIds: projectConfig.agentIds } : {}), ...(projectConfig.defaultAgentId ? { defaultAgentId: projectConfig.defaultAgentId } : {}), environmentIds: projectConfig.environmentIds, ...(projectConfig.defaultEnvironmentId ? { defaultEnvironmentId: projectConfig.defaultEnvironmentId } : {}) } : undefined;
  const workingDirectory = project?.rootDir ?? baseDirectory;
  const roots = environmentPermission.filesystem.roots.map((root) => resolveConfiguredPath(workingDirectory, root));
  if (!roots.some((root) => isWithinRoot(workingDirectory, root))) throw new Error(`Working directory "${workingDirectory}" is outside Environment Permission "${environmentPermission.id}" filesystem roots.`);
  const allowedEnvironmentKeys = [...new Set(environmentPermission.environment.allow)].sort();
  const source = options.environment ?? process.env;
  const processEnvironment: Record<string, string> = {};
  for (const key of allowedEnvironmentKeys) { const value = source[key]; if (value !== undefined) processEnvironment[key] = value; }
  processEnvironment.AGENTDOCK_CONFIG_DIR = directories.configDir; processEnvironment.AGENTDOCK_STATE_DIR = directories.stateDir; processEnvironment.AGENTDOCK_CACHE_DIR = directories.cacheDir;
  if (engine.adapter === "codex") processEnvironment.CODEX_HOME = directories.configDir;
  if (engine.adapter === "claude-code") processEnvironment.CLAUDE_CONFIG_DIR = directories.configDir;
  if (selectedAgent) {
    assertSafeProcessEnvironment(selectedAgent.processEnv, selectedAgent.id);
    Object.assign(processEnvironment, selectedAgent.processEnv);
  }
  const secretReferences: Record<string, SecretReference> = { ...(environmentPermission.environment.secretRefs ?? {}) };
  const manifest = readEnvironmentManifestSync(config, baseDirectory, environmentId);
  return { ...(selectedAgent ? { agent: selectedAgent } : {}), engine, agentEnvironment, environmentPermission, ...(project ? { project } : {}), workingDirectory, allowedEnvironmentKeys, environment: processEnvironment, secretReferences, ...(manifest ? { environmentManifest: manifest } : {}) };
}

function selectAgent(config: AgentDockConfig, agentId: string | undefined, project: AgentDockConfig["projects"][number] | undefined): Agent | undefined {
  const agents = configuredAgents(config);
  if (!agentId) return undefined;
  const agent = agents.find((item) => item.id === agentId);
  if (!agent) throw new Error(`Agent "${agentId}" was not found.`);
  if (project?.agentIds?.length && !project.agentIds.includes(agent.id)) throw new Error(`Agent "${agent.id}" is not enabled for Project "${project.id}".`);
  if (!agent.enabled) throw new Error(`Agent "${agent.id}" is disabled.`);
  return agent;
}

function findProject(config: AgentDockConfig, projectId?: string): AgentDockConfig["projects"][number] | undefined { if (!projectId) return undefined; const project = config.projects.find((item) => item.id === projectId); if (!project) throw new Error(`Project "${projectId}" was not found.`); return project; }
function resolveEnvironment(config: AgentDockConfig, id: string, visited = new Set<string>()): ConfigEnvironment { if (visited.has(id)) throw new Error(`Environment inheritance cycle detected at "${id}".`); const environment = config.environments.find((item) => item.id === id); if (!environment) throw new Error(`Environment "${id}" was not found.`); if (!environment.extends) return environment; const parent = resolveEnvironment(config, environment.extends, new Set([...visited, id])); return { ...parent, ...environment, launchArgs: [...parent.launchArgs, ...environment.launchArgs], settings: { ...parent.settings, ...environment.settings } }; }
function isWithinRoot(candidate: string, root: string): boolean { const pathModule = usesWindowsPath(candidate) || usesWindowsPath(root) ? win32 : { relative, isAbsolute }; const path = pathModule.relative(root, candidate); return path === "" || (path !== ".." && !path.startsWith("..\\") && !path.startsWith("../") && !pathModule.isAbsolute(path)); }
function resolveConfiguredPath(baseDirectory: string, configuredPath: string): string { return usesWindowsPath(baseDirectory) || usesWindowsPath(configuredPath) ? win32.resolve(baseDirectory, configuredPath) : resolve(baseDirectory, configuredPath); }
function usesWindowsPath(value: string): boolean { return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\"); }

function assertSafeProcessEnvironment(values: Record<string, string>, agentId: string): void {
  for (const key of Object.keys(values)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalized.includes("apikey") || normalized.includes("authorization") || normalized.includes("credential") || normalized.includes("password") || normalized.includes("secret") || normalized.includes("token")) {
      throw new Error(`Agent "${agentId}" processEnv key "${key}" looks like a secret; use Environment Permission secretRefs instead.`);
    }
  }
}

export function formatDryRun(context: ExecutionContext, task: string, routing?: RunRouteSnapshot): Record<string, unknown> {
  return { task, agent: context.agent ? { id: context.agent.id, engineId: context.agent.engineId, environmentId: context.agent.environmentId, permissionId: context.agent.permissionId } : undefined, engine: { id: context.engine.id, adapter: context.engine.adapter, binary: context.engine.binary, args: context.engine.args, capabilities: context.engine.capabilities }, environment: { ...context.agentEnvironment, configHash: context.environmentManifest?.configHash ?? null, lastScannedAt: context.environmentManifest?.scannedAt ?? null }, project: context.project ? { id: context.project.id, rootDir: context.project.rootDir } : undefined, permission: { id: context.environmentPermission.id, filesystem: context.environmentPermission.filesystem, network: context.environmentPermission.network }, ...(routing ? { routing } : {}), workingDirectory: context.workingDirectory, environmentKeys: Object.keys(context.environment).sort(), inheritedEnvironmentKeys: context.allowedEnvironmentKeys, secretReferenceKeys: Object.keys(context.secretReferences).sort(), executes: false };
}
