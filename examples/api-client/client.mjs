const apiBaseUrl = (process.env.AGENTDOCK_API_BASE_URL ?? "http://127.0.0.1:4177/api/v1").replace(/\/$/u, "");
const apiToken = process.env.AGENTDOCK_API_TOKEN;
const task = process.argv.slice(2).join(" ").trim() || "example API task";

if (!apiToken) {
  process.stderr.write("Set AGENTDOCK_API_TOKEN to the local API token before running this example.\n");
  process.exitCode = 2;
} else {
  const idempotencyKey = `example-${Date.now()}`;
  const created = await fetch(`${apiBaseUrl}/runs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ task, projectId: process.env.AGENTDOCK_PROJECT_ID ?? "workspace" }),
  });
  const body = await created.json();
  if (!created.ok || !body.run?.id || !body.eventsUrl) {
    process.stderr.write(`${JSON.stringify(body)}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify({ runId: body.run.id, created: body.created })}\n`);
    const eventsUrl = body.eventsUrl.startsWith("http")
      ? body.eventsUrl
      : `${new URL(apiBaseUrl).origin}${body.eventsUrl}`;
    const events = await fetch(`${eventsUrl}?stream=sse&after=-1`, {
      headers: { authorization: `Bearer ${apiToken}` },
    });
    if (!events.ok || !events.body) {
      process.stderr.write(`${await events.text()}\n`);
      process.exitCode = 1;
    } else {
      const reader = events.body.getReader();
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
}
