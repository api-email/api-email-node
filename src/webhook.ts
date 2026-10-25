import { WebhookVerificationError } from './errors';
import type { WebhookEvent } from './types';

export interface VerifyWebhookOptions {
  /** Maximum distance between the signature timestamp and now, in seconds. Default 300. */
  tolerance?: number;
  /** The current Unix time in seconds; for tests. */
  now?: number;
}

const encoder = new TextEncoder();
const SIGNATURE = /^[0-9a-f]{64}$/;

/**
 * Checks the `api-email-signature` header of a webhook or route delivery and returns the parsed event.
 * Pass the raw request body exactly as received: re-serialised JSON no longer matches the signature.
 */
export async function verifyWebhook(
  payload: string | Uint8Array | ArrayBuffer,
  signatureHeader: string | string[] | null | undefined,
  secret: string,
  options: VerifyWebhookOptions = {},
): Promise<WebhookEvent> {
  const body = toBytes(payload);
  if (typeof secret !== 'string' || secret === '') {
    throw new TypeError('api-email: verifyWebhook needs the endpoint or route secret (whsec_…) as its third argument');
  }
  const tolerance = options.tolerance ?? 300;
  const now = options.now ?? Date.now() / 1000;
  // NaN would compare false below and accept any timestamp, so bad values fail closed.
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new TypeError(`api-email: tolerance must be a finite number of seconds from 0, got ${String(options.tolerance)}`);
  }
  if (!Number.isFinite(now)) throw new TypeError(`api-email: now must be a Unix time in seconds, got ${String(options.now)}`);
  const { t, signatures } = parseHeader(signatureHeader);
  if (Math.abs(now - t) > tolerance) {
    throw new WebhookVerificationError('timestamp_out_of_tolerance', `The signature timestamp is more than ${tolerance} seconds away from now`);
  }
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  // One HMAC however many v1 values the header carries (two arrive for 24 hours after a secret rotation).
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, concat(encoder.encode(`${t}.`), body)));
  for (const signature of signatures) {
    if (constantTimeEqual(expected, hexToBytes(signature))) return parseEvent(body);
  }
  throw new WebhookVerificationError('signature_mismatch', 'No signature in the header matches this body and secret');
}

function toBytes(payload: unknown): Uint8Array {
  if (typeof payload === 'string') return encoder.encode(payload);
  if (payload instanceof Uint8Array) return payload;
  if (Object.prototype.toString.call(payload) === '[object ArrayBuffer]') return new Uint8Array(payload as ArrayBuffer);
  throw new TypeError(
    'api-email: verifyWebhook needs the raw request body as a string, Buffer, Uint8Array or ArrayBuffer, not parsed JSON. ' +
      'In Express, use express.raw({ type: "application/json" }) on the webhook route.',
  );
}

function parseHeader(header: string | string[] | null | undefined): { t: number; signatures: string[] } {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  let t: string | undefined;
  const signatures: string[] = [];
  for (const part of String(raw).split(',')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (key === 't' && t === undefined) t = value;
    else if (key === 'v1' && SIGNATURE.test(value)) signatures.push(value);
  }
  if (t === undefined || !/^\d+$/.test(t) || signatures.length === 0) {
    throw new WebhookVerificationError('malformed_header', 'The api-email-signature header is missing or malformed');
  }
  return { t: Number(t), signatures };
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function hexToBytes(hex: string) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function parseEvent(body: Uint8Array): WebhookEvent {
  try {
    return JSON.parse(new TextDecoder().decode(body)) as WebhookEvent;
  } catch {
    throw new WebhookVerificationError('invalid_json', 'The body is signed correctly but is not valid JSON');
  }
}
