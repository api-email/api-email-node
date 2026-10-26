# api-email

The official Node.js SDK for [api.email](https://api.email): send and receive transactional email through one API.

Get an API key at [api.email/signup](https://api.email/signup). This SDK follows the API documented at [api.email/docs](https://api.email/docs).

## Install

```bash
npm install api-email
```

Requires Node.js 20 or later. The SDK has no dependencies: it uses the built-in `fetch` and Web Crypto, and CI tests it on Node.js 20, 22 and 24, Bun and Deno.

## Send an email

```js
import { ApiEmail } from 'api-email';

const apiEmail = new ApiEmail(process.env.API_EMAIL_KEY);

const email = await apiEmail.emails.send(
  {
    from: 'Acme <hello@acme.com>',
    to: 'ann@example.com',
    subject: 'Reset your password',
    text: 'Reset it here: https://acme.com/r/8f2c',
    html: '<p>Reset it <a href="https://acme.com/r/8f2c">here</a>.</p>',
  },
  { idempotencyKey: 'password-reset-8f2c' },
);

console.log(email.id); // em_…
```

`new ApiEmail()` without an argument reads `API_EMAIL_KEY` from the environment. Field names match the [API reference](https://api.email/docs/api) one to one, in snake_case: `reply_to`, `scheduled_at`, `track_opens`.

Keep the key on your server. Never ship it to a browser or a mobile app.

### Attachments and scheduling

```js
import { readFile } from 'node:fs/promises';

await apiEmail.emails.send({
  from: 'Acme Billing <billing@acme.com>',
  to: ['ann@example.com'],
  subject: 'Your receipt for order 1042',
  text: 'Thanks for your order. Your receipt is attached.',
  attachments: [
    { filename: 'receipt-1042.pdf', content: await readFile('receipt-1042.pdf'), content_type: 'application/pdf' },
  ],
  scheduled_at: new Date(Date.now() + 60 * 60 * 1000),
  tags: ['receipt'],
});
```

`content` takes bytes (`Buffer`, `Uint8Array`, `ArrayBuffer`) or a base64 string; for a `Blob` or `File`, pass `await file.arrayBuffer()`. `scheduled_at` takes a `Date` or an ISO 8601 string, up to 30 days ahead.

### Read, list and cancel

```js
const email = await apiEmail.emails.get('em_8f2c1a');
const page = await apiEmail.emails.list({ status: 'bounced' }); // { data, next_cursor }

for await (const email of apiEmail.emails.listAll({ tag: 'receipt' })) {
  console.log(email.id, email.status);
}

await apiEmail.emails.cancel('em_8f2c1a'); // a scheduled email that has not been sent yet
```

## Domains

```js
const domain = await apiEmail.domains.create({ name: 'acme.com' });
// Publish the two CNAME records in domain.records, then check the status:
const { status } = await apiEmail.domains.get(domain.id); // 'pending' | 'verified' | 'failed'
```

Also `apiEmail.domains.list()`, `apiEmail.domains.listAll()` and `apiEmail.domains.delete(id)`.

## Receive email

Point an MX record at `mx.api.email`, then create a route:

```js
const route = await apiEmail.routes.create({
  match: 'support@in.acme.com',
  forward: 'https://acme.com/hooks/inbound',
});
// route.secret signs every delivery from this route: store it like a password.
```

Received messages are also available through the API:

```js
const message = await apiEmail.inbound.get('in_5d1e7a');
const pdf = await apiEmail.inbound.attachment(message.id, 0); // Uint8Array, kept for 7 days
```

Also `apiEmail.routes.list()`, `apiEmail.routes.listAll()`, `apiEmail.routes.delete(id)`, `apiEmail.inbound.list()` and `apiEmail.inbound.listAll()`.

## Webhooks

```js
const endpoint = await apiEmail.webhooks.create({
  url: 'https://acme.com/hooks/email',
  events: ['email.delivered', 'email.bounced', 'email.complained'],
});
// endpoint.secret signs every event.
```

Also `apiEmail.webhooks.list()`, `apiEmail.webhooks.listAll()` and `apiEmail.webhooks.delete(id)`.

### Verify signatures

Every webhook and route delivery carries an `api-email-signature` header. `verifyWebhook` checks it and returns the parsed event, or throws `WebhookVerificationError`. It needs the raw body exactly as received, because parsed and re-serialised JSON no longer matches the signature. It does not need an API key.

Express:

```js
import express from 'express';
import { verifyWebhook, WebhookVerificationError } from 'api-email';

const app = express();

// Register express.raw() on the webhook route, before any global express.json().
app.post('/hooks/email', express.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const event = await verifyWebhook(req.body, req.headers['api-email-signature'], process.env.API_EMAIL_WEBHOOK_SECRET);
    if (event.type === 'email.bounced') {
      // event.email_id, event.to, event.reason
    }
    res.sendStatus(200);
  } catch (error) {
    if (error instanceof WebhookVerificationError) return res.sendStatus(400);
    next(error);
  }
});
```

Next.js route handler:

```js
import { verifyWebhook } from 'api-email';

export async function POST(request) {
  const body = await request.text();
  try {
    const event = await verifyWebhook(body, request.headers.get('api-email-signature'), process.env.API_EMAIL_WEBHOOK_SECRET);
    // handle the event
    return new Response(null, { status: 200 });
  } catch {
    return new Response('invalid signature', { status: 400 });
  }
}
```

`verifyWebhook` accepts both signatures sent for 24 hours after a secret rotation. It rejects timestamps more than five minutes away; pass `{ tolerance: seconds }` as the fourth argument to change that. An event can arrive more than once, so store `event.id` and skip ids you have already handled.

## Errors

A failed call throws `ApiEmailError`:

```js
import { ApiEmailError } from 'api-email';

try {
  await apiEmail.emails.send(message);
} catch (error) {
  if (error instanceof ApiEmailError) {
    console.log(error.status);    // 403
    console.log(error.code);      // 'domain_not_verified'
    console.log(error.message);   // 'acme.com is not verified'
    console.log(error.hint);      // 'Add the two CNAME records shown in the dashboard.'
    console.log(error.requestId); // include it when you contact support
  }
}
```

When no response arrives, `status` is `null` and `code` is `connection_error` or `timeout`.

## Retries and idempotency

The SDK retries network errors, timeouts, `429` and `5xx` responses up to twice, with exponential backoff, and honours `Retry-After`. Other errors are not retried.

Every POST carries an `Idempotency-Key` that stays the same on every retry, so a retried send never delivers twice. Pass your own key derived from your data, such as `receipt-1042`, to keep retries safe across process restarts too.

```js
const apiEmail = new ApiEmail(process.env.API_EMAIL_KEY, {
  maxRetries: 2,   // the default
  timeout: 60_000, // per attempt, in ms; the default
});

await apiEmail.emails.get('em_8f2c1a', { timeout: 5_000, signal: AbortSignal.timeout(10_000) });
```

## Options

| Option | Default | |
|---|---|---|
| `baseUrl` | `https://api.email/v1` | API base URL |
| `timeout` | `60000` | Milliseconds per attempt |
| `maxRetries` | `2` | Retries after the first attempt |
| `fetch` | `globalThis.fetch` | A custom fetch, for a proxy or tests |

Every method also takes per-request options: `{ signal, timeout, maxRetries }`, plus `idempotencyKey` on `send` and `create` calls.

## TypeScript

Types ship with the package. `SendEmailParams`, `Email`, `Domain`, `Route`, `InboundEmail`, `Webhook`, `WebhookEvent` and the rest are exported from `api-email`.

## License

MIT
