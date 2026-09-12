const apiBaseUrl = (process.env.AGENTDOCK_API_BASE_URL ?? "http://127.0.0.1:4177/api/v1").replace(/\/$/u, "");
const apiToken = process.env.AGENTDOCK_API_TOKEN;
const agentId = process.env.AGENTDOCK_AGENT_ID ?? "codex-reviewer";
const task = process.argv.slice(2).join(" ").trim() || "example API task";

if (!apiToken) {
  process.stderr.write("Set AGENTDOCK_API_TOKEN to the local API token before running this example.\n");
  process.exitCode = 2;
} else {
  const idempotencyKey = `example-${Date.now()}`;
  const invoked = await fetch(`${apiBaseUrl}/agents/${encodeURIComponent(agentId)}/invoke`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
      accept: "text/event-stream",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ task, projectId: process.env.AGENTDOCK_PROJECT_ID ?? "workspace" }),
  });
  if (!invoked.ok || !invoked.body) {
    process.stderr.write(`${await invoked.text()}\n`);
    process.exitCode = 1;
  } else {
    const reader = invoked.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame.split("\n").find((line) => line.startsWith("data: "));
        if (data) process.stdout.write(`${data.slice("data: ".length)}\n`);
      }
    }
  }
}
