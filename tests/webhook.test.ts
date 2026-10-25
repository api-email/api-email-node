import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookVerificationError } from '../src/errors';
import { verifyWebhook } from '../src/webhook';
import { verify as referenceVerify } from './reference-verify';

const secret = 'whsec_test_secret';
const NOW = 1_761_383_643;
const event = {
  type: 'email.bounced',
  id: 'evt_9a7c2e',
  email_id: 'em_8f2c1a',
  to: 'ann@example.com',
  at: '2026-10-25T09:12:04Z',
  tags: ['password-reset'],
  reason: '550 5.1.1 mailbox does not exist',
};
const body = JSON.stringify(event);
const sign = (payload: string, t = NOW, key = secret) => createHmac('sha256', key).update(`${t}.`).update(payload).digest('hex');
const header = (sig = sign(body), t = NOW) => `t=${t},v1=${sig}`;

async function reason(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WebhookVerificationError);
  return (error as WebhookVerificationError).reason;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('verifyWebhook', () => {
  it('returns the parsed event for a valid signature', async () => {
    expect(await verifyWebhook(body, header(), secret, { now: NOW })).toEqual(event);
  });

  it('accepts the raw body as a Buffer, Uint8Array or ArrayBuffer', async () => {
    const buf = Buffer.from(body);
    for (const payload of [buf, new Uint8Array(buf), new Uint8Array(buf).buffer]) {
      expect(await verifyWebhook(payload, header(), secret, { now: NOW })).toEqual(event);
    }
  });

  it('accepts either signature after a secret rotation', async () => {
    const rotated = `t=${NOW},v1=${sign(body, NOW, 'whsec_new')},v1=${sign(body, NOW, secret)}`;
    expect(await verifyWebhook(body, rotated, secret, { now: NOW })).toEqual(event);
    expect(await verifyWebhook(body, rotated, 'whsec_new', { now: NOW })).toEqual(event);
  });

  it('tolerates spaces and a header split into an array', async () => {
    expect(await verifyWebhook(body, `t=${NOW}, v1=${sign(body)}`, secret, { now: NOW })).toEqual(event);
    expect(await verifyWebhook(body, [`t=${NOW}`, `v1=${sign(body)}`], secret, { now: NOW })).toEqual(event);
  });

  it('rejects timestamps outside the tolerance, in both directions', async () => {
    expect(await reason(verifyWebhook(body, header(), secret, { now: NOW + 301 }))).toBe('timestamp_out_of_tolerance');
    expect(await reason(verifyWebhook(body, header(), secret, { now: NOW - 301 }))).toBe('timestamp_out_of_tolerance');
    expect(await verifyWebhook(body, header(), secret, { now: NOW + 300 })).toEqual(event);
    expect(await verifyWebhook(body, header(), secret, { now: NOW + 600, tolerance: 600 })).toEqual(event);
  });

  it('uses the current time by default', async () => {
    const t = Math.floor(Date.now() / 1000);
    expect(await verifyWebhook(body, header(sign(body, t), t), secret)).toEqual(event);
    expect(await reason(verifyWebhook(body, header(sign(body, t - 1000), t - 1000), secret))).toBe('timestamp_out_of_tolerance');
  });

  it('rejects a tampered body, a wrong secret and a re-serialised body', async () => {
    expect(await reason(verifyWebhook(body.replace('ann', 'eve'), header(), secret, { now: NOW }))).toBe('signature_mismatch');
    expect(await reason(verifyWebhook(body, header(), 'whsec_other', { now: NOW }))).toBe('signature_mismatch');
    expect(await reason(verifyWebhook(JSON.stringify(event, null, 2), header(), secret, { now: NOW }))).toBe('signature_mismatch');
  });

  it('rejects missing and malformed headers', async () => {
    const sig = sign(body);
    const headers = [undefined, null, '', `t=abc,v1=${sig}`, `t=${NOW}`, `v1=${sig}`, `t=${NOW},v1=${sig.toUpperCase()}`, `t=${NOW},v1=deadbeef`, `t=${NOW},v0=${sig}`];
    for (const h of headers) {
      expect(await reason(verifyWebhook(body, h, secret, { now: NOW })), String(h)).toBe('malformed_header');
    }
  });

  it('reports a correctly signed body that is not JSON as invalid_json', async () => {
    const text = 'not json';
    expect(await reason(verifyWebhook(text, header(sign(text)), secret, { now: NOW }))).toBe('invalid_json');
  });

  it('throws a TypeError with a hint when given a parsed body', async () => {
    await expect(verifyWebhook(event as unknown as string, header(), secret, { now: NOW })).rejects.toThrow(/raw request body/);
  });

  it('throws a TypeError naming the secret when it is missing', async () => {
    await expect(verifyWebhook(body, header(), undefined as unknown as string, { now: NOW })).rejects.toThrow(/secret/);
    await expect(verifyWebhook(body, header(), '', { now: NOW })).rejects.toThrow(TypeError);
  });

  it('computes the HMAC once however many v1 values the header carries', async () => {
    const signSpy = vi.spyOn(crypto.subtle, 'sign');
    const verifySpy = vi.spyOn(crypto.subtle, 'verify');
    const fakes = Array.from({ length: 50 }, (_, i) => `v1=${i.toString(16).padStart(64, '0')}`).join(',');
    try {
      expect(await verifyWebhook(body, `t=${NOW},${fakes},v1=${sign(body)}`, secret, { now: NOW })).toEqual(event);
      expect(signSpy.mock.calls.length + verifySpy.mock.calls.length).toBe(1);
    } finally {
      signSpy.mockRestore();
      verifySpy.mockRestore();
    }
  });

  it('rejects a tolerance or now that is not a finite number, instead of failing open', async () => {
    const ancient = header(sign(body, 1), 1);
    for (const options of [{ tolerance: Number.NaN }, { tolerance: -1 }, { tolerance: Infinity }, { now: Number.NaN }]) {
      await expect(verifyWebhook(body, ancient, secret, options), String(Object.values(options)[0])).rejects.toThrow(TypeError);
    }
  });

  it('agrees with the reference verify() from the docs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
    const cases: Array<[string, string]> = [
      [body, header()],
      [body, header(sign(body, NOW - 400), NOW - 400)],
      [`${body} `, header()],
      [body, `t=${NOW},v1=${sign(body, NOW, 'whsec_other')},v1=${sign(body)}`],
      [body, `t=${NOW},v1=${sign(body, NOW, 'whsec_other')}`],
      [body, 'garbage'],
      [body, `t=${NOW}, v1=${sign(body)}`],
    ];
    for (const [payload, h] of cases) {
      const ours = await verifyWebhook(payload, h, secret).then(
        () => true,
        () => false,
      );
      expect(ours, h).toBe(referenceVerify(payload, h, secret));
    }
  });
});
