# Build and local deployment

The repository uses npm workspaces for two main packages: agentdock, the core CLI/API, and @agentdock/dsh, the optional DSH plugin. The VitePress Wiki is a third, independent output.

## Install dependencies and build

Node.js >=22.5 and npm are required. Install dependencies at the repository root:

~~~powershell
npm ci
~~~

If you only need the core CLI/API, build the core workspace:

~~~powershell
npm run build --workspace agentdock
node .\packages\core\dist\cli.js config validate .\packages\core\examples\config.quickstart.json
node .\packages\core\dist\cli.js doctor --config .\packages\core\examples\config.quickstart.json
~~~

The root npm run build builds core and then DSH. Source lives in packages/core/src/ and packages/dsh/src/; core output is packages/core/dist/, with packages/core/dist/cli.js as its CLI entrypoint. Cordis, React, and browser bundles for DSH belong only to the separate plugin package. Normally edit source, not generated files in dist/.

## Optional: install a local global CLI

To avoid typing the Node entrypoint path, pack the core workspace and install it into the current user's global npm directory:

~~~powershell
npm pack --workspace agentdock
npm install --global .\agentdock-0.1.3-dev.tgz
agentdock --help
~~~

Use the exact filename printed by npm pack. Rebuild, repack, and install a new tarball after updating source. Or run node .\packages\core\dist\cli.js ... directly without a global install. See [DeepSeek Harness integration](./dsh) for the separate DSH plugin package.

## Start the local API and Control Center

Validate the configuration before starting the API:

~~~powershell
node .\packages\core\dist\cli.js config validate .\packages\core\examples\config.quickstart.json
node .\packages\core\dist\cli.js api serve --config .\packages\core\examples\config.quickstart.json --port 4177
~~~

Open http://127.0.0.1:4177/ for the Control Center. The service listens only on local loopback. When no token is supplied, startup output includes the api-token file path; enter that file's contents in the UI's authentication prompt. Press Ctrl+C to stop the API.

You can provide a stable token through the environment:

~~~powershell
$env:AGENTDOCK_API_TOKEN = 'replace-with-a-long-local-token'
node .\packages\core\dist\cli.js api serve --config .\packages\core\examples\config.quickstart.json --port 4177
~~~

## Build the Wiki

Wiki source and VitePress configuration are under docs/wiki/:

~~~text
npm run wiki:dev       # local authoring server with hot reload
npm run wiki:build     # static output to docs/wiki/.vitepress/dist/
npm run wiki:preview   # preview the generated site locally
~~~

The Wiki is independent of the AgentDock API and SQLite, and can be deployed to any static file server.

## Data and paths

The CLI defaults to .agentdock/config.json below the current working directory; use --config to select another file. Relative config paths resolve from the directory containing that config. dataDir controls SQLite, tokens, and Environment control data; by default the database is .agentdock/data/agentdock.db. The quickstart config writes into its isolated .agentdock/quickstart-data/ directory.

When copying a build to another machine, also configure that machine's Agent CLIs and Environments, then run config validate, doctor, and Engine health checks there.
