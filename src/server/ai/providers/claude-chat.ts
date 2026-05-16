import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatBlock,
  ChatMessage,
  ChatProvider,
  ChatStreamArgs,
  ChatStreamEvent,
  ToolDescriptor,
} from "../chat-types";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_OUTPUT_TOKENS = 4096;

interface AnthropicToolInput {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [k: string]: unknown;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: AnthropicToolInput;
}

function toAnthropicTools(tools: ToolDescriptor[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: (t.inputSchema as unknown as AnthropicToolInput) ?? {
      type: "object",
      properties: {},
    },
  }));
}

function blocksToAnthropicContent(blocks: ChatBlock[]): unknown[] {
  const content: unknown[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      const text = block.text.trim();
      if (text.length === 0) continue;
      content.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      content.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input ?? {},
      });
    } else if (block.type === "tool_result") {
      content.push({
        type: "tool_result",
        tool_use_id: block.toolUseId,
        is_error: block.isError === true,
        content:
          typeof block.output === "string"
            ? block.output
            : JSON.stringify(block.output),
      });
    }
  }
  return content;
}

function toAnthropicMessages(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const msg of messages) {
    if (msg.role === "system") continue; // system prompt is passed separately
    if (msg.role === "tool") {
      // tool messages are folded into a user turn with tool_result blocks
      out.push({ role: "user", content: blocksToAnthropicContent(msg.blocks) });
      continue;
    }
    const role: "user" | "assistant" =
      msg.role === "assistant" ? "assistant" : "user";
    const content = blocksToAnthropicContent(msg.blocks);
    if (content.length === 0) continue;
    out.push({ role, content });
  }
  return out;
}

interface ToolUseAccumulator {
  id: string;
  name: string;
  buffer: string;
}

export class ClaudeChatProvider implements ChatProvider {
  readonly id = "claude" as const;
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async *stream(args: ChatStreamArgs): AsyncIterable<ChatStreamEvent> {
    const tools = toAnthropicTools(args.tools);
    const messages = toAnthropicMessages(args.messages);

    let stream;
    try {
      stream = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: args.system,
          tools: tools as unknown as Anthropic.Tool[],
          messages: messages as unknown as Anthropic.MessageParam[],
          stream: true,
        },
        { signal: args.signal }
      );
    } catch (err) {
      yield {
        type: "error",
        message: err instanceof Error ? err.message : "Claude request failed",
      };
      return;
    }

    const toolBlocks = new Map<number, ToolUseAccumulator>();
    type StopReason = Extract<
      ChatStreamEvent,
      { type: "message_stop" }
    >["stopReason"];
    let stopReason: StopReason = "end_turn";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    try {
      for await (const event of stream) {
        if (event.type === "message_start") {
          const usage = event.message.usage;
          if (usage) {
            inputTokens = usage.input_tokens ?? undefined;
            outputTokens = usage.output_tokens ?? undefined;
          }
        } else if (event.type === "content_block_start") {
          const block = event.content_block;
          if (block.type === "tool_use") {
            toolBlocks.set(event.index, {
              id: block.id,
              name: block.name,
              buffer: "",
            });
          }
        } else if (event.type === "content_block_delta") {
          const delta = event.delta;
          if (delta.type === "text_delta") {
            yield { type: "text_delta", text: delta.text };
          } else if (delta.type === "input_json_delta") {
            const acc = toolBlocks.get(event.index);
            if (acc) acc.buffer += delta.partial_json;
          }
        } else if (event.type === "content_block_stop") {
          const acc = toolBlocks.get(event.index);
          if (acc) {
            let input: unknown = {};
            if (acc.buffer.trim().length > 0) {
              try {
                input = JSON.parse(acc.buffer);
              } catch {
                input = { _raw: acc.buffer };
              }
            }
            yield {
              type: "tool_use",
              id: acc.id,
              name: acc.name,
              input,
            };
            toolBlocks.delete(event.index);
          }
        } else if (event.type === "message_delta") {
          if (event.delta.stop_reason) {
            stopReason = mapStopReason(event.delta.stop_reason);
          }
          if (event.usage) {
            outputTokens = event.usage.output_tokens ?? outputTokens;
          }
        }
      }
    } catch (err) {
      yield {
        type: "error",
        message: err instanceof Error ? err.message : "Claude stream failed",
      };
      return;
    }

    yield {
      type: "message_stop",
      stopReason,
      usage: {
        inputTokens,
        outputTokens,
      },
    };
  }
}

function mapStopReason(
  reason: string
): "end_turn" | "tool_use" | "max_tokens" | "stop" | "other" {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "end_turn") return "end_turn";
  if (reason === "stop_sequence") return "stop";
  return "other";
}
