import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiEmailError } from '../src/errors';
import { HttpClient, backoffDelay, path, retryDelay, type ClientOptions } from '../src/http';
import { VERSION } from '../src/version';
import { BASE, empty, hanging, json, mockFetch } from './helpers';

const http = (fetch: typeof globalThis.fetch, options: ClientOptions = {}) =>
  new HttpClient('ae_test_123', { fetch, maxRetries: 0, ...options });

// Fake only the timers the SDK uses, so fetch/stream internals keep their real scheduling.
const useFakeTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

afterEach(() => {
  vi.useRealTimers();
});

describe('requests', () => {
  it('sends the key, accept and user-agent headers, and builds the URL with a query', async () => {
    const { fetch, requests } = mockFetch(json(200, { ok: true }));
    await http(fetch).request({ method: 'GET', path: '/emails', query: { status: 'sent', to: undefined, tag: 'a b' } });
    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: `${BASE}/emails?status=sent&tag=a+b`,
      headers: { authorization: 'Bearer ae_test_123', accept: 'application/json', 'user-agent': `api-email-node/${VERSION}` },
    });
    expect(requests[0]!.headers['content-type']).toBeUndefined();
    expect(requests[0]!.headers['idempotency-key']).toBeUndefined();
  });

  it('strips trailing slashes from baseUrl', async () => {
    const { fetch, requests } = mockFetch(json(200, {}));
    await http(fetch, { baseUrl: 'http://localhost:8080/v1/' }).request({ method: 'GET', path: '/domains' });
    expect(requests[0]!.url).toBe('http://localhost:8080/v1/domains');
  });

  it('sends JSON bodies with a generated Idempotency-Key on POST', async () => {
    const { fetch, requests } = mockFetch(json(200, {}));
    await http(fetch).request({ method: 'POST', path: '/emails', body: { subject: 'Hi' } });
    expect(requests[0]!.headers['content-type']).toBe('application/json');
    expect(requests[0]!.body).toEqual({ subject: 'Hi' });
    expect(requests[0]!.headers['idempotency-key']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('uses the caller idempotency key, and a fresh key per call otherwise', async () => {
    const { fetch, requests } = mockFetch(json(200, {}), json(200, {}), json(200, {}));
    const client = http(fetch);
    await client.request({ method: 'POST', path: '/emails', body: {}, options: { idempotencyKey: 'receipt-1042' } });
    await client.request({ method: 'POST', path: '/emails', body: {} });
    await client.request({ method: 'POST', path: '/emails', body: {} });
    expect(requests[0]!.headers['idempotency-key']).toBe('receipt-1042');
    expect(requests[1]!.headers['idempotency-key']).not.toBe(requests[2]!.headers['idempotency-key']);
  });

  it('downloads binary bodies as bytes and accepts any content type', async () => {
    const { fetch, requests } = mockFetch(new Response(new Uint8Array([0, 1, 254, 255]), { status: 200 }));
    const bytes = await http(fetch).request<Uint8Array>({ method: 'GET', path: '/inbound/in_1/attachments/0', binary: true });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([0, 1, 254, 255]);
    expect(requests[0]!.headers.accept).toBe('*/*');
  });
});

describe('responses', () => {
  it('parses JSON, and returns undefined for 204 and empty bodies', async () => {
    const { fetch } = mockFetch(json(200, { id: 'em_1' }), empty(204), new Response('', { status: 200 }));
    const client = http(fetch);
    expect(await client.request({ method: 'GET', path: '/emails/em_1' })).toEqual({ id: 'em_1' });
    expect(await client.request({ method: 'DELETE', path: '/domains/d' })).toBeUndefined();
    expect(await client.request({ method: 'DELETE', path: '/routes/r' })).toBeUndefined();
  });

  it('turns an API error body into ApiEmailError with the request id', async () => {
    const { fetch } = mockFetch(
      json(403, { error: { code: 'domain_not_verified', message: 'acme.com is not verified', hint: 'Add the two CNAME records.' } }, { 'x-request-id': 'req_42' }),
    );
    const error = await http(fetch).request({ method: 'POST', path: '/emails', body: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiEmailError);
    expect(error).toMatchObject({
      name: 'ApiEmailError',
      status: 403,
      code: 'domain_not_verified',
      message: 'acme.com is not verified',
      hint: 'Add the two CNAME records.',
      requestId: 'req_42',
    });
  });

  it('reports a non-JSON error page as http_error', async () => {
    const { fetch } = mockFetch(new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    const error = await http(fetch).request({ method: 'GET', path: '/emails' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiEmailError);
    expect(error).toMatchObject({ status: 502, code: 'http_error', message: 'HTTP 502' });
  });

  it('reports a 2xx body that is not JSON as http_error', async () => {
    const { fetch } = mockFetch(new Response('<html>challenge</html>', { status: 200 }));
    await expect(http(fetch).request({ method: 'GET', path: '/emails' })).rejects.toMatchObject({ status: 200, code: 'http_error' });
  });
});

describe('retries', () => {
  it('retries a 5xx with the same Idempotency-Key, then returns the success', async () => {
    useFakeTimers();
    const { fetch, requests } = mockFetch(json(503, { error: { code: 'unavailable', message: 'busy' } }), json(200, { id: 'em_1' }));
    const result = http(fetch, { maxRetries: 2 }).request({ method: 'POST', path: '/emails', body: {} });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toEqual({ id: 'em_1' });
    expect(requests).toHaveLength(2);
    expect(requests[1]!.headers['idempotency-key']).toBe(requests[0]!.headers['idempotency-key']);
  });

  it('waits exactly Retry-After seconds on 429', async () => {
    useFakeTimers();
    const { fetch, requests } = mockFetch(
      json(429, { error: { code: 'rate_limited', message: 'slow down' } }, { 'retry-after': '1' }),
      json(200, {}),
    );
    const result = http(fetch, { maxRetries: 1 }).request({ method: 'GET', path: '/emails' });
    await vi.advanceTimersByTimeAsync(999);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({});
    expect(requests).toHaveLength(2);
  });

  it('gives up at once when Retry-After is longer than 60 seconds', async () => {
    const { fetch, requests } = mockFetch(json(429, { error: { code: 'rate_limited', message: 'later' } }, { 'retry-after': '120' }), json(200, {}));
    await expect(http(fetch, { maxRetries: 2 }).request({ method: 'GET', path: '/emails' })).rejects.toMatchObject({ status: 429 });
    expect(requests).toHaveLength(1);
  });

  it('retries a network error, then succeeds', async () => {
    useFakeTimers();
    const { fetch, requests } = mockFetch(new TypeError('fetch failed'), json(200, { ok: 1 }));
    const result = http(fetch, { maxRetries: 1 }).request({ method: 'GET', path: '/emails' });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toEqual({ ok: 1 });
    expect(requests).toHaveLength(2);
  });

  it('reports a network error as connection_error with the cause', async () => {
    const cause = new TypeError('fetch failed');
    const { fetch } = mockFetch(cause);
    const error = await http(fetch).request({ method: 'GET', path: '/emails' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiEmailError);
    expect(error).toMatchObject({ status: null, code: 'connection_error', cause });
  });

  it('does not retry other 4xx', async () => {
    const { fetch, requests } = mockFetch(json(400, { error: { code: 'invalid_request', message: 'to is required' } }), json(200, {}));
    await expect(http(fetch, { maxRetries: 2 }).request({ method: 'POST', path: '/emails', body: {} })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_request',
    });
    expect(requests).toHaveLength(1);
  });

  it('throws the last error when retries run out', async () => {
    useFakeTimers();
    const { fetch, requests } = mockFetch(
      json(503, { error: { code: 'unavailable', message: 'first' } }),
      json(502, { error: { code: 'bad_gateway', message: 'second' } }),
      json(500, { error: { code: 'internal', message: 'last' } }),
    );
    const result = http(fetch, { maxRetries: 2 }).request({ method: 'GET', path: '/emails' });
    const check = expect(result).rejects.toMatchObject({ status: 500, message: 'last' });
    await vi.advanceTimersByTimeAsync(10_000);
    await check;
    expect(requests).toHaveLength(3);
  });
});

describe('timeouts and aborts', () => {
  it('gives up after the timeout with code timeout', async () => {
    useFakeTimers();
    const { fetch } = mockFetch(hanging);
    const result = http(fetch, { timeout: 5000 }).request({ method: 'GET', path: '/emails' });
    const check = expect(result).rejects.toMatchObject({ status: null, code: 'timeout' });
    await vi.advanceTimersByTimeAsync(5000);
    await check;
  });

  it('applies a per-request timeout', async () => {
    useFakeTimers();
    const { fetch } = mockFetch(hanging);
    const result = http(fetch).request({ method: 'GET', path: '/emails', options: { timeout: 100 } });
    const check = expect(result).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(100);
    await check;
  });

  it('counts a body that stalls after the headers against the timeout', async () => {
    useFakeTimers();
    const { fetch } = mockFetch(
      (init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
            },
          }),
          { status: 200 },
        ),
    );
    const result = http(fetch, { timeout: 2000 }).request({ method: 'GET', path: '/emails' });
    const check = expect(result).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(2000);
    await check;
  });

  it('passes a caller abort through untouched and does not retry', async () => {
    const controller = new AbortController();
    const { fetch, requests } = mockFetch(hanging, json(200, {}));
    const result = http(fetch, { maxRetries: 2 }).request({ method: 'GET', path: '/emails', options: { signal: controller.signal } });
    controller.abort();
    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
    expect(requests).toHaveLength(1);
  });

  it('does not call fetch when the signal is already aborted', async () => {
    const { fetch, requests } = mockFetch(json(200, {}));
    const signal = AbortSignal.abort();
    const error = await http(fetch).request({ method: 'GET', path: '/emails', options: { signal } }).catch((e: unknown) => e);
    expect((error as DOMException).name).toBe('AbortError');
    expect(requests).toHaveLength(0);
  });
});

describe('delays', () => {
  it('backs off exponentially with ±25% jitter, capped at 8 s', () => {
    expect(backoffDelay(0, () => 0)).toBe(375);
    expect(backoffDelay(0, () => 1)).toBe(625);
    expect(backoffDelay(1, () => 0.5)).toBe(1000);
    expect(backoffDelay(2, () => 0.5)).toBe(2000);
    expect(backoffDelay(10, () => 1)).toBe(8000);
  });

  it('reads Retry-After as seconds or an HTTP date, and refuses waits over 60 s', () => {
    const now = Date.UTC(2026, 9, 25, 9, 0, 0);
    expect(retryDelay('1', 0, now)).toBe(1000);
    expect(retryDelay('60', 0, now)).toBe(60_000);
    expect(retryDelay('61', 0, now)).toBeNull();
    expect(retryDelay(new Date(now + 30_000).toUTCString(), 0, now)).toBe(30_000);
    const fallback = retryDelay('soon', 2, now);
    expect(fallback).toBeGreaterThanOrEqual(1500);
    expect(fallback).toBeLessThanOrEqual(2500);
    const none = retryDelay(null, 0, now);
    expect(none).toBeGreaterThanOrEqual(375);
    expect(none).toBeLessThanOrEqual(625);
  });
});

describe('path', () => {
  it('encodes ids and rejects empty ones', () => {
    expect(path`/emails/${'em/1 2'}`).toBe('/emails/em%2F1%202');
    expect(path`/inbound/${'in_1'}/attachments/${0}`).toBe('/inbound/in_1/attachments/0');
    expect(() => path`/emails/${''}`).toThrow(TypeError);
    expect(() => path`/emails/${undefined as unknown as string}`).toThrow(TypeError);
  });
});
