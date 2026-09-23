import type { UserConfig } from "tsdown";

// DSH's browser module loader accepts a factory-form CommonJS bundle, not a
// native ESM file. The host bundle embeds AgentDock's config editor so a local
// plugin tarball never needs an unpublished `agentdock` package from npm.
const client: UserConfig = {
  entry: { client: "src/client.ts" },
  outDir: "dist",
  format: "cjs",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  dts: false,
  clean: true,
  external: ["react"],
  noExternal: (id: string) => id === "react" ? undefined : true,
  outputOptions: {
    entryFileNames: "client.js",
    banner: "window.__ModuleLoader__.load({ id: \"@agentdock/dsh\", factory: (require) => {",
    intro: "var module = { exports: {} }; var exports = module.exports;",
    footer: "return module.exports; } });",
  },
};

const host: UserConfig = {
  entry: { host: "src/host.ts" },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "es2022",
  sourcemap: true,
  dts: false,
  clean: false,
  external: [/^@deepseek-ai\//u, "react"],
  noExternal: ["agentdock", "zod"],
  outputOptions: {
    entryFileNames: "host.js",
  },
};

export default [client, host];
