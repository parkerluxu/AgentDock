import { describe, expect, it } from "vitest";
import { EnvironmentSecretResolver, SecretResolutionError } from "../src/secrets/resolver.js";

describe("EnvironmentSecretResolver", () => {
  it("resolves env references under their requested process environment names", () => {
    const resolver = new EnvironmentSecretResolver({ SOURCE_TOKEN: "value-not-to-log" });
    expect(resolver.resolve({ AGENT_TOKEN: { provider: "env", key: "SOURCE_TOKEN" } })).toEqual({ AGENT_TOKEN: "value-not-to-log" });
  });

  it("never includes secret values in missing-secret diagnostics", () => {
    const resolver = new EnvironmentSecretResolver({});
    expect(() => resolver.resolve({ AGENT_TOKEN: { provider: "env", key: "MISSING" } })).toThrow(SecretResolutionError);
    expect(resolver.diagnose({ AGENT_TOKEN: { provider: "env", key: "MISSING" } })).toEqual([
      { name: "AGENT_TOKEN", provider: "env", healthy: false, message: "Environment variable is not set." },
    ]);
  });
});
