import type { AgentDockConfig } from "../config/schema.js";
import type { NetworkPolicy, RuntimeCapability } from "../core/types.js";
import { configuredAgents } from "../config/model.js";

export type RuntimeHealthStatus = "healthy" | "unknown" | "unhealthy";
export interface RouteRequirements { requiredCapabilities?: RuntimeCapability[]; network?: NetworkPolicy; filesystemWrite?: boolean }
export interface RouteInput { agentId?: string; environmentId?: string; projectId?: string; requirements?: RouteRequirements; engineHealth?: Readonly<Record<string, RuntimeHealthStatus>> }
export interface RouteCandidate { agentId?: string; environmentId: string; engineId: string; health: RuntimeHealthStatus; accepted: boolean; reasons: string[] }
export type RouteMode = "explicit_agent" | "explicit_environment" | "project_default" | "unique_candidate";
export interface RouteDecision { mode: RouteMode; agentId?: string; environmentId: string; engineId: string; candidates: RouteCandidate[]; explanation: string }
export interface RouteExplanation {
  resolved: boolean;
  candidates: RouteCandidate[];
  mode?: RouteMode;
  agentId?: string;
  environmentId?: string;
  engineId?: string;
  explanation: string;
  error?: { code: RouteResolutionError["code"]; message: string };
}
export class RouteResolutionError extends Error { public constructor(public readonly code: "AGENT_NOT_FOUND" | "ENVIRONMENT_NOT_FOUND" | "PROJECT_NOT_FOUND" | "NO_ROUTE_CANDIDATE" | "AMBIGUOUS_ROUTE" | "ROUTE_REQUIREMENT_INVALID", message: string, public readonly candidates: RouteCandidate[] = []) { super(message); this.name = "RouteResolutionError"; } }

export function resolveRoute(config: AgentDockConfig, input: RouteInput): RouteDecision {
  const requirements = normalize(input.requirements);
  const project = input.projectId ? config.projects.find((item) => item.id === input.projectId) : undefined;
  if (input.projectId && !project) throw new RouteResolutionError("PROJECT_NOT_FOUND", `Project "${input.projectId}" was not found.`);
  const agents = configuredAgents(config);
  if (input.agentId) {
    const agent = agents.find((item) => item.id === input.agentId);
    if (!agent) throw new RouteResolutionError("AGENT_NOT_FOUND", `Agent "${input.agentId}" was not found.`);
    const candidate = evaluate(config, agent, requirements, input.engineHealth, project);
    if (!candidate.accepted) throw new RouteResolutionError("NO_ROUTE_CANDIDATE", `Agent "${agent.id}" cannot satisfy the requested route: ${candidate.reasons.join("; ")}.`, [candidate]);
    return decision("explicit_agent", agent, candidate, [candidate], `Explicit Agent "${agent.id}" was selected.`);
  }
  if (input.environmentId) {
    const environment = config.environments.find((item) => item.id === input.environmentId);
    if (!environment) throw new RouteResolutionError("ENVIRONMENT_NOT_FOUND", `Environment "${input.environmentId}" was not found.`);
    const candidates = agents.filter((agent) => agent.environmentId === environment.id).map((agent) => evaluate(config, agent, requirements, input.engineHealth, project));
    const accepted = candidates.filter((item) => item.accepted);
    if (accepted.length === 0) throw new RouteResolutionError(candidates.length === 0 ? "NO_ROUTE_CANDIDATE" : "NO_ROUTE_CANDIDATE", candidates.length === 0 ? `No Agent is bound to Environment "${environment.id}".` : `Environment "${environment.id}" cannot satisfy the requested route: ${candidates.flatMap((candidate) => candidate.reasons).join("; ")}.`, candidates);
    if (accepted.length !== 1) throw new RouteResolutionError("AMBIGUOUS_ROUTE", `Multiple Agents are bound to Environment "${environment.id}".`, candidates);
    const selected = agents.find((agent) => agent.id === accepted[0]?.agentId) as (typeof agents)[number];
    return decision("explicit_environment", selected, accepted[0] as CandidateWithAgent, candidates, `Explicit Environment "${environment.id}" was selected.`);
  }
  const scopedAgents = project?.agentIds?.length ? agents.filter((agent) => project.agentIds.includes(agent.id)) : project?.environmentIds?.length ? agents.filter((agent) => project.environmentIds.includes(agent.environmentId)) : agents;
  const candidates = scopedAgents.map((agent) => evaluate(config, agent, requirements, input.engineHealth, project));
  const defaultAgentId = project?.defaultAgentId ?? (project?.defaultEnvironmentId ? agents.find((agent) => agent.environmentId === project.defaultEnvironmentId)?.id : undefined);
  const selectedDefault = defaultAgentId ? candidates.find((candidate) => candidate.agentId === defaultAgentId) : undefined;
  if (selectedDefault) {
    if (selectedDefault.accepted) {
      const agent = agents.find((item) => item.id === defaultAgentId) as (typeof agents)[number];
      return decision("project_default", agent, selectedDefault, candidates, `Project "${project?.id}" default Agent "${agent.id}" was selected.`);
    }
    throw new RouteResolutionError("NO_ROUTE_CANDIDATE", `Project default Agent cannot satisfy the requested route: ${selectedDefault.reasons.join("; ")}.`, candidates);
  }
  const accepted = candidates.filter((item) => item.accepted);
  if (accepted.length === 1) {
    const agent = agents.find((item) => item.id === accepted[0]?.agentId) as (typeof agents)[number];
    return decision("unique_candidate", agent, accepted[0] as CandidateWithAgent, candidates, `Agent "${agent.id}" was the only matching candidate.`);
  }
  if (accepted.length === 0) throw new RouteResolutionError("NO_ROUTE_CANDIDATE", "No configured Agent can satisfy the requested route.", candidates);
  throw new RouteResolutionError("AMBIGUOUS_ROUTE", `${config.agents.length ? "Multiple Agents" : "Multiple Environments"} satisfy the requested route: ${accepted.map((item) => item.agentId).join(", ")}.`, candidates);
}

