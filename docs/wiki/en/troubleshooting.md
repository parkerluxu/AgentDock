# Troubleshooting

## Node.js or SQLite errors

```text
node --version
```

Use Node.js `22.5` or newer, then rerun `npm ci` and `npm run build`.

## Configuration errors

```text
node packages/core/dist/cli.js config validate <config-path>
```

Check lowercase IDs, existing Engine/Environment/Permission references, Project defaults, external Environment directories, and inheritance cycles.

## Missing Adapter or unhealthy Runtime

```text
node packages/core/dist/cli.js engine list --config <config-path>
node packages/core/dist/cli.js engine health <engine-id> --config <config-path>
node packages/core/dist/cli.js doctor --config <config-path>
```

Confirm the Adapter is installed/enabled and the configured binary is available on PATH.

## Environment drift

If the environment changed before the next Run starts, confirm the change is trusted and rescan:

```text
POST /api/v1/environments/<environment-id>/rescan
```

Changes made by the Agent during an active Run, such as sessions, caches, and runtime state, are reconciled automatically when the Run finishes. This applies to both `managed` and `external` Environments.

## API or token problems

Verify the service is running on `127.0.0.1`, the port matches startup JSON, and every request sends `Authorization: Bearer <token>`. Use `--port 0` if a fixed port is occupied.

## Wiki changes not visible

Edit Markdown under `docs/wiki/`, then run `npm run wiki:build` and `npm run wiki:preview`. Never edit the generated `.vitepress/dist/` directory directly.
