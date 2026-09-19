import type { UserConfig } from "tsdown";

// DSH's browser module loader accepts a factory-form CommonJS bundle, not a
// native ESM file. Host TypeScript remains compiled by `tsc`; this secondary
// build replaces only dist/client.js with the browser-safe client half.
const client: UserConfig = {
  entry: { client: "src/client.ts" },
  outDir: "dist",
  format: "cjs",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  dts: false,
  clean: false,
  external: ["react"],
  noExternal: (id: string) => id === "react" ? undefined : true,
  outputOptions: {
    entryFileNames: "client.js",
    banner: "window.__ModuleLoader__.load({ id: \"agentdock\", factory: (require) => {",
    intro: "var module = { exports: {} }; var exports = module.exports;",
    footer: "return module.exports; } });",
  },
};

export default [client];
