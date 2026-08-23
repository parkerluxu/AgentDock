import { validateAdapterManifest, type AgentAdapter } from "../adapter-contract/index.js";
import type { RuntimeDescriptor } from "../core/types.js";
import { ClaudeCodeAdapter, CodexAdapter } from "./adapters.js";
import { EchoAdapter } from "./echo-adapter.js";
import { ProcessRunner } from "./process-runner.js";

export type AdapterFactory = (runtime: RuntimeDescriptor) => AgentAdapter;

export class RuntimeRegistry {
  private readonly factories = new Map<string, AdapterFactory>();

  public register(adapterId: string, factory: AdapterFactory): void {
    if (this.factories.has(adapterId)) throw new Error(`Adapter "${adapterId}" is already registered.`);
    this.factories.set(adapterId, factory);
  }

  public create(runtime: RuntimeDescriptor): AgentAdapter {
    const factory = this.factories.get(runtime.adapter);
    if (!factory) throw new Error(`No Adapter registered for "${runtime.adapter}".`);
    const adapter = factory(runtime);
    validateAdapterManifest(adapter.manifest);
    return adapter;
  }

  public list(): string[] {
    return [...this.factories.keys()].sort();
  }
}

export function createBuiltinRuntimeRegistry(runner = new ProcessRunner()): RuntimeRegistry {
  const registry = new RuntimeRegistry();
  registry.register("claude-code", (runtime) => new ClaudeCodeAdapter(runtime, runner));
  registry.register("codex", (runtime) => new CodexAdapter(runtime, runner));
  registry.register("echo", (runtime) => new EchoAdapter(runtime));
  return registry;
}
