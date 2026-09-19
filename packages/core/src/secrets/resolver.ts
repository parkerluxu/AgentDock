import type { SecretReference } from "../core/types.js";

export class SecretResolutionError extends Error {
  public constructor(public readonly referenceName: string, message: string) {
    super(message);
    this.name = "SecretResolutionError";
  }
}

export interface SecretResolver {
  resolve(references: Record<string, SecretReference>): Record<string, string>;
  diagnose(references: Record<string, SecretReference>): Array<{ name: string; provider: SecretReference["provider"]; healthy: boolean; message?: string }>;
}

export class EnvironmentSecretResolver implements SecretResolver {
  public constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  public resolve(references: Record<string, SecretReference>): Record<string, string> {
    const resolved: Record<string, string> = {};
    for (const [name, reference] of Object.entries(references)) {
      if (reference.provider !== "env") {
        throw new SecretResolutionError(name, `Secret "${name}" uses provider "${reference.provider}", which is not configured.`);
      }
      const value = this.environment[reference.key];
      if (value === undefined || value.length === 0) {
        throw new SecretResolutionError(name, `Environment variable for secret "${name}" is not set.`);
      }
      resolved[name] = value;
    }
    return resolved;
  }

  public diagnose(references: Record<string, SecretReference>): Array<{ name: string; provider: SecretReference["provider"]; healthy: boolean; message?: string }> {
    return Object.entries(references).map(([name, reference]) => {
      if (reference.provider !== "env") {
        return { name, provider: reference.provider, healthy: false, message: `Provider "${reference.provider}" is not configured.` };
      }
      const value = this.environment[reference.key];
      return value && value.length > 0
        ? { name, provider: reference.provider, healthy: true }
        : { name, provider: reference.provider, healthy: false, message: "Environment variable is not set." };
    });
  }
}
