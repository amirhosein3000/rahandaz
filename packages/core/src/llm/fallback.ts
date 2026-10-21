/**
 * Tries each model in order; a provider outage (after its own retries) falls
 * through to the next one, so one provider being down does not stop a run.
 */
import { LlmError, type ChatMessage, type CompletionResult, type LlmProvider, type ToolSchema } from "./types";

export class FallbackProvider implements LlmProvider {
  constructor(private readonly providers: LlmProvider[]) {
    if (!providers.length) throw new Error("FallbackProvider needs at least one provider");
  }

  get name(): string {
    return this.providers.map((p) => p.name).join(" → ");
  }

  async complete(input: { messages: ChatMessage[]; tools: ToolSchema[] }): Promise<CompletionResult> {
    let last: unknown;
    for (const p of this.providers) {
      try {
        return await p.complete(input);
      } catch (err) {
        last = err;
        console.warn(`[llm] ${p.name} failed (${(err as Error).message}); trying the next provider`);
      }
    }
    throw last instanceof LlmError ? last : new LlmError((last as Error)?.message ?? "all LLM providers failed", false);
  }
}
