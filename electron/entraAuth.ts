/**
 * Microsoft Entra ID sign-in for the main process using MSAL Node (public client,
 * authorization code + PKCE). The system browser handles the sign-in so an existing
 * SSO session can satisfy it; MSAL's loopback listener on http://localhost captures
 * the redirect. Tokens are cached encrypted with the OS account (safeStorage) so the
 * user is not asked to sign in on every launch.
 *
 * App registration: "Mobile and desktop applications" platform with redirect URI
 * http://localhost, public client flows allowed, no secret.
 */
import { app, net, safeStorage, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  InteractionRequiredAuthError,
  LogLevel,
  PublicClientApplication,
  type AccountInfo,
  type ICachePlugin,
  type INetworkModule,
  type NetworkRequestOptions,
  type NetworkResponse,
  type TokenCacheContext,
} from '@azure/msal-node';
import type { AiSettings } from '../shared/types.js';

const SUCCESS_PAGE =
  '<html><body style="font-family:sans-serif;padding:2rem"><h2>Signed in</h2><p>You can close this tab and return to the GRC Evidence Workspace.</p></body></html>';
const ERROR_PAGE =
  '<html><body style="font-family:sans-serif;padding:2rem"><h2>Sign-in failed</h2><p>Return to the GRC Evidence Workspace for details.</p></body></html>';

function cacheFile(): string {
  return path.join(app.getPath('userData'), 'secrets', 'msal-cache.bin');
}

/** Persists MSAL's token cache encrypted; without OS encryption the cache stays in memory only. */
const cachePlugin: ICachePlugin = {
  async beforeCacheAccess(context: TokenCacheContext) {
    if (!safeStorage.isEncryptionAvailable()) return;
    try {
      context.tokenCache.deserialize(safeStorage.decryptString(await fs.readFile(cacheFile())));
    } catch {
      /* no cache yet, or it was written by another OS account */
    }
  },
  async afterCacheAccess(context: TokenCacheContext) {
    if (!context.cacheHasChanged || !safeStorage.isEncryptionAvailable()) return;
    await fs.mkdir(path.dirname(cacheFile()), { recursive: true });
    await fs.writeFile(cacheFile(), safeStorage.encryptString(context.tokenCache.serialize()));
  },
};

/** Sends MSAL's token requests through Electron's network stack (OS proxy + Windows certificate store). */
const electronNetwork: INetworkModule = {
  async sendGetRequestAsync<T>(url: string, options?: NetworkRequestOptions, timeout?: number): Promise<NetworkResponse<T>> {
    return send<T>(url, 'GET', options, timeout);
  },
  async sendPostRequestAsync<T>(url: string, options?: NetworkRequestOptions): Promise<NetworkResponse<T>> {
    return send<T>(url, 'POST', options);
  },
};

async function send<T>(url: string, method: 'GET' | 'POST', options?: NetworkRequestOptions, timeout?: number): Promise<NetworkResponse<T>> {
  const response = await net.fetch(url, {
    method,
    headers: options?.headers,
    body: method === 'POST' ? options?.body : undefined,
    signal: timeout ? AbortSignal.timeout(timeout) : undefined,
  });
  const text = await response.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: 'invalid_response', error_description: text.slice(0, 500) };
  }
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body: body as T };
}

interface EntraTarget {
  clientId: string;
  authority: string;
  scope: string;
}

export function entraTarget(ai: AiSettings): EntraTarget {
  const government = ai.cloud === 'government';
  const host = government ? 'https://login.microsoftonline.us' : 'https://login.microsoftonline.com';
  return {
    clientId: ai.clientId.trim(),
    authority: `${host}/${ai.tenantId.trim() || 'organizations'}`,
    scope:
      ai.tokenScope.trim() ||
      (government ? 'https://cognitiveservices.azure.us/.default' : 'https://cognitiveservices.azure.com/.default'),
  };
}

const clients = new Map<string, PublicClientApplication>();

function clientFor(target: EntraTarget): PublicClientApplication {
  if (!target.clientId) {
    throw new Error('Enter the application (client) ID of the Entra app registration used for sign-in.');
  }
  const key = `${target.clientId}|${target.authority}`;
  let pca = clients.get(key);
  if (!pca) {
    pca = new PublicClientApplication({
      auth: { clientId: target.clientId, authority: target.authority },
      cache: { cachePlugin },
      system: {
        networkClient: electronNetwork,
        loggerOptions: {
          logLevel: LogLevel.Warning,
          piiLoggingEnabled: false,
          loggerCallback: (_level, message) => console.warn('[msal]', message),
        },
      },
    });
    clients.set(key, pca);
  }
  return pca;
}

async function cachedAccount(pca: PublicClientApplication): Promise<AccountInfo | null> {
  const accounts = await pca.getTokenCache().getAllAccounts();
  return accounts[0] ?? null;
}

let interactive: Promise<string> | null = null;

/** Browser sign-in; concurrent callers share one sign-in window. */
export function signInInteractive(ai: AiSettings): Promise<string> {
  if (interactive) return interactive;
  const target = entraTarget(ai);
  const pca = clientFor(target);
  interactive = pca
    .acquireTokenInteractive({
      scopes: [target.scope],
      openBrowser: async (url) => {
        await shell.openExternal(url);
      },
      successTemplate: SUCCESS_PAGE,
      errorTemplate: ERROR_PAGE,
      prompt: 'select_account',
    })
    .then((result) => {
      if (!result?.accessToken) throw new Error('Sign-in completed without an access token.');
      return result.accessToken;
    })
    .finally(() => {
      interactive = null;
    });
  return interactive;
}

/** Silent token from the cache or refresh token, falling back to browser sign-in when interaction is required. */
export async function getAccessToken(ai: AiSettings): Promise<string> {
  const target = entraTarget(ai);
  const pca = clientFor(target);
  const account = await cachedAccount(pca);
  if (account) {
    try {
      const result = await pca.acquireTokenSilent({ account, scopes: [target.scope] });
      if (result?.accessToken) return result.accessToken;
    } catch (error) {
      if (!(error instanceof InteractionRequiredAuthError)) throw error;
    }
  }
  return signInInteractive(ai);
}

export async function signedInAccount(ai: AiSettings): Promise<string | null> {
  try {
    const account = await cachedAccount(clientFor(entraTarget(ai)));
    return account ? account.username || account.name || account.homeAccountId : null;
  } catch {
    return null;
  }
}

export async function signOutAll(): Promise<void> {
  for (const pca of clients.values()) {
    const cache = pca.getTokenCache();
    for (const account of await cache.getAllAccounts()) await cache.removeAccount(account);
  }
  clients.clear();
  await fs.rm(cacheFile(), { force: true });
}
