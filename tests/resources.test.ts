import { describe, expect, it } from 'vitest';
import type { ApiEmail } from '../src/client';
import { BASE, client, empty, json, mockFetch } from './helpers';

const domain = {
  id: 'dom_4k2m9',
  name: 'acme.com',
  status: 'pending',
  records: [
    { type: 'CNAME', name: 'send.acme.com', value: 'acme-com.rp.api.email' },
    { type: 'CNAME', name: 'api._domainkey.acme.com', value: 'acme-com.dkim.api.email' },
  ],
};
const route = { id: 'rt_3k9d', match: '*@in.acme.com', forward: 'https://acme.com/hooks/inbound' };
const inbound = {
  id: 'in_5d1e7a',
  from: 'ann@example.com',
  to: 'support@in.acme.com',
  subject: 'Re: Your order #1042 shipped',
  reply_text: 'Can I change the address?',
  headers: {},
  attachments: [],
  auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
  received_at: '2026-10-25T09:14:03Z',
};
const webhook = { id: 'wh_1', url: 'https://acme.com/hooks/email', events: ['email.delivered'] };

interface Case {
  name: string;
  call: (api: ApiEmail) => Promise<unknown>;
  reply: () => Response;
  method: string;
  url: string;
  body?: unknown;
  result: unknown;
}

const cases: Case[] = [
  { name: 'domains.create', call: (api) => api.domains.create({ name: 'acme.com', return_path: 'mail' }), reply: () => json(200, domain), method: 'POST', url: `${BASE}/domains`, body: { name: 'acme.com', return_path: 'mail' }, result: domain },
  { name: 'domains.get', call: (api) => api.domains.get('dom_4k2m9'), reply: () => json(200, domain), method: 'GET', url: `${BASE}/domains/dom_4k2m9`, result: domain },
  { name: 'domains.list', call: (api) => api.domains.list({ cursor: 'c1' }), reply: () => json(200, { data: [domain], next_cursor: null }), method: 'GET', url: `${BASE}/domains?cursor=c1`, result: { data: [domain], next_cursor: null } },
  { name: 'domains.delete', call: (api) => api.domains.delete('dom_4k2m9'), reply: () => empty(204), method: 'DELETE', url: `${BASE}/domains/dom_4k2m9`, result: undefined },
  { name: 'routes.create', call: (api) => api.routes.create({ match: '*@in.acme.com', forward: 'https://acme.com/hooks/inbound' }), reply: () => json(200, { id: 'rt_3k9d', secret: 'whsec_route' }), method: 'POST', url: `${BASE}/routes`, body: { match: '*@in.acme.com', forward: 'https://acme.com/hooks/inbound' }, result: { id: 'rt_3k9d', secret: 'whsec_route' } },
  { name: 'routes.list', call: (api) => api.routes.list(), reply: () => json(200, { data: [route] }), method: 'GET', url: `${BASE}/routes`, result: { data: [route] } },
  { name: 'routes.delete (200 with a body)', call: (api) => api.routes.delete('rt_3k9d'), reply: () => json(200, { id: 'rt_3k9d', deleted: true }), method: 'DELETE', url: `${BASE}/routes/rt_3k9d`, result: undefined },
  { name: 'inbound.get', call: (api) => api.inbound.get('in_5d1e7a'), reply: () => json(200, inbound), method: 'GET', url: `${BASE}/inbound/in_5d1e7a`, result: inbound },
  { name: 'inbound.list', call: (api) => api.inbound.list(), reply: () => json(200, { data: [inbound], next_cursor: 'c2' }), method: 'GET', url: `${BASE}/inbound`, result: { data: [inbound], next_cursor: 'c2' } },
  { name: 'webhooks.create', call: (api) => api.webhooks.create({ url: 'https://acme.com/hooks/email', events: ['email.delivered', 'email.bounced'] }), reply: () => json(200, { id: 'wh_1', secret: 'whsec_hook' }), method: 'POST', url: `${BASE}/webhooks`, body: { url: 'https://acme.com/hooks/email', events: ['email.delivered', 'email.bounced'] }, result: { id: 'wh_1', secret: 'whsec_hook' } },
  { name: 'webhooks.list', call: (api) => api.webhooks.list(), reply: () => json(200, { data: [webhook] }), method: 'GET', url: `${BASE}/webhooks`, result: { data: [webhook] } },
  { name: 'webhooks.delete', call: (api) => api.webhooks.delete('wh_1'), reply: () => empty(204), method: 'DELETE', url: `${BASE}/webhooks/wh_1`, result: undefined },
];

describe('resources', () => {
  it.each(cases)('$name', async ({ call, reply, method, url, body, result }) => {
    const { fetch, requests } = mockFetch(reply());
    expect(await call(client(fetch))).toEqual(result);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method, url });
    expect(requests[0]!.body).toEqual(body);
    if (method === 'POST') expect(requests[0]!.headers['idempotency-key']).toBeTruthy();
  });

  it('inbound.attachment downloads the bytes', async () => {
    const { fetch, requests } = mockFetch(new Response(new Uint8Array([0, 1, 254, 255]), { status: 200, headers: { 'content-type': 'application/pdf' } }));
    const bytes = await client(fetch).inbound.attachment('in_5d1e7a', 0);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([0, 1, 254, 255]);
    expect(requests[0]).toMatchObject({ method: 'GET', url: `${BASE}/inbound/in_5d1e7a/attachments/0`, headers: { accept: '*/*' } });
  });

  it('inbound.attachment rejects a negative or fractional index', async () => {
    const { fetch, requests } = mockFetch();
    const api = client(fetch);
    await expect(api.inbound.attachment('in_1', -1)).rejects.toThrow(TypeError);
    await expect(api.inbound.attachment('in_1', 1.5)).rejects.toThrow(TypeError);
    expect(requests).toHaveLength(0);
  });

  it('listAll walks every page on each list resource', async () => {
    for (const name of ['domains', 'routes', 'inbound', 'webhooks'] as const) {
      const { fetch, requests } = mockFetch(json(200, { data: [{ id: 'a' }], next_cursor: 'c2' }), json(200, { data: [{ id: 'b' }] }));
      const ids: string[] = [];
      for await (const item of client(fetch)[name].listAll()) ids.push(item.id);
      expect(ids, name).toEqual(['a', 'b']);
      expect(requests.map((r) => r.url), name).toEqual([`${BASE}/${name}`, `${BASE}/${name}?cursor=c2`]);
    }
  });

  it('rejects an empty id instead of calling the collection URL', async () => {
    const { fetch, requests } = mockFetch();
    const api = client(fetch);
    const calls = [
      () => api.domains.get(''),
      () => api.domains.delete(''),
      () => api.routes.delete(''),
      () => api.inbound.get(''),
      () => api.inbound.attachment('', 0),
      () => api.webhooks.delete(''),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow(TypeError);
    expect(requests).toHaveLength(0);
  });
});
