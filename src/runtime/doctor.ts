import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentDockConfig } from "../config/schema.js";
import { EnvironmentSecretResolver, type SecretResolver } from "../secrets/resolver.js";
import { SqliteRunStore } from "../storage/sqlite-run-store.js";
import { configBaseDirectory, configDataPath, runtimeDescriptors } from "./configuration.js";
import { createConfiguredRuntimeRegistry, type RuntimeRegistry } from "./registry.js";
import { environmentCatalog } from "../config/model.js";

export interface DoctorDiagnostic {
  scope: "runtime" | "project" | "storage" | "secret";
  id: string;
  healthy: boolean;
  message?: string;
}

export interface DoctorReport {
  healthy: boolean;
  diagnostics: DoctorDiagnostic[];
}

export interface DoctorOptions {
  config: AgentDockConfig;
  configPath: string;
  registry?: RuntimeRegistry;
  secretResolver?: SecretResolver;
  checkStorage?: boolean;
}

export async function doctor(options: DoctorOptions): Promise<DoctorReport> {
  const diagnostics: DoctorDiagnostic[] = [];
  const registry = options.registry ?? await createConfiguredRuntimeRegistry(options.config, options.configPath);
  const secretResolver = options.secretResolver ?? new EnvironmentSecretResolver();

  for (const runtime of runtimeDescriptors(options.config)) {
    if (!registry.list().includes(runtime.adapter)) {
      diagnostics.push({ scope: "runtime", id: runtime.id, healthy: false, message: `Adapter "${runtime.adapter}" is not registered.` });
      continue;
    }
    const health = await registry.create(runtime).healthCheck();
    diagnostics.push({
      scope: "runtime",
      id: runtime.id,
      healthy: health.healthy,
      ...(health.message ? { message: health.message } : {}),
    });
  }

  const baseDirectory = configBaseDirectory(options.configPath);
  for (const project of options.config.projects) {
    const rootDir = resolve(baseDirectory, project.rootDir);
    diagnostics.push({
      scope: "project",
      id: project.id,
      healthy: existsSync(rootDir),
      ...(existsSync(rootDir) ? {} : { message: `Project root does not exist: ${rootDir}` }),
    });
  }

  if (options.checkStorage !== false) {
    try {
      const store = new SqliteRunStore(configDataPath(options.config, options.configPath), options.config.storage);
      store.close();
      diagnostics.push({ scope: "storage", id: "sqlite", healthy: true });
    } catch (error) {
      diagnostics.push({ scope: "storage", id: "sqlite", healthy: false, message: String(error) });
    }
  }

  for (const policy of environmentCatalog(options.config).permissions) {
    for (const diagnostic of secretResolver.diagnose(policy.environment.secretRefs ?? {})) {
      diagnostics.push({
        scope: "secret",
        id: `${policy.id}/${diagnostic.name}`,
        healthy: diagnostic.healthy,
        ...(diagnostic.message ? { message: diagnostic.message } : {}),
      });
    }
  }

  return { healthy: diagnostics.every((diagnostic) => diagnostic.healthy), diagnostics };
}
