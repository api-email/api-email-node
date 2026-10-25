import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

describe('README', () => {
  it('documents every public method', () => {
    const methods = [
      'emails.send', 'emails.get', 'emails.list', 'emails.listAll', 'emails.cancel',
      'domains.create', 'domains.get', 'domains.list', 'domains.delete',
      'routes.create', 'routes.list', 'routes.delete',
      'inbound.get', 'inbound.list', 'inbound.attachment',
      'webhooks.create', 'webhooks.list', 'webhooks.delete',
      'verifyWebhook',
    ];
    for (const name of methods) expect(readme, name).toContain(name);
  });

  it('says the API is in early access and links the signup page', () => {
    expect(readme).toMatch(/early access/i);
    expect(readme).toContain('https://api.email/signup');
  });

  it('warns against shipping the key to a browser', () => {
    expect(readme).toMatch(/never ship it to a browser/i);
  });
});
