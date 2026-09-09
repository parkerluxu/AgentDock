# Build and local deployment

There are two independent outputs: the AgentDock TypeScript runtime and the static Wiki website.

## Build AgentDock

```text
npm ci
npm run typecheck
npm test
npm run build
npm run config:validate -- examples/config.example.json
node dist/cli.js doctor --config examples/config.example.json
```

`npm run build` is `tsc -p tsconfig.json`: source is under `src/`, output is under `dist/`, and `dist/cli.js` is the runnable entrypoint.

## Start the local API

```text
node dist/cli.js api serve --config examples/config.example.json --port 4177
```

Open `http://127.0.0.1:4177/` for the Control Center. Startup JSON prints the API URL and, when no explicit token is supplied, the generated `api-token` path. You can also set `--api-token` or `AGENTDOCK_API_TOKEN`.

The API is loopback-only. Use `--port 0` to let the operating system choose an available port. Press `Ctrl+C` to stop the service cleanly.

## Build the Wiki

The source pages live under `docs/wiki/`; navigation is configured in `docs/wiki/.vitepress/config.ts`:

```text
npm run wiki:dev       # authoring server with hot reload
npm run wiki:build     # output: docs/wiki/.vitepress/dist/
npm run wiki:preview   # preview the generated static site
```

The generated directory can be copied to any static file server. It does not require the AgentDock API or a database.
