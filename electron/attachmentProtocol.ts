/** Serves workspace attachments to the renderer by URL, so previews stream from disk instead of crossing IPC as base64. */
import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import { mimeForFile, resolveAttachmentPath } from './attachments.js';

export const ATTACHMENT_SCHEME = 'grc-attachment';

/** Must run before the app is ready. */
export function registerAttachmentScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ATTACHMENT_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);
}

/** `grc-attachment://file/attachments/AC/a.png` -> `attachments/AC/a.png`, or null when malformed. */
export function relPathFromUrl(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
}

const SAFE_HEADERS = {
  // The file is data for <img> or fetch(); it must never run as a document.
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

export function registerAttachmentProtocol(): void {
  protocol.handle(ATTACHMENT_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    const relPath = relPathFromUrl(request.url);
    const absolute = relPath ? await resolveAttachmentPath(relPath) : null;
    if (!absolute) return new Response(null, { status: 404 });

    // Forward the Range header so large files can be previewed partially.
    const upstream = await net.fetch(pathToFileURL(absolute).toString(), {
      method: request.method,
      headers: request.headers,
    });
    const headers = new Headers(upstream.headers);
    headers.set('Content-Type', mimeForFile(absolute));
    for (const [name, value] of Object.entries(SAFE_HEADERS)) headers.set(name, value);
    return new Response(upstream.body, { status: upstream.status, headers });
  });
}
