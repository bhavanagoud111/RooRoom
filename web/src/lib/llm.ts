import 'server-only';
import { ProxyAgent, fetch as ufetch } from 'undici';
import { modelFor, type Task } from './config';
import { parseJson } from './json';

export { parseJson };

// Every model call goes through here, to OpenRouter, through the egress proxy.
// The container has no other route to the internet.

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type ToolDef = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export class LlmError extends Error {}

export async function llm(opts: {
  task: Task;
  messages: ChatMessage[];
  json?: boolean;
  tools?: ToolDef[];
  maxTokens?: number;
  temperature?: number;
}): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new LlmError('The AI is not configured yet (OPENROUTER_API_KEY is missing).');
  const body: Record<string, unknown> = {
    model: modelFor(opts.task),
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 1200,
    // Ask OpenRouter to route only to providers that do not store or train on prompts.
    provider: { data_collection: 'deny' },
  };
  if (opts.json) body.response_format = { type: 'json_object' };
  if (opts.tools) body.tools = opts.tools;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await ufetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        dispatcher,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-Title': 'RooRoom',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new LlmError(`Model call failed (${res.status}): ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[];
      };
      const msg = data.choices?.[0]?.message;
      return { content: msg?.content ?? '', toolCalls: msg?.tool_calls ?? [] };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new LlmError('Model call failed');
}

export async function llmJson<T>(task: Task, system: string, user: string, maxTokens = 800, opts: { latex?: boolean } = {}): Promise<T> {
  const r = await llm({
    task, json: true, maxTokens, temperature: 0,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  return parseJson<T>(r.content, opts);
}
