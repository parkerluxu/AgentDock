import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { RuntimeDescriptor } from "../core/types.js";
import type { AgentDockConfig, ConfigRuntime } from "../config/schema.js";

export function toRuntimeDescriptor(runtime: ConfigRuntime): RuntimeDescriptor {
  return {
    id: runtime.id,
    adapter: runtime.adapter,
    ...(runtime.binary ? { binary: runtime.binary } : {}),
    args: runtime.args,
    ...(runtime.version ? { version: runtime.version } : {}),
    enabled: runtime.enabled,
    capabilities: runtime.capabilities,
  };
}

export function runtimeDescriptors(config: AgentDockConfig): RuntimeDescriptor[] {
  return config.runtimes.map(toRuntimeDescriptor);
}

export function configBaseDirectory(configPath: string): string {
  return resolve(dirname(configPath));
}

export function configDataPath(config: AgentDockConfig, configPath: string): string {
  const dataDirectory = config.dataDir
    ? resolve(configBaseDirectory(configPath), config.dataDir)
    : resolve(process.cwd(), ".agentdock", "data");

  // AgentDock v0.1 development builds treated `dataDir` as a database file.
  // Keep reading that file when it already exists so upgrading does not hide or
  // overwrite a user's local Run and Session history.
  if (existsSync(dataDirectory) && statSync(dataDirectory).isFile()) return dataDirectory;

  return join(dataDirectory, "agentdock.db");
}
