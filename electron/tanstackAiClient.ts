/**
 * OpenAI connectivity through TanStack AI (@tanstack/ai + @tanstack/ai-openai): the Responses API for
 * OpenAI, or Chat Completions against an Azure OpenAI deployment authenticated with an API key.
 *
 * The API key is encrypted with the OS account (safeStorage) under userData/secrets and never
 * leaves the main process. Requests use Electron's `net.fetch` (OS proxy + Windows certificate store).
 */
import { app, net, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chat } from '@tanstack/ai';
import { createOpenaiChat, createOpenaiChatCompletions } from '@tanstack/ai-openai';
import type {
  AiConnectionTestResult,
  AiEvaluateRequest,
  AiEvaluation,
  AiRelatedDraft,
  AiRelatedDraftRequest,
  AiReviseRequest,
  AiRevision,
  AiSettings,
} from '../shared/types.js';
import {
  evaluationFromResponse,
  parseRelatedDraftResponse,
  parseRevisionResponse,
  renderPrompt,
  renderRelatedDraftPrompt,
  renderRevisePrompt,
} from '../shared/ai.js';

const SYSTEM_MESSAGE =
  'You are a senior federal security control assessor (NIST SP 800-53A). Follow the response format in the user message exactly and reply with valid JSON only.';

function keyFile(): string {
  return path.join(app.getPath('userData'), 'secrets', 'openai-api-key.bin');
}

export async function setApiKey(apiKey: string): Promise<void> {
  const key = apiKey.trim();
  if (!key) throw new Error('Enter an API key.');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is unavailable on this machine, so the API key cannot be stored securely.');
  }
  await fs.mkdir(path.dirname(keyFile()), { recursive: true });
  await fs.writeFile(keyFile(), safeStorage.encryptString(key));
}

export async function clearApiKey(): Promise<void> {
  await fs.rm(keyFile(), { force: true });
}

async function readApiKey(): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(await fs.readFile(keyFile()));
  } catch {
    return null;
  }
}

export async function hasApiKey(): Promise<boolean> {
  return (await readApiKey()) !== null;
}

function httpsUrl(value: string, example: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`The URL is not valid, e.g. ${example}`);
  }
  if (url.protocol !== 'https:') throw new Error('The URL must use https.');
  return value;
}

async function requireApiKey(): Promise<string> {
  const apiKey = await readApiKey();
  if (!apiKey) throw new Error('No API key is stored. Enter your API key and select Save key.');
  return apiKey;
}

function clientOptions(ai: AiSettings) {
  return {
    timeout: Math.max(5, ai.timeoutSeconds) * 1000,
    maxRetries: 1,
    fetch: net.fetch as unknown as typeof fetch,
  };
}

async function createOpenaiAdapter(ai: AiSettings) {
  const model = ai.openaiModel.trim();
  if (!model) throw new Error('Enter the model, e.g. gpt-5.2.');
  const baseURL = ai.openaiBaseUrl.trim();
  if (baseURL) httpsUrl(baseURL, 'https://api.openai.com/v1');
  const apiKey = await requireApiKey();

  return createOpenaiChat(model as Parameters<typeof createOpenaiChat>[0], apiKey, {
    ...(baseURL ? { baseURL } : {}),
    ...(ai.openaiOrganization.trim() ? { organization: ai.openaiOrganization.trim() } : {}),
    ...clientOptions(ai),
  });
}

/** Azure streams content-filter chunks whose choices have no `delta`; TanStack's adapter assumes one is always present. */
const azureFetch: typeof fetch = async (input, init) => {
  const response = await net.fetch(input as string, init as RequestInit);
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  const fixLine = (line: string): string => {
    if (!line.startsWith('data:')) return line;
    const payload = line.slice(5).trim();
    if (!payload.startsWith('{')) return line;
    try {
      const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: unknown }> };
      if (!chunk.choices?.some((c) => !c.delta)) return line;
      chunk.choices = chunk.choices.map((c) => ({ ...c, delta: c.delta ?? {} }));
      return `data: ${JSON.stringify(chunk)}`;
    } catch {
      return line;
    }
  };
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(bytes, controller) {
        buffer += decoder.decode(bytes, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        if (lines.length) controller.enqueue(encoder.encode(lines.map(fixLine).join('\n') + '\n'));
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer) controller.enqueue(encoder.encode(fixLine(buffer)));
      },
    }),
  );
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
};

/** Azure routes by deployment in the path, versions by query string and authenticates with an `api-key` header. */
async function createAzureAdapter(ai: AiSettings) {
  const endpoint = httpsUrl(ai.endpoint.trim(), 'https://my-resource.openai.azure.us')
    .replace(/\/+$/, '')
    .replace(/\/openai$/i, '');
  const deployment = ai.deployment.trim();
  if (!deployment) throw new Error('Enter the deployment name.');
  if (!ai.apiVersion.trim()) throw new Error('Enter the API version.');
  const apiKey = await requireApiKey();

  return createOpenaiChatCompletions(deployment as Parameters<typeof createOpenaiChatCompletions>[0], apiKey, {
    baseURL: `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}`,
    defaultQuery: { 'api-version': ai.apiVersion.trim() },
    defaultHeaders: { 'api-key': apiKey, Authorization: null },
    ...clientOptions(ai),
    fetch: azureFetch,
  });
}

