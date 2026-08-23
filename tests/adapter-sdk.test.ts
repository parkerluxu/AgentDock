import { describe, expect, it } from "vitest";
import {
  AdapterManifestValidationError,
  assertAdapterContract,
  createErrorEvent,
  createMessageEvent,
  createStatusEvent,
  normalizeAdapterError,
  validateAdapterManifest,
} from "../src/adapter-sdk/index.js";
import { EchoAdapter } from "../src/runtime/echo-adapter.js";
import type { RuntimeDescriptor } from "../src/core/types.js";

const runtime: RuntimeDescriptor = {
  id: "echo",
  adapter: "echo",
  args: [],
  enabled: true,
  capabilities: ["execute", "stream_events", "cancel", "healthcheck"],
};

describe("Adapter SDK", () => {
  it("validates the manifest shape and supported version range syntax", () => {
    const manifest = validateAdapterManifest({
      name: "example",
      version: "0.1.0",
      entry: "./example-adapter.js",
      agentDockApi: "v1",
      runtime: { id: "example", versionRange: ">=1.2.0 <2.0.0" },
      capabilities: ["execute", "healthcheck"],
      requiredPermissions: ["filesystem.read"],
    });
    expect(manifest.entry).toBe("./example-adapter.js");
    expect(() => validateAdapterManifest({ ...manifest, capabilities: ["execute", "execute"] })).toThrow(AdapterManifestValidationError);
    expect(() => validateAdapterManifest({ ...manifest, runtime: { id: "example", versionRange: "latest" } })).toThrow(AdapterManifestValidationError);
  });

  it("constructs stable status, message and error events", () => {
    expect(createStatusEvent("run-1", 0, "running").payload).toMatchObject({ status: "running" });
    expect(createMessageEvent("run-1", 1, "hello", { source: "echo" }).payload).toEqual({ source: "echo", text: "hello" });
    expect(createErrorEvent("run-1", 2, new Error("command timed out")).payload).toMatchObject({ status: "timed_out", errorCode: "TIMED_OUT" });
  });

  it("normalizes common process errors without exposing a stack as the message", () => {
    expect(normalizeAdapterError(Object.assign(new Error("missing executable"), { code: "ENOENT" }))).toEqual({
      code: "NOT_FOUND",
      message: "missing executable",
      retryable: false,
    });
  });

  it("runs the shared contract checks against the deterministic Echo Adapter", async () => {
    const report = await assertAdapterContract(new EchoAdapter(runtime), { runtime, task: "hello adapter" });
    expect(report.health.healthy).toBe(true);
    expect(report.cancelCompleted).toBe(true);
    expect(report.events.map((event) => event.type)).toEqual(["status", "message", "status"]);
    expect(report.events.at(-1)?.payload).toMatchObject({ status: "succeeded", exitCode: 0 });
  });
});
