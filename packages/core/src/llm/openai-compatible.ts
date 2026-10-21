/**
 * Provider for any OpenAI-compatible /chat/completions endpoint with tool
 * calling (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL). No SDK: one fetch.
 */
import { LlmError, type ChatMessage, type CompletionResult, type LlmProvider, type ToolSchema } from "./types";

export interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  temperature?: number;
}

export class OpenAICompatibleProvider implements LlmProvider {
  readonly name: string;

  constructor(private readonly opts: OpenAICompatibleOptions) {
    this.name = `openai-compatible:${opts.model}`;
  }

  async complete(input: { messages: ChatMessage[]; tools: ToolSchema[] }): Promise<CompletionResult> {
    let lastErr: LlmError | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await this.once(input);
      } catch (err) {
        lastErr = err instanceof LlmError ? err : new LlmError((err as Error).message, true);
        if (!lastErr.retryable || attempt === 3) break;
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    throw lastErr ?? new LlmError("LLM call failed", false);
  }

  private async once(input: { messages: ChatMessage[]; tools: ToolSchema[] }): Promise<CompletionResult> {
    const res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.opts.model,
        messages: input.messages,
        tools: input.tools,
        tool_choice: "auto",
        temperature: this.opts.temperature ?? 0.2,
      }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 60_000),
    });
    if (!res.ok) {
      throw new LlmError(`LLM HTTP ${res.status}`, res.status === 429 || res.status >= 500);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: ChatMessage }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const message = data.choices?.[0]?.message;
    if (!message) throw new LlmError("LLM returned no message", true);
    return {
      message: { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls?.length ? message.tool_calls : undefined },
      usage: { promptTokens: data.usage?.prompt_tokens ?? 0, completionTokens: data.usage?.completion_tokens ?? 0 },
    };
  }
}
