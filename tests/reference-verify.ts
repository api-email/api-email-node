// The verify() example from https://api.email/docs/webhooks, used as an independent oracle.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(rawBody: string | Buffer, header: string | undefined, secret: string, toleranceSeconds = 300): boolean {
  const parts = String(header ?? '').split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k, v]) => k === 'v1' && /^[0-9a-f]{64}$/.test(v ?? '')).map(([, v]) => v as string);
  if (!/^\d+$/.test(t ?? '') || sigs.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  return sigs.some((s) => timingSafeEqual(Buffer.from(s, 'hex'), expected));
}
