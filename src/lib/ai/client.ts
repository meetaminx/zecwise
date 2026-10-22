import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/lib/config";

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("The AI model is not configured. Set ANTHROPIC_API_KEY on the server to enable answers.");
    this.name = "LlmNotConfiguredError";
  }
}

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!config.llm.apiKey) throw new LlmNotConfiguredError();
  if (!client) client = new Anthropic({ apiKey: config.llm.apiKey, timeout: config.llm.timeoutMs, maxRetries: 2 });
  return client;
}
