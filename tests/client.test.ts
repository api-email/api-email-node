import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiEmail } from '../src/client';
import { ApiEmailError } from '../src/errors';
import { json, mockFetch } from './helpers';

const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('new ApiEmail', () => {
  const saved = process.env.API_EMAIL_KEY;
  beforeEach(() => {
    delete process.env.API_EMAIL_KEY;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.API_EMAIL_KEY;
    else process.env.API_EMAIL_KEY = saved;
  });

  it('throws missing_api_key without a key or API_EMAIL_KEY', () => {
    for (const make of [() => new ApiEmail(), () => new ApiEmail(''), () => new ApiEmail('   ')]) {
      const error = thrown(make);
      expect(error).toBeInstanceOf(ApiEmailError);
      expect(error).toMatchObject({ status: null, code: 'missing_api_key' });
    }
  });

  it('reads API_EMAIL_KEY when no key is passed, and trims keys', async () => {
    process.env.API_EMAIL_KEY = 'ae_test_env\n';
    const { fetch, requests } = mockFetch(json(200, {}), json(200, {}));
    await new ApiEmail(undefined, { fetch }).emails.get('em_1');
    await new ApiEmail('  ae_test_arg ', { fetch }).emails.get('em_1');
    expect(requests[0]!.headers.authorization).toBe('Bearer ae_test_env');
    expect(requests[1]!.headers.authorization).toBe('Bearer ae_test_arg');
  });

  it('runs the api.email home-page snippet as written', async () => {
    process.env.API_EMAIL_KEY = 'ae_test_home';
    const { fetch, requests } = mockFetch(json(200, { id: 'em_1', status: 'queued' }));
    const mail = new ApiEmail(process.env.API_EMAIL_KEY, { fetch });
    await mail.emails.send({
      from: 'Acme <hello@acme.com>',
      to: 'ann@example.com',
      subject: 'Reset your password',
      html: "<a href='https://acme.com/r/…'>Reset</a>",
    });
    expect(requests[0]).toMatchObject({ method: 'POST', url: 'https://api.email/v1/emails', headers: { authorization: 'Bearer ae_test_home' } });
  });
});
