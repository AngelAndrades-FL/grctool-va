/**
 * Azure OpenAI connectivity for the main process: client construction with a Microsoft
 * Entra ID user token (MSAL Node, see entraAuth.ts), a connection test, and the AI features.
 *
 * Requests go through Electron's `net.fetch`, which uses the OS proxy settings and the
 * Windows certificate store, so corporate TLS inspection works without disabling
 * certificate verification.
 */
import { net } from 'electron';
import { AzureOpenAI, APIError } from 'openai';
import * as entra from './entraAuth.js';
import type {
  AiConnectionTestResult,
  AiEvaluateRequest,
  AiEvaluation,
  AiOdpSuggestions,
  AiOdpSuggestRequest,
  AiRelatedDraft,
  AiRelatedDraftRequest,
  AiReviseRequest,
  AiRevision,
  AiSettings,
} from '../shared/types.js';
import {
  evaluationFromResponse,
  parseOdpSuggestResponse,
  parseRelatedDraftResponse,
  parseRevisionResponse,
  renderOdpSuggestPrompt,
  renderPrompt,
  renderRelatedDraftPrompt,
  renderRevisePrompt,
} from '../shared/ai.js';

const SYSTEM_MESSAGE =
  'You are a senior federal security control assessor (NIST SP 800-53A). Follow the response format in the user message exactly and reply with valid JSON only.';

function validate(ai: AiSettings): void {
  let url: URL;
  try {
    url = new URL(ai.endpoint.trim());
  } catch {
    throw new Error('The endpoint is not a valid URL, e.g. https://my-resource.openai.azure.us or https://my-gateway.azure-api.us/api');
  }
  if (url.protocol !== 'https:') throw new Error('The endpoint must use https.');
  if (!ai.deployment.trim()) throw new Error('Enter the deployment name.');
  if (!ai.apiVersion.trim()) throw new Error('Enter the API version.');
}

function createClient(ai: AiSettings): AzureOpenAI {
  validate(ai);
  return new AzureOpenAI({
    endpoint: ai.endpoint.trim(),
    deployment: ai.deployment.trim(),
    apiVersion: ai.apiVersion.trim(),
    timeout: Math.max(5, ai.timeoutSeconds) * 1000,
    maxRetries: 1,
    fetch: net.fetch as unknown as typeof fetch,
    azureADTokenProvider: () => entra.getAccessToken(ai),
  });
}

export async function signOut(): Promise<void> {
  await entra.signOutAll();
}

export async function signIn(ai: AiSettings): Promise<string | null> {
  try {
    await entra.signInInteractive(ai);
  } catch (error) {
    rethrow(error, ai);
  }
  return entra.signedInAccount(ai);
}

export function signedInAccount(ai: AiSettings): Promise<string | null> {
  return entra.signedInAccount(ai);
}