/** Returns the same deterministic decision data as resolveRoute without making callers parse thrown errors. */
export function explainRoute(config: AgentDockConfig, input: RouteInput): RouteExplanation {
  try {
    const decision = resolveRoute(config, input);
    return { resolved: true, ...decision };
  } catch (error) {
    if (error instanceof RouteResolutionError) {
      return {
        resolved: false,
        candidates: error.candidates,
        explanation: error.message,
        error: { code: error.code, message: error.message },
      };
    }
    throw error;
  }
}

interface Requirements { requiredCapabilities: RuntimeCapability[]; network?: NetworkPolicy; filesystemWrite?: boolean }
type CandidateWithAgent = RouteCandidate & { agentId: string };
function normalize(input?: RouteRequirements): Requirements { if (input?.network !== undefined && input.network !== "allow" && input.network !== "deny") throw new RouteResolutionError("ROUTE_REQUIREMENT_INVALID", "Unsupported network requirement."); if (input?.filesystemWrite !== undefined && typeof input.filesystemWrite !== "boolean") throw new RouteResolutionError("ROUTE_REQUIREMENT_INVALID", "filesystemWrite must be boolean."); return { requiredCapabilities: [...new Set(input?.requiredCapabilities ?? [])].sort() as RuntimeCapability[], ...(input?.network ? { network: input.network } : {}), ...(input?.filesystemWrite !== undefined ? { filesystemWrite: input.filesystemWrite } : {}) }; }
function evaluate(config: AgentDockConfig, agent: ReturnType<typeof configuredAgents>[number], requirements: Requirements, healthMap: Readonly<Record<string, RuntimeHealthStatus>> | undefined, project: AgentDockConfig["projects"][number] | undefined): CandidateWithAgent {
  const engine = config.engines.find((item) => item.id === agent.engineId);
  const permission = config.environmentPermissions.find((item) => item.id === agent.permissionId);
  const health = healthMap?.[agent.engineId] ?? "unknown";
  const reasons: string[] = [];
  if (project?.agentIds?.length && !project.agentIds.includes(agent.id)) reasons.push(`Agent is not enabled for Project "${project.id}"`);
  else if (!project?.agentIds?.length && project?.environmentIds?.length && !project.environmentIds.includes(agent.environmentId)) reasons.push(`Environment "${agent.environmentId}" is not enabled for Project "${project.id}"`);
  if (!agent.enabled) reasons.push(`Agent "${agent.id}" is disabled`);
  if (!engine) reasons.push(`Engine "${agent.engineId}" is not configured`); else { if (!engine.enabled) reasons.push(`Engine "${engine.id}" is disabled`); if (health === "unhealthy") reasons.push(`Engine "${engine.id}" is unhealthy`); for (const capability of requirements.requiredCapabilities) if (!engine.capabilities.includes(capability)) reasons.push(`Engine lacks capability "${capability}"`); }
  if (!permission) reasons.push(`Environment Permission "${agent.permissionId}" is not configured`); else { if (requirements.network !== undefined && permission.network !== requirements.network) reasons.push("Network permission does not match"); if (requirements.filesystemWrite !== undefined && permission.filesystem.write !== requirements.filesystemWrite) reasons.push("Filesystem write permission does not match"); }
  return { agentId: agent.id, environmentId: agent.environmentId, engineId: agent.engineId, health, accepted: reasons.length === 0, reasons };
}
function decision(mode: RouteMode, agent: ReturnType<typeof configuredAgents>[number], selected: CandidateWithAgent, candidates: CandidateWithAgent[], explanation: string): RouteDecision { return { mode, agentId: agent.id, environmentId: selected.environmentId, engineId: selected.engineId, candidates, explanation }; }