async function complete(ai: AiSettings, prompt: string, json: boolean): Promise<string> {
  const messages = [{ role: 'user' as const, content: prompt }];
  if (ai.openaiService === 'azure') {
    const adapter = await createAzureAdapter(ai);
    // Chat Completions takes its parameters verbatim; the adapter's types describe the Responses API.
    const modelOptions = {
      ...(ai.temperature !== null ? { temperature: ai.temperature } : {}),
      ...(ai.maxOutputTokens ? { max_tokens: ai.maxOutputTokens } : {}),
      ...(json && ai.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    } as never;
    return chat({ adapter, systemPrompts: [SYSTEM_MESSAGE], messages, stream: false, modelOptions });
  }

  const adapter = await createOpenaiAdapter(ai);
  return chat({
    adapter,
    systemPrompts: [SYSTEM_MESSAGE],
    messages,
    stream: false,
    modelOptions: {
      // Control text and narratives must not be retained for later retrieval.
      store: false,
      ...(ai.temperature !== null ? { temperature: ai.temperature } : {}),
      ...(ai.maxOutputTokens ? { max_output_tokens: ai.maxOutputTokens } : {}),
      ...(json && ai.jsonMode ? { text: { format: { type: 'json_object' as const } } } : {}),
    },
  });
}

/** Translates TanStack AI / OpenAI failures into a message and a next step. */
function describeError(error: unknown): { message: string; hint?: string } {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  const status = Number(typeof code === 'string' && /^\d{3}$/.test(code) ? code : /^(\d{3})\b/.exec(message)?.[1]);
  const hints: Record<number, string> = {
    400: 'The request was rejected. If the message mentions a parameter (temperature, max tokens, text.format), the model may not support it.',
    401: 'The API key was rejected. Check that it is valid and not revoked, then save it again.',
    403: 'The key or organization does not have access to this model, or the request came from an unsupported region.',
    404: 'Not found. For Azure, select the Azure OpenAI service, use the deployment name (not the model name) and an API version the resource supports, and enter the resource or gateway base URL without /openai/deployments/... For OpenAI, check the model ID.',
    408: 'The request timed out. Try again.',
    429: 'Rate limit or quota exceeded. Wait and retry, or check the billing and usage limits for your OpenAI organization.',
  };
  if (status && hints[status]) return { message: `OpenAI returned ${message}`, hint: hints[status] };
  if (status >= 500) return { message: `OpenAI returned ${message}`, hint: 'The service had a problem. Try again shortly.' };
  if (code === 'invalid_api_key') return { message, hint: hints[401] };
  if (/ENOTFOUND|getaddrinfo|ERR_NAME_NOT_RESOLVED/i.test(message)) {
    return { message, hint: 'The host could not be resolved. Check the base URL and that this machine can reach it (VPN/proxy).' };
  }
  if (/CERT|certificate|self.signed/i.test(message)) {
    return { message, hint: 'A TLS certificate problem occurred. Make sure your organization\u2019s root certificate is installed in the Windows certificate store.' };
  }
  if (/timed? ?out|ETIMEDOUT|aborted/i.test(message)) {
    return { message, hint: 'The request timed out. Check network access to OpenAI or increase the timeout.' };
  }
  return { message };
}

function rethrow(error: unknown): never {
  const { message, hint } = describeError(error);
  throw new Error(hint ? `${message} \u2014 ${hint}` : message);
}

export async function testConnection(ai: AiSettings): Promise<AiConnectionTestResult> {
  const started = Date.now();
  try {
    const text = await complete({ ...ai, maxOutputTokens: null }, 'Connectivity test. Reply with the single word OK.', false);
    const model = ai.openaiService === 'azure' ? ai.deployment.trim() : ai.openaiModel.trim();
    return {
      ok: true,
      latencyMs: Date.now() - started,
      model,
      message: `Connected to ${ai.openaiService === 'azure' ? 'Azure OpenAI deployment' : 'OpenAI model'} "${model}" in ${Date.now() - started} ms. Reply: "${text.trim().slice(0, 60)}"`,
    };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, ...describeError(error) };
  }
}

export async function evaluateWithOpenai(req: AiEvaluateRequest, ai: AiSettings, template: string, promptVersion: number): Promise<AiEvaluation> {
  const renderedPrompt = req.promptOverride ?? renderPrompt(template, req);
  try {
    const text = await complete(ai, renderedPrompt, true);
    return evaluationFromResponse(req, renderedPrompt, text, promptVersion);
  } catch (error) {
    rethrow(error);
  }
}

export async function reviseWithOpenai(req: AiReviseRequest, ai: AiSettings): Promise<AiRevision> {
  const renderedPrompt = renderRevisePrompt(req);
  try {
    const text = await complete(ai, renderedPrompt, true);
    return { ...parseRevisionResponse(text), renderedPrompt };
  } catch (error) {
    rethrow(error);
  }
}

export async function relatedDraftWithOpenai(req: AiRelatedDraftRequest, ai: AiSettings): Promise<AiRelatedDraft> {
  const renderedPrompt = renderRelatedDraftPrompt(req);
  try {
    const text = await complete(ai, renderedPrompt, true);
    return { ...parseRelatedDraftResponse(text), renderedPrompt };
  } catch (error) {
    rethrow(error);
  }
}
