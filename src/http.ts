import { ApiEmailError } from './errors';
import { VERSION } from './version';

export interface ClientOptions {
  /** API base URL. Default `https://api.email/v1`. */
  baseUrl?: string;
  /** Milliseconds per attempt. Default 60 000. */
  timeout?: number;
  /** Retries after the first attempt. Default 2. */
  maxRetries?: number;
  /** A fetch implementation. Default `globalThis.fetch`. */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
}

export interface PostOptions extends RequestOptions {
  /** Reused on every retry. Derive it from your own data, such as `receipt-1042`. */
  idempotencyKey?: string;
}

export interface RequestArgs {
  method: 'GET' | 'POST' | 'DELETE';
  /** Starts with `/`. Build it with `path` so ids are encoded. */
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  options?: PostOptions | undefined;
  /** Return the body as bytes (attachment downloads). */
  binary?: boolean;
}

export const DEFAULT_BASE_URL = 'https://api.email/v1';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRY_AFTER_MS = 60_000;
const MAX_BACKOFF_MS = 8_000;
const MAX_TIMER_MS = 2_147_483_647; // setTimeout fires after 1 ms for anything larger

type Attempt = { ok: true; value: unknown } | { ok: false; error: ApiEmailError; retryAfter: string | null };

export class HttpClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeout: number;
  readonly #maxRetries: number;
  readonly #fetch: (input: string, init: RequestInit) => Promise<Response>;

  constructor(apiKey: string, options: ClientOptions = {}) {
    this.#apiKey = apiKey;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#timeout = checkTimeout(options.timeout, DEFAULT_TIMEOUT_MS);
    this.#maxRetries = checkRetries(options.maxRetries, DEFAULT_MAX_RETRIES);
    const custom = options.fetch;
    // Called detached: some runtimes reject a native fetch invoked with a foreign `this`.
    this.#fetch = custom ? (input, init) => custom(input, init) : (input, init) => globalThis.fetch(input, init);
  }

  async request<T>(args: RequestArgs): Promise<T> {
    const options = args.options ?? {};
    const url = this.#url(args.path, args.query);
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#apiKey}`,
      accept: args.binary ? '*/*' : 'application/json',
      'user-agent': `api-email-node/${VERSION}`,
    };
    let body: string | undefined;
    if (args.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(args.body);
    }
    // One key per call, reused on every retry, so a retried POST never acts twice.
    if (args.method === 'POST') {
      const key = options.idempotencyKey;
      // An empty key would make every such call look like the same email to the server.
      if (key !== undefined && (typeof key !== 'string' || key.trim() === '')) {
        throw new TypeError('api-email: idempotencyKey must be a non-empty string');
      }
      headers['idempotency-key'] = key ?? crypto.randomUUID();
    }
    const init: RequestInit = body === undefined ? { method: args.method, headers } : { method: args.method, headers, body };
    const maxRetries = checkRetries(options.maxRetries, this.#maxRetries);
    const timeout = checkTimeout(options.timeout, this.#timeout);

    for (let attempt = 0; ; attempt++) {
      let result: Attempt;
      try {
        result = await this.#attempt(url, init, timeout, options.signal, args.binary === true);
      } catch (error) {
        if (!isRetryableFailure(error) || attempt >= maxRetries) throw error;
        await sleep(backoffDelay(attempt), options.signal);
        continue;
      }
      if (result.ok) return result.value as T;
      if (attempt >= maxRetries || !isRetryableStatus(result.error.status)) throw result.error;
      const delay = retryDelay(result.retryAfter, attempt);
      if (delay === null) throw result.error;
      await sleep(delay, options.signal);
    }
  }

  #url(path: string, query: RequestArgs['query']): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) params.append(key, value);
    }
    const search = params.toString();
    return `${this.#baseUrl}${path}${search ? `?${search}` : ''}`;
  }

  async #attempt(url: string, init: RequestInit, timeout: number, signal: AbortSignal | undefined, binary: boolean): Promise<Attempt> {
    if (signal?.aborted) throw signal.reason;
    const controller = new AbortController();
    let timedOut = false;
    // Infinity means no timeout; very large values are capped so setTimeout does not fire at once.
    const timer = Number.isFinite(timeout)
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, Math.min(timeout, MAX_TIMER_MS))
      : undefined;
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      // The body is read inside the timeout too, so a response that stalls mid-body times out.
      const response = await this.#fetch(url, { ...init, signal: controller.signal });
      if (response.ok) return { ok: true, value: await readBody(response, binary) };
      return { ok: false, error: await toApiError(response), retryAfter: response.headers.get('retry-after') };
    } catch (error) {
      if (error instanceof ApiEmailError) throw error;
      if (timedOut) {
        throw new ApiEmailError({ status: null, code: 'timeout', message: `api.email did not answer within ${timeout} ms`, cause: error });
      }
      if (signal?.aborted) throw error; // the caller's abort, as is
      throw new ApiEmailError({ status: null, code: 'connection_error', message: `Could not reach api.email: ${messageOf(error)}`, cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

/** Builds a path and URI-encodes every interpolated id: path`/emails/${id}`. */
export function path(strings: TemplateStringsArray, ...values: Array<string | number>): string {
  let out = strings[0] ?? '';
  values.forEach((value, i) => {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
    // '.' and '..' survive encodeURIComponent and URL parsing collapses them: /emails/.. would hit /v1/.
    if (text === undefined || text === '' || text === '.' || text === '..') {
      throw new TypeError(`api-email: expected an id, got ${text === undefined ? String(value) : JSON.stringify(text)}`);
    }
    out += encodeURIComponent(text) + (strings[i + 1] ?? '');
  });
  return out;
}

export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.min(Math.round(base * (0.75 + random() * 0.5)), MAX_BACKOFF_MS);
}

/** Milliseconds to wait before the next attempt, or `null` when the server asks for longer than we wait. */
export function retryDelay(retryAfter: string | null, attempt: number, now: number = Date.now()): number | null {
  const value = retryAfter?.trim();
  if (!value) return backoffDelay(attempt);
  let ms: number;
  if (/^\d+$/.test(value)) {
    ms = Number(value) * 1000;
  } else {
    const at = Date.parse(value);
    if (Number.isNaN(at)) return backoffDelay(attempt);
    ms = Math.max(0, at - now);
  }
  return ms <= MAX_RETRY_AFTER_MS ? ms : null;
}

function checkTimeout(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
    throw new TypeError(`api-email: timeout must be a positive number of milliseconds or Infinity, got ${String(value)}`);
  }
  return value;
}

function checkRetries(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`api-email: maxRetries must be a whole number from 0, got ${String(value)}`);
  }
  return value;
}

