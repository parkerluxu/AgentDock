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

    const runtimeIds = checkUniqueIds(config.runtimes, "runtimes");
    const profileIds = checkUniqueIds(config.profiles, "profiles");
    const policyIds = checkUniqueIds(config.policies, "policies");
    checkUniqueIds(config.projects, "projects");

    for (const [index, profile] of config.profiles.entries()) {
      if (!runtimeIds.has(profile.runtimeId)) {
        issues.push({ path: `profiles.${index}.runtimeId`, message: `unknown runtime "${profile.runtimeId}".` });
      }
      if (!policyIds.has(profile.policyId)) {
        issues.push({ path: `profiles.${index}.policyId`, message: `unknown policy "${profile.policyId}".` });
      }
      if (profile.extends === profile.id) {
        issues.push({ path: `profiles.${index}.extends`, message: "a profile cannot extend itself." });
      } else if (profile.extends !== undefined && !profileIds.has(profile.extends)) {
        issues.push({ path: `profiles.${index}.extends`, message: `unknown parent profile "${profile.extends}".` });
      }
    }
    for (const [index, profile] of config.profiles.entries()) {
      const chain = new Set<string>();
      let current = profile;
      while (current.extends !== undefined) {
        if (chain.has(current.id)) {
          issues.push({ path: `profiles.${index}.extends`, message: `profile inheritance cycle detected at "${current.id}".` });
          break;
        }
        chain.add(current.id);
        const parent = config.profiles.find((item) => item.id === current.extends);
        if (!parent) break;
        current = parent;
      }
    }

    for (const [index, project] of config.projects.entries()) {
      for (const [profileIndex, profileId] of project.profileIds.entries()) {
        if (!profileIds.has(profileId)) {
          issues.push({ path: `projects.${index}.profileIds.${profileIndex}`, message: `unknown profile "${profileId}".` });
        }
      }
      if (project.defaultProfileId !== undefined && !project.profileIds.includes(project.defaultProfileId)) {
        issues.push({ path: `projects.${index}.defaultProfileId`, message: "must be included in profileIds." });
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
