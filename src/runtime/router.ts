import type { AgentDockConfig } from "../config/schema.js";
import type { NetworkPolicy, Profile, RuntimeCapability } from "../core/types.js";

export type RuntimeHealthStatus = "healthy" | "unknown" | "unhealthy";

export interface RouteRequirements {
  requiredCapabilities?: RuntimeCapability[];
  network?: NetworkPolicy;
  filesystemWrite?: boolean;
}

export interface RouteInput {
  profileId?: string;
  projectId?: string;
  requirements?: RouteRequirements;
  runtimeHealth?: Readonly<Record<string, RuntimeHealthStatus>>;
}

export interface RouteCandidate {
  profileId: string;
  runtimeId: string;
  health: RuntimeHealthStatus;
  accepted: boolean;
  reasons: string[];
}

export type RouteMode = "explicit_profile" | "project_default" | "unique_candidate";

export interface RouteDecision {
  mode: RouteMode;
  profileId: string;
  runtimeId: string;
  candidates: RouteCandidate[];
  explanation: string;
}

export class RouteResolutionError extends Error {
  public constructor(
    public readonly code: "PROFILE_NOT_FOUND" | "PROJECT_NOT_FOUND" | "NO_ROUTE_CANDIDATE" | "AMBIGUOUS_ROUTE" | "ROUTE_REQUIREMENT_INVALID",
    message: string,
    public readonly candidates: RouteCandidate[] = [],
  ) {
    super(message);
    this.name = "RouteResolutionError";
  }
}

export function resolveRoute(config: AgentDockConfig, input: RouteInput): RouteDecision {
  const requirements = normalizeRequirements(input.requirements);
  const project = input.projectId ? config.projects.find((item) => item.id === input.projectId) : undefined;
  if (input.projectId && !project) throw new RouteResolutionError("PROJECT_NOT_FOUND", `Project "${input.projectId}" was not found.`);

  if (input.profileId) {
    const profile = config.profiles.find((item) => item.id === input.profileId);
    if (!profile) throw new RouteResolutionError("PROFILE_NOT_FOUND", `Profile "${input.profileId}" was not found.`);
    const candidate = evaluateCandidate(config, profile, requirements, input.runtimeHealth, project);
    if (!candidate.accepted) {
      throw new RouteResolutionError("NO_ROUTE_CANDIDATE", `Profile "${profile.id}" cannot satisfy the requested route: ${candidate.reasons.join("; ")}.`, [candidate]);
    }
    return decision("explicit_profile", candidate, [candidate], `Explicit Profile "${profile.id}" was selected.`);
  }

  const profiles = project
    ? config.profiles.filter((profile) => project.profileIds.includes(profile.id))
    : config.profiles;
  const candidates = profiles.map((profile) => evaluateCandidate(config, profile, requirements, input.runtimeHealth, project));
  if (project?.defaultProfileId) {
    const defaultCandidate = candidates.find((candidate) => candidate.profileId === project.defaultProfileId);
    if (defaultCandidate?.accepted) return decision("project_default", defaultCandidate, candidates, `Project "${project.id}" default Profile "${defaultCandidate.profileId}" was selected.`);
    if (defaultCandidate && !defaultCandidate.accepted) {
      throw new RouteResolutionError("NO_ROUTE_CANDIDATE", `Project "${project.id}" default Profile "${defaultCandidate.profileId}" cannot satisfy the requested route: ${defaultCandidate.reasons.join("; ")}.`, candidates);
    }
  }

  const accepted = candidates.filter((candidate) => candidate.accepted);
  if (accepted.length === 1) return decision("unique_candidate", accepted[0] as RouteCandidate, candidates, `Profile "${accepted[0]?.profileId}" was the only candidate satisfying the requested route.`);
  if (accepted.length === 0) throw new RouteResolutionError("NO_ROUTE_CANDIDATE", "No configured Profile can satisfy the requested route.", candidates);
  throw new RouteResolutionError("AMBIGUOUS_ROUTE", `Multiple Profiles satisfy the requested route: ${accepted.map((candidate) => candidate.profileId).join(", ")}. Select a profile explicitly.`, candidates);
}

interface NormalizedRouteRequirements {
  requiredCapabilities: RuntimeCapability[];
  network?: NetworkPolicy;
  filesystemWrite?: boolean;
}

function normalizeRequirements(input: RouteRequirements | undefined): NormalizedRouteRequirements {
  if (input?.network !== undefined && input.network !== "allow" && input.network !== "deny") {
    throw new RouteResolutionError("ROUTE_REQUIREMENT_INVALID", `Unsupported network requirement "${String(input.network)}".`);
  }
  if (input?.filesystemWrite !== undefined && typeof input.filesystemWrite !== "boolean") {
    throw new RouteResolutionError("ROUTE_REQUIREMENT_INVALID", "The filesystemWrite requirement must be a boolean.");
  }
  const requiredCapabilities = [...new Set(input?.requiredCapabilities ?? [])].sort() as RuntimeCapability[];
  return {
    requiredCapabilities,
    ...(input?.network !== undefined ? { network: input.network } : {}),
    ...(input?.filesystemWrite !== undefined ? { filesystemWrite: input.filesystemWrite } : {}),
  };
}

function evaluateCandidate(
  config: AgentDockConfig,
  profile: AgentDockConfig["profiles"][number],
  requirements: NormalizedRouteRequirements,
  runtimeHealth: Readonly<Record<string, RuntimeHealthStatus>> | undefined,
  project: AgentDockConfig["projects"][number] | undefined,
): RouteCandidate {
  const runtime = config.runtimes.find((item) => item.id === profile.runtimeId);
  const policy = config.policies.find((item) => item.id === profile.policyId);
  const health = runtimeHealth?.[profile.runtimeId] ?? "unknown";
  const reasons: string[] = [];
  if (project && !project.profileIds.includes(profile.id)) reasons.push(`Profile is not enabled for Project "${project.id}"`);
  if (!runtime) reasons.push(`Runtime "${profile.runtimeId}" is not configured`);
  else {
    if (!runtime.enabled) reasons.push(`Runtime "${runtime.id}" is disabled`);
    if (health === "unhealthy") reasons.push(`Runtime "${runtime.id}" is unhealthy`);
    for (const capability of requirements.requiredCapabilities) {
      if (!runtime.capabilities.includes(capability)) reasons.push(`Runtime lacks capability "${capability}"`);
    }
  }
  if (!policy) reasons.push(`Policy "${profile.policyId}" is not configured`);
  else {
    if (requirements.network !== undefined && policy.network !== requirements.network) reasons.push(`Policy "${policy.id}" does not match requested network policy "${requirements.network}"`);
    if (requirements.filesystemWrite !== undefined && policy.filesystem.write !== requirements.filesystemWrite) reasons.push(`Policy "${policy.id}" does not match requested filesystem write policy`);
  }
  return { profileId: profile.id, runtimeId: profile.runtimeId, health, accepted: reasons.length === 0, reasons };
}

function decision(mode: RouteMode, selected: RouteCandidate, candidates: RouteCandidate[], explanation: string): RouteDecision {
  return { mode, profileId: selected.profileId, runtimeId: selected.runtimeId, candidates, explanation };
}
