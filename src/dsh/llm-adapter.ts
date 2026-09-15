import { LlmAdapter, LlmError, type GenerateOptions, type LlmModelInfo, type LlmProviderInfo, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { AgentDockGateway, AgentDockGatewayError } from "./gateway.js";

/**
 * Makes AgentDock a normal DSH provider. DSH remains responsible for transcript
 * persistence and rendering; AgentDock receives only the new user turn and
 * owns the underlying Codex/Claude session and its native tools.
 */
export class AgentDockLlmAdapter extends LlmAdapter {
  public constructor(private readonly gateway: AgentDockGateway) { super(); }

  public override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: "AgentDock" };
  }

  public override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: "bound", name: "Bound AgentDock agent", description: "Uses this DSH session's AgentDock binding." }]);
  }

  public override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const dshSessionId = options.sessionId;
    if (!dshSessionId) throw new LlmError("AgentDock requests require a DSH session.", "SESSION_REQUIRED");
    const task = latestUserText(options);
    if (!task) throw new LlmError("AgentDock did not receive user text for this turn.", "EMPTY_TASK");

    let opened = false;
    let emittedText = false;
    let output = "";
    let terminal: string | undefined;
    try {
      for await (const event of this.gateway.invoke(String(dshSessionId), task, options.signal)) {
        const text = responseText(event.payload);
        if (text !== undefined) {
          if (!opened) {
            opened = true;
            yield { type: "block-start", index: 0, blockType: "text" };
          }
          emittedText = true;
          output += text;
          yield { type: "text-delta", index: 0, text };
        } else if (event.type === "status" || event.type === "error") {
          const status = event.payload.status;
          if (typeof status === "string" && (status === "succeeded" || status === "failed" || status === "cancelled" || status === "timed_out")) terminal = status;
          if (event.type === "error" && terminal === undefined) terminal = "failed";
        }
      }
    } catch (error) {
      throw asLlmError(error);
    }
    if (opened) yield { type: "block-end", index: 0, block: { type: "text", text: output } };
    if (terminal === "failed" || terminal === "timed_out") {
      throw new LlmError(`AgentDock run ${terminal}.`, terminal === "timed_out" ? "TIMEOUT" : "AGENTDOCK_RUN_FAILED");
    }
    if (terminal === "cancelled" || options.signal?.aborted) {
      throw new LlmError("AgentDock run was cancelled.", "ABORTED");
    }
    if (!emittedText) {
      yield { type: "block-start", index: 0, blockType: "text" };
      const fallback = "AgentDock completed without a text response.";
      yield { type: "text-delta", index: 0, text: fallback };
      yield { type: "block-end", index: 0, block: { type: "text", text: fallback } };
    }
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

/** Also accepts the raw Codex shape from an AgentDock server that predates the normalizer fix. */
function responseText(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.text === "string") return payload.text;
  const item = payload.item;
  if (typeof item !== "object" || item === null || Array.isArray(item)) return undefined;
  const candidate = item as Record<string, unknown>;
  return candidate.type === "agent_message" && typeof candidate.text === "string" ? candidate.text : undefined;
}

function latestUserText(options: GenerateOptions): string {
  const message = [...options.messages].reverse().find((item) => item.role === "user");
  if (!message) return "";
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function asLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  if (error instanceof AgentDockGatewayError) {
    return new LlmError(error.message, error.code, error.status === undefined ? undefined : { status: error.status, cause: error });
  }
  return new LlmError(error instanceof Error ? error.message : String(error), "AGENTDOCK_GATEWAY_ERROR", { cause: error });
}