function isRetryableFailure(error: unknown): boolean {
  return error instanceof ApiEmailError && (error.code === 'connection_error' || error.code === 'timeout');
}

function isRetryableStatus(status: number | null): boolean {
  return status === 429 || (status !== null && status >= 500 && status <= 599);
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readBody(response: Response, binary: boolean): Promise<unknown> {
  if (binary) return new Uint8Array(await response.arrayBuffer());
  const text = await response.text();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiEmailError({
      status: response.status,
      code: 'http_error',
      message: `HTTP ${response.status}: the response is not JSON`,
      requestId: requestIdOf(response),
    });
  }
}

async function toApiError(response: Response): Promise<ApiEmailError> {
  const requestId = requestIdOf(response);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text());
  } catch {
    parsed = undefined; // an HTML error page or an unreadable body: the status says enough
  }
  const error = isRecord(parsed) ? parsed.error : undefined;
  if (isRecord(error) && typeof error.code === 'string' && typeof error.message === 'string') {
    return new ApiEmailError({
      status: response.status,
      code: error.code,
      message: error.message,
      hint: typeof error.hint === 'string' ? error.hint : undefined,
      requestId,
    });
  }
  return new ApiEmailError({ status: response.status, code: 'http_error', message: `HTTP ${response.status}`, requestId });
}

function requestIdOf(response: Response): string | undefined {
  return response.headers.get('x-request-id') ?? undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
