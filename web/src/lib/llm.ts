import 'server-only';
import { ProxyAgent, fetch as ufetch } from 'undici';
import { ChatOpenAI } from '@langchain/openai';
import {
  AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage,
} from '@langchain/core/messages';
import { modelFor, type Task } from './config';
import { parseJson } from './json';

export { parseJson };

// Every model call goes through LangChain (ChatOpenAI pointed at OpenRouter's OpenAI-compatible
// API), through the egress proxy. The container has no other route to the internet.
// The multi-step agents (Tutor + Integrity Guard, Calendar, question and note pipelines) are
// LangGraph graphs built on top of chatModel(); the single-step agents call llm() / llmJson().

const OPENROUTER = 'https://openrouter.ai/api/v1';
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
const proxiedFetch = ((url: unknown, init?: Record<string, unknown>) =>
  ufetch(url as string, { ...(init ?? {}), ...(dispatcher ? { dispatcher } : {}) } as never)) as unknown as typeof fetch;

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

/**
 * The LangChain chat model for one task. Same settings as before the move to LangChain: the
 * model comes from config/models.json, OpenRouter is asked to route only to providers that do not
 * store or train on prompts, 90 s timeout, one retry.
 */
export function chatModel(task: Task, opts: { temperature?: number; maxTokens?: number; json?: boolean } = {}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new LlmError('The AI is not configured yet (OPENROUTER_API_KEY is missing).');
  return new ChatOpenAI({
    model: modelFor(task),
    apiKey: key,
    temperature: opts.temperature ?? 0.2,
    maxTokens: opts.maxTokens ?? 1200,
    timeout: 90_000,
    maxRetries: 1,
    modelKwargs: {
      provider: { data_collection: 'deny' },
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    },
    configuration: { baseURL: OPENROUTER, fetch: proxiedFetch, defaultHeaders: { 'X-Title': 'RooRoom' } },
  });
}

/** Our plain message shape → LangChain messages. */
export function toLangChain(messages: ChatMessage[]): BaseMessage[] {
  return messages.map((m) => {
    if (m.role === 'system') return new SystemMessage(m.content);
    if (m.role === 'user') return new HumanMessage(m.content);
    if (m.role === 'tool') return new ToolMessage({ tool_call_id: m.tool_call_id, content: m.content });
    const a = m as Extract<ChatMessage, { role: 'assistant' }>;
    return new AIMessage({
      content: a.content ?? '',
      tool_calls: (a.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, args: safeArgs(c.function.arguments), type: 'tool_call' as const })),
    });
  });
}

function safeArgs(s: string): Record<string, unknown> {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

/** Text of a LangChain reply (content can be a string or a list of parts). */
export function textOf(m: BaseMessage): string {
  const c = m.content;
  if (typeof c === 'string') return c;
  return c.map((p) => (typeof p === 'string' ? p : 'text' in p ? String(p.text) : '')).join('');
}

/** Tool calls of a LangChain reply, in the OpenAI shape the rest of the app uses. */
export function toolCallsOf(m: AIMessage): ToolCall[] {
  const ok = (m.tool_calls ?? []).map((c, i) => ({
    id: c.id ?? `call_${i}`, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
  }));
  const bad = (m.invalid_tool_calls ?? []).map((c, i) => ({
    id: c.id ?? `bad_${i}`, type: 'function' as const, function: { name: c.name ?? '', arguments: c.args ?? '' },
  }));
  return [...ok, ...bad];
}

export async function invokeModel<T extends { invoke: (m: BaseMessage[]) => Promise<AIMessage> }>(model: T, messages: BaseMessage[]): Promise<AIMessage> {
  try {
    return await model.invoke(messages);
  } catch (e) {
    throw new LlmError(`Model call failed: ${(e as Error).message?.slice(0, 200)}`);
  }
}

export async function llm(opts: {
  task: Task;
  messages: ChatMessage[];
  json?: boolean;
  tools?: ToolDef[];
  maxTokens?: number;
  temperature?: number;
}): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const base = chatModel(opts.task, { temperature: opts.temperature, maxTokens: opts.maxTokens, json: opts.json });
  const model = opts.tools ? base.bindTools(opts.tools) : base;
  const reply = await invokeModel(model as never, toLangChain(opts.messages));
  return { content: textOf(reply), toolCalls: toolCallsOf(reply) };
}

export async function llmJson<T>(task: Task, system: string, user: string, maxTokens = 800, opts: { latex?: boolean } = {}): Promise<T> {
  const r = await llm({
    task, json: true, maxTokens, temperature: 0,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  return parseJson<T>(r.content, opts);
}
