import { isAbsolute, relative, resolve, win32 } from "node:path";
import type { AgentDockConfig } from "../config/schema.js";
import type { ExecutionContext, Policy, Profile, Project, RuntimeDescriptor, SecretReference } from "../core/types.js";
import { toRuntimeDescriptor } from "../runtime/configuration.js";

export interface ResolveOptions {
  config: AgentDockConfig;
  baseDirectory: string;
  profileId?: string;
  projectId?: string;
  environment?: NodeJS.ProcessEnv;
}

export function resolveExecutionContext(options: ResolveOptions): ExecutionContext {
  const { config, baseDirectory } = options;
  const project = findProject(config, options.projectId) ?? (config.projects.length === 1 ? config.projects[0] : undefined);
  const profileId = options.profileId ?? project?.defaultProfileId;
  if (!profileId) throw new Error("A profileId is required when no project default profile is configured.");
  const profileConfig = resolveProfile(config, profileId);
  if (project && !project.profileIds.includes(profileConfig.id)) {
    throw new Error(`Profile "${profileConfig.id}" is not enabled for project "${project.id}".`);
  }
  const runtimeConfig = config.runtimes.find((item) => item.id === profileConfig.runtimeId);
  if (!runtimeConfig) throw new Error(`Runtime "${profileConfig.runtimeId}" was not found.`);
  if (!runtimeConfig.enabled) throw new Error(`Runtime "${runtimeConfig.id}" is disabled.`);
  const policyConfig = config.policies.find((item) => item.id === profileConfig.policyId);
  if (!policyConfig) throw new Error(`Policy "${profileConfig.policyId}" was not found.`);

  const runtime: RuntimeDescriptor = toRuntimeDescriptor(runtimeConfig);
  const profile: Profile = {
    id: profileConfig.id,
    runtimeId: profileConfig.runtimeId,
    policyId: profileConfig.policyId,
    ...(profileConfig.extends ? { extends: profileConfig.extends } : {}),
    settings: profileConfig.settings,
  };
  const policy: Policy = {
    id: policyConfig.id,
    filesystem: policyConfig.filesystem,
    environment: {
      allow: policyConfig.environment.allow,
      ...(policyConfig.environment.secretRefs ? { secretRefs: policyConfig.environment.secretRefs } : {}),
    },
    network: policyConfig.network,
  };
  const normalizedProject: Project | undefined = project
    ? {
        id: project.id,
        rootDir: resolveConfiguredPath(baseDirectory, project.rootDir),
        profileIds: project.profileIds,
        ...(project.defaultProfileId ? { defaultProfileId: project.defaultProfileId } : {}),
      }
    : undefined;
  const workingDirectory = normalizedProject?.rootDir ?? baseDirectory;
  const policyRoots = policy.filesystem.roots.map((root) => resolveConfiguredPath(workingDirectory, root));
  if (!policyRoots.some((root) => isWithinRoot(workingDirectory, root))) {
    throw new Error(`Working directory "${workingDirectory}" is outside Policy "${policy.id}" filesystem roots.`);
  }
  const allowedEnvironmentKeys = [...new Set(policy.environment.allow)].sort();
  const sourceEnvironment = options.environment ?? process.env;
  const environment: Record<string, string> = {};
  for (const key of allowedEnvironmentKeys) {
    const value = sourceEnvironment[key];
    if (value !== undefined) environment[key] = value;
  }
  const secretReferences: Record<string, SecretReference> = { ...(policy.environment.secretRefs ?? {}) };
  return {
    runtime,
    profile,
    policy,
    ...(normalizedProject ? { project: normalizedProject } : {}),
    workingDirectory,
    allowedEnvironmentKeys,
    environment,
    secretReferences,
  };
}

function findProject(config: AgentDockConfig, projectId?: string): AgentDockConfig["projects"][number] | undefined {
  if (!projectId) return undefined;
  const project = config.projects.find((item) => item.id === projectId);
  if (!project) throw new Error(`Project "${projectId}" was not found.`);
  return project;
}

function resolveProfile(config: AgentDockConfig, profileId: string, visited = new Set<string>()): AgentDockConfig["profiles"][number] {
  if (visited.has(profileId)) throw new Error(`Profile inheritance cycle detected at "${profileId}".`);
  const profile = config.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error(`Profile "${profileId}" was not found.`);
  if (!profile.extends) return profile;
  const parent = resolveProfile(config, profile.extends, new Set([...visited, profileId]));
  return {
    ...parent,
    ...profile,
    settings: { ...parent.settings, ...profile.settings },
  };
}

function isWithinRoot(candidate: string, root: string): boolean {
  const pathModule = usesWindowsPath(candidate) || usesWindowsPath(root) ? win32 : { relative, isAbsolute };
  const path = pathModule.relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith("..\\") && !path.startsWith("../") && !pathModule.isAbsolute(path));
}

function resolveConfiguredPath(baseDirectory: string, configuredPath: string): string {
  if (usesWindowsPath(baseDirectory) || usesWindowsPath(configuredPath)) return win32.resolve(baseDirectory, configuredPath);
  return resolve(baseDirectory, configuredPath);
}

function usesWindowsPath(value: string): boolean {
  return win32.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

export function formatDryRun(context: ExecutionContext, task: string): Record<string, unknown> {
  return {
    task,
    runtime: {
      id: context.runtime.id,
      adapter: context.runtime.adapter,
      binary: context.runtime.binary,
      args: context.runtime.args,
      capabilities: context.runtime.capabilities,
    },
    profile: { id: context.profile.id, settings: context.profile.settings },
    project: context.project ? { id: context.project.id, rootDir: context.project.rootDir } : undefined,
    policy: {
      id: context.policy.id,
      filesystem: context.policy.filesystem,
      network: context.policy.network,
    },
    workingDirectory: context.workingDirectory,
    environmentKeys: context.allowedEnvironmentKeys,
    secretReferenceKeys: Object.keys(context.secretReferences).sort(),
    executes: false,
  };
}
