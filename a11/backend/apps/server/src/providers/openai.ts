import OpenAI from "openai";
const { buildLongTermMemorySnippet } = require("../../lib/a11-longterm.cjs");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.A11_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
});

const DEFAULT_MODEL = process.env.A11_OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";

export interface OpenAIChatOptions {
  model?: string;
  systemPrompt?: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
}

export async function askOpenAI(opts: OpenAIChatOptions): Promise<string> {
  const model = opts.model || DEFAULT_MODEL;

  const response = await client.chat.completions.create({
    model,
    messages: opts.messages,
    stream: false,
  });

  const msg = response.choices[0]?.message?.content || "";
  return msg;
}

export async function streamOpenAI(
  opts: OpenAIChatOptions,
  onChunk: (delta: string) => void
): Promise<void> {
  const model = opts.model || DEFAULT_MODEL;

  const stream = await client.chat.completions.create({
    model,
    messages: opts.messages,
    stream: true,
  });

  for await (const part of stream) {
    const delta = part.choices[0]?.delta?.content || "";
    if (delta) {
      onChunk(delta);
    }
  }
}
