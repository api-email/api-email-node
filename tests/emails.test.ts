import { describe, expect, it } from 'vitest';
import { BASE, client, json, mockFetch } from './helpers';

describe('emails', () => {
  it('send posts the documented fields and returns the response', async () => {
    const { fetch, requests } = mockFetch(json(200, { id: 'em_8f2c1a', status: 'queued' }));
    const result = await client(fetch).emails.send(
      {
        from: 'Acme <hello@acme.com>',
        to: ['ann@example.com'],
        subject: 'Reset your password',
        text: 'Reset it here',
        reply_to: 'support@acme.com',
        tags: ['reset'],
        track_opens: true,
      },
      { idempotencyKey: 'reset-8f2c' },
    );
    expect(result).toEqual({ id: 'em_8f2c1a', status: 'queued' });
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: `${BASE}/emails`,
      headers: { 'idempotency-key': 'reset-8f2c' },
      body: {
        from: 'Acme <hello@acme.com>',
        to: ['ann@example.com'],
        subject: 'Reset your password',
        text: 'Reset it here',
        reply_to: 'support@acme.com',
        tags: ['reset'],
        track_opens: true,
      },
    });
  });

  it('send turns a Date into ISO 8601 and bytes into base64', async () => {
    // 100 000 bytes crosses the 32 KB chunk size and covers every byte value.
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 7) % 256);
    const { fetch, requests } = mockFetch(json(200, { id: 'em_1', status: 'scheduled', scheduled_at: '2026-11-01T09:00:00.000Z' }));
    await client(fetch).emails.send({
      from: 'billing@acme.com',
      to: 'ann@example.com',
      subject: 'Receipt',
      html: '<p>Thanks</p>',
      scheduled_at: new Date('2026-11-01T09:00:00Z'),
      attachments: [
        { filename: 'receipt.pdf', content: bytes, content_type: 'application/pdf' },
        { filename: 'note.txt', content: 'aGk=', content_type: 'text/plain' },
      ],
    });
    const body = requests[0]!.body as { scheduled_at: string; attachments: { filename: string; content: string; content_type: string }[] };
    expect(body.scheduled_at).toBe('2026-11-01T09:00:00.000Z');
    expect(body.attachments[0]).toEqual({ filename: 'receipt.pdf', content: Buffer.from(bytes).toString('base64'), content_type: 'application/pdf' });
    expect(body.attachments[1]!.content).toBe('aGk=');
  });

  it('send base64-encodes an ArrayBuffer or any typed-array view of attachment bytes', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const expected = Buffer.from(bytes).toString('base64');
    const view = new DataView(new Uint8Array([9, ...bytes, 9]).buffer, 1, bytes.length);
    const { fetch, requests } = mockFetch(json(200, {}), json(200, {}));
    for (const content of [bytes.slice().buffer, view]) {
      await client(fetch).emails.send({
        from: 'a@acme.com',
        to: 'b@example.com',
        subject: 's',
        text: 't',
        attachments: [{ filename: 'f.bin', content: content as ArrayBuffer, content_type: 'application/octet-stream' }],
      });
    }
    for (const r of requests) expect((r.body as { attachments: { content: string }[] }).attachments[0]!.content).toBe(expected);
  });

  it('send rejects attachment content it cannot encode, with a hint for Blob', async () => {
    const { fetch, requests } = mockFetch();
    const api = client(fetch);
    const send = (content: unknown) =>
      api.emails.send({ from: 'a@acme.com', to: 'b@example.com', subject: 's', text: 't', attachments: [{ filename: 'f', content: content as string, content_type: 'text/plain' }] });
    await expect(send(new Blob(['hi']))).rejects.toThrow(/arrayBuffer\(\)/);
    await expect(send(42)).rejects.toThrow(TypeError);
    await expect(send({ data: [1, 2] })).rejects.toThrow(TypeError);
    expect(requests).toHaveLength(0);
  });

  it('send requires text or html at compile time', () => {
    const api = client(mockFetch().fetch);
    // @ts-expect-error: neither text nor html
    const call = () => api.emails.send({ from: 'a@acme.com', to: 'b@example.com', subject: 's' });
    expect(typeof call).toBe('function');
  });

  it('get encodes the id', async () => {
    const { fetch, requests } = mockFetch(json(200, { id: 'em/1' }));
    await client(fetch).emails.get('em/1');
    expect(requests[0]).toMatchObject({ method: 'GET', url: `${BASE}/emails/em%2F1` });
  });

  it('list sends only the filters that are set', async () => {
    const { fetch, requests } = mockFetch(json(200, { data: [], next_cursor: null }));
    const page = await client(fetch).emails.list({ status: 'bounced', tag: 'receipt', cursor: 'c2' });
    expect(page).toEqual({ data: [], next_cursor: null });
    expect(requests[0]!.url).toBe(`${BASE}/emails?status=bounced&tag=receipt&cursor=c2`);
  });

  it('listAll walks next_cursor until the last page', async () => {
    const { fetch, requests } = mockFetch(
      json(200, { data: [{ id: 'em_1' }, { id: 'em_2' }], next_cursor: 'c2' }),
      json(200, { data: [{ id: 'em_3' }], next_cursor: 'c3' }),
      json(200, { data: [{ id: 'em_4' }], next_cursor: null }),
    );
    const ids: string[] = [];
    for await (const email of client(fetch).emails.listAll({ status: 'delivered' })) ids.push(email.id);
    expect(ids).toEqual(['em_1', 'em_2', 'em_3', 'em_4']);
    expect(requests.map((r) => r.url)).toEqual([
      `${BASE}/emails?status=delivered`,
      `${BASE}/emails?status=delivered&cursor=c2`,
      `${BASE}/emails?status=delivered&cursor=c3`,
    ]);
  });

  it('listAll stops when next_cursor is missing or repeats', async () => {
    const one = mockFetch(json(200, { data: [{ id: 'em_1' }] }));
    const seen: string[] = [];
    for await (const email of client(one.fetch).emails.listAll()) seen.push(email.id);
    expect(seen).toEqual(['em_1']);

    const loop = mockFetch(json(200, { data: [{ id: 'em_1' }], next_cursor: 'c1' }), json(200, { data: [{ id: 'em_2' }], next_cursor: 'c1' }));
    const looped: string[] = [];
    for await (const email of client(loop.fetch).emails.listAll()) looped.push(email.id);
    expect(looped).toEqual(['em_1', 'em_2']);
    expect(loop.requests).toHaveLength(2);
  });

  it('cancel deletes and returns the canceled email', async () => {
    const { fetch, requests } = mockFetch(json(200, { id: 'em_1', status: 'canceled' }));
    expect(await client(fetch).emails.cancel('em_1')).toEqual({ id: 'em_1', status: 'canceled' });
    expect(requests[0]).toMatchObject({ method: 'DELETE', url: `${BASE}/emails/em_1` });
  });

  it('rejects an empty id without sending a request', async () => {
    const { fetch, requests } = mockFetch();
    const api = client(fetch);
    await expect(api.emails.get('')).rejects.toThrow(TypeError);
    await expect(api.emails.cancel(undefined as unknown as string)).rejects.toThrow(TypeError);
    expect(requests).toHaveLength(0);
  });
});
