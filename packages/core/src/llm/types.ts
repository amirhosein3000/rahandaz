/** OpenAI-compatible chat types (the subset we use). */

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface CompletionResult {
  message: ChatMessage;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface LlmProvider {
  readonly name: string;
  complete(input: { messages: ChatMessage[]; tools: ToolSchema[] }): Promise<CompletionResult>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
