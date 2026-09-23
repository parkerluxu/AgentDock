# Plain-language case study: understand one Echo Run

Imagine Alex has just opened AgentDock and wants to know how to tell whether it is working. Alex does not need to install a model CLI or learn the whole codebase first. This walkthrough uses built-in Echo to exercise config, routing, a local Run, and history.

## A few simple roles

- Engine: how work executes. Echo is built in for demos; real use can select Codex or Claude Code.
- Agent: a selectable identity that binds an Engine, Environment, and Permission.
- Environment: the Agent's own config, state, and cache directories.
- Project: the working directory and the Agents allowed to use it.
- Permission: AgentDock's application-level filesystem, network, and environment-variable policy.
- Run: one task record with a frozen config snapshot, events, and final status.

## Step 1: install dependencies and build core

From the repository root:

~~~powershell
npm ci
npm run build --workspace agentdock
node .\packages\core\dist\cli.js config validate .\packages\core\examples\config.quickstart.json
~~~

The starter config uses isolated quickstart-data, does not overwrite .agentdock/config.json, and does not require a separate Echo package.

## Step 2: preview the route

~~~powershell
node .\packages\core\dist\cli.js run dry-run --config .\packages\core\examples\config.quickstart.json --agent echo-agent --project agentdock-demo "Inspect this project"
~~~

Alex can see the selected Agent, Engine, Environment, Project working directory, and permissions. A dry-run only resolves the route; it does not start an Agent or write a Run.

## Step 3: execute a safe local Run

~~~powershell
node .\packages\core\dist\cli.js run execute --config .\packages\core\examples\config.quickstart.json --agent echo-agent --project agentdock-demo "Hello, AgentDock"
node .\packages\core\dist\cli.js run list --config .\packages\core\examples\config.quickstart.json
~~~

Echo returns the input as a message; it does not understand repository contents or call a model. The first execution creates SQLite history and a managed Environment under .agentdock/quickstart-data/. Save the Run ID to inspect it later with run show and run events.

## Step 4: inspect it in the UI

In another terminal:

~~~powershell
node .\packages\core\dist\cli.js api serve --config .\packages\core\examples\config.quickstart.json --port 4177
~~~

Open http://127.0.0.1:4177/ and retrieve the local API token as described in the startup output. Select Project agentdock-demo in the overview, then open the Run snapshot and event timeline.

## To actually investigate test failures

Echo only checks installation, routing, Run, and history flows. To read or modify a real repository, install and sign in to Codex CLI or Claude Code separately, enable its Engine/Agent in AgentDock, and set the Project rootDir to the intended repository. Run doctor, Engine health, and dry-run before a real execution; real calls may consume model quota. See [Installation and quick start](./getting-started) and [Configuration](./configuration).

## Takeaways

1. An Engine is an execution method; an Agent combines Engine, Environment, and Permission.
2. Project rootDir selects the working directory; AgentDock does not infer it from the terminal.
3. Preview routing and permissions before deciding to run a real Agent.
4. Runs and SQLite history help with review; the starter data is isolated from default data.
