import { ApiEmail } from '../src/client';
import type { ClientOptions } from '../src/http';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Reply = Response | Error | ((init: RequestInit) => Response | Promise<Response>);

export const BASE = 'https://api.email/v1';

/** A fetch that records each request and answers with the next reply, in order. */
export function mockFetch(...replies: Reply[]): { fetch: typeof globalThis.fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    requests.push({
      url: String(input),
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const reply = replies.shift();
    if (reply === undefined) throw new Error(`mockFetch: no reply left for ${init.method ?? 'GET'} ${String(input)}`);
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply(init) : reply;
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export const empty = (status = 204): Response => new Response(null, { status });

/** Never answers; rejects like a real fetch once the request is aborted. */
export const hanging = (init: RequestInit): Promise<Response> =>
  new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

export const client = (fetch: typeof globalThis.fetch, options: ClientOptions = {}): ApiEmail =>
  new ApiEmail('ae_test_123', { fetch, maxRetries: 0, ...options });