async function complete(client: AzureOpenAI, ai: AiSettings, prompt: string, json: boolean): Promise<{ text: string; model: string }> {
  const response = await client.chat.completions.create({
    model: ai.deployment.trim(),
    messages: [
      { role: 'system', content: SYSTEM_MESSAGE },
      { role: 'user', content: prompt },
    ],
    ...(ai.temperature !== null ? { temperature: ai.temperature } : {}),
    ...(ai.maxOutputTokens ? { max_completion_tokens: ai.maxOutputTokens } : {}),
    ...(json && ai.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
  });
  const choice = response.choices[0];
  if (choice?.finish_reason === 'content_filter') {
    throw new Error('The response was blocked by the Azure OpenAI content filter.');
  }
  if (choice?.finish_reason === 'length') {
    throw new Error('The response was cut off. Increase "Max output tokens" in Settings.');
  }
  return { text: choice?.message?.content ?? '', model: response.model };
}

/** Translates SDK/network failures into a message and a next step. */
function describeError(error: unknown, ai: AiSettings): { message: string; hint?: string } {
  if (error instanceof APIError) {
    const status = error.status;
    const hints: Record<number, string> = {
      400: 'The request was rejected. If the message mentions a parameter (temperature, max tokens, response_format), clear it in Settings — some models do not support it.',
      401: 'The Entra token was rejected. If the endpoint is an API Management gateway, it may expect its own token scope (e.g. api://<gateway-app-id>/.default) — ask its owners and set Token scope.',
      403: 'Your account needs the "Cognitive Services OpenAI User" role on the resource (or access granted by the gateway), or network rules are blocking this machine.',
      404: 'The deployment or API version was not found. Use the deployment name (not the model name) and an API version the resource supports.',
      408: 'The request timed out. Increase the timeout or try again.',
      429: 'Rate limit or quota exceeded for this deployment. Wait and retry, or raise the deployment\u2019s tokens-per-minute quota.',
    };
    return {
      message: `Azure OpenAI returned ${status ?? 'an error'}: ${error.message}`,
      hint: (status && hints[status]) || (status && status >= 500 ? 'The service had a problem. Try again shortly.' : undefined),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOTFOUND|getaddrinfo|ERR_NAME_NOT_RESOLVED/i.test(message)) {
    return { message, hint: 'The endpoint host could not be resolved. Check the endpoint spelling and that this machine can reach it (VPN/proxy).' };
  }
  if (/CERT|certificate|self.signed/i.test(message)) {
    return { message, hint: 'A TLS certificate problem occurred. Make sure your organization\u2019s root certificate is installed in the Windows certificate store.' };
  }
  if (/AADSTS|msal|client id|interaction_required|access_denied/i.test(message)) {
    const tenantHint = /AADSTS90002|AADSTS50020|AADSTS700016|tenant/i.test(message)
      ? ' The tenant ID may belong to the other cloud — Azure Government uses different tenants from commercial Azure.'
      : '';
    const registrationHint = /AADSTS700016|AADSTS50011|AADSTS7000218|AADSTS65001/i.test(message)
      ? ' Check the app registration: correct client ID and tenant, a "Mobile and desktop applications" platform with redirect URI http://localhost, "Allow public client flows" enabled, and admin consent for the scope.'
      : '';
    return {
      message,
      hint: `Sign-in did not complete. Check the client ID and tenant ID, and that your account can sign in to it.${registrationHint}${tenantHint}`,
    };
  }
  if (/timed? ?out|ETIMEDOUT|aborted/i.test(message)) {
    return { message, hint: 'The request timed out. Check network access to the endpoint or increase the timeout.' };
  }
  return { message };
}

function rethrow(error: unknown, ai: AiSettings): never {
  const { message, hint } = describeError(error, ai);
  throw new Error(hint ? `${message} \u2014 ${hint}` : message);
}

export async function testConnection(ai: AiSettings): Promise<AiConnectionTestResult> {
  const started = Date.now();
  try {
    const client = createClient(ai);
    const { text, model } = await complete(client, { ...ai, maxOutputTokens: null }, 'Connectivity test. Reply with the single word OK.', false);
    return {
      ok: true,
      latencyMs: Date.now() - started,
      model,
      message: `Connected to deployment "${ai.deployment.trim()}" (model ${model}) in ${Date.now() - started} ms. Reply: "${text.trim().slice(0, 60)}"`,
    };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, ...describeError(error, ai) };
  }
}

export async function evaluateWithAzure(req: AiEvaluateRequest, ai: AiSettings, template: string, promptVersion: number): Promise<AiEvaluation> {
  const renderedPrompt = req.promptOverride ?? renderPrompt(template, req);
  try {
    const client = await createClient(ai);
    const { text } = await complete(client, ai, renderedPrompt, true);
    return evaluationFromResponse(req, renderedPrompt, text, promptVersion);
  } catch (error) {
    rethrow(error, ai);
  }
}

export async function reviseWithAzure(req: AiReviseRequest, ai: AiSettings): Promise<AiRevision> {
  const renderedPrompt = renderRevisePrompt(req);
  try {
    const client = await createClient(ai);
    const { text } = await complete(client, ai, renderedPrompt, true);
    return { ...parseRevisionResponse(text), renderedPrompt };
  } catch (error) {
    rethrow(error, ai);
  }
}

export async function relatedDraftWithAzure(req: AiRelatedDraftRequest, ai: AiSettings): Promise<AiRelatedDraft> {
  const renderedPrompt = renderRelatedDraftPrompt(req);
  try {
    const client = await createClient(ai);
    const { text } = await complete(client, ai, renderedPrompt, true);
    return { ...parseRelatedDraftResponse(text), renderedPrompt };
  } catch (error) {
    rethrow(error, ai);
  }
}

export async function suggestOdpWithAzure(req: AiOdpSuggestRequest, ai: AiSettings): Promise<AiOdpSuggestions> {
  try {
    const client = await createClient(ai);
    const { text } = await complete(client, ai, renderOdpSuggestPrompt(req), true);
    return parseOdpSuggestResponse(text, req);
  } catch (error) {
    rethrow(error, ai);
  }
}
