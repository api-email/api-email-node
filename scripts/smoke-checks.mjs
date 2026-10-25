// Runs against the built package in every runtime CI covers: Node (ESM and CJS), Bun and Deno.
export async function run(sdk, label) {
  const { ApiEmail, ApiEmailError, WebhookVerificationError, verifyWebhook, VERSION } = sdk;
  const check = (ok, what) => {
    if (!ok) throw new Error(`smoke ${label}: ${what}`);
  };

  const requests = [];
  const apiEmail = new ApiEmail('ae_test_smoke', {
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: 'em_smoke', status: 'queued' }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const sent = await apiEmail.emails.send({ from: 'Acme <hello@acme.com>', to: 'ann@example.com', subject: 'Smoke test', text: 'ok' });
  check(sent.id === 'em_smoke', 'send returns the parsed response');
  check(requests[0].url === 'https://api.email/v1/emails', 'send posts to /v1/emails');
  check(new Headers(requests[0].init.headers).get('idempotency-key'), 'send sets an Idempotency-Key');

  const secret = 'whsec_smoke';
  const body = JSON.stringify({ type: 'email.delivered', id: 'evt_smoke', email_id: 'em_smoke', to: 'ann@example.com', at: '2026-10-25T09:12:04Z' });
  const t = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${body}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  const event = await verifyWebhook(body, `t=${t},v1=${hex}`, secret);
  check(event.id === 'evt_smoke', 'verifyWebhook returns the event');
  const tampered = await verifyWebhook(`${body} `, `t=${t},v1=${hex}`, secret).then(
    () => null,
    (e) => e,
  );
  check(tampered instanceof WebhookVerificationError && tampered.reason === 'signature_mismatch', 'a tampered body is rejected');

  let missingKey = null;
  try {
    new ApiEmail('');
  } catch (e) {
    missingKey = e;
  }
  check(missingKey instanceof ApiEmailError && missingKey.code === 'missing_api_key', 'an empty key throws ApiEmailError');

  console.log(`smoke ${label}: ok (api-email ${VERSION})`);
}
